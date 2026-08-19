import { calculateStandings } from "@/lib/standings-calculator";

type JsonRecord = Record<string, unknown>;

export type SeriesCarryOverGameLike = {
  id?: string | number | null;
  competition_id?: string | null;
  phase_id?: string | null;
  cycle_number?: string | number | null;
  round_number?: string | number | null;
  game_order?: string | number | null;
  home_team_id?: string | null;
  away_team_id?: string | null;
  home_team_name?: string | null;
  away_team_name?: string | null;
  home_score?: string | number | null;
  away_score?: string | number | null;
  status?: string | null;
  scheduled_date?: string | null;
  scheduled_time?: string | null;
  round_label?: string | null;
};

export type SeriesCarryOverPhaseLike = {
  id?: string | number | null;
  competition_id?: string | null;
  name?: string | null;
  format?: string | null;
  phase_kind?: string | null;
  lifecycle_status?: string | null;
  previous_phase_id?: string | number | null;
  wins_required?: string | number | null;
  carry_over_enabled?: string | number | null;
  carry_over_source_phase_id?: string | null;
  rule_settings_json?: unknown;
  settings_json?: unknown;
};

export type SeriesCarryOverMatchupLike = {
  id: string;
  slotA: {
    type?: string | null;
    teamId?: string | null;
    matchupId?: string | null;
    position?: string | null;
  };
  slotB: {
    type?: string | null;
    teamId?: string | null;
    matchupId?: string | null;
    position?: string | null;
  };
};

export type SeriesCarryOverMeetingResolution = {
  meetingNumber: number;
  state: "resolved" | "pending" | "error";
  message: string;
  gameId?: string | null;
  winnerTeamId?: string | null;
  winnerTeamName?: string | null;
};

export type SeriesCarryOverMatchupResolution = {
  matchupId: string;
  label: string;
  teamAId: string | null;
  teamAName: string | null;
  teamBId: string | null;
  teamBName: string | null;
  selectedMeetings: number[];
  sourcePhaseId: string | null;
  sourcePhaseName: string | null;
  sourcePhaseGamesPerPairing?: number;
  meetingResolutions: SeriesCarryOverMeetingResolution[];
  startingWinsA: number | null;
  startingWinsB: number | null;
  currentSeriesDecided: boolean;
  maxNewGames: number | null;
  state: "resolved" | "pending" | "error";
  message: string;
};

export type SeriesCarryOverResolution = {
  carryOverEnabled: boolean;
  sourcePhaseId: string | null;
  sourcePhaseName: string | null;
  selectedMeetings: number[];
  matchups: SeriesCarryOverMatchupResolution[];
};

export type SeriesCarryOverTeamLike = {
  id?: string | number | null;
  name?: string | null;
};

export type FinalizedStandingsPositionLike = {
  position: number;
  teamId: string;
  teamName: string;
};

const parseJsonRecord = (input: unknown): JsonRecord => {
  if (!input) return {};
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : {};
    } catch {
      return {};
    }
  }
  if (typeof input === "object" && !Array.isArray(input)) return input as JsonRecord;
  return {};
};

const parseSlotArray = (value: unknown) => {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const row = item as JsonRecord;
      const slotA = row.slotA as JsonRecord | undefined;
      const slotB = row.slotB as JsonRecord | undefined;
      if (!slotA || !slotB) return null;
      return {
        id: String(row.id || `matchup-${index}`),
        slotA: {
          type: String(slotA.type || ""),
          teamId: String(slotA.teamId || "").trim() || null,
          matchupId: String(slotA.matchupId || "").trim() || null,
          position: String(slotA.position || "").trim() || null,
        },
        slotB: {
          type: String(slotB.type || ""),
          teamId: String(slotB.teamId || "").trim() || null,
          matchupId: String(slotB.matchupId || "").trim() || null,
          position: String(slotB.position || "").trim() || null,
        },
      };
    })
    .filter(Boolean) as SeriesCarryOverMatchupLike[];
};

const toInt = (value: unknown, fallback = 0) => {
  const candidate = Number(value);
  return Number.isInteger(candidate) ? candidate : fallback;
};

const getSeriesSettings = (phase: SeriesCarryOverPhaseLike | undefined) => {
  if (!phase) return {};
  const raw = {
    ...parseJsonRecord(phase.settings_json),
    ...parseJsonRecord(phase.rule_settings_json),
  };
  return raw;
};

