"use client";

import { usePlatformContext, PlatformButton, PlatformForm, PlatformFileInput } from "@/components/admin/platform/shared/platform-context";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  Field,
  Panel,
  Row,
  Snapshot,
  DeleteEntity,
  buttonClass,
  getCompetitionTeamsForStandings,
  inputClass,
  parseDateForDisplay,
  parseStandingsRules,
  phaseFormatLabel,
  roundRobinStructureFromTeams,
  scheduleLifecycleLabels,
} from "../shared/admin-core";
import { calculateSeriesProgression, calculateSeriesRoundWindow, type SeriesProgressionRoundRow } from "@/lib/series-progression";
import {
  classifySeriesBracketEntry,
  resolveSeriesCarryOver,
} from "@/lib/series-carry-over";
import type { PlatformMatchReport, PlatformMatchReportAvailability } from "@/lib/platform-match-report";
import type { MatchdayMvpState } from "@/services/matchday-mvp.service";

type PhaseScheduleRow = Row & {
  id: string;
  competition_id: string | null;
  phase_id: string | null;
  lifecycle_status: string | null;
  phase_name: string | null;
  phase_format: string | null;
  phase_type: string | null;
  phase_order: number | string | null;
  wins_required: number | string | null;
  carry_over_enabled: number | string | null;
  carry_over_source_phase_id: string | null;
  carry_over_source_name: string | null;
};

type GeneratedGameRow = Row & {
  id: string;
  schedule_id: string | null;
  series_matchup_id: string | null;
  series_round_number: number | string | null;
  round_number: number | string | null;
  game_order: number | string | null;
  round_label: string | null;
  home_team_id: string | null;
  away_team_id: string | null;
  home_team_name: string | null;
  away_team_name: string | null;
  home_score: number | string | null;
  away_score: number | string | null;
  result_source: string | null;
  status: string | null;
  external_id: string | null;
  video_url: string | null;
  phase_format: string | null;
  phase_lifecycle_status: string | null;
  administrative_result_id: string | null;
  administrative_decision_type: string | null;
  administrative_home_standings_points_override: number | string | null;
  administrative_away_standings_points_override: number | string | null;
  administrative_reason: string | null;
  administrative_updated_at: string | null;
};

type ResultEditorMode = "manual" | "administrative-correction" | "administrative-interruption";

type SeriesRoundViewRow = {
  matchupId: string;
  matchupLabel: string;
  round: SeriesProgressionRoundRow;
};

type SeriesRoundView = {
  roundNumber: number;
  roundLabel: string;
  rows: SeriesRoundViewRow[];
};

type CompetitionVenueRow = Row & {
  id: string;
  competition_id: string | null;
  name: string | null;
  address: string | null;
  map_url: string | null;
  sort_order: number | string | null;
};

type SeriesPlanningSlotRow = Row & {
  id: string;
  competition_id: string;
  phase_id: string;
  schedule_id: string;
  matchup_id: string;
  series_round_number: number | string;
  scheduled_date: string | null;
  scheduled_time: string | null;
  venue: string;
  real_game_id: string | null;
};

type SchedulingMode = "keep" | "set" | "clear";
type ScheduleDisplayMode = "round" | "all";

export function matchReportButtonPresentation(availability?: PlatformMatchReportAvailability) {
  if (!availability?.available) return {
    disabled: true, label: "MATCH REPORT", title: "Το αναλυτικό Match Report δεν είναι διαθέσιμο.",
    className: "border-zinc-300 bg-zinc-100 text-zinc-500",
  };
  if (availability.hasIncidentReport) return {
    disabled: false, label: "⚠ MATCH REPORT", title: "Υπάρχει Αναφορά Συμβάντων που απαιτεί προσοχή.",
    className: "border-red-700 bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-700",
  };
  return {
    disabled: false, label: "MATCH REPORT", title: "Άνοιγμα αναλυτικού Match Report.",
    className: "border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:outline-emerald-700",
  };
}

type ScheduleEditorState = {
  scheduledDateMode: SchedulingMode;
  scheduledDate: string;
  scheduledTimeMode: SchedulingMode;
  scheduledTime: string;
  venueMode: SchedulingMode;
  venueId: string;
};

const parseObject = (value: unknown) => {
  if (!value) return {};
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  return {};
};

const buildPhaseSummary = (data: Snapshot, phase?: Row | null) => {
  if (!phase) return [] as string[];
  const competitionId = String(phase.competition_id ?? "");
  const format = String(phase.format ?? phase.phase_kind ?? "standings").trim().toLowerCase();
  if (format === "standings") {
    const teams = getCompetitionTeamsForStandings(data, competitionId);
    const rules = parseStandingsRules(phase.rule_settings_json);
    const structure = roundRobinStructureFromTeams(teams.length, rules.gamesPerPairing);
    return [
      "Τύπος: Βαθμολογική σειρά",
      `Ομάδες: ${teams.length}`,
      `Αγωνιστικές: ${structure.rounds}`,
      `Αγώνες ανά αγωνιστική: ${structure.gamesPerRound}`,
      `Συνολικοί αγώνες: ${structure.totalGames}`,
      `Ρεπό ανά αγωνιστική: ${structure.byesPerRound}`,
    ];
  }

  if (format === "series") {
    const phaseSettings = parseObject(phase.rule_settings_json);
    const bracketConfig = parseObject(phaseSettings.bracketConfiguration);
    const matchups = Array.isArray(bracketConfig.matchups) ? bracketConfig.matchups : [];
    const entryClassifications = matchups.map((matchup) => ({ matchup, entry: classifySeriesBracketEntry(matchup) }));
    const playableMatchups = entryClassifications.filter(({ entry }) => entry.kind === "playable_matchup").map(({ matchup }) => matchup);
    const winsRequired = Math.max(1, Math.floor(Number(phase.wins_required ?? 0) || 0));
    const carryOverEnabled = Boolean(Number(phase.carry_over_enabled ?? 0));
    const carryOverMeetingNumbers = Array.isArray(phaseSettings.carryOverMeetingNumbers)
      ? [...new Set(phaseSettings.carryOverMeetingNumbers.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1))]
      : [];
    const transferredRounds = carryOverEnabled ? Math.max(1, carryOverMeetingNumbers.length || 1) : 0;
    const roundWindows = playableMatchups.map((matchup) => {
      const startingWins = resolveSeriesCarryOver(data.phases, data.games, data.teams, phase).matchups.find((entry) => entry.matchupId === String(matchup?.id ?? "")) ?? null;
      const window = calculateSeriesRoundWindow({
        winsRequired,
        currentWinsA: Number(startingWins?.startingWinsA ?? 0),
        currentWinsB: Number(startingWins?.startingWinsB ?? 0),
        qualified: Boolean(startingWins?.state !== "resolved" || startingWins?.currentSeriesDecided),
      });
      return window;
    });
    const minimumNewRounds = roundWindows.length ? Math.max(...roundWindows.map((entry) => entry.minimumNewRounds)) : 0;
    const maximumNewRounds = roundWindows.length ? Math.max(...roundWindows.map((entry) => entry.maximumNewRounds)) : 0;
    const maxNewGames = maximumNewRounds * playableMatchups.length;
    const directQualifiers = entryClassifications.filter(({ entry }) => entry.kind === "direct_qualifier").length;
    const totalConcreteTeams = matchups.reduce((count, matchup) => {
      const slotAType = String(matchup?.slotA?.type ?? "");
      const slotBType = String(matchup?.slotB?.type ?? "");
      return count + (slotAType === "bye" ? 0 : 1) + (slotBType === "bye" ? 0 : 1);
    }, 0);
    const materializedSeriesGames = (data.games as GeneratedGameRow[]).filter((game) =>
      String(game.phase_id ?? "") === String(phase.id ?? "") &&
      String(game.series_matchup_id ?? "").trim() &&
      Number.isInteger(Number(game.series_round_number ?? 0)),
    );
    const completedSeriesGames = materializedSeriesGames.filter((game) => String(game.status ?? "").toLowerCase() === "completed").length;
    return [
      "Τύπος: Σειρά αγώνων",
      `Ομάδες: ${totalConcreteTeams}`,
      `Νίκες για πρόκριση: ${winsRequired}`,
      `Μεταφορά αποτελέσματος: ${carryOverEnabled ? `${transferredRounds}η συνάντηση` : "—"}`,
      `Μεταφερόμενοι γύροι: ${transferredRounds}`,
      `Ελάχιστοι νέοι γύροι: ${minimumNewRounds}`,
      `Μέγιστοι νέοι γύροι: ${maximumNewRounds}`,
      `Διασταυρώσεις ανά γύρο: ${playableMatchups.length}`,
      `Μέγιστοι πιθανοί νέοι αγώνες: ${maxNewGames}`,
      `Ομάδες που προκρίνονται απευθείας: ${directQualifiers}`,
      `Υλικοποιημένοι αγώνες: ${materializedSeriesGames.length}`,
      `Ολοκληρωμένοι υλικοποιημένοι αγώνες: ${completedSeriesGames}`,
    ];
  }

  return [`Τύπος: ${phaseFormatLabel(format)}`];
};

const buildGeneratedRounds = (games: GeneratedGameRow[], teams: { id: string; name: string }[]) => {
  const byRound = new Map<number, GeneratedGameRow[]>();
  for (const game of games) {
    const roundNumber = Number(game.round_number ?? 0) || 0;
    if (!byRound.has(roundNumber)) byRound.set(roundNumber, []);
    byRound.get(roundNumber)?.push(game);
  }
  const rounds = [...byRound.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([roundNumber, roundGames]) => {
      const sortedGames = [...roundGames].sort((left, right) => Number(left.game_order ?? 0) - Number(right.game_order ?? 0));
      const usedTeams = new Set<string>();
      for (const game of sortedGames) {
        if (game.home_team_id) usedTeams.add(String(game.home_team_id));
        if (game.away_team_id) usedTeams.add(String(game.away_team_id));
      }
      const byeTeam = teams.find((team) => !usedTeams.has(team.id)) ?? null;
      return {
        roundNumber,
        roundLabel: String(sortedGames[0]?.round_label ?? `${roundNumber}η Αγωνιστική`),
        games: sortedGames,
        byeTeam,
      };
    });
  return rounds;
};

const getRoundOrdinalLabel = (roundNumber: number) => {
  const suffix = roundNumber === 1 ? "1ος" : roundNumber === 2 ? "2ος" : roundNumber === 3 ? "3ος" : `${roundNumber}ος`;
  return `${suffix} Γύρος`;
};

const getSeriesRoundLabel = (roundNumber: number, rowState?: string) => {
  const base = getRoundOrdinalLabel(roundNumber);
  if (roundNumber === 1 && rowState === "transferred") return `${base} — από μεταφορά`;
  if (rowState === "if_needed") return `${base} — εάν χρειαστεί`;
  return base;
};

const buildSeriesRounds = (
  data: Snapshot,
  phase: Row,
  scheduleId: string,
  scheduleGames: GeneratedGameRow[],
) => {
  const phaseSettings = parseObject(phase.rule_settings_json);
  const bracketConfig = parseObject(phaseSettings.bracketConfiguration);
  const matchups = Array.isArray(bracketConfig.matchups) ? bracketConfig.matchups : [];
  const carryOver = resolveSeriesCarryOver(data.phases, data.games, data.teams, phase);

  const materializedSeriesGames = scheduleGames
    .filter((game) => String(game.series_matchup_id ?? "").trim() && Number.isInteger(Number(game.series_round_number ?? 0)))
    .map((game) => ({
      matchupId: String(game.series_matchup_id ?? ""),
      gameId: String(game.id ?? ""),
      seriesRoundNumber: Number(game.series_round_number ?? 0),
      homeTeamId: String(game.home_team_id ?? ""),
      awayTeamId: String(game.away_team_id ?? ""),
      homeScore: game.home_score === null || game.home_score === "" ? null : Number(game.home_score),
      awayScore: game.away_score === null || game.away_score === "" ? null : Number(game.away_score),
      status: String(game.status ?? ""),
      date: String(game.scheduled_date ?? "") || null,
      time: String(game.scheduled_time ?? "") || null,
      venue: String(game.venue ?? "") || null,
    }));

  const sourceGames = (data.games as GeneratedGameRow[]).filter((game) => String(game.phase_id ?? "") === carryOver.sourcePhaseId);
  const seriesRoundsByNumber = new Map<number, SeriesRoundView>();
  const matchupsInOrder = matchups.length ? matchups : carryOver.matchups.map((matchup) => ({
    id: matchup.matchupId,
    slotA: { type: "team", teamId: matchup.teamAId, position: null },
    slotB: { type: "team", teamId: matchup.teamBId, position: null },
  }));

  for (const matchup of matchupsInOrder) {
    const matchupResolution = carryOver.matchups.find((entry) => entry.matchupId === String(matchup.id ?? "")) ?? null;
    if (!matchupResolution) continue;
    const teamA = {
      id: String(matchupResolution.teamAId ?? "").trim(),
      name: String(matchupResolution.teamAName ?? "—"),
    };
    const teamB = {
      id: String(matchupResolution.teamBId ?? "").trim(),
      name: String(matchupResolution.teamBName ?? "—"),
    };
    if (!teamA.id || !teamB.id) continue;
    const transferredGames = (matchupResolution.meetingResolutions ?? [])
      .filter((meeting) => meeting.state === "resolved" && meeting.gameId)
      .map((meeting) => {
        const sourceGame = sourceGames.find((game) => String(game.id ?? "") === String(meeting.gameId ?? "")) ?? null;
        if (!sourceGame) return null;
        return {
          sourceGameId: String(sourceGame.id ?? ""),
          seriesRoundNumber: Number(meeting.meetingNumber || 1),
          homeTeamId: String(sourceGame.home_team_id ?? ""),
          awayTeamId: String(sourceGame.away_team_id ?? ""),
          homeScore: Number(sourceGame.home_score ?? 0),
          awayScore: Number(sourceGame.away_score ?? 0),
          status: String(sourceGame.status ?? ""),
          date: String(sourceGame.scheduled_date ?? "") || null,
          time: String(sourceGame.scheduled_time ?? "") || null,
          venue: String(sourceGame.venue ?? "") || null,
        };
      })
      .filter(Boolean) as Parameters<typeof calculateSeriesProgression>[0]["transferredGames"];
    const matchupGames = materializedSeriesGames.filter(
      (game) => game.matchupId === matchupResolution.matchupId,
    );
    const planningSlots: Parameters<typeof calculateSeriesProgression>[0]["planningSlots"] = (data.seriesPlanningSlots as SeriesPlanningSlotRow[])
      .filter((slot) =>
        String(slot.schedule_id ?? "") === scheduleId
        && String(slot.matchup_id ?? "") === matchupResolution.matchupId
        && !String(slot.real_game_id ?? "").trim()
        && !matchupGames.some((game) => game.seriesRoundNumber === Number(slot.series_round_number)),
      )
      .map((slot) => ({
        seriesRoundNumber: Number(slot.series_round_number),
        scheduledDate: slot.scheduled_date,
        scheduledTime: slot.scheduled_time,
        venue: slot.venue,
      }));
    let progression;
    try {
      progression = calculateSeriesProgression({
        matchupId: matchupResolution.matchupId,
        teamA,
        teamB,
        winsRequired: Math.max(1, Math.floor(Number(phase.wins_required ?? 0) || 0)),
        transferredGames,
        materializedGames: matchupGames,
        planningSlots,
      });
    } catch {
      continue;
    }
    for (const round of progression.rounds) {
      const existing = seriesRoundsByNumber.get(round.seriesRoundNumber);
      const nextRows: SeriesRoundViewRow[] = existing?.rows ?? [];
      nextRows.push({
        matchupId: matchupResolution.matchupId,
        matchupLabel: matchupResolution.label,
        round,
      });
      seriesRoundsByNumber.set(round.seriesRoundNumber, {
        roundNumber: round.seriesRoundNumber,
        roundLabel: getSeriesRoundLabel(round.seriesRoundNumber, round.rowState),
        rows: nextRows,
      });
    }
  }

  return [...seriesRoundsByNumber.values()].sort((left, right) => left.roundNumber - right.roundNumber);
};

