import { calculateSeriesProgression, type SeriesProgressionMaterializedGame, type SeriesProgressionTransferredGame } from "@/lib/series-progression";
import {
  classifySeriesBracketEntry,
  resolveFinalizedStandingsPositions,
  resolveSeriesCarryOver,
  resolveSeriesParticipantSourcePhaseId,
  type FinalizedSeriesOutcomeReferenceResolution,
  type SeriesCarryOverGameLike,
  type SeriesCarryOverMatchupLike,
  type SeriesCarryOverPhaseLike,
  type SeriesCarryOverTeamLike,
  type SeriesPhaseCompletion,
  type SeriesPhaseCompletionBlocker,
  type SeriesPhaseCompletionBlockerCode,
} from "@/lib/series-carry-over";

type JsonRecord = Record<string, unknown>;

const parseRecord = (value: unknown): JsonRecord => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonRecord : {};
    } catch {
      return {};
    }
  }
  return typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
};

const settingsFor = (phase?: SeriesCarryOverPhaseLike) => ({
  ...parseRecord(phase?.settings_json),
  ...parseRecord(phase?.rule_settings_json),
});

const parseMatchups = (phase?: SeriesCarryOverPhaseLike): SeriesCarryOverMatchupLike[] => {
  const bracket = parseRecord(settingsFor(phase).bracketConfiguration);
  if (!Array.isArray(bracket.matchups)) return [];
  return bracket.matchups.flatMap((value, index) => {
    const row = parseRecord(value);
    const slotA = parseRecord(row.slotA);
    const slotB = parseRecord(row.slotB);
    if (!Object.keys(slotA).length || !Object.keys(slotB).length) return [];
    const slot = (source: JsonRecord) => ({
      type: String(source.type ?? "").trim() || null,
      teamId: String(source.teamId ?? "").trim() || null,
      matchupId: String(source.matchupId ?? "").trim() || null,
      position: String(source.position ?? "").trim() || null,
    });
    return [{ id: String(row.id ?? `matchup-${index}`), slotA: slot(slotA), slotB: slot(slotB) }];
  });
};

const blocker = (
  code: SeriesPhaseCompletionBlockerCode,
  message: string,
  matchupId: string | null = null,
  seriesRoundNumber: number | null = null,
): SeriesPhaseCompletionBlocker => ({ code, message, matchupId, seriesRoundNumber });

const phaseFormat = (phase?: SeriesCarryOverPhaseLike) => {
  const value = String(phase?.format ?? phase?.phase_kind ?? "").trim().toLowerCase();
  return value === "regular_season" ? "standings" : value;
};

const teamById = (teams: SeriesCarryOverTeamLike[], teamId?: string | null) => {
  const id = String(teamId ?? "").trim();
  const team = teams.find((entry) => String(entry.id ?? "") === id);
  return id && team ? { state: "resolved" as const, teamId: id, teamName: String(team.name ?? "—"), message: "" } : null;
};

const resolveDirectSlot = (
  phases: SeriesCarryOverPhaseLike[],
  games: SeriesCarryOverGameLike[],
  teams: SeriesCarryOverTeamLike[],
  phase: SeriesCarryOverPhaseLike,
  slot: SeriesCarryOverMatchupLike["slotA"],
) => {
  const type = String(slot.type ?? "").trim();
  if (type === "fixed_team" || type === "manual") {
    return teamById(teams, slot.teamId) ?? { state: "pending" as const, teamId: null, teamName: null, message: "Δεν επιλύθηκε η ομάδα άμεσης πρόκρισης." };
  }
  const sourcePhaseId = resolveSeriesParticipantSourcePhaseId(phase);
  if (type === "standing_position") {
    const raw = String(slot.position ?? "").trim();
    const position = Number(raw.startsWith("direct:") ? raw.slice(7) : raw);
    const resolved = resolveFinalizedStandingsPositions(phases, games.filter((game) => String(game.phase_id ?? "") === String(sourcePhaseId ?? "")), teams, sourcePhaseId);
    const team = resolved.positions.find((entry) => entry.position === position);
    return team
      ? { state: "resolved" as const, teamId: team.teamId, teamName: team.teamName, message: "" }
      : { state: resolved.state, teamId: null, teamName: null, message: resolved.message };
  }
  if (type === "matchup_winner" || type === "matchup_loser") {
    const resolved = resolveFinalizedSeriesOutcomeReference(phases, games, teams, sourcePhaseId, slot.matchupId, type === "matchup_winner" ? "winner" : "loser");
    return { state: resolved.state, teamId: resolved.teamId, teamName: resolved.teamName, message: resolved.message };
  }
  return { state: "pending" as const, teamId: null, teamName: null, message: "Δεν επιλύθηκε η ομάδα άμεσης πρόκρισης." };
};