const getSourceTeam = (
  slot: SeriesCarryOverMatchupLike["slotA"] | SeriesCarryOverMatchupLike["slotB"],
  teams: SeriesCarryOverTeamLike[],
) => {
  const teamId = String(slot.teamId ?? "").trim() || null;
  const teamName = teamId ? (teams.find((team) => String(team.id ?? "") === teamId)?.name ?? null) : null;
  return { teamId, teamName };
};

const getMatchupLabel = (teamAName: string | null, teamBName: string | null) => {
  if (teamAName && teamBName) return `${teamAName} — ${teamBName}`;
  if (teamAName) return `${teamAName} — —`;
  if (teamBName) return `— — ${teamBName}`;
  return "—";
};

const getMeetingLabel = (meetingNumber: number) => `${meetingNumber}η συνάντηση`;

const getMeetingOrder = (meetingNumbers: number[]) => {
  return [...new Set(meetingNumbers)].sort((left, right) => left - right);
};

const resolveSourceGameWinner = (game: SeriesCarryOverGameLike, teamAId: string, teamBId: string) => {
  const homeTeamId = String(game.home_team_id ?? "").trim();
  const awayTeamId = String(game.away_team_id ?? "").trim();
  const homeScore = Number(game.home_score);
  const awayScore = Number(game.away_score);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore) || homeScore === awayScore) return null;
  const homeWon = homeScore > awayScore;
  if (homeTeamId === teamAId && awayTeamId === teamBId) return homeWon ? teamAId : teamBId;
  if (homeTeamId === teamBId && awayTeamId === teamAId) return homeWon ? teamBId : teamAId;
  return null;
};

const normalizePhaseFormat = (phase: SeriesCarryOverPhaseLike | undefined) => {
  const raw = String(phase?.format ?? phase?.phase_kind ?? "").trim().toLowerCase();
  return raw === "regular_season" ? "standings" : raw;
};

const parsePhaseParticipants = (
  phase: SeriesCarryOverPhaseLike | undefined,
  teams: SeriesCarryOverTeamLike[],
) => {
  const settings = getSeriesSettings(phase);
  const participantConfig = parseJsonRecord(settings.participantConfiguration);
  const participantSourceType = String(participantConfig.participantSourceType ?? "competition_participants").trim() || "competition_participants";
  if (participantSourceType === "selected_teams") {
    const selectedIds = Array.isArray(participantConfig.selectedTeamIds)
      ? [...new Set(participantConfig.selectedTeamIds.map((value) => String(value ?? "").trim()).filter(Boolean))]
      : [];
    if (!selectedIds.length) return [];
    return selectedIds.map((teamId) => {
      const team = teams.find((entry) => String(entry.id ?? "") === teamId);
      return {
        id: teamId,
        name: String(team?.name ?? "—"),
      };
    }).filter((entry) => entry.id);
  }
  return teams
    .map((team) => ({ id: String(team.id ?? "").trim(), name: String(team.name ?? "—") }))
    .filter((team) => team.id);
};