const createDefaultScheduleEditorState = (): ScheduleEditorState => ({
  scheduledDateMode: "keep",
  scheduledDate: "",
  scheduledTimeMode: "keep",
  scheduledTime: "",
  venueMode: "keep",
  venueId: "",
});

const normalizeTimeEditorValue = (value: string) => {
  const digits = String(value ?? "").replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  if (digits.length === 3) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
};

const formatGameScheduleLabel = (game: GeneratedGameRow) => {
  const scheduledDate = String(game.scheduled_date ?? "").trim();
  const scheduledTime = String(game.scheduled_time ?? "").trim();
  if (scheduledDate && scheduledTime) return `${scheduledDate} • ${scheduledTime}`;
  if (scheduledDate) return `${scheduledDate} · Ώρα: —`;
  return "Δεν έχει προγραμματιστεί";
};

const sortRoundsForDisplay = (games: GeneratedGameRow[]) => {
  return [...games].sort((left, right) => {
    const leftDate = String(left.scheduled_date ?? "").trim();
    const rightDate = String(right.scheduled_date ?? "").trim();
    const leftTime = String(left.scheduled_time ?? "").trim();
    const rightTime = String(right.scheduled_time ?? "").trim();
    const leftHasDateTime = Boolean(leftDate && leftTime);
    const rightHasDateTime = Boolean(rightDate && rightTime);
    if (leftHasDateTime !== rightHasDateTime) return leftHasDateTime ? -1 : 1;
    if (leftHasDateTime && rightHasDateTime) {
      const byDate = leftDate.localeCompare(rightDate);
      if (byDate) return byDate;
      const byTime = leftTime.localeCompare(rightTime);
      if (byTime) return byTime;
    }
    const leftHasDate = Boolean(leftDate);
    const rightHasDate = Boolean(rightDate);
    if (leftHasDate !== rightHasDate) return leftHasDate ? -1 : 1;
    if (leftHasDate && rightHasDate) {
      const byDate = leftDate.localeCompare(rightDate);
      if (byDate) return byDate;
    }
    const leftHasTime = Boolean(leftTime);
    const rightHasTime = Boolean(rightTime);
    if (leftHasTime !== rightHasTime) return leftHasTime ? -1 : 1;
    if (leftHasTime && rightHasTime) {
      const byTime = leftTime.localeCompare(rightTime);
      if (byTime) return byTime;
    }
    return Number(left.game_order ?? 0) - Number(right.game_order ?? 0);
  });
};

const getMaterializedProgramCount = (data: Snapshot, phaseId: string) => {
  return (data.games as GeneratedGameRow[]).filter((game) =>
    String(game.phase_id ?? "") === phaseId &&
    String(game.series_matchup_id ?? "").trim()
      ? Number.isInteger(Number(game.series_round_number ?? 0))
      : Boolean(String(game.round_label ?? "").trim()) || Number.isInteger(Number(game.round_number ?? 0)),
  ).length;
};

const hasFullRoundRobinProgram = (data: Snapshot, phase: Row, competitionTeams: { id: string; name: string }[]) => {
  const rules = parseStandingsRules(phase.rule_settings_json);
  const structure = roundRobinStructureFromTeams(competitionTeams.length, rules.gamesPerPairing);
  const materializedCount = (data.games as GeneratedGameRow[]).filter(
    (game) => String(game.phase_id ?? "") === String(phase.id ?? "") && !String(game.series_matchup_id ?? "").trim(),
  ).length;
  return materializedCount >= structure.totalGames;
};