export function deriveSeriesPhaseCompletion(
  phases: SeriesCarryOverPhaseLike[],
  games: SeriesCarryOverGameLike[],
  teams: SeriesCarryOverTeamLike[],
  phase?: SeriesCarryOverPhaseLike,
): SeriesPhaseCompletion {
  const phaseId = String(phase?.id ?? "").trim();
  const result: SeriesPhaseCompletion = { phaseId, competitivelyComplete: false, outcomes: [], blockers: [] };
  if (!phase || !phaseId || phaseFormat(phase) !== "series") {
    result.blockers.push(blocker("invalid_phase", "Η φάση δεν είναι έγκυρη φάση σειράς αγώνων."));
    return result;
  }
  const matchups = parseMatchups(phase);
  if (!matchups.length) {
    result.blockers.push(blocker("invalid_bracket", "Η φάση δεν περιέχει έγκυρες διασταυρώσεις."));
    return result;
  }

  const carry = resolveSeriesCarryOver(phases, games, teams, phase);
  const carryById = new Map(carry.matchups.map((entry) => [entry.matchupId, entry]));
  const matchupIds = new Set(matchups.map((entry) => entry.id));
  for (const game of games.filter((entry) => String(entry.phase_id ?? "") === phaseId && String(entry.series_matchup_id ?? "").trim())) {
    const matchupId = String(game.series_matchup_id ?? "").trim();
    const round = Number(game.series_round_number);
    if (!matchupIds.has(matchupId) || !Number.isInteger(round) || round < 1 || !String(game.schedule_id ?? "").trim()) {
      result.blockers.push(blocker("invalid_series_game_identity", `Ο αγώνας ${String(game.id ?? "")} δεν έχει έγκυρη ταυτότητα Series.`, matchupId || null, Number.isInteger(round) ? round : null));
    }
  }

  for (const matchup of matchups) {
    const entry = classifySeriesBracketEntry(matchup);
    if (entry.kind === "invalid") {
      result.blockers.push(blocker("unresolved_direct_qualifier", entry.message, matchup.id));
      continue;
    }
    if (entry.kind === "direct_qualifier") {
      const direct = resolveDirectSlot(phases, games, teams, phase, entry.participantSlot);
      if (direct.state !== "resolved" || !direct.teamId || !direct.teamName) {
        result.blockers.push(blocker("unresolved_direct_qualifier", direct.message, matchup.id));
        continue;
      }
      result.outcomes.push({ matchupId: matchup.id, resolution: "direct_qualifier", qualifiedTeamId: direct.teamId, qualifiedTeamName: direct.teamName, qualificationRoundNumber: null, loserTeamId: null, loserTeamName: null });
      continue;
    }

    const resolved = carryById.get(matchup.id);
    if (!resolved || resolved.state !== "resolved" || !resolved.teamAId || !resolved.teamBId || !resolved.teamAName || !resolved.teamBName) {
      result.blockers.push(blocker(resolved?.state === "error" ? "invalid_carry_over" : "unresolved_matchup_teams", resolved?.message || "Δεν επιλύθηκαν οι ομάδες του matchup.", matchup.id));
      continue;
    }
    const transferred: SeriesProgressionTransferredGame[] = [];
    let invalidCarry = false;
    resolved.meetingResolutions.forEach((meeting, index) => {
      const sourceGame = games.find((game) => String(game.id ?? "") === String(meeting.gameId ?? ""));
      if (meeting.state !== "resolved" || !sourceGame) {
        invalidCarry = true;
        result.blockers.push(blocker("invalid_carry_over", meeting.message, matchup.id, index + 1));
        return;
      }
      transferred.push({ sourceGameId: String(sourceGame.id ?? ""), seriesRoundNumber: index + 1, homeTeamId: String(sourceGame.home_team_id ?? ""), awayTeamId: String(sourceGame.away_team_id ?? ""), homeScore: Number(sourceGame.home_score), awayScore: Number(sourceGame.away_score), status: String(sourceGame.status ?? ""), date: sourceGame.scheduled_date ?? null, time: sourceGame.scheduled_time ?? null, venue: null });
    });
    if (invalidCarry) continue;

    const materialized: SeriesProgressionMaterializedGame[] = games
      .filter((game) => String(game.phase_id ?? "") === phaseId && String(game.series_matchup_id ?? "") === matchup.id)
      .map((game) => ({ matchupId: matchup.id, gameId: String(game.id ?? ""), seriesRoundNumber: Number(game.series_round_number), homeTeamId: String(game.home_team_id ?? ""), awayTeamId: String(game.away_team_id ?? ""), homeScore: game.home_score === null || game.home_score === undefined ? null : Number(game.home_score), awayScore: game.away_score === null || game.away_score === undefined ? null : Number(game.away_score), status: String(game.status ?? ""), date: game.scheduled_date ?? null, time: game.scheduled_time ?? null, venue: null }));
    try {
      const progression = calculateSeriesProgression({ matchupId: matchup.id, teamA: { id: resolved.teamAId, name: resolved.teamAName }, teamB: { id: resolved.teamBId, name: resolved.teamBName }, winsRequired: Math.max(1, Number(phase.wins_required ?? 2)), transferredGames: transferred, materializedGames: materialized, planningSlots: [] });
      if (progression.qualifiedTeamId && progression.qualifiedTeamName && progression.qualificationRoundNumber !== null) {
        const aWon = progression.qualifiedTeamId === progression.teamAId;
        result.outcomes.push({ matchupId: matchup.id, resolution: "series_winner", qualifiedTeamId: progression.qualifiedTeamId, qualifiedTeamName: progression.qualifiedTeamName, qualificationRoundNumber: progression.qualificationRoundNumber, loserTeamId: aWon ? progression.teamBId : progression.teamAId, loserTeamName: aWon ? progression.teamBName : progression.teamAName });
      } else {
        const pending = progression.rounds.find((round) => round.rowState === "real_game" && !round.winnerTeamId);
        if (pending) result.blockers.push(blocker("required_game_incomplete", `Ο απαιτούμενος Γύρος ${pending.seriesRoundNumber} δεν έχει επίσημο αποτέλεσμα.`, matchup.id, pending.seriesRoundNumber));
        else if (progression.nextRequiredRoundNumber !== null) result.blockers.push(blocker("required_game_missing", `Ο απαιτούμενος Γύρος ${progression.nextRequiredRoundNumber} δεν έχει υλοποιηθεί.`, matchup.id, progression.nextRequiredRoundNumber));
        else result.blockers.push(blocker("matchup_not_qualified", "Το matchup δεν έχει ακόμη αναδείξει ομάδα που προκρίνεται.", matchup.id));
      }
    } catch (error) {
      result.blockers.push(blocker("invalid_competitive_result", error instanceof Error ? error.message : "Μη έγκυρη ανταγωνιστική κατάσταση.", matchup.id));
    }
  }
  result.competitivelyComplete = result.blockers.length === 0 && result.outcomes.length === matchups.length;
  return result;
}