export const resolveFinalizedStandingsPositions = (
  phases: SeriesCarryOverPhaseLike[],
  games: SeriesCarryOverGameLike[],
  teams: SeriesCarryOverTeamLike[],
  sourcePhaseId?: string | null,
): {
  state: "resolved" | "pending" | "error";
  message: string;
  sourcePhaseId: string | null;
  sourcePhaseName: string | null;
  positions: FinalizedStandingsPositionLike[];
} => {
  const normalizedSourcePhaseId = String(sourcePhaseId ?? "").trim() || null;
  if (!normalizedSourcePhaseId) {
    return {
      state: "pending",
      message: "Σε αναμονή προσδιορισμού φάσης προέλευσης.",
      sourcePhaseId: null,
      sourcePhaseName: null,
      positions: [],
    };
  }

  const sourcePhase = phases.find((entry) => String(entry.id ?? "") === normalizedSourcePhaseId);
  if (!sourcePhase) {
    return {
      state: "pending",
      message: "Σε αναμονή προσδιορισμού φάσης προέλευσης.",
      sourcePhaseId: normalizedSourcePhaseId,
      sourcePhaseName: null,
      positions: [],
    };
  }

  if (String(sourcePhase.lifecycle_status ?? "active") !== "finalized") {
    return {
      state: "pending",
      message: "Σε αναμονή οριστικοποίησης φάσης προέλευσης.",
      sourcePhaseId: normalizedSourcePhaseId,
      sourcePhaseName: sourcePhase.name ?? null,
      positions: [],
    };
  }

  if (normalizePhaseFormat(sourcePhase) !== "standings") {
    return {
      state: "error",
      message: "Η φάση προέλευσης δεν είναι βαθμολογική.",
      sourcePhaseId: normalizedSourcePhaseId,
      sourcePhaseName: sourcePhase.name ?? null,
      positions: [],
    };
  }

  const sourceParticipants = parsePhaseParticipants(sourcePhase, teams);
  if (!sourceParticipants.length) {
    return {
      state: "error",
      message: "Η φάση προέλευσης δεν έχει έγκυρους συμμετέχοντες.",
      sourcePhaseId: normalizedSourcePhaseId,
      sourcePhaseName: sourcePhase.name ?? null,
      positions: [],
    };
  }

  const sourceSettings = getSeriesSettings(sourcePhase);
  const standings = calculateStandings({
    phaseId: normalizedSourcePhaseId,
    teams: sourceParticipants.map((team) => ({
      id: String(team.id ?? ""),
      name: String(team.name ?? "—"),
    })),
    games: games.map((game) => ({
      id: String(game.id ?? ""),
      phaseId: String(game.phase_id ?? null),
      homeTeamId: String(game.home_team_id ?? ""),
      awayTeamId: String(game.away_team_id ?? ""),
      homeScore: game.home_score ?? null,
      awayScore: game.away_score ?? null,
      status: String(game.status ?? null),
      resultSource: null,
    })),
    rules: {
      pointsForWin: Math.max(0, toInt(sourceSettings.pointsForWin ?? sourceSettings.winPoints ?? 2, 2)),
      pointsForLoss: Math.max(0, toInt(sourceSettings.pointsForLoss ?? sourceSettings.lossPoints ?? 1, 1)),
    },
    tieBreakers: Array.isArray(sourceSettings.tieBreakers) ? sourceSettings.tieBreakers as never : undefined,
  });

  return {
    state: "resolved",
    message: "Η φάση προέλευσης έχει οριστικοποιηθεί.",
    sourcePhaseId: normalizedSourcePhaseId,
    sourcePhaseName: sourcePhase.name ?? null,
    positions: standings.orderedRows.map((row: { rank: number; teamId: string; teamName: string }) => ({
      position: Number(row.rank),
      teamId: String(row.teamId),
      teamName: String(row.teamName ?? "—"),
    })),
  };
};