export function ProgramGamesSection({
  data,
  competitionId,
  submit,
  updateEntity,
  deleteEntity,
  bulkScheduleGames,
  busy,
  onRefreshCompetitionData,
}: {
  data: Snapshot;
  competitionId: string;
  submit: (resource: string, event: FormEvent<HTMLFormElement>) => Promise<boolean>;
  updateEntity: (resource: string, id: string, event: FormEvent<HTMLFormElement>, successMessage: string) => Promise<boolean>;
  deleteEntity: DeleteEntity;
  bulkScheduleGames: (payload: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
  onRefreshCompetitionData?: () => Promise<void> | void;
}) {
  const { request: fetch, url: platformUrl } = usePlatformContext();
  const competitionPhases = useMemo(() => {
    return data.phases
      .filter((phase) => String(phase.competition_id ?? "") === competitionId)
      .sort((left, right) => {
        const leftOrder = Number(left.phase_order ?? left.order_index ?? 0);
        const rightOrder = Number(right.phase_order ?? right.order_index ?? 0);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return String(left.id).localeCompare(String(right.id));
      });
  }, [data.phases, competitionId]);

  const schedules = useMemo(() => {
    return (data.phaseSchedules as PhaseScheduleRow[])
      .filter((schedule) => String(schedule.competition_id ?? "") === competitionId)
      .sort((left, right) => {
        const leftPhase = competitionPhases.find((phase) => String(phase.id) === String(left.phase_id ?? ""));
        const rightPhase = competitionPhases.find((phase) => String(phase.id) === String(right.phase_id ?? ""));
        const leftOrder = Number(leftPhase?.phase_order ?? leftPhase?.order_index ?? left.phase_order ?? 0);
        const rightOrder = Number(rightPhase?.phase_order ?? rightPhase?.order_index ?? right.phase_order ?? 0);
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return String(left.id).localeCompare(String(right.id));
      });
  }, [competitionId, competitionPhases, data.phaseSchedules]);

  const competitionTeams = useMemo(() => {
    return getCompetitionTeamsForStandings(data, competitionId).map((team) => ({
      id: String(team.team_id ?? ""),
      name: String(team.team_name ?? "—"),
    })).filter((team) => team.id && team.name);
  }, [data, competitionId]);
  const availablePhases = useMemo(() => {
    const scheduleByPhaseId = new Map(schedules.map((schedule) => [String(schedule.phase_id ?? ""), schedule]));
    return competitionPhases.filter((phase) => {
      const phaseId = String(phase.id ?? "");
      const schedule = scheduleByPhaseId.get(phaseId) ?? null;
      if (!schedule) return true;
      const phaseFormat = String(phase.format ?? phase.phase_kind ?? "standings").trim().toLowerCase();
      if (phaseFormat === "standings") {
        return !hasFullRoundRobinProgram(data, phase, competitionTeams);
      }
      if (phaseFormat === "series") {
        const materializedSeriesGames = (data.games as GeneratedGameRow[]).filter((game) =>
          String(game.phase_id ?? "") === phaseId && String(game.series_matchup_id ?? "").trim() && Number.isInteger(Number(game.series_round_number ?? 0)),
        );
        return materializedSeriesGames.length === 0;
      }
      return false;
    });
  }, [competitionTeams, competitionPhases, data, schedules]);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPhaseId, setSelectedPhaseId] = useState("");
  const [showGenerateModal, setShowGenerateModal] = useState(false);
  const [selectedScheduleId, setSelectedScheduleId] = useState("");
  const [openScheduleId, setOpenScheduleId] = useState<string | null>(null);
  const hasInitializedOpenSchedule = useRef(false);
  const [selectedRoundByScheduleId, setSelectedRoundByScheduleId] = useState<Record<string, number>>({});
  const [scheduleDisplayModeByScheduleId, setScheduleDisplayModeByScheduleId] = useState<Record<string, ScheduleDisplayMode>>({});
  const [showVenueManager, setShowVenueManager] = useState(false);
  const [showVenueForm, setShowVenueForm] = useState(false);
  const [editingVenueId, setEditingVenueId] = useState("");
  const [showResultForm, setShowResultForm] = useState(false);
  const [editingResultGameId, setEditingResultGameId] = useState("");
  const [resultHomeScore, setResultHomeScore] = useState("");
  const [resultAwayScore, setResultAwayScore] = useState("");
  const [resultEditorMode, setResultEditorMode] = useState<ResultEditorMode>("manual");
  const [resultHomeStandingsPoints, setResultHomeStandingsPoints] = useState("");
  const [resultAwayStandingsPoints, setResultAwayStandingsPoints] = useState("");
  const [resultReason, setResultReason] = useState("");
  const [matchReportGameId, setMatchReportGameId] = useState("");
  const [matchReportDetail, setMatchReportDetail] = useState<PlatformMatchReport | null>(null);
  const [matchReportLoading, setMatchReportLoading] = useState(false);
  const [matchReportError, setMatchReportError] = useState("");
  const [statisticsPdfLoading, setStatisticsPdfLoading] = useState(false);
  const [statisticsPdfError, setStatisticsPdfError] = useState("");
  const [showIncidentReport, setShowIncidentReport] = useState(false);
  const [selectedGameIdsByScheduleId, setSelectedGameIdsByScheduleId] = useState<Record<string, string[]>>({});
  const [scheduleEditorByScheduleId, setScheduleEditorByScheduleId] = useState<Record<string, ScheduleEditorState>>({});
  const [deleteProgramTarget, setDeleteProgramTarget] = useState<{ phaseId: string; phaseName: string } | null>(null);
  const [deleteProgramConfirmation, setDeleteProgramConfirmation] = useState("");
  const [matchdayMvpOpen, setMatchdayMvpOpen] = useState(false);
  const [matchdayMvpState, setMatchdayMvpState] = useState<MatchdayMvpState | null>(null);
  const [matchdayMvpLoading, setMatchdayMvpLoading] = useState(false);
  const [matchdayMvpSaving, setMatchdayMvpSaving] = useState("");
  const [matchdayMvpError, setMatchdayMvpError] = useState("");
  const [showOtherMvpPlayers, setShowOtherMvpPlayers] = useState(false);
  const [otherMvpSelection, setOtherMvpSelection] = useState("");
  const [deleteProgramBusy, setDeleteProgramBusy] = useState(false);
  const [deleteProgramError, setDeleteProgramError] = useState("");
  const [planningTarget, setPlanningTarget] = useState<{
    phaseId: string;
    scheduleId: string;
    matchupId: string;
    seriesRoundNumber: number;
    homeTeamName: string;
    awayTeamName: string;
  } | null>(null);
  const [planningDate, setPlanningDate] = useState("");
  const [planningTime, setPlanningTime] = useState("");
  const [planningVenueId, setPlanningVenueId] = useState("");
  const [planningBusy, setPlanningBusy] = useState(false);
  const [planningError, setPlanningError] = useState("");
  const selectedPhase = availablePhases.find((phase) => String(phase.id) === selectedPhaseId) ?? availablePhases[0] ?? null;

  useEffect(() => {
    if (!showCreateModal) return;
    if (selectedPhase && availablePhases.some((phase) => String(phase.id) === String(selectedPhase.id))) return;
    setSelectedPhaseId(String(availablePhases[0]?.id ?? ""));
  }, [availablePhases, selectedPhase, showCreateModal]);

  const openCreateModal = () => {
    setSelectedPhaseId(String(availablePhases[0]?.id ?? ""));
    setShowCreateModal(true);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
  };

  const selectedSchedule = schedules.find((schedule) => String(schedule.id) === selectedScheduleId) ?? null;
  const competitionVenues = useMemo(() => {
    return (data.competitionVenues as CompetitionVenueRow[])
      .filter((venue) => String(venue.competition_id ?? "") === competitionId)
      .sort((left, right) => {
        const leftOrder = Number(left.sort_order ?? 0) || 0;
        const rightOrder = Number(right.sort_order ?? 0) || 0;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
        return String(left.name ?? "").localeCompare(String(right.name ?? ""), "el-GR");
      });
  }, [competitionId, data.competitionVenues]);
  const selectedVenue = competitionVenues.find((venue) => String(venue.id) === editingVenueId) ?? null;

  const selectedScheduleGames = useMemo(() => {
    if (!selectedSchedule) return [] as GeneratedGameRow[];
    return (data.games as GeneratedGameRow[])
      .filter((game) => String(game.schedule_id ?? "") === String(selectedSchedule.id))
      .sort((left, right) => {
        const leftRound = Number(left.round_number ?? 0);
        const rightRound = Number(right.round_number ?? 0);
        if (leftRound !== rightRound) return leftRound - rightRound;
        return Number(left.game_order ?? 0) - Number(right.game_order ?? 0);
      });
  }, [data.games, selectedSchedule]);

  const selectedScheduleRounds = useMemo(() => {
    return buildGeneratedRounds(selectedScheduleGames, competitionTeams);
  }, [competitionTeams, selectedScheduleGames]);

  useEffect(() => {
    if (!schedules.length) {
      hasInitializedOpenSchedule.current = false;
      setOpenScheduleId(null);
      return;
    }
    if (hasInitializedOpenSchedule.current) {
      if (openScheduleId === null) return;
      if (schedules.some((schedule) => String(schedule.id) === openScheduleId)) return;
    }
    const preferredSchedule = schedules.find((schedule) => {
      const phase = competitionPhases.find((entry) => String(entry.id) === String(schedule.phase_id ?? ""));
      return String((phase as Row | undefined)?.lifecycle_status ?? "active") === "active";
    }) ?? schedules[0];
    hasInitializedOpenSchedule.current = true;
    setOpenScheduleId(String(preferredSchedule?.id ?? "") || null);
  }, [openScheduleId, schedules, competitionPhases]);

  useEffect(() => {
    if (!selectedSchedule) return;
    const selectedSchedulePhase = competitionPhases.find((phase) => String(phase.id) === String(selectedSchedule.phase_id ?? "")) ?? null;
    const selectedScheduleFormat = String(selectedSchedulePhase?.format ?? selectedSchedulePhase?.phase_kind ?? "standings").trim().toLowerCase();
    const derivedRounds = selectedScheduleFormat === "series"
      ? buildSeriesRounds(data, selectedSchedulePhase ?? selectedSchedule as unknown as Row, String(selectedSchedule.id), selectedScheduleGames)
      : selectedScheduleRounds;
    const currentRound = selectedRoundByScheduleId[String(selectedSchedule.id)]
      ?? (selectedScheduleFormat === "series" ? 1 : Number(selectedScheduleGames[0]?.round_number ?? 0));
    if (currentRound && derivedRounds.some((round) => round.roundNumber === currentRound)) return;
    const firstRound = derivedRounds[0]?.roundNumber ?? 0;
    if (firstRound) {
      setSelectedRoundByScheduleId((current) => ({ ...current, [String(selectedSchedule.id)]: firstRound }));
    }
  }, [selectedSchedule, selectedScheduleGames, selectedScheduleRounds, selectedRoundByScheduleId, competitionPhases, competitionTeams, data]);

  const openGenerateModal = (scheduleId: string) => {
    setSelectedScheduleId(scheduleId);
    setShowGenerateModal(true);
  };

  const closeGenerateModal = () => {
    setShowGenerateModal(false);
    setSelectedScheduleId("");
  };

  const openVenueManager = () => {
    setShowVenueForm(competitionVenues.length === 0);
    setEditingVenueId("");
    setShowVenueManager(true);
  };

  const closeVenueManager = () => {
    setShowVenueManager(false);
    setShowVenueForm(false);
    setEditingVenueId("");
  };

  const handleVenueDelete = async (venue: CompetitionVenueRow) => {
    if (!window.confirm(`Να αφαιρεθεί το γήπεδο «${String(venue.name ?? "—")}» από τη λίστα της διοργάνωσης;`)) return;
    await deleteEntity("competition-venues", String(venue.id), `Το γήπεδο «${String(venue.name ?? "—")}» αφαιρέθηκε από τη διοργάνωση.`);
  };

  const startVenueForm = (venueId = "") => {
    setEditingVenueId(venueId);
    setShowVenueForm(true);
  };

  const openResultForm = (game: GeneratedGameRow, requestedMode?: ResultEditorMode) => {
    const hasResult = game.home_score !== null && game.home_score !== undefined
      && game.away_score !== null && game.away_score !== undefined;
    setEditingResultGameId(String(game.id));
    setResultHomeScore(String(game.home_score ?? ""));
    setResultAwayScore(String(game.away_score ?? ""));
    setResultEditorMode(requestedMode ?? (hasResult ? "administrative-correction" : "manual"));
    setResultHomeStandingsPoints(String(game.administrative_home_standings_points_override ?? ""));
    setResultAwayStandingsPoints(String(game.administrative_away_standings_points_override ?? ""));
    setResultReason(String(game.administrative_reason ?? ""));
    setShowResultForm(true);
  };

  const closeResultForm = () => {
    setShowResultForm(false);
    setEditingResultGameId("");
    setResultHomeScore("");
    setResultAwayScore("");
    setResultEditorMode("manual");
    setResultHomeStandingsPoints("");
    setResultAwayStandingsPoints("");
    setResultReason("");
  };

  const closeMatchReport = () => {
    setMatchReportGameId(""); setMatchReportDetail(null); setMatchReportError("");
    setMatchReportLoading(false); setShowIncidentReport(false); setStatisticsPdfLoading(false); setStatisticsPdfError("");
  };

  const downloadStatisticsPdf = async () => {
    if (!matchReportGameId || !matchReportDetail || statisticsPdfLoading) return;
    setStatisticsPdfLoading(true); setStatisticsPdfError("");
    try {
      const response = await fetch(`/api/admin/match-reports/${encodeURIComponent(matchReportGameId)}/statistics`);
      if (!response.ok) throw new Error("STATISTICS_PDF_UNAVAILABLE");
      const blob = await response.blob();
      if (blob.type !== "application/pdf" || blob.size === 0) throw new Error("STATISTICS_PDF_INVALID");
      const disposition = response.headers.get("Content-Disposition") ?? "";
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename = encodedName ? decodeURIComponent(encodedName) : "komobasket-statistics.pdf";
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = filename; anchor.style.display = "none";
      document.body.appendChild(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(url);
    } catch {
      setStatisticsPdfError("Το PDF στατιστικών δεν δημιουργήθηκε. Δοκιμάστε ξανά.");
    } finally {
      setStatisticsPdfLoading(false);
    }
  };

  const openGameSheet = () => {
    if (!matchReportGameId || !matchReportDetail) return;
    window.open(platformUrl(`/api/admin/match-reports/${encodeURIComponent(matchReportGameId)}/game-sheet`), "_blank", "noopener,noreferrer");
  };

  const openMatchReport = async (gameId: string, availability?: PlatformMatchReportAvailability) => {
    if (!availability?.available) return;
    setMatchReportGameId(gameId); setMatchReportDetail(null); setMatchReportError("");
    setMatchReportLoading(true); setShowIncidentReport(false);
    try {
      const response = await fetch(`/api/admin/match-reports/${encodeURIComponent(gameId)}`);
      const payload = await response.json() as { data?: PlatformMatchReport; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || "MATCH_REPORT_UNAVAILABLE");
      setMatchReportDetail(payload.data);
    } catch {
      setMatchReportError("Το Match Report δεν είναι διαθέσιμο αυτή τη στιγμή.");
    } finally {
      setMatchReportLoading(false);
    }
  };

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ok = await submit("phase-schedules", event);
    if (!ok) return;
    setShowCreateModal(false);
    setSelectedPhaseId("");
  };

  const handleGenerate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const ok = await submit("phase-schedules", event);
    if (!ok) return;
    setShowGenerateModal(false);
    setSelectedScheduleId("");
  };

  const closeDeleteProgramDialog = () => {
    if (deleteProgramBusy) return;
    setDeleteProgramTarget(null);
    setDeleteProgramConfirmation("");
    setDeleteProgramError("");
  };

  const handleDeletePhaseProgram = async () => {
    if (!deleteProgramTarget || deleteProgramConfirmation !== "ΔΙΑΓΡΑΦΗ") return;
    setDeleteProgramBusy(true);
    setDeleteProgramError("");
    try {
      const response = await fetch("/api/admin/league/phase-schedules", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "deletePhaseProgram",
          competitionId,
          phaseId: deleteProgramTarget.phaseId,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Η διαγραφή του προγράμματος απέτυχε.");
      setDeleteProgramTarget(null);
      setDeleteProgramConfirmation("");
      setOpenScheduleId(null);
      if (onRefreshCompetitionData) {
        await onRefreshCompetitionData();
      } else {
        window.location.reload();
      }
    } catch (error) {
      setDeleteProgramError(error instanceof Error ? error.message : "Η διαγραφή του προγράμματος απέτυχε.");
    } finally {
      setDeleteProgramBusy(false);
    }
  };

  const openPlanningDialog = (target: {
    phaseId: string;
    scheduleId: string;
    matchupId: string;
    seriesRoundNumber: number;
    homeTeamName: string;
    awayTeamName: string;
    planningSlot: SeriesProgressionRoundRow["planningSlot"];
  }) => {
    const venueName = String(target.planningSlot?.venue ?? "").trim();
    const venueId = venueName
      ? String(competitionVenues.find((venue) => String(venue.name ?? "") === venueName)?.id ?? "")
      : "";
    setPlanningTarget({
      phaseId: target.phaseId,
      scheduleId: target.scheduleId,
      matchupId: target.matchupId,
      seriesRoundNumber: target.seriesRoundNumber,
      homeTeamName: target.homeTeamName,
      awayTeamName: target.awayTeamName,
    });
    setPlanningDate(String(target.planningSlot?.scheduledDate ?? ""));
    setPlanningTime(String(target.planningSlot?.scheduledTime ?? ""));
    setPlanningVenueId(venueId);
    setPlanningError("");
  };

  const closePlanningDialog = () => {
    if (planningBusy) return;
    setPlanningTarget(null);
    setPlanningDate("");
    setPlanningTime("");
    setPlanningVenueId("");
    setPlanningError("");
  };

  const handleSaveSeriesPlanning = async () => {
    if (!planningTarget) return;
    setPlanningBusy(true);
    setPlanningError("");
    try {
      const response = await fetch("/api/admin/league/phase-schedules", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "saveSeriesPlanningSlot",
          competitionId,
          phaseId: planningTarget.phaseId,
          matchupId: planningTarget.matchupId,
          seriesRoundNumber: planningTarget.seriesRoundNumber,
          scheduledDate: planningDate,
          scheduledTime: planningTime,
          venueId: planningVenueId,
        }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Η αποθήκευση του προσωρινού προγραμματισμού απέτυχε.");
      setPlanningTarget(null);
      setPlanningDate("");
      setPlanningTime("");
      setPlanningVenueId("");
      setPlanningError("");
      if (onRefreshCompetitionData) {
        await onRefreshCompetitionData();
      } else {
        window.location.reload();
      }
    } catch (error) {
      setPlanningError(error instanceof Error ? error.message : "Η αποθήκευση του προσωρινού προγραμματισμού απέτυχε.");
    } finally {
      setPlanningBusy(false);
    }
  };

  const getSelectedGameIds = (scheduleKey: string) => selectedGameIdsByScheduleId[scheduleKey] ?? [];
  const getScheduleEditor = (scheduleKey: string) => scheduleEditorByScheduleId[scheduleKey] ?? createDefaultScheduleEditorState();
  const getScheduleDisplayMode = (scheduleKey: string) => scheduleDisplayModeByScheduleId[scheduleKey] ?? "round";
  const updateScheduleEditor = (scheduleKey: string, patch: Partial<ScheduleEditorState>) => {
    setScheduleEditorByScheduleId((current) => ({
      ...current,
      [scheduleKey]: {
        ...createDefaultScheduleEditorState(),
        ...(current[scheduleKey] ?? createDefaultScheduleEditorState()),
        ...patch,
      },
    }));
  };
  const clearScheduleSelection = (scheduleKey: string) => {
    setSelectedGameIdsByScheduleId((current) => ({ ...current, [scheduleKey]: [] }));
    setScheduleEditorByScheduleId((current) => ({ ...current, [scheduleKey]: createDefaultScheduleEditorState() }));
  };
  const setScheduleDisplayMode = (scheduleKey: string, mode: ScheduleDisplayMode) => {
    setScheduleDisplayModeByScheduleId((current) => ({ ...current, [scheduleKey]: mode }));
    if (mode === "all") {
      clearScheduleSelection(scheduleKey);
    }
  };
  const toggleScheduleGame = (scheduleKey: string, gameId: string) => {
    setSelectedGameIdsByScheduleId((current) => {
      const existing = current[scheduleKey] ?? [];
      const next = existing.includes(gameId) ? existing.filter((value) => value !== gameId) : [...existing, gameId];
      return { ...current, [scheduleKey]: next };
    });
  };
  const setAllScheduleGames = (scheduleKey: string, gameIds: string[]) => {
    setSelectedGameIdsByScheduleId((current) => ({ ...current, [scheduleKey]: [...gameIds] }));
  };
  const saveScheduleSelection = async (scheduleKey: string, scheduleCompetitionId: string, selectedGameIds: string[], editor: ScheduleEditorState) => {
    if (!selectedGameIds.length) return false;
    const ok = await bulkScheduleGames({
      competitionId: scheduleCompetitionId,
      gameIds: selectedGameIds,
      scheduledDateMode: editor.scheduledDateMode,
      scheduledDate: editor.scheduledDateMode === "set" ? editor.scheduledDate : null,
      scheduledTimeMode: editor.scheduledTimeMode,
      scheduledTime: editor.scheduledTimeMode === "set" ? editor.scheduledTime : null,
      venueMode: editor.venueMode,
      venueId: editor.venueMode === "set" ? editor.venueId : null,
    });
    if (!ok) return false;
    clearScheduleSelection(scheduleKey);
    return true;
  };

  const openMatchdayMvp = async (phaseId: string, roundNumber: number) => {
    setMatchdayMvpOpen(true);
    setMatchdayMvpState(null);
    setMatchdayMvpError("");
    setShowOtherMvpPlayers(false);
    setOtherMvpSelection("");
    setMatchdayMvpLoading(true);
    try {
      const params = new URLSearchParams({ competitionId, phaseId, roundNumber: String(roundNumber) });
      const response = await fetch(`/api/admin/matchday-mvp?${params}`, { cache: "no-store" });
      const body = await response.json().catch(() => null) as (MatchdayMvpState & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error || "Η λίστα υποψηφίων δεν φορτώθηκε.");
      setMatchdayMvpState(body);
    } catch (error) {
      setMatchdayMvpError(error instanceof Error ? error.message : "Η λίστα υποψηφίων δεν φορτώθηκε.");
    } finally {
      setMatchdayMvpLoading(false);
    }
  };

  const selectMatchdayMvp = async (gameId: string, playerId: string) => {
    if (!matchdayMvpState || matchdayMvpSaving) return;
    const key = `${gameId}:${playerId}`;
    setMatchdayMvpSaving(key);
    setMatchdayMvpError("");
    try {
      const response = await fetch("/api/admin/matchday-mvp", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          competitionId,
          phaseId: matchdayMvpState.phaseId,
          roundNumber: matchdayMvpState.roundNumber,
          gameId,
          playerId,
        }),
      });
      const body = await response.json().catch(() => null) as (MatchdayMvpState & { error?: string }) | null;
      if (!response.ok || !body) throw new Error(body?.error || "Η επιλογή MVP δεν αποθηκεύτηκε.");
      setMatchdayMvpState(body);
      setShowOtherMvpPlayers(false);
      setOtherMvpSelection("");
    } catch (error) {
      setMatchdayMvpError(error instanceof Error ? error.message : "Η επιλογή MVP δεν αποθηκεύτηκε.");
    } finally {
      setMatchdayMvpSaving("");
    }
  };

  return (
    <Panel
      title="Πρόγραμμα & Αγώνες"
      description="Δημιουργία και διαχείριση του προγράμματος αγώνων ανά φάση της διοργάνωσης."
    >
      <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-black text-zinc-900">Πρόγραμμα & Αγώνες</p>
            <p className="mt-1 text-sm text-zinc-600">
              {schedules.length
                ? "Υπάρχουν καταχωρημένα προγράμματα φάσεων."
                : "Δεν έχει δημιουργηθεί πρόγραμμα για κάποια φάση."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PlatformButton type="button" onClick={openVenueManager} className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700 transition hover:bg-zinc-50">
              Διαχείριση γηπέδων
            </PlatformButton>
            <PlatformButton type="button" onClick={openCreateModal} disabled={!competitionPhases.length} className={buttonClass}>
              + Δημιουργία Προγράμματος
            </PlatformButton>
          </div>
        </div>

        {!schedules.length ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-5 text-sm text-zinc-600">
            Δεν έχει δημιουργηθεί πρόγραμμα για κάποια φάση.
          </div>
        ) : (
          <div className="grid gap-4">
            {schedules.map((schedule) => {
              const scheduleKey = String(schedule.id);
              const phase = competitionPhases.find((entry) => String(entry.id) === String(schedule.phase_id ?? "")) ?? null;
              const phaseRules = parseStandingsRules(phase?.rule_settings_json);
              const roundRobinStructure = roundRobinStructureFromTeams(competitionTeams.length, phaseRules.gamesPerPairing);
              const scheduleGames = (data.games as GeneratedGameRow[]).filter((game) => String(game.schedule_id ?? "") === scheduleKey);
              const completedGames = scheduleGames.filter((game) => String(game.status ?? "") === "completed").length;
              const generatedRounds = buildGeneratedRounds(scheduleGames, competitionTeams);
              const lifecycle = String(schedule.lifecycle_status ?? "draft");
              const phaseFormat = String(phase?.format ?? phase?.phase_kind ?? "").toLowerCase();
              const seriesRounds = phaseFormat === "series" ? buildSeriesRounds(data, phase ?? schedule as unknown as Row, scheduleKey, scheduleGames) : [];
              const hasGames = phaseFormat === "series"
                ? scheduleGames.some((game) => String(game.series_matchup_id ?? "").trim()) || seriesRounds.length > 0
                : scheduleGames.length > 0;
              const activeRoundNumber = selectedRoundByScheduleId[scheduleKey] ?? (phaseFormat === "series" ? 1 : generatedRounds[0]?.roundNumber ?? 0);
              const activeRound = phaseFormat === "series"
                ? null
                : (generatedRounds.find((round) => round.roundNumber === activeRoundNumber) ?? generatedRounds[0] ?? null);
              const activeSeriesRound = phaseFormat === "series"
                ? (seriesRounds.find((round) => round.roundNumber === activeRoundNumber) ?? seriesRounds[0] ?? null)
                : null;
              const canGenerate = lifecycle === "draft" && !hasGames && phaseFormat === "standings" && competitionTeams.length >= 2;
              const phaseSettings = parseObject(phase?.rule_settings_json);
              const bracketConfig = parseObject(phaseSettings.bracketConfiguration);
              const seriesMatchups = Array.isArray(bracketConfig.matchups) ? bracketConfig.matchups : [];
              const seriesEntryClassifications = seriesMatchups.map((matchup) => classifySeriesBracketEntry(matchup));
              const playableSeriesMatchupCount = seriesEntryClassifications.filter((entry) => entry.kind === "playable_matchup").length;
              const seriesTeams = seriesMatchups.reduce((count, matchup) => {
                const slotAType = String(matchup?.slotA?.type ?? "");
                const slotBType = String(matchup?.slotB?.type ?? "");
                return count + (slotAType === "bye" ? 0 : 1) + (slotBType === "bye" ? 0 : 1);
              }, 0);
              const winsRequired = Math.max(1, Math.floor(Number(phase?.wins_required ?? 0) || 0));
              const carryOverEnabled = Boolean(Number(phase?.carry_over_enabled ?? 0));
              const carryOverMeetingNumbers = Array.isArray(phaseSettings.carryOverMeetingNumbers)
                ? [...new Set(phaseSettings.carryOverMeetingNumbers.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value >= 1))]
                : [];
              const transferredRounds = carryOverEnabled ? Math.max(1, carryOverMeetingNumbers.length || 1) : 0;
              const carryOverResolution = resolveSeriesCarryOver(data.phases, data.games, data.teams, phase ?? schedule as unknown as Row);
              const seriesRoundWindows = carryOverResolution.matchups.filter((matchup) => matchup.playable !== false).map((matchup) => {
                const window = calculateSeriesRoundWindow({
                  winsRequired,
                  currentWinsA: Number(matchup.startingWinsA ?? 0),
                  currentWinsB: Number(matchup.startingWinsB ?? 0),
                  qualified: Boolean(matchup.currentSeriesDecided || matchup.state !== "resolved"),
                });
                return window;
              });
              const minimumNewRounds = seriesRoundWindows.length ? Math.max(...seriesRoundWindows.map((entry) => entry.minimumNewRounds)) : 0;
              const maximumNewRounds = seriesRoundWindows.length ? Math.max(...seriesRoundWindows.map((entry) => entry.maximumNewRounds)) : 0;
              const matchupsPerRound = playableSeriesMatchupCount;
              const maxNewGames = maximumNewRounds * matchupsPerRound;
              const materializedSeriesGames = (data.games as GeneratedGameRow[]).filter((game) =>
                String(game.phase_id ?? "") === String(phase?.id ?? "") &&
                String(game.series_matchup_id ?? "").trim() &&
                Number.isInteger(Number(game.series_round_number ?? 0)),
              );
              const participantConfiguration = parseObject(phaseSettings.participantConfiguration);
              const sourcePhaseId = String(
                phase?.previous_phase_id
                ?? participantConfiguration.participantSourcePhaseId
                ?? participantConfiguration.sourcePhaseId
                ?? "",
              ).trim();
              const sourceGamesById = new Map(
                (data.games as GeneratedGameRow[])
                  .filter((game) => String(game.phase_id ?? "") === sourcePhaseId)
                  .map((game) => [String(game.id ?? ""), game] as const),
              );
              const seriesGamesById = new Map(materializedSeriesGames.map((game) => [String(game.id ?? ""), game] as const));
              const completedSeriesGames = materializedSeriesGames.filter((game) => String(game.status ?? "").toLowerCase() === "completed").length;
              const totalGames = phaseFormat === "series" ? materializedSeriesGames.length : (hasGames ? scheduleGames.length : roundRobinStructure.totalGames);
              const statusLine = phaseFormat === "series"
                ? `${seriesTeams} ομάδες • ${transferredRounds} μεταφερόμενοι γύροι • ${minimumNewRounds} ελάχιστοι νέοι γύροι • ${maximumNewRounds} μέγιστοι νέοι γύροι • ${matchupsPerRound} διασταυρώσεις/γύρο • ${maxNewGames} μέγιστοι πιθανοί νέοι αγώνες`
                : hasGames
                  ? `${totalGames} αγώνες • ${generatedRounds.length} αγωνιστικές • ${completedGames}/${totalGames} ολοκληρωμένοι`
                  : `${roundRobinStructure.totalGames} προβλεπόμενοι αγώνες • ${roundRobinStructure.rounds} αγωνιστικές`;
              const selectedGameIds = getSelectedGameIds(scheduleKey);
              const selectedGameSet = new Set(selectedGameIds);
              const displayedRoundGames = phaseFormat === "series" ? [] : (activeRound ? sortRoundsForDisplay(activeRound.games) : []);
              const mvpMatchdayEligible = phaseFormat === "standings" && displayedRoundGames.length > 0
                && displayedRoundGames.every((game) => data.matchReports?.[String(game.id)]?.available === true);
              const activeSeriesRows = phaseFormat === "series" ? (activeSeriesRound?.rows ?? []) : [];
              const activeSeriesSelectableGameIds = activeSeriesRows
                .filter((entry) => entry.round.rowState === "real_game" && entry.round.realGameId)
                .map((entry) => String(entry.round.realGameId ?? ""));
              const selectedRoundGames = phaseFormat === "series"
                ? (activeSeriesSelectableGameIds.length ? materializedSeriesGames.filter((game) => selectedGameSet.has(String(game.id))) : [])
                : displayedRoundGames.filter((game) => selectedGameSet.has(String(game.id)));
              const allRoundSelected = phaseFormat === "series"
                ? activeSeriesSelectableGameIds.length > 0 && activeSeriesSelectableGameIds.every((gameId) => selectedGameSet.has(gameId))
                : displayedRoundGames.length > 0 && displayedRoundGames.every((game) => selectedGameSet.has(String(game.id)));
              const editor = getScheduleEditor(scheduleKey);
              const displayMode = getScheduleDisplayMode(scheduleKey);
              const selectedDateValues = [...new Set(selectedRoundGames.map((game) => String(game.scheduled_date ?? "").trim()).filter(Boolean))];
              const selectedTimeValues = [...new Set(selectedRoundGames.map((game) => String(game.scheduled_time ?? "").trim()).filter(Boolean))];
              const selectedVenueValues = [...new Set(selectedRoundGames.map((game) => String(game.venue ?? "").trim()).filter(Boolean))];
              const commonDateValue = selectedDateValues.length === 1 ? selectedDateValues[0] : "";
              const commonTimeValue = selectedTimeValues.length === 1 ? selectedTimeValues[0] : "";
              const commonVenueValue = selectedVenueValues.length === 1 ? selectedVenueValues[0] : "";
              const commonVenueId = commonVenueValue
                ? competitionVenues.find((venue) => String(venue.name ?? "") === commonVenueValue)?.id ?? ""
                : "";
              const selectedResultGame = editingResultGameId
                ? scheduleGames.find((game) => String(game.id) === editingResultGameId) ?? null
                : null;
              const administrativeResultMode = resultEditorMode !== "manual";
              const resultPhaseUsesStandings = String(selectedResultGame?.phase_format ?? "") === "standings";
              const selectedMatchReportGame = matchReportGameId
                ? scheduleGames.find((game) => String(game.id) === matchReportGameId) ?? null
                : null;
              const selectedGameRows = scheduleGames.filter((game) => selectedGameSet.has(String(game.id)));
              const dateInputValue = editor.scheduledDateMode === "set"
                ? editor.scheduledDate
                : editor.scheduledDateMode === "clear"
                  ? ""
                  : commonDateValue;
              const timeInputValue = editor.scheduledTimeMode === "set"
                ? editor.scheduledTime
                : editor.scheduledTimeMode === "clear"
                  ? ""
                  : commonTimeValue;
              const venueSelectValue = editor.venueMode === "set"
                ? editor.venueId
                : editor.venueMode === "clear"
                  ? ""
                  : commonVenueId;
              const canSaveSelection = selectedGameIds.length > 0
                && !(editor.scheduledDateMode === "set" && !dateInputValue)
                && !(editor.scheduledTimeMode === "set" && !timeInputValue)
                && !(editor.venueMode === "set" && (!competitionVenues.length || !venueSelectValue));
              const dateDisplayMode = selectedDateValues.length > 1 ? "Διαφορετικές τιμές" : commonDateValue || "—";
              const timeDisplayMode = selectedTimeValues.length > 1 ? "Διαφορετικές τιμές" : commonTimeValue || "—";
              const venueDisplayMode = selectedVenueValues.length > 1 ? "Διαφορετικές τιμές" : commonVenueValue || "—";
              const isExpanded = openScheduleId === scheduleKey;
              const phaseLifecycle = String((phase as Row | undefined)?.lifecycle_status ?? "active");
              const programObviouslyStarted = scheduleGames.some((game) =>
                String(game.status ?? "").trim().toLowerCase() !== "scheduled"
                || game.home_score !== null
                || game.away_score !== null
                || Boolean(String(game.result_source ?? "").trim())
                || Boolean(String(game.external_id ?? "").trim()),
              );
              const phaseLifecycleLabel = phaseLifecycle === "finalized" ? "Οριστικοποιημένη" : "Σε εξέλιξη";
              const phaseProgressLabel = phaseFormat === "series"
                ? `${completedSeriesGames}/${Math.max(materializedSeriesGames.length, 0)} υλικοποιημένοι ολοκληρωμένοι`
                : `${completedGames}/${totalGames}`;
              const phaseHeaderSummary = totalGames ? `${phaseLifecycleLabel} · ${phaseProgressLabel}` : phaseLifecycleLabel;
              const headerLabel = `${String(schedule.phase_name ?? phase?.name ?? "—")}`;
              return (
                <article key={String(schedule.id)} className="w-full min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
                  <PlatformButton
                    type="button"
                    onClick={() => setOpenScheduleId(isExpanded ? null : scheduleKey)}
                    className="flex w-full min-w-0 flex-wrap items-start justify-between gap-3 text-left"
                  >
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-lg font-black text-zinc-950">{headerLabel}</h3>
                        <span className={`rounded-full px-3 py-1 text-xs font-black ${phaseLifecycle === "finalized" ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
                          {phaseLifecycleLabel}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-zinc-600">
                        {phaseFormatLabel(String(schedule.phase_format ?? phase?.format ?? phase?.phase_kind ?? ""))}
                        {typeof schedule.phase_order !== "undefined" ? ` · σειρά ${String(schedule.phase_order ?? phase?.phase_order ?? phase?.order_index ?? "—")}` : ""}
                        {totalGames ? ` · ${phaseProgressLabel}` : ""}
                      </p>
                    </div>
                    <span className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-800 transition hover:border-orange-500">
                      {isExpanded ? "Σύμπτυξη" : "Άνοιγμα"}
                    </span>
                  </PlatformButton>
                  {isExpanded ? (
                    <div className="mt-4 min-w-0 space-y-1.5 text-sm text-zinc-700">
                      {buildPhaseSummary(data, phase).map((line) => <p key={line}>{line}</p>)}
                      <p className="pt-1 text-xs font-black uppercase tracking-wide text-zinc-500">{statusLine}</p>
                      {hasGames ? (
                        <div className="mt-4 min-w-0 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="text-sm font-black text-zinc-900">{phaseFormat === "series" ? "Σειρά Αγώνων" : "Αγωνιστικές"}</p>
                              <div className="inline-flex rounded-xl border border-zinc-300 bg-white p-1 text-xs font-black text-zinc-700">
                                <PlatformButton
                                  type="button"
                                  onClick={() => setScheduleDisplayMode(scheduleKey, "round")}
                                  className={`rounded-lg px-3 py-2 transition ${displayMode === "round" ? "bg-orange-600 text-white" : "hover:bg-zinc-50"}`}
                                >
                                  {phaseFormat === "series" ? "Ανά γύρο" : "Ανά αγωνιστική"}
                                </PlatformButton>
                                <PlatformButton
                                  type="button"
                                  onClick={() => setScheduleDisplayMode(scheduleKey, "all")}
                                  className={`rounded-lg px-3 py-2 transition ${displayMode === "all" ? "bg-orange-600 text-white" : "hover:bg-zinc-50"}`}
                                >
                                  Εμφάνιση όλων
                                </PlatformButton>
                              </div>
                              {displayMode === "round" ? (
                                <PlatformButton mutation
                                  type="button"
                                  className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-black text-zinc-700 transition hover:bg-zinc-50"
                                  onClick={() => {
                                    if (phaseFormat === "series") {
                                      if (!activeSeriesSelectableGameIds.length) return;
                                      if (allRoundSelected) {
                                        clearScheduleSelection(scheduleKey);
                                        return;
                                      }
                                      setAllScheduleGames(scheduleKey, activeSeriesSelectableGameIds);
                                      return;
                                    }
                                    if (!displayedRoundGames.length) return;
                                    if (allRoundSelected) {
                                      clearScheduleSelection(scheduleKey);
                                      return;
                                    }
                                    setAllScheduleGames(scheduleKey, displayedRoundGames.map((game) => String(game.id)));
                                    if (!selectedGameIdsByScheduleId[scheduleKey]?.length) {
                                      setScheduleEditorByScheduleId((current) => ({
                                        ...current,
                                        [scheduleKey]: current[scheduleKey] ?? createDefaultScheduleEditorState(),
                                      }));
                                    }
                                  }}
                                >
                                  Επιλογή όλων
                                </PlatformButton>
                              ) : null}
                            </div>
                            {displayMode === "round" ? (
                              <div className="flex flex-wrap items-center justify-end gap-2">
                              <select
                                className={inputClass}
                                value={String(activeRoundNumber || "")}
                                onChange={(event) => {
                                  const nextRoundNumber = Number(event.target.value);
                                  setSelectedRoundByScheduleId((current) => ({
                                    ...current,
                                    [scheduleKey]: nextRoundNumber,
                                  }));
                                  clearScheduleSelection(scheduleKey);
                                }}
                              >
                                {(phaseFormat === "series" ? seriesRounds : generatedRounds).map((round) => (
                                  <option key={round.roundNumber} value={round.roundNumber}>
                                    {round.roundLabel}
                                  </option>
                                ))}
                              </select>
                              {phaseFormat === "standings" && activeRoundNumber ? (
                                <PlatformButton mutation
                                  type="button"
                                  disabled={!mvpMatchdayEligible || matchdayMvpLoading}
                                  title={mvpMatchdayEligible ? "Επιλογή MVP για την αγωνιστική" : "Η επιλογή MVP ενεργοποιείται όταν ολοκληρωθούν όλα τα Match Reports της αγωνιστικής."}
                                  onClick={() => void openMatchdayMvp(String(phase?.id ?? ""), activeRoundNumber)}
                                  className="rounded-xl border border-orange-300 bg-orange-50 px-3 py-2 text-xs font-black text-orange-800 transition hover:bg-orange-100 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  MVP ΑΓΩΝΙΣΤΙΚΗΣ
                                </PlatformButton>
                              ) : null}
                              </div>
                            ) : null}
                          </div>
                          {displayMode === "round" ? (
                            phaseFormat === "series" ? (
                              activeSeriesRound ? (
                                <div className="mt-4 min-w-0">
                                  <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-zinc-200 bg-white">
                                    <table className="w-full min-w-[68rem] table-auto text-left text-sm">
                                      <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                                        <tr>
                                          <th className="w-10 min-w-10 whitespace-nowrap px-3 py-3" aria-label="Selection"></th>
                                          <th className="min-w-28 whitespace-nowrap px-3 py-3">Match Report</th>
                                          <th className="min-w-24 whitespace-nowrap px-3 py-3">ΒΙΝΤΕΟ</th>
                                          <th className="min-w-[11rem] whitespace-nowrap px-3 py-3">Γηπεδούχος</th>
                                          <th className="min-w-32 whitespace-nowrap px-3 py-3 text-center">Αποτέλεσμα</th>
                                          <th className="min-w-[11rem] whitespace-nowrap px-3 py-3">Φιλοξενούμενος</th>
                                          <th className="min-w-28 whitespace-nowrap px-3 py-3">Ημερομηνία</th>
                                          <th className="min-w-20 whitespace-nowrap px-3 py-3">Ώρα</th>
                                          <th className="min-w-40 whitespace-nowrap px-3 py-3">Γήπεδο</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {(activeSeriesRound.rows ?? []).map((entry) => {
                                          const round = entry.round;
                                          const isRealGame = round.rowState === "real_game";
                                          const isTransferred = round.rowState === "transferred";
                                          const isIfNeeded = round.rowState === "if_needed";
                                          const isQualified = round.rowState === "qualified";
                                          const realGame = round.realGameId ? seriesGamesById.get(String(round.realGameId)) ?? null : null;
                                          const sourceGame = round.sourceGameId ? sourceGamesById.get(String(round.sourceGameId)) ?? null : null;
                                          const backingGame = realGame ?? sourceGame;
                                          const gameId = String(round.realGameId ?? round.sourceGameId ?? `${entry.matchupId}-${round.seriesRoundNumber}`);
                                          const isSelected = selectedGameSet.has(String(round.realGameId ?? ""));
                                          const displayHome = String(round.homeTeamName ?? round.expectedHomeTeamName ?? "—");
                                          const displayAway = String(round.awayTeamName ?? round.expectedAwayTeamName ?? "—");
                                          const displayResult = isQualified
                                            ? `Πρόκριση ${String(round.winnerTeamName ?? "—")} από τον ${round.qualificationRoundNumber ?? round.seriesRoundNumber}ο Γύρο`
                                            : isIfNeeded
                                              ? "Εάν χρειαστεί"
                                              : round.homeScore !== null && round.awayScore !== null
                                                ? `${String(round.homeScore ?? "—")} – ${String(round.awayScore ?? "—")}`
                                                : "—";
                                          const planningDateValue = isIfNeeded ? String(round.planningSlot?.scheduledDate ?? "").trim() : "";
                                          const planningTimeValue = isIfNeeded ? String(round.planningSlot?.scheduledTime ?? "").trim() : "";
                                          const planningVenueValue = isIfNeeded ? String(round.planningSlot?.venue ?? "").trim() : "";
                                          const displayDate = backingGame
                                            ? parseDateForDisplay(String(backingGame.scheduled_date ?? ""))
                                            : planningDateValue ? parseDateForDisplay(planningDateValue) : "—";
                                           const displayTime = backingGame ? String(backingGame.scheduled_time ?? "").trim() || "—" : planningTimeValue || "—";
                                           const displayVenue = backingGame ? String(backingGame.venue ?? "").trim() || "—" : planningVenueValue || "—";
                                           const matchReportAvailability = realGame ? data.matchReports?.[String(realGame.id)] : undefined;
                                           const matchReportPresentation = matchReportButtonPresentation(matchReportAvailability);
                                           if (isQualified) {
                                             return (
                                               <tr key={gameId} className="border-t border-zinc-100 bg-white">
                                                 <td colSpan={9} className="px-3 py-3">
                                                   <div className="flex min-h-10 w-full items-center justify-center rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-center text-sm font-black leading-snug text-emerald-900">
                                                     <span className="min-w-0 break-words">{displayResult}</span>
                                                   </div>
                                                 </td>
                                               </tr>
                                             );
                                           }
                                           return (
                                            <tr key={gameId} className={`border-t border-zinc-100 ${isSelected ? "bg-orange-50" : "bg-white"}`}>
                                              <td className="px-3 py-3 align-top">
                                                {isRealGame ? (
                                                  <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={() => toggleScheduleGame(scheduleKey, String(round.realGameId ?? ""))}
                                                    className="mt-1 h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                                                  />
                                                ) : null}
                                              </td>
                                              <td className="px-3 py-3 align-top">
                                                <PlatformButton
                                                  type="button"
                                                  disabled={!isRealGame || !realGame || matchReportPresentation.disabled}
                                                  aria-disabled={!isRealGame || !realGame || matchReportPresentation.disabled}
                                                  title={matchReportPresentation.title}
                                                  onClick={() => {
                                                    if (isRealGame && realGame) void openMatchReport(String(realGame.id), matchReportAvailability);
                                                  }}
                                                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-black transition focus-visible:outline focus-visible:outline-2 ${matchReportPresentation.className}`}
                                                >
                                                  {isTransferred ? "Από μεταφορά" : isRealGame ? matchReportPresentation.label : "—"}
                                                </PlatformButton>
                                              </td>
                                              <td className="px-3 py-3 align-top">
                                                {backingGame?.video_url ? (
                                                  <a href={String(backingGame.video_url)} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-black text-sky-800 transition hover:bg-sky-100">
                                                    ▶ Βίντεο
                                                  </a>
                                                ) : "—"}
                                              </td>
                                              <td className="min-w-[11rem] px-3 py-3 align-top text-zinc-800">
                                                <span className="block whitespace-normal break-normal text-right leading-snug">{displayHome}</span>
                                              </td>
                                              <td className="px-3 py-3 align-top font-black text-zinc-900">
                                                {isRealGame ? (
                                                  <div className="space-y-2">
                                                  {round.homeScore !== null && round.awayScore !== null ? (
                                                    <div className="mx-auto inline-flex min-h-10 w-full items-center justify-center whitespace-nowrap rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-2 text-sm font-black text-zinc-900">
                                                      {`${String(round.homeScore ?? "—")} – ${String(round.awayScore ?? "—")}`}
                                                    </div>
                                                  ) : (
                                                    <PlatformButton
                                                      type="button"
                                                      onClick={() => {
                                                        if (realGame) openResultForm(realGame);
                                                      }}
                                                      className="mx-auto inline-flex min-h-10 w-full items-center justify-center whitespace-nowrap rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm font-black text-zinc-900 transition hover:border-orange-300 hover:bg-orange-50"
                                                    >
                                                      —
                                                    </PlatformButton>
                                                  )}
                                                  {realGame?.administrative_decision_type === "interruption" ? (
                                                    <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black leading-tight text-amber-900">
                                                      Διακοπή – διοικητικό αποτέλεσμα
                                                    </p>
                                                  ) : null}
                                                  </div>
                                                ) : (
                                                  <div className="mx-auto inline-flex min-h-10 w-full items-center justify-center whitespace-nowrap rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-2 text-sm font-black text-zinc-600">
                                                    {displayResult}
                                                  </div>
                                                )}
                                              </td>
                                              <td className="min-w-[11rem] px-3 py-3 align-top text-zinc-800">
                                                <span className="block whitespace-normal break-normal text-left leading-snug">{displayAway}</span>
                                              </td>
                                              <td className="px-3 py-3 align-top text-zinc-800">
                                                {displayDate}
                                              </td>
                                              <td className="px-3 py-3 align-top text-zinc-800">
                                                {displayTime}
                                              </td>
                                              <td className="px-3 py-3 align-top text-zinc-800">
                                                <span className="block min-w-0 max-w-full whitespace-normal break-words leading-snug [overflow-wrap:anywhere]">
                                                  {displayVenue}
                                                </span>
                                                {isIfNeeded ? (
                                                  <PlatformButton
                                                    type="button"
                                                    onClick={() => openPlanningDialog({
                                                      phaseId: String(phase?.id ?? schedule.phase_id ?? ""),
                                                      scheduleId: scheduleKey,
                                                      matchupId: entry.matchupId,
                                                      seriesRoundNumber: round.seriesRoundNumber,
                                                      homeTeamName: displayHome,
                                                      awayTeamName: displayAway,
                                                      planningSlot: round.planningSlot,
                                                    })}
                                                    className="mt-2 inline-flex rounded-lg border border-sky-300 bg-sky-50 px-2.5 py-1.5 text-xs font-black text-sky-800 transition hover:bg-sky-100"
                                                  >
                                                    {round.planningSlot ? "Επεξεργασία" : "Προγραμματισμός"}
                                                  </PlatformButton>
                                                ) : null}
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>
                              ) : null
                            ) : (
                              activeRound ? (
                                <div className="mt-4 min-w-0">
                                  <div className="max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-zinc-200 bg-white">
                                    <table className="w-full min-w-[68rem] table-auto text-left text-sm">
                                      <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
                                        <tr>
                                          <th className="w-10 min-w-10 whitespace-nowrap px-3 py-3" aria-label="Selection"></th>
                                          <th className="min-w-28 whitespace-nowrap px-3 py-3">Match Report</th>
                                          <th className="min-w-24 whitespace-nowrap px-3 py-3">ΒΙΝΤΕΟ</th>
                                          <th className="min-w-[11rem] whitespace-nowrap px-3 py-3">Γηπεδούχος</th>
                                          <th className="min-w-32 whitespace-nowrap px-3 py-3 text-center">Αποτέλεσμα</th>
                                          <th className="min-w-[11rem] whitespace-nowrap px-3 py-3">Φιλοξενούμενος</th>
                                          <th className="min-w-28 whitespace-nowrap px-3 py-3">Ημερομηνία</th>
                                          <th className="min-w-20 whitespace-nowrap px-3 py-3">Ώρα</th>
                                          <th className="min-w-40 whitespace-nowrap px-3 py-3">Γήπεδο</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {displayedRoundGames.map((game) => {
                                          const gameId = String(game.id);
                                          const isSelected = selectedGameSet.has(gameId);
                                          const date = String(game.scheduled_date ?? "").trim();
                                          const time = String(game.scheduled_time ?? "").trim();
                                           const hasScore = String(game.home_score ?? "").trim() || String(game.away_score ?? "").trim();
                                           const matchReportAvailability = data.matchReports?.[gameId];
                                           const matchReportPresentation = matchReportButtonPresentation(matchReportAvailability);
                                          return (
                                            <tr key={gameId} className={`border-t border-zinc-100 ${isSelected ? "bg-orange-50" : "bg-white"}`}>
                                              <td className="px-3 py-3 align-top">
                                                <input
                                                  type="checkbox"
                                                  checked={isSelected}
                                                  onChange={() => toggleScheduleGame(scheduleKey, gameId)}
                                                  className="mt-1 h-4 w-4 rounded border-zinc-300 text-orange-600 focus:ring-orange-500"
                                                />
                                              </td>
                                              <td className="px-3 py-3 align-top">
                                                <PlatformButton
                                                  type="button"
                                                  disabled={matchReportPresentation.disabled}
                                                  aria-disabled={matchReportPresentation.disabled}
                                                  title={matchReportPresentation.title}
                                                  onClick={() => void openMatchReport(gameId, matchReportAvailability)}
                                                  className={`inline-flex rounded-full border px-3 py-1 text-xs font-black transition focus-visible:outline focus-visible:outline-2 ${matchReportPresentation.className}`}
                                                >
                                                  {matchReportPresentation.label}
                                                </PlatformButton>
                                              </td>
                                              <td className="px-3 py-3 align-top">
                                                {game.video_url ? (
                                                  <a href={String(game.video_url)} target="_blank" rel="noopener noreferrer" className="inline-flex rounded-lg border border-sky-300 bg-sky-50 px-2 py-1 text-xs font-black text-sky-800 transition hover:bg-sky-100">
                                                    ▶ Βίντεο
                                                  </a>
                                                ) : "—"}
                                              </td>
                                              <td className="min-w-[11rem] px-3 py-3 align-top text-zinc-800">
                                                <span className="block whitespace-normal break-normal text-right leading-snug">{String(game.home_team_name ?? "—")}</span>
                                              </td>
                                              <td className="px-3 py-3 align-top font-black text-zinc-900">
                                                <div className="space-y-2">
                                                {hasScore ? (
                                                  <div className="mx-auto inline-flex min-h-10 w-full items-center justify-center whitespace-nowrap rounded-xl border border-zinc-200 bg-zinc-50 px-2 py-2 text-sm font-black text-zinc-900">
                                                    {`${String(game.home_score ?? "—")} – ${String(game.away_score ?? "—")}`}
                                                  </div>
                                                ) : (
                                                  <PlatformButton
                                                    type="button"
                                                    onClick={() => openResultForm(game)}
                                                    className="mx-auto inline-flex min-h-10 w-full items-center justify-center whitespace-nowrap rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm font-black text-zinc-900 transition hover:border-orange-300 hover:bg-orange-50"
                                                  >
                                                    —
                                                  </PlatformButton>
                                                )}
                                                {game.administrative_decision_type === "interruption" ? (
                                                  <p className="rounded-lg border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-black leading-tight text-amber-900">
                                                    Διακοπή – διοικητικό αποτέλεσμα
                                                  </p>
                                                ) : null}
                                                </div>
                                              </td>
                                              <td className="min-w-[11rem] px-3 py-3 align-top text-zinc-800">
                                                <span className="block whitespace-normal break-normal text-left leading-snug">{String(game.away_team_name ?? "—")}</span>
                                              </td>
                                              <td className="px-3 py-3 align-top text-zinc-800">
                                                {date ? parseDateForDisplay(date) : "—"}
                                              </td>
                                              <td className="px-3 py-3 align-top text-zinc-800">
                                                {time || "—"}
                                              </td>
                                              <td className="px-3 py-3 align-top text-zinc-800">
                                                <span className="block min-w-0 max-w-full whitespace-normal break-words leading-snug [overflow-wrap:anywhere]">
                                                  {String(game.venue ?? "").trim() || "—"}
                                                </span>
                                              </td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  </div>
                                  {activeSeriesRound?.rows?.some((entry) => entry.round.rowState === "if_needed") ? (
                                    <div className="mt-3 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                                      Ρεπό: <span className="font-black text-zinc-900">—</span>
                                    </div>
                                  ) : null}
                                </div>
                              ) : null
                            )
                          ) : (
                            <div className="mt-4 space-y-4">
                              {(phaseFormat === "series" ? seriesRounds : generatedRounds).map((round) => (
                                <section key={round.roundNumber} className="rounded-2xl border border-zinc-200 bg-white p-3">
                                  <p className="text-sm font-black text-zinc-900">{round.roundLabel}</p>
                                  <div className="mt-3 space-y-2">
                                    {(phaseFormat === "series"
                                      ? ((round as SeriesRoundView).rows)
                                      : (round as typeof generatedRounds[number]).games.map((game) => ({
                                        matchupId: String(game.id),
                                        matchupLabel: String(game.home_team_name ?? "—"),
                                        round: {
                                          seriesRoundNumber: Number(game.round_number ?? 0),
                                          rowState: "real_game" as const,
                                          expectedHomeTeamId: String(game.home_team_id ?? ""),
                                          expectedHomeTeamName: String(game.home_team_name ?? "—"),
                                          expectedAwayTeamId: String(game.away_team_id ?? ""),
                                          expectedAwayTeamName: String(game.away_team_name ?? "—"),
                                          sourceGameId: null,
                                          realGameId: String(game.id ?? ""),
                                          planningSlot: null,
                                          homeTeamId: String(game.home_team_id ?? ""),
                                          homeTeamName: String(game.home_team_name ?? "—"),
                                          awayTeamId: String(game.away_team_id ?? ""),
                                          awayTeamName: String(game.away_team_name ?? "—"),
                                          homeScore: game.home_score === null ? null : Number(game.home_score),
                                          awayScore: game.away_score === null ? null : Number(game.away_score),
                                          winnerTeamId: null,
                                          winnerTeamName: null,
                                          qualificationRoundNumber: null,
                                          nextRequiredRoundNumber: null,
                                        },
                                      }))).map((entry: SeriesRoundViewRow) => {
                                      const round = entry.round;
                                      const isRealGame = round.rowState === "real_game";
                                      const isTransferred = round.rowState === "transferred";
                                      const isIfNeeded = round.rowState === "if_needed";
                                      const isQualified = round.rowState === "qualified";
                                      const realGame = round.realGameId ? seriesGamesById.get(String(round.realGameId)) ?? null : null;
                                      const sourceGame = round.sourceGameId ? sourceGamesById.get(String(round.sourceGameId)) ?? null : null;
                                      const backingGame = realGame ?? sourceGame;
                                      const displayHome = String(round.homeTeamName ?? round.expectedHomeTeamName ?? "—");
                                      const displayAway = String(round.awayTeamName ?? round.expectedAwayTeamName ?? "—");
                                      const displayResult = isQualified
                                        ? `Πρόκριση ${String(round.winnerTeamName ?? "—")} από τον ${round.qualificationRoundNumber ?? round.seriesRoundNumber}ο Γύρο`
                                        : isIfNeeded
                                          ? "Εάν χρειαστεί"
                                          : round.homeScore !== null && round.awayScore !== null
                                            ? `${String(round.homeScore ?? "—")} – ${String(round.awayScore ?? "—")}`
                                            : "—";
                                       const displayDate = backingGame ? parseDateForDisplay(String(backingGame.scheduled_date ?? "")) : "—";
                                       const displayTime = backingGame ? String(backingGame.scheduled_time ?? "").trim() || "—" : "—";
                                       const displayVenue = backingGame ? String(backingGame.venue ?? "").trim() || "—" : "—";
                                       if (isQualified) {
                                         return (
                                           <div key={`${entry.matchupId}-${round.seriesRoundNumber}`} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center text-sm font-black leading-snug text-emerald-900">
                                             <span className="break-words">{displayResult}</span>
                                           </div>
                                         );
                                       }
                                       return (
                                        phaseFormat === "series" ? (
                                          <div key={`${entry.matchupId}-${round.seriesRoundNumber}`} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-8 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                                            <div className="min-w-0 justify-self-end text-right text-zinc-800">
                                              <span className="block break-words leading-snug">{displayHome}</span>
                                            </div>
                                            <div className="inline-flex min-h-10 w-[7.5rem] items-center justify-center whitespace-nowrap rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm font-black text-zinc-900">
                                              {displayResult}
                                            </div>
                                            <div className="min-w-0 text-left text-zinc-800">
                                              <span className="block break-words leading-snug">{displayAway}</span>
                                            </div>
                                          </div>
                                        ) : (
                                          <div key={`${entry.matchupId}-${round.seriesRoundNumber}`} className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-8 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3">
                                            <div className="min-w-0 justify-self-end text-right text-zinc-800">
                                              <span className="block break-words">{displayHome}</span>
                                            </div>
                                            <div className="inline-flex min-h-10 w-[7.5rem] items-center justify-center whitespace-nowrap rounded-xl border border-zinc-200 bg-white px-2 py-2 text-sm font-black text-zinc-900">
                                              {displayResult}
                                            </div>
                                            <div className="min-w-0 text-left text-zinc-800">
                                              <span className="block break-words">{displayAway}</span>
                                            </div>
                                          </div>
                                        )
                                      );
                                    })}
                                  </div>
                                </section>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : null}

                      {showResultForm && selectedResultGame ? (
                          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="text-xl font-black text-zinc-950">
                                    {resultEditorMode === "administrative-interruption"
                                      ? "Οριστικό κλείσιμο λόγω διακοπής"
                                      : administrativeResultMode
                                        ? "Επεξεργασία επίσημου αποτελέσματος"
                                        : "Καταχώριση αποτελέσματος"}
                                  </p>
                                  <p className="mt-1 text-sm text-zinc-600">
                                    {String(selectedResultGame.home_team_name ?? "—")} - {String(selectedResultGame.away_team_name ?? "—")}
                                  </p>
                                </div>
                                <PlatformButton
                                  type="button"
                                  onClick={closeResultForm}
                                  className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
                                >
                                  Κλείσιμο
                                </PlatformButton>
                              </div>
                              <PlatformForm
                                className="mt-4 space-y-4"
                                onSubmit={async (event) => {
                                  event.preventDefault();
                                  if (resultEditorMode === "administrative-interruption" && !window.confirm(
                                    "Καταγράφεται επίσημο διοικητικό αποτέλεσμα. Το ιστορικό KomoControl δεν θα οριστικοποιηθεί τεχνητά. Ο αγώνας δεν θα συνεχιστεί. Θέλετε να προχωρήσετε;",
                                  )) return;
                                  const ok = await updateEntity(
                                    "games",
                                    editingResultGameId,
                                    event,
                                    administrativeResultMode ? "Το επίσημο διοικητικό αποτέλεσμα αποθηκεύτηκε." : "Το αποτέλεσμα αποθηκεύτηκε.",
                                  );
                                  if (!ok) return;
                                  if (administrativeResultMode) {
                                    await onRefreshCompetitionData?.();
                                  }
                                  closeResultForm();
                                }}
                              >
                                <input type="hidden" name="competitionId" value={competitionId} />
                                <input type="hidden" name="action" value={administrativeResultMode ? "administrative-result" : "manual-result"} />
                                {administrativeResultMode ? <>
                                  <input type="hidden" name="decisionType" value={resultEditorMode === "administrative-interruption" ? "interruption" : "correction"} />
                                  <input type="hidden" name="expectedAdministrativeUpdatedAt" value={String(selectedResultGame.administrative_updated_at ?? "")} />
                                </> : null}
                                <div className="grid gap-4 md:grid-cols-2">
                                  <Field label={`${administrativeResultMode ? "Επίσημο σκορ · " : ""}${String(selectedResultGame.home_team_name ?? "Γηπεδούχος")}`}>
                                    <input
                                      name="homeScore"
                                      type="number"
                                      min={0}
                                      step={1}
                                      required
                                      value={resultHomeScore}
                                      onChange={(event) => setResultHomeScore(event.target.value)}
                                      className={inputClass}
                                    />
                                  </Field>
                                  <Field label={`${administrativeResultMode ? "Επίσημο σκορ · " : ""}${String(selectedResultGame.away_team_name ?? "Φιλοξενούμενος")}`}>
                                    <input
                                      name="awayScore"
                                      type="number"
                                      min={0}
                                      step={1}
                                      required
                                      value={resultAwayScore}
                                      onChange={(event) => setResultAwayScore(event.target.value)}
                                      className={inputClass}
                                    />
                                  </Field>
                                </div>
                                {administrativeResultMode && resultPhaseUsesStandings ? (
                                  <div className="grid gap-4 md:grid-cols-2">
                                    <Field label={`Βαθμοί · ${String(selectedResultGame.home_team_name ?? "Γηπεδούχος")}`}>
                                      <input name="homeStandingsPointsOverride" type="number" min={0} step={1} value={resultHomeStandingsPoints} onChange={(event) => setResultHomeStandingsPoints(event.target.value)} className={inputClass} placeholder="Αυτόματος κανόνας" />
                                    </Field>
                                    <Field label={`Βαθμοί · ${String(selectedResultGame.away_team_name ?? "Φιλοξενούμενος")}`}>
                                      <input name="awayStandingsPointsOverride" type="number" min={0} step={1} value={resultAwayStandingsPoints} onChange={(event) => setResultAwayStandingsPoints(event.target.value)} className={inputClass} placeholder="Αυτόματος κανόνας" />
                                    </Field>
                                    <p className="md:col-span-2 text-xs font-semibold text-zinc-600">Κενό πεδίο: εφαρμόζεται ο κανονικός κανόνας της φάσης. Το 0 αποθηκεύεται ως ρητή απονομή μηδενικών βαθμών.</p>
                                  </div>
                                ) : null}
                                {administrativeResultMode ? (
                                  <>
                                    <Field label="Αιτία / Παρατηρήσεις">
                                      <textarea name="reason" required maxLength={2000} value={resultReason} onChange={(event) => setResultReason(event.target.value)} className={`${inputClass} min-h-28 resize-y`} />
                                    </Field>
                                    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
                                      Η διοικητική απόφαση δεν αλλάζει το χρονόμετρο, τα γεγονότα, τη finalization ή τα στατιστικά KomoControl. Τυχόν μεταγενέστερες φάσεις ή διασταυρώσεις δεν ανακατασκευάζονται αυτόματα.
                                    </div>
                                  </>
                                ) : null}
                                <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4">
                                  <PlatformButton
                                    type="button"
                                    onClick={closeResultForm}
                                    className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700"
                                  >
                                    Ακύρωση
                                  </PlatformButton>
                                  <PlatformButton mutation disabled={busy} className={buttonClass}>
                                    {resultEditorMode === "administrative-interruption"
                                      ? "Κλείσιμο και αποθήκευση αποτελέσματος"
                                      : administrativeResultMode
                                        ? "Αποθήκευση διόρθωσης"
                                        : "Αποθήκευση αποτελέσματος"}
                                  </PlatformButton>
                                </div>
                              </PlatformForm>
                            </div>
                          </div>
                        ) : null}

                      {matchReportGameId && scheduleGames.some((game) => String(game.id) === matchReportGameId) ? (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="match-report-title">
                          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <h2 id="match-report-title" className="text-xl font-black text-zinc-950">MATCH REPORT</h2>
                                {matchReportDetail ? <>
                                  <p className="mt-2 break-words text-lg font-black text-zinc-900">{matchReportDetail.game.homeTeam.name} {matchReportDetail.game.finalScore.home} – {matchReportDetail.game.finalScore.away} {matchReportDetail.game.awayTeam.name}</p>
                                  <p className="mt-1 text-sm text-zinc-600">{matchReportDetail.game.competition}{matchReportDetail.game.round ? ` · ${matchReportDetail.game.round}` : ""}</p>
                                  {selectedMatchReportGame?.administrative_result_id ? <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">Υπάρχει διοικητική διαφοροποίηση του επίσημου αποτελέσματος.</p> : null}
                                </> : null}
                              </div>
                              <PlatformButton type="button" onClick={closeMatchReport} className="min-h-11 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-black text-zinc-700">Κλείσιμο</PlatformButton>
                            </div>
                            {matchReportLoading ? <p className="mt-6 text-sm font-bold text-zinc-600">Φόρτωση Match Report…</p> : null}
                            {matchReportError ? <p className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-800">{matchReportError}</p> : null}
                            {matchReportDetail ? <div className="mt-6 grid gap-3 sm:grid-cols-2">
                              <PlatformButton type="button" disabled={statisticsPdfLoading} onClick={() => void downloadStatisticsPdf()} className="min-h-12 rounded-xl border border-sky-700 bg-sky-600 px-4 py-3 font-black text-white transition hover:bg-sky-700 disabled:cursor-wait disabled:opacity-60">{statisticsPdfLoading ? "ΔΗΜΙΟΥΡΓΙΑ PDF…" : "ΣΤΑΤΙΣΤΙΚΑ PDF"}</PlatformButton>
                              <PlatformButton type="button" onClick={openGameSheet} className="min-h-12 rounded-xl border border-zinc-900 bg-zinc-950 px-4 py-3 font-black text-white transition hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950">ΦΥΛΛΟ ΑΓΩΝΑ</PlatformButton>
                              {statisticsPdfError ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800 sm:col-span-2">{statisticsPdfError}</p> : null}
                              {matchReportDetail.availability.hasIncidentReport && matchReportDetail.incidentReport ? <PlatformButton type="button" onClick={() => setShowIncidentReport(true)} className="min-h-12 rounded-xl border border-red-800 bg-red-600 px-4 py-3 font-black text-white transition hover:bg-red-700 sm:col-span-2">⚠ ΑΝΑΦΟΡΑ ΣΥΜΒΑΝΤΩΝ</PlatformButton> : null}
                            </div> : null}
                          </div>
                        </div>
                      ) : null}

                      {showIncidentReport && matchReportDetail?.incidentReport && scheduleGames.some((game) => String(game.id) === matchReportGameId) ? (
                        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="incident-report-title">
                          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-red-200 bg-white p-5 shadow-2xl sm:p-6">
                            <div className="flex items-start justify-between gap-4">
                              <h2 id="incident-report-title" className="text-xl font-black text-red-800">ΑΝΑΦΟΡΑ ΣΥΜΒΑΝΤΩΝ</h2>
                              <PlatformButton type="button" onClick={() => setShowIncidentReport(false)} className="min-h-11 rounded-xl border border-zinc-300 bg-white px-4 py-2 text-sm font-black text-zinc-700">Κλείσιμο</PlatformButton>
                            </div>
                            <p className="mt-5 whitespace-pre-wrap break-words rounded-xl border border-red-200 bg-red-50 p-4 text-sm leading-7 text-zinc-900">{matchReportDetail.incidentReport}</p>
                          </div>
                        </div>
                      ) : null}

                        {!!selectedGameIds.length ? (
                          <div className="mt-4 rounded-2xl border border-orange-200 bg-white p-4">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-black text-zinc-900">Επιλεγμένοι αγώνες: {selectedGameIds.length}</p>
                                <div className="mt-2 flex min-w-0 flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-700">
                                  {selectedGameRows.map((game) => (
                                    <span key={String(game.id)} className="min-w-0 break-words">
                                      {String(game.home_team_name ?? "—")} – {String(game.away_team_name ?? "—")}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <PlatformButton mutation
                                type="button"
                                onClick={async () => {
                                  if (!selectedGameIds.length) return;
                                  await saveScheduleSelection(scheduleKey, competitionId, selectedGameIds, editor);
                                }}
                                disabled={busy || !canSaveSelection}
                                className={buttonClass}
                              >
                                Επεξεργασία επιλεγμένων
                              </PlatformButton>
                            </div>

                            {selectedGameIds.length === 1 ? (() => {
                              const selectedVideoGame = scheduleGames.find((game) => String(game.id) === selectedGameIds[0]) ?? null;
                              return selectedVideoGame ? (
                                <PlatformForm
                                  key={selectedVideoGame.id}
                                  className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4"
                                  onSubmit={async (event) => {
                                    event.preventDefault();
                                    await updateEntity("games", String(selectedVideoGame.id), event, "Το βίντεο του αγώνα αποθηκεύτηκε.");
                                  }}
                                >
                                  <input type="hidden" name="competitionId" value={competitionId} />
                                  <Field label="Βίντεο αγώνα (URL)">
                                    <input
                                      name="videoUrl"
                                      type="url"
                                      inputMode="url"
                                      placeholder="https://www.youtube.com/watch?v=..."
                                      defaultValue={String(selectedVideoGame.video_url ?? "")}
                                      className={inputClass}
                                    />
                                    <p className="mt-2 text-xs text-sky-900">Τρέχουσα τιμή: {String(selectedVideoGame.video_url ?? "").trim() || "—"}</p>
                                  </Field>
                                  <div className="mt-3 flex justify-end">
                                    <PlatformButton mutation disabled={busy} className={buttonClass}>Αποθήκευση βίντεο</PlatformButton>
                                  </div>
                                </PlatformForm>
                              ) : null;
                            })() : (
                              <p className="mt-4 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                                Το βίντεο ορίζεται ξεχωριστά για κάθε αγώνα.
                              </p>
                            )}

                            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,0.9fr)_minmax(0,1.6fr)]">
                              <Field label="Ημερομηνία">
                                <div className="flex min-w-0 items-center gap-2">
                                  <input
                                    type="date"
                                    value={dateInputValue}
                                    onChange={(event) => updateScheduleEditor(scheduleKey, { scheduledDateMode: "set", scheduledDate: event.target.value })}
                                    className={`${inputClass} min-w-0 flex-1`}
                                  />
                                  <PlatformButton
                                    type="button"
                                    onClick={() => updateScheduleEditor(scheduleKey, { scheduledDateMode: "clear", scheduledDate: "" })}
                                    className="shrink-0 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-black text-zinc-700 transition hover:bg-zinc-50"
                                  >
                                    Καθαρισμός
                                  </PlatformButton>
                                </div>
                                <p className="mt-2 text-xs text-zinc-500">
                                  {selectedRoundGames.length
                                    ? `Τρέχουσα τιμή: ${dateDisplayMode || "—"}`
                                    : "Δεν υπάρχουν επιλεγμένοι αγώνες."}
                                </p>
                              </Field>

                              <Field label="Ώρα">
                                <div className="flex min-w-0 items-center gap-2">
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    pattern="^([01]\\d|2[0-3]):[0-5]\\d$"
                                    placeholder="18:00"
                                    value={timeInputValue}
                                    onChange={(event) => updateScheduleEditor(scheduleKey, { scheduledTimeMode: "set", scheduledTime: normalizeTimeEditorValue(event.target.value) })}
                                    onBlur={(event) => {
                                      const normalized = normalizeTimeEditorValue(event.target.value);
                                      if (normalized !== event.target.value) {
                                        updateScheduleEditor(scheduleKey, { scheduledTimeMode: "set", scheduledTime: normalized });
                                      }
                                    }}
                                    maxLength={5}
                                    className={`${inputClass} min-w-0 flex-1`}
                                  />
                                  <PlatformButton
                                    type="button"
                                    onClick={() => updateScheduleEditor(scheduleKey, { scheduledTimeMode: "clear", scheduledTime: "" })}
                                    className="shrink-0 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-black text-zinc-700 transition hover:bg-zinc-50"
                                  >
                                    Καθαρισμός
                                  </PlatformButton>
                                </div>
                                <p className="mt-2 text-xs text-zinc-500">
                                  {selectedRoundGames.length
                                    ? `Τρέχουσα τιμή: ${timeDisplayMode || "—"}`
                                    : "Δεν υπάρχουν επιλεγμένοι αγώνες."}
                                </p>
                              </Field>

                              <Field label="Γήπεδο">
                                <div className="flex min-w-0 items-center gap-2">
                                  {competitionVenues.length ? (
                                    <select
                                      className={`${inputClass} min-w-0 flex-1 truncate`}
                                      value={venueSelectValue}
                                      onChange={(event) => updateScheduleEditor(scheduleKey, { venueMode: "set", venueId: event.target.value })}
                                    >
                                      <option value="">—</option>
                                      {competitionVenues.map((venue) => (
                                        <option key={String(venue.id)} value={String(venue.id)}>
                                          {String(venue.name ?? "—")}
                                        </option>
                                      ))}
                                    </select>
                                  ) : (
                                    <p className="min-w-0 flex-1 rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-3 py-2 text-xs text-zinc-600">
                                      Δεν υπάρχουν διαθέσιμα γήπεδα στη διοργάνωση.
                                    </p>
                                  )}
                                  <PlatformButton
                                    type="button"
                                    onClick={() => updateScheduleEditor(scheduleKey, { venueMode: "clear", venueId: "" })}
                                    className="shrink-0 rounded-xl border border-zinc-300 bg-white px-3 py-2 text-xs font-black text-zinc-700 transition hover:bg-zinc-50"
                                  >
                                    Καθαρισμός
                                  </PlatformButton>
                                </div>
                                <p className="mt-2 text-xs text-zinc-500">
                                  {selectedRoundGames.length
                                    ? `Τρέχουσα τιμή: ${venueDisplayMode || "—"}`
                                    : "Δεν υπάρχουν επιλεγμένοι αγώνες."}
                                </p>
                              </Field>
                            </div>

                            {selectedGameIds.length === 1 ? (() => {
                              const selectedPanelGame = scheduleGames.find((game) => String(game.id) === selectedGameIds[0]) ?? null;
                              if (!selectedPanelGame) return null;
                              const hasOfficialResult = selectedPanelGame.home_score !== null && selectedPanelGame.away_score !== null;
                              const isAdministrativeInterruption = selectedPanelGame.administrative_decision_type === "interruption";
                              return (
                                <section data-testid="selected-game-result-controls" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4">
                                  <p className="text-xs font-black uppercase tracking-[0.16em] text-amber-800">ΑΠΟΤΕΛΕΣΜΑ ΑΓΩΝΑ</p>
                                  {isAdministrativeInterruption ? (
                                    <p className="mt-2 inline-flex rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-black text-amber-900">
                                      Διοικητικό κλείσιμο λόγω διακοπής
                                    </p>
                                  ) : null}
                                  <div className="mt-3 flex flex-wrap gap-2">
                                    {hasOfficialResult ? (
                                      <PlatformButton
                                        type="button"
                                        onClick={() => openResultForm(selectedPanelGame, "administrative-correction")}
                                        className={buttonClass}
                                      >
                                        Επεξεργασία επίσημου αποτελέσματος
                                      </PlatformButton>
                                    ) : (
                                      <PlatformButton
                                        type="button"
                                        onClick={() => openResultForm(selectedPanelGame, "administrative-interruption")}
                                        className="rounded-xl border border-amber-300 bg-white px-4 py-2.5 text-sm font-black text-amber-900 transition hover:bg-amber-100"
                                      >
                                        Οριστικό κλείσιμο λόγω διακοπής
                                      </PlatformButton>
                                    )}
                                  </div>
                                </section>
                              );
                            })() : null}
                          </div>
                        ) : null}
                        </div>
                      ) : (
                        <p className="pt-1 text-xs font-black uppercase tracking-wide text-zinc-500">
                          {lifecycle === "published" ? "Δημοσιευμένο πρόγραμμα" : "Αναμονή δημιουργίας αγώνων"}
                        </p>
                      )}
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    {canGenerate ? (
                      <PlatformButton
                        type="button"
                        disabled={busy}
                        onClick={() => openGenerateModal(String(schedule.id))}
                        className="rounded-xl border border-orange-300 bg-white px-4 py-2.5 text-sm font-black text-orange-700 transition hover:bg-orange-50 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Δημιουργία Αγώνων
                      </PlatformButton>
                    ) : null}
                    <PlatformButton
                      type="button"
                      disabled={busy || deleteProgramBusy || phaseLifecycle === "finalized" || programObviouslyStarted}
                      onClick={() => {
                        setDeleteProgramConfirmation("");
                        setDeleteProgramError("");
                        setDeleteProgramTarget({
                          phaseId: String(phase?.id ?? schedule.phase_id ?? ""),
                          phaseName: String(schedule.phase_name ?? phase?.name ?? "—"),
                        });
                      }}
                      className="rounded-xl border border-red-300 bg-white px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:border-zinc-200 disabled:bg-zinc-50 disabled:text-zinc-400"
                    >
                      Διαγραφή Προγράμματος
                    </PlatformButton>
                    {phaseLifecycle === "finalized" ? (
                      <span className="text-xs font-bold text-zinc-500">Η οριστικοποιημένη φάση δεν επιτρέπει διαγραφή προγράμματος.</span>
                    ) : programObviouslyStarted ? (
                      <span className="text-xs font-bold text-zinc-500">Το πρόγραμμα έχει ξεκινήσει ή περιέχει αγωνιστικά δεδομένα.</span>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {planningTarget ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="series-planning-title" className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 id="series-planning-title" className="text-xl font-black text-zinc-950">Προσωρινός προγραμματισμός — Εάν χρειαστεί</h3>
                <p className="mt-1 text-sm font-bold text-zinc-700">
                  {planningTarget.homeTeamName} — {planningTarget.awayTeamName} · {getRoundOrdinalLabel(planningTarget.seriesRoundNumber)} Γύρος
                </p>
              </div>
              <PlatformButton
                type="button"
                disabled={planningBusy}
                onClick={closePlanningDialog}
                className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700 disabled:opacity-60"
              >
                Κλείσιμο
              </PlatformButton>
            </div>
            <p className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm leading-relaxed text-sky-900">
              Ο αγώνας δεν έχει δημιουργηθεί ακόμη. Τα στοιχεία θα μεταφερθούν αυτόματα εάν ο αγώνας χρειαστεί.
            </p>
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Field label="Ημερομηνία">
                <input
                  type="date"
                  value={planningDate}
                  onChange={(event) => {
                    const value = event.target.value;
                    setPlanningDate(value);
                    if (!value) setPlanningTime("");
                  }}
                  className={inputClass}
                />
              </Field>
              <Field label="Ώρα">
                <input
                  type="time"
                  value={planningTime}
                  disabled={!planningDate}
                  onChange={(event) => setPlanningTime(event.target.value)}
                  className={`${inputClass} disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400`}
                />
              </Field>
            </div>
            <div className="mt-4">
              <Field label="Γήπεδο">
                <select value={planningVenueId} onChange={(event) => setPlanningVenueId(event.target.value)} className={inputClass}>
                  <option value="">—</option>
                  {competitionVenues.map((venue) => (
                    <option key={String(venue.id)} value={String(venue.id)}>{String(venue.name ?? "—")}</option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="mt-3 text-xs leading-relaxed text-zinc-500">Αν καθαρίσετε και τα τρία πεδία, ο προσωρινός προγραμματισμός θα αφαιρεθεί.</p>
            {planningError ? (
              <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{planningError}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4">
              <PlatformButton
                type="button"
                disabled={planningBusy}
                onClick={closePlanningDialog}
                className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700 disabled:opacity-60"
              >
                Ακύρωση
              </PlatformButton>
              <PlatformButton
                type="button"
                disabled={planningBusy || (!!planningTime && !planningDate)}
                onClick={() => void handleSaveSeriesPlanning()}
                className="rounded-xl bg-sky-700 px-4 py-2.5 font-black text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {planningBusy ? "Αποθήκευση..." : "Αποθήκευση προγραμματισμού"}
              </PlatformButton>
            </div>
          </div>
        </div>
      ) : null}

      {deleteProgramTarget ? (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="delete-program-title" className="w-full max-w-xl rounded-2xl bg-white p-5 shadow-2xl sm:p-6">
            <h3 id="delete-program-title" className="text-xl font-black text-zinc-950">Διαγραφή Προγράμματος</h3>
            <div className="mt-4 space-y-3 text-sm leading-relaxed text-zinc-700">
              <p className="font-black text-zinc-950">Να διαγραφεί το πρόγραμμα της φάσης «{deleteProgramTarget.phaseName}»;</p>
              <p>Θα διαγραφούν οι υλοποιημένοι αγώνες και τα στοιχεία προγραμματισμού της συγκεκριμένης φάσης.</p>
              <p>Η φάση, οι κανόνες, οι διασταυρώσεις και οι ιστορικοί αγώνες μεταφοράς θα διατηρηθούν.</p>
              <p>Μετά τη διαγραφή μπορείτε να δημιουργήσετε νέο πρόγραμμα.</p>
            </div>
            <label className="mt-5 block text-sm font-black text-zinc-900">
              Πληκτρολογήστε ΔΙΑΓΡΑΦΗ για επιβεβαίωση
              <input
                autoFocus
                value={deleteProgramConfirmation}
                onChange={(event) => setDeleteProgramConfirmation(event.target.value)}
                className={`${inputClass} mt-2`}
                autoComplete="off"
              />
            </label>
            {deleteProgramError ? (
              <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{deleteProgramError}</p>
            ) : null}
            <div className="mt-6 flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4">
              <PlatformButton
                type="button"
                disabled={deleteProgramBusy}
                onClick={closeDeleteProgramDialog}
                className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700 disabled:opacity-60"
              >
                Ακύρωση
              </PlatformButton>
              <PlatformButton
                type="button"
                disabled={deleteProgramBusy || deleteProgramConfirmation !== "ΔΙΑΓΡΑΦΗ"}
                onClick={() => void handleDeletePhaseProgram()}
                className="rounded-xl bg-red-700 px-4 py-2.5 font-black text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deleteProgramBusy ? "Διαγραφή..." : "Οριστική Διαγραφή Προγράμματος"}
              </PlatformButton>
            </div>
          </div>
        </div>
      ) : null}

      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-black text-zinc-950">Δημιουργία Προγράμματος</h3>
                <p className="mt-1 text-sm text-zinc-600">Επίλεξε μια ήδη αποθηκευμένη φάση της τρέχουσας διοργάνωσης.</p>
              </div>
              <PlatformButton
                type="button"
                onClick={closeCreateModal}
                className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
              >
                Ακύρωση
              </PlatformButton>
            </div>
            <PlatformForm onSubmit={handleCreate} className="mt-5 space-y-4">
              <input type="hidden" name="action" value="materializePhaseProgram" />
              <input type="hidden" name="competitionId" value={competitionId} />
              {availablePhases.length ? (
                <Field label="Φάση">
                  <select
                    name="phaseId"
                    required
                    value={selectedPhaseId}
                    onChange={(event) => setSelectedPhaseId(event.target.value)}
                    className={inputClass}
                  >
                    <option value="">Επιλογή φάσης</option>
                    {availablePhases.map((phase) => (
                      <option key={String(phase.id)} value={String(phase.id)}>
                        {String(phase.name ?? "—")}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : null}
              {selectedPhase ? (
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                  <p className="text-sm font-black text-zinc-900">Σύνοψη φάσης</p>
                  <div className="mt-3 space-y-1.5 text-sm text-zinc-700">
                    {buildPhaseSummary(data, selectedPhase).map((line) => (
                      <p key={line}>{line}</p>
                    ))}
                  </div>
                </div>
              ) : availablePhases.length ? null : (
                <p className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-bold text-zinc-700">
                  Όλες οι αποθηκευμένες φάσεις έχουν ήδη πρόγραμμα.
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4">
                <PlatformButton
                  type="button"
                  onClick={closeCreateModal}
                  className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700"
                >
                  Ακύρωση
                </PlatformButton>
                <PlatformButton mutation disabled={busy || !selectedPhaseId || !availablePhases.length} className={buttonClass}>
                  Δημιουργία Προγράμματος Φάσης
                </PlatformButton>
              </div>
            </PlatformForm>
          </div>
        </div>
      )}

      {showGenerateModal && selectedSchedule && (() => {
        const phase = competitionPhases.find((entry) => String(entry.id) === String(selectedSchedule.phase_id ?? "")) ?? null;
        const phaseRules = parseStandingsRules(phase?.rule_settings_json);
        const structure = roundRobinStructureFromTeams(competitionTeams.length, phaseRules.gamesPerPairing);
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-xl font-black text-zinc-950">Δημιουργία Αγώνων</h3>
                  <p className="mt-1 text-sm text-zinc-600">
                    Θα δημιουργηθούν {structure.totalGames} αγώνες σε {structure.rounds} αγωνιστικές.
                  </p>
                  <p className="mt-1 text-sm text-zinc-600">Οι αγώνες θα δημιουργηθούν χωρίς ημερομηνία, ώρα και γήπεδο.</p>
                </div>
                <PlatformButton
                  type="button"
                  onClick={closeGenerateModal}
                  className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
                >
                  Ακύρωση
                </PlatformButton>
              </div>
              <PlatformForm onSubmit={handleGenerate} className="mt-5 space-y-4">
                <input type="hidden" name="action" value="materializePhaseProgram" />
                <input type="hidden" name="scheduleId" value={selectedSchedule.id} />
                <input type="hidden" name="id" value={selectedSchedule.id} />
                <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                  <p className="font-black text-zinc-900">{String(selectedSchedule.phase_name ?? phase?.name ?? "—")}</p>
                  <p className="mt-1">Πρόχειρο πρόγραμμα · {structure.totalGames} προβλεπόμενοι αγώνες · {structure.rounds} αγωνιστικές</p>
                </div>
                <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4">
                  <PlatformButton type="button" onClick={closeGenerateModal} className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700">
                    Ακύρωση
                  </PlatformButton>
                  <PlatformButton mutation disabled={busy} className={buttonClass}>
                    Δημιουργία Αγώνων
                  </PlatformButton>
                </div>
              </PlatformForm>
            </div>
          </div>
        );
      })()}

      {showVenueManager && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-xl font-black text-zinc-950">Γήπεδα διοργάνωσης</h3>
                <p className="mt-1 text-sm text-zinc-600">Διαχείριση γηπέδων για τη συγκεκριμένη διοργάνωση.</p>
              </div>
              <PlatformButton type="button" onClick={closeVenueManager} className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700">
                ← Επιστροφή
              </PlatformButton>
            </div>

            {!competitionVenues.length ? (
              <div className="mt-5 space-y-4">
                <p className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
                  Δεν έχουν προστεθεί γήπεδα για αυτή τη διοργάνωση.
                </p>
                <PlatformButton type="button" onClick={() => startVenueForm("")} className={buttonClass}>
                  + Προσθήκη γηπέδου
                </PlatformButton>
                {showVenueForm ? (
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-zinc-900">Προσθήκη γηπέδου</p>
                        <p className="mt-1 text-sm text-zinc-600">Τα ιστορικά παιχνίδια διατηρούν το κείμενο γηπέδου που έχουν ήδη αποθηκεύσει.</p>
                      </div>
                      <PlatformButton mutation
                        type="button"
                        onClick={() => {
                          setEditingVenueId("");
                          setShowVenueForm(false);
                        }}
                        className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
                      >
                        Κλείσιμο
                      </PlatformButton>
                    </div>
                    <PlatformForm
                      className="mt-4 space-y-4"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const ok = selectedVenue
                          ? await updateEntity("competition-venues", String(selectedVenue.id), event, `Το γήπεδο «${String(selectedVenue.name ?? "—")}» ενημερώθηκε.`)
                          : await submit("competition-venues", event);
                        if (!ok) return;
                        setEditingVenueId("");
                        setShowVenueForm(false);
                      }}
                    >
                      <input type="hidden" name="competitionId" value={competitionId} />
                      <Field label="Όνομα γηπέδου">
                        <input name="name" required className={inputClass} />
                      </Field>
                      <Field label="Διεύθυνση">
                        <input name="address" className={inputClass} />
                      </Field>
                      <Field label="Σύνδεσμος χάρτη">
                        <input name="mapUrl" placeholder="https://..." className={inputClass} />
                      </Field>
                      <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4">
                        <PlatformButton mutation
                          type="button"
                          onClick={() => {
                            setEditingVenueId("");
                            setShowVenueForm(false);
                          }}
                          className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700"
                        >
                          Καθαρισμός
                        </PlatformButton>
                        <PlatformButton mutation disabled={busy} className={buttonClass}>
                          Προσθήκη γηπέδου
                        </PlatformButton>
                      </div>
                    </PlatformForm>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-5 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                <div className="space-y-3">
                  {competitionVenues.map((venue) => (
                    <article key={String(venue.id)} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-black text-zinc-950">{String(venue.name ?? "—")}</p>
                          {String(venue.address ?? "").trim() ? <p className="mt-1 text-sm text-zinc-600">{String(venue.address)}</p> : null}
                          {String(venue.map_url ?? "").trim() ? (
                            <a
                              href={String(venue.map_url)}
                              target="_blank"
                              rel="noreferrer noopener"
                              className="mt-2 inline-flex text-sm font-black text-orange-700 underline decoration-orange-300 underline-offset-2"
                            >
                              Προβολή στον χάρτη
                            </a>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <PlatformButton
                            type="button"
                            onClick={() => startVenueForm(String(venue.id))}
                            className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
                          >
                            Επεξεργασία
                          </PlatformButton>
                          <PlatformButton
                            type="button"
                            onClick={() => void handleVenueDelete(venue)}
                            className="rounded-xl border border-red-300 bg-white px-3 py-2 text-sm font-black text-red-700"
                          >
                            Αφαίρεση
                          </PlatformButton>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
                {showVenueForm ? (
                  <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-zinc-900">{selectedVenue ? "Επεξεργασία γηπέδου" : "Προσθήκη γηπέδου"}</p>
                        <p className="mt-1 text-sm text-zinc-600">Τα ιστορικά παιχνίδια διατηρούν το κείμενο γηπέδου που έχουν ήδη αποθηκεύσει.</p>
                      </div>
                      <PlatformButton mutation
                        type="button"
                        onClick={() => {
                          setEditingVenueId("");
                          setShowVenueForm(false);
                        }}
                        className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700"
                      >
                        Κλείσιμο
                      </PlatformButton>
                    </div>
                    <PlatformForm
                      className="mt-4 space-y-4"
                      onSubmit={async (event) => {
                        event.preventDefault();
                        const ok = editingVenueId
                          ? await updateEntity("competition-venues", editingVenueId, event, `Το γήπεδο «${String(selectedVenue?.name ?? "—")}» ενημερώθηκε.`)
                          : await submit("competition-venues", event);
                        if (!ok) return;
                        setEditingVenueId("");
                        setShowVenueForm(false);
                      }}
                    >
                      <input type="hidden" name="competitionId" value={competitionId} />
                      <Field label="Όνομα γηπέδου">
                        <input
                          name="name"
                          defaultValue={String(selectedVenue?.name ?? "")}
                          required
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Διεύθυνση">
                        <input
                          name="address"
                          defaultValue={String(selectedVenue?.address ?? "")}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Σύνδεσμος χάρτη">
                        <input
                          name="mapUrl"
                          defaultValue={String(selectedVenue?.map_url ?? "")}
                          placeholder="https://..."
                          className={inputClass}
                        />
                      </Field>
                      <div className="flex flex-wrap justify-end gap-3 border-t border-zinc-200 pt-4">
                        <PlatformButton mutation
                          type="button"
                          onClick={() => {
                            setEditingVenueId("");
                            setShowVenueForm(false);
                          }}
                          className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700"
                        >
                          Καθαρισμός
                        </PlatformButton>
                        <PlatformButton mutation disabled={busy} className={buttonClass}>
                          {selectedVenue ? "Αποθήκευση αλλαγών" : "Προσθήκη γηπέδου"}
                        </PlatformButton>
                      </div>
                    </PlatformForm>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50 p-4 text-sm text-zinc-600">
                    Επιλέξτε ένα γήπεδο για επεξεργασία ή πατήστε «+ Προσθήκη γηπέδου» για νέο.
                  </div>
                )}
              </div>
            )}

            {competitionVenues.length ? (
              <div className="mt-5 rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-600">
                <p className="font-black text-zinc-900">Προσθήκη γηπέδου</p>
                <p className="mt-1">Το ίδιο γήπεδο μπορεί να χρησιμοποιηθεί αργότερα στο Πρόγραμμα & Αγώνες ως απλό κείμενο.</p>
              </div>
            ) : null}
          </div>
        </div>
      )}
      {matchdayMvpOpen ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 sm:p-5" role="dialog" aria-modal="true" aria-labelledby="matchday-mvp-title">
          <div className="max-h-[92vh] w-full max-w-7xl overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl sm:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-700">{matchdayMvpState?.roundLabel ?? "Αγωνιστική"}</p>
                <h2 id="matchday-mvp-title" className="mt-2 text-3xl font-black text-zinc-950">MVP ΑΓΩΝΙΣΤΙΚΗΣ</h2>
                <p className="mt-2 text-sm font-bold text-zinc-600">Οι 5 πρώτοι προκύπτουν από EFF, PTS, REB, AST και το canonical tie-break. Η τελική επιλογή είναι ανθρώπινη.</p>
              </div>
              <PlatformButton type="button" onClick={() => setMatchdayMvpOpen(false)} className="rounded-xl border border-zinc-300 bg-white px-4 py-2 font-black text-zinc-700">Κλείσιμο</PlatformButton>
            </div>
            {matchdayMvpLoading ? <p className="mt-6 rounded-2xl bg-zinc-100 p-5 font-bold text-zinc-600">Φόρτωση υποψηφίων…</p> : null}
            {matchdayMvpError ? <p role="alert" className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-4 font-bold text-red-700">{matchdayMvpError}</p> : null}
            {matchdayMvpState ? (
              <>
                {matchdayMvpState.selection ? <p className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 font-black text-emerald-800">Επιλεγμένος MVP: #{matchdayMvpState.selection.player.shirtNumber} {matchdayMvpState.selection.player.displayName} · {matchdayMvpState.selection.teamName}</p> : null}
                <div className="mt-6 max-w-full overflow-x-auto overscroll-x-contain rounded-2xl border border-zinc-200 bg-white">
                  <table className="w-full min-w-[72rem] table-auto text-left text-sm">
                    <thead className="bg-zinc-950 text-xs font-black uppercase tracking-wide text-zinc-200">
                      <tr>
                        <th className="min-w-28 whitespace-nowrap px-3 py-3">Επιλογή</th>
                        <th className="w-16 whitespace-nowrap px-3 py-3 text-center">#</th>
                        <th className="min-w-44 whitespace-nowrap px-3 py-3">Ονοματεπώνυμο</th>
                        <th className="min-w-44 whitespace-nowrap px-3 py-3">Ομάδα</th>
                        <th className="w-14 whitespace-nowrap px-2 py-3 text-center">PTS</th>
                        <th className="w-16 whitespace-nowrap px-2 py-3 text-center">3PTS</th>
                        <th className="w-14 whitespace-nowrap px-2 py-3 text-center">REB</th>
                        <th className="w-14 whitespace-nowrap px-2 py-3 text-center">AST</th>
                        <th className="w-14 whitespace-nowrap px-2 py-3 text-center">STL</th>
                        <th className="w-14 whitespace-nowrap px-2 py-3 text-center">EFF</th>
                        <th className="min-w-72 whitespace-nowrap px-3 py-3">Αποτέλεσμα αγώνα</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matchdayMvpState.candidates.map((candidate) => {
                        const key = `${candidate.gameId}:${candidate.playerId}`;
                        const selected = matchdayMvpState.selection?.gameId === candidate.gameId && matchdayMvpState.selection?.playerId === candidate.playerId;
                        return <tr key={key} className={`border-t border-zinc-200 ${selected ? "bg-emerald-50" : "bg-white"}`}>
                          <td className="px-3 py-3">
                            <PlatformButton mutation type="button" disabled={Boolean(matchdayMvpSaving)} onClick={() => void selectMatchdayMvp(candidate.gameId, candidate.playerId)} className={`min-w-24 rounded-xl px-3 py-2 text-xs font-black text-white disabled:opacity-50 ${selected ? "bg-emerald-700" : "bg-zinc-950"}`}>{selected ? "ΕΠΙΛΕΓΜΕΝΟΣ" : matchdayMvpSaving === key ? "ΑΠΟΘΗΚΕΥΣΗ…" : "ΕΠΙΛΟΓΗ"}</PlatformButton>
                          </td>
                          <td className="whitespace-nowrap px-3 py-3 text-center font-black text-zinc-950">#{candidate.player.shirtNumber}</td>
                          <td className="min-w-44 whitespace-nowrap px-3 py-3 font-black text-zinc-950">{candidate.player.displayName}</td>
                          <td className="min-w-44 whitespace-nowrap px-3 py-3 font-bold text-zinc-700">{candidate.teamName}</td>
                          <td className="px-2 py-3 text-center tabular-nums text-zinc-800">{candidate.statistics.points}</td>
                          <td className="px-2 py-3 text-center tabular-nums text-zinc-800">{candidate.statistics.threePointMade}</td>
                          <td className="px-2 py-3 text-center tabular-nums text-zinc-800">{candidate.statistics.rebounds}</td>
                          <td className="px-2 py-3 text-center tabular-nums text-zinc-800">{candidate.statistics.assists}</td>
                          <td className="px-2 py-3 text-center tabular-nums text-zinc-800">{candidate.statistics.steals}</td>
                          <td className="px-2 py-3 text-center font-black tabular-nums text-orange-700">{candidate.statistics.efficiency}</td>
                          <td className="min-w-72 whitespace-nowrap px-3 py-3 font-bold text-zinc-700">{candidate.teamName} – {candidate.opponentName} {candidate.finalScore.team}–{candidate.finalScore.opponent}</td>
                        </tr>;
                      })}
                    </tbody>
                  </table>
                </div>
                {matchdayMvpState.otherPerformances.length ? (
                  <div className="mt-6 border-t border-zinc-200 pt-5">
                    <PlatformButton type="button" onClick={() => setShowOtherMvpPlayers((current) => !current)} className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-800">ΑΛΛΟΣ ΠΑΙΚΤΗΣ</PlatformButton>
                    {showOtherMvpPlayers ? <div className="mt-4 flex flex-col gap-3 sm:flex-row"><select className={`${inputClass} flex-1`} value={otherMvpSelection} onChange={(event) => setOtherMvpSelection(event.target.value)}><option value="">Επιλέξτε επιλέξιμη εμφάνιση</option>{matchdayMvpState.otherPerformances.map((performance) => <option key={`${performance.gameId}:${performance.playerId}`} value={`${performance.gameId}:${performance.playerId}`}>#{performance.player.shirtNumber} {performance.player.displayName} · {performance.teamName} · EFF {performance.statistics.efficiency}</option>)}</select><PlatformButton mutation type="button" disabled={!otherMvpSelection || Boolean(matchdayMvpSaving)} onClick={() => { const separator = otherMvpSelection.indexOf(":"); const gameId = otherMvpSelection.slice(0, separator); const playerId = otherMvpSelection.slice(separator + 1); if (separator > 0 && gameId && playerId) void selectMatchdayMvp(gameId, playerId); }} className={buttonClass}>ΑΠΟΘΗΚΕΥΣΗ MVP</PlatformButton></div> : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