export function resolveFinalizedSeriesOutcomeReference(
  phases: SeriesCarryOverPhaseLike[], games: SeriesCarryOverGameLike[], teams: SeriesCarryOverTeamLike[], sourcePhaseId?: string | null, matchupId?: string | null, outcomeKind: "winner" | "loser" = "winner",
): FinalizedSeriesOutcomeReferenceResolution {
  const sourceId = String(sourcePhaseId ?? "").trim() || null;
  const matchId = String(matchupId ?? "").trim() || null;
  const base = { sourcePhaseId: sourceId, matchupId: matchId, outcomeKind };
  if (!sourceId || !matchId) return { ...base, state: "pending", message: "Λείπει η φάση προέλευσης ή το matchup.", teamId: null, teamName: null, qualificationRoundNumber: null };
  const source = phases.find((phase) => String(phase.id ?? "") === sourceId);
  if (!source || phaseFormat(source) !== "series") return { ...base, state: "error", message: "Η φάση προέλευσης δεν είναι έγκυρη Series Phase.", teamId: null, teamName: null, qualificationRoundNumber: null };
  if (String(source.lifecycle_status ?? "active") !== "finalized") return { ...base, state: "pending", message: "Η Series Phase προέλευσης δεν έχει οριστικοποιηθεί.", teamId: null, teamName: null, qualificationRoundNumber: null };
  const completion = deriveSeriesPhaseCompletion(phases, games, teams, source);
  if (!completion.competitivelyComplete) return { ...base, state: "error", message: "Η οριστικοποιημένη Series Phase δεν έχει συνεπή πλήρη αποτελέσματα.", teamId: null, teamName: null, qualificationRoundNumber: null, blockers: completion.blockers };
  const outcome = completion.outcomes.find((entry) => entry.matchupId === matchId);
  if (!outcome) return { ...base, state: "error", message: "Το matchup δεν ανήκει στη φάση προέλευσης.", teamId: null, teamName: null, qualificationRoundNumber: null };
  if (outcomeKind === "loser" && outcome.resolution === "direct_qualifier") return { ...base, state: "error", message: "Η άμεση πρόκριση/BYE δεν έχει ανταγωνιστικό ηττημένο.", teamId: null, teamName: null, qualificationRoundNumber: null };
  return { ...base, state: "resolved", message: "Το αποτέλεσμα του matchup επιλύθηκε από οριστικοποιημένη Series Phase.", teamId: outcomeKind === "winner" ? outcome.qualifiedTeamId : outcome.loserTeamId, teamName: outcomeKind === "winner" ? outcome.qualifiedTeamName : outcome.loserTeamName, qualificationRoundNumber: outcome.qualificationRoundNumber };
}