export const resolveSeriesCarryOver = (
  phases: SeriesCarryOverPhaseLike[],
  games: SeriesCarryOverGameLike[],
  teams: SeriesCarryOverTeamLike[],
  phase?: SeriesCarryOverPhaseLike,
): SeriesCarryOverResolution => {
  if (!phase) {
    return {
      carryOverEnabled: false,
      sourcePhaseId: null,
      sourcePhaseName: null,
      selectedMeetings: [],
      matchups: [],
    };
  }

  const settings = getSeriesSettings(phase);
  const carryOverEnabled = Number(phase.carry_over_enabled ?? 0) === 1;
  const sourcePhaseId = carryOverEnabled ? String(phase.carry_over_source_phase_id ?? "").trim() || null : null;
  const sourcePhase = sourcePhaseId ? phases.find((entry) => String(entry.id ?? "") === sourcePhaseId) : undefined;
  const sourceSettings = getSeriesSettings(sourcePhase);
  const sourceGamesPerPairing = Math.max(1, toInt(sourceSettings.gamesPerPairing, 1));
  const selectedMeetings = getMeetingOrder(
    Array.isArray(settings.carryOverMeetingNumbers)
      ? settings.carryOverMeetingNumbers.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1 && value <= sourceGamesPerPairing)
      : [1].filter((value) => value <= sourceGamesPerPairing),
  );
  const bracketConfig = parseJsonRecord(settings.bracketConfiguration);
  const matchupDefinitions = parseSlotArray(bracketConfig.matchups);
  const sourceGames = games.filter((game) =>
    String(game.phase_id ?? "") === String(sourcePhaseId ?? "") &&
    String(game.competition_id ?? "") === String(phase.competition_id ?? ""),
  );
  const positionResolution = resolveFinalizedStandingsPositions(
    phases,
    games.filter((game) => String(game.phase_id ?? "") === String(sourcePhaseId ?? "")),
    teams,
    String(phase.previous_phase_id ?? sourcePhaseId ?? "").trim() || null,
  );
  const positionMap = new Map<number, FinalizedStandingsPositionLike>(
    positionResolution.positions.map((entry) => [entry.position, entry]),
  );
  const resolveStandingPosition = (position: string | null | undefined) => {
    const normalized = Number(String(position ?? "").trim());
    if (!Number.isInteger(normalized) || normalized < 1) {
      return { teamId: null, teamName: null, message: "Σε αναμονή προσδιορισμού ομάδων." };
    }
    const resolved = positionMap.get(normalized);
    if (!resolved) {
      return {
        teamId: null,
        teamName: null,
        message: positionResolution.state === "pending"
          ? "Σε αναμονή οριστικοποίησης φάσης προέλευσης."
          : positionResolution.message,
      };
    }
    return {
      teamId: resolved.teamId,
      teamName: resolved.teamName,
      message: "",
    };
  };

  const matchupResolutions = matchupDefinitions.map((matchup) => {
    const rawTeamA = getSourceTeam(matchup.slotA, teams);
    const rawTeamB = getSourceTeam(matchup.slotB, teams);
    const standingTeamA = String(matchup.slotA.type ?? "").trim() === "standing_position"
      ? resolveStandingPosition(matchup.slotA.position)
      : { teamId: null, teamName: null, message: "" };
    const standingTeamB = String(matchup.slotB.type ?? "").trim() === "standing_position"
      ? resolveStandingPosition(matchup.slotB.position)
      : { teamId: null, teamName: null, message: "" };
    const teamA = standingTeamA.teamId ? standingTeamA : rawTeamA;
    const teamB = standingTeamB.teamId ? standingTeamB : rawTeamB;
    const concreteTeamsResolved = Boolean(teamA.teamId && teamB.teamId);
    const selectedMeetingResolutions: SeriesCarryOverMeetingResolution[] = [];
    let startingWinsA: number | null = concreteTeamsResolved ? 0 : null;
    let startingWinsB: number | null = concreteTeamsResolved ? 0 : null;
    let unresolvedMessage = "";

    if (!carryOverEnabled) {
      return {
        matchupId: matchup.id,
        label: getMatchupLabel(teamA.teamName, teamB.teamName),
        teamAId: teamA.teamId,
        teamAName: teamA.teamName,
        teamBId: teamB.teamId,
        teamBName: teamB.teamName,
        selectedMeetings,
        sourcePhaseId,
        sourcePhaseName: sourcePhase?.name ?? null,
        sourceGamesPerPairing,
        meetingResolutions: [],
        startingWinsA: null,
        startingWinsB: null,
        currentSeriesDecided: false,
        maxNewGames: null,
        state: "resolved" as const,
        message: "Μεταφορά προηγούμενων μεταξύ τους αγώνων: Όχι",
      };
    }

    if (!sourcePhaseId || !sourcePhase) {
      return {
        matchupId: matchup.id,
        label: getMatchupLabel(teamA.teamName, teamB.teamName),
        teamAId: teamA.teamId,
        teamAName: teamA.teamName,
        teamBId: teamB.teamId,
        teamBName: teamB.teamName,
        selectedMeetings,
        sourcePhaseId,
        sourcePhaseName: sourcePhase?.name ?? null,
        sourceGamesPerPairing,
        meetingResolutions: [],
        startingWinsA: null,
        startingWinsB: null,
        currentSeriesDecided: false,
        maxNewGames: null,
        state: "pending" as const,
        message: "Σε αναμονή προσδιορισμού φάσης προέλευσης.",
      };
    }

    if (!teamA.teamId || !teamB.teamId) {
      return {
        matchupId: matchup.id,
        label: getMatchupLabel(teamA.teamName, teamB.teamName),
        teamAId: teamA.teamId,
        teamAName: teamA.teamName,
        teamBId: teamB.teamId,
        teamBName: teamB.teamName,
        selectedMeetings,
        sourcePhaseId,
        sourcePhaseName: sourcePhase.name ?? null,
        sourceGamesPerPairing,
        meetingResolutions: [],
        startingWinsA: null,
        startingWinsB: null,
        currentSeriesDecided: false,
        maxNewGames: null,
        state: "pending" as const,
        message: standingTeamA.message || standingTeamB.message || "Σε αναμονή προσδιορισμού ομάδων.",
      };
    }

    for (const meetingNumber of selectedMeetings) {
      const matches = sourceGames.filter((game) => String(game.cycle_number ?? "") === String(meetingNumber));
      const matchingPairGames = matches.filter((game) => {
        const homeTeamId = String(game.home_team_id ?? "").trim();
        const awayTeamId = String(game.away_team_id ?? "").trim();
        return (
          (homeTeamId === teamA.teamId && awayTeamId === teamB.teamId) ||
          (homeTeamId === teamB.teamId && awayTeamId === teamA.teamId)
        );
      });

      if (matchingPairGames.length !== 1) {
        selectedMeetingResolutions.push({
          meetingNumber,
          state: "error",
          message: matchingPairGames.length === 0
            ? `Δεν βρέθηκε προηγούμενος αγώνας για την ${getMeetingLabel(meetingNumber)}.`
            : `Βρέθηκαν πολλαπλοί αγώνες για την ${getMeetingLabel(meetingNumber)}.`,
        });
        unresolvedMessage = matchingPairGames.length === 0
          ? "Σε αναμονή επίλυσης προηγούμενου αγώνα."
          : "Ασυμφωνία δεδομένων προηγούμενου αγώνα.";
        startingWinsA = null;
        startingWinsB = null;
        continue;
      }

      const game = matchingPairGames[0];
      const winnerTeamId = resolveSourceGameWinner(game, teamA.teamId, teamB.teamId);
      if (!winnerTeamId) {
        selectedMeetingResolutions.push({
          meetingNumber,
          state: "pending",
          message: String(game.status ?? "").toLowerCase() === "completed"
            ? "Ο προηγούμενος αγώνας δεν έχει έγκυρο νικητή."
            : "Σε αναμονή αποτελέσματος προηγούμενου αγώνα.",
          gameId: String(game.id ?? ""),
        });
        unresolvedMessage = "Σε αναμονή αποτελέσματος προηγούμενου αγώνα.";
        startingWinsA = null;
        startingWinsB = null;
        continue;
      }

      const winnerName = winnerTeamId === teamA.teamId ? teamA.teamName : teamB.teamName;
      selectedMeetingResolutions.push({
        meetingNumber,
        state: "resolved",
        message: winnerName ? `${getMeetingLabel(meetingNumber)}: ${winnerName} κέρδισε.` : `${getMeetingLabel(meetingNumber)}: 1 αποτέλεσμα.`,
        gameId: String(game.id ?? ""),
        winnerTeamId,
        winnerTeamName: winnerName,
      });
      if (startingWinsA !== null && startingWinsB !== null) {
        if (winnerTeamId === teamA.teamId) startingWinsA += 1;
        if (winnerTeamId === teamB.teamId) startingWinsB += 1;
      }
    }

    const allResolved = selectedMeetingResolutions.length > 0 && selectedMeetingResolutions.every((entry) => entry.state === "resolved");
    if (!allResolved) {
      return {
        matchupId: matchup.id,
        label: getMatchupLabel(teamA.teamName, teamB.teamName),
        teamAId: teamA.teamId,
        teamAName: teamA.teamName,
        teamBId: teamB.teamId,
        teamBName: teamB.teamName,
        selectedMeetings,
        sourcePhaseId,
        sourcePhaseName: sourcePhase.name ?? null,
        sourceGamesPerPairing,
        meetingResolutions: selectedMeetingResolutions,
        startingWinsA: null,
        startingWinsB: null,
        currentSeriesDecided: false,
        maxNewGames: null,
        state: "pending" as const,
        message: unresolvedMessage || "Σε αναμονή επίλυσης προηγούμενων αγώνων.",
      };
    }

    const winsRequired = Math.max(1, toInt(phase.wins_required, 2));
    const resolvedWinsA = startingWinsA ?? 0;
    const resolvedWinsB = startingWinsB ?? 0;
    const currentSeriesDecided = resolvedWinsA >= winsRequired || resolvedWinsB >= winsRequired;
    const maxNewGames = currentSeriesDecided
      ? 0
      : Math.max(0, (winsRequired - resolvedWinsA) + (winsRequired - resolvedWinsB) - 1);

    return {
      matchupId: matchup.id,
      label: getMatchupLabel(teamA.teamName, teamB.teamName),
      teamAId: teamA.teamId,
      teamAName: teamA.teamName,
      teamBId: teamB.teamId,
      teamBName: teamB.teamName,
      selectedMeetings,
      sourcePhaseId,
      sourcePhaseName: sourcePhase.name ?? null,
      sourceGamesPerPairing,
      meetingResolutions: selectedMeetingResolutions,
      startingWinsA: resolvedWinsA,
      startingWinsB: resolvedWinsB,
      currentSeriesDecided,
      maxNewGames,
      state: "resolved" as const,
      message: currentSeriesDecided
        ? "Η σειρά έχει ήδη κριθεί από τη μεταφορά προηγούμενων αποτελεσμάτων."
        : `Αφετηρία σειράς: ${resolvedWinsA}–${resolvedWinsB}.`,
    };
  });

  return {
    carryOverEnabled,
    sourcePhaseId,
    sourcePhaseName: sourcePhase?.name ?? null,
    selectedMeetings,
    matchups: matchupResolutions,
  };
};
