export type MatchReportUnavailableReason = "NOT_FINALIZED" | "LEGACY_RESULT" | "INCONSISTENT_DATA";

export type PlatformMatchReportMode = "SIMPLE" | "FULL";

export type PlatformMatchReportAvailability = {
  available: boolean;
  hasIncidentReport: boolean;
  unavailableReason?: MatchReportUnavailableReason;
};

export type PlatformMatchReportPeriodScore = {
  period: { kind: "REGULATION" | "OVERTIME"; index: number };
  home: number;
  away: number;
};

export type PlatformMatchReportStatisticsLine = {
  points: number;
  twoPointMade: number;
  twoPointAttempts: number;
  threePointMade: number;
  threePointAttempts: number;
  freeThrowMade: number;
  freeThrowAttempts: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
  efficiency: number;
};

export type PlatformMatchReportPlayer = {
  shirtNumber: string;
  displayName: string;
  starter: boolean;
  finalStatus: string;
  finalStatusReason: string | null;
  statistics: PlatformMatchReportStatisticsLine;
};

export type PlatformMatchReportTeamStatistics = {
  players: PlatformMatchReportPlayer[];
  totals: PlatformMatchReportStatisticsLine;
};

export type PlatformMatchReport = {
  mode: PlatformMatchReportMode;
  availability: PlatformMatchReportAvailability;
  game: {
    gameId: string;
    competition: string;
    season: string;
    phase: string | null;
    round: string | null;
    scheduledDate: string | null;
    scheduledTime: string | null;
    venue: string | null;
    homeTeam: { teamId: string; name: string; logoUrl: string | null };
    awayTeam: { teamId: string; name: string; logoUrl: string | null };
    finalScore: { home: number; away: number };
    winner: "HOME" | "AWAY" | null;
    periodScores: PlatformMatchReportPeriodScore[];
  };
  statistics: {
    home: PlatformMatchReportTeamStatistics;
    away: PlatformMatchReportTeamStatistics;
  };
  incidentReport: string | null;
};

export function platformMatchReportMode(packageSnapshotJson: string): PlatformMatchReportMode {
  let parsed: unknown;
  try { parsed = JSON.parse(packageSnapshotJson); } catch { throw new Error("MATCH_REPORT_MODE_INVALID"); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("MATCH_REPORT_MODE_INVALID");
  const settings = (parsed as Record<string, unknown>).settings;
  if (typeof settings !== "object" || settings === null || Array.isArray(settings)) throw new Error("MATCH_REPORT_MODE_INVALID");
  const mode = (settings as Record<string, unknown>).game_mode;
  if (mode !== "SIMPLE" && mode !== "FULL") throw new Error("MATCH_REPORT_MODE_INVALID");
  return mode;
}

export type PlatformMatchReportConsistencySource = {
  gameId: string;
  gameStatus: string | null;
  resultSource: string | null;
  gameHomeScore: number | null;
  gameAwayScore: number | null;
  claimRunId: string | null;
  headLifecycle: string | null;
  headHistoryRevision: number | null;
  headLastAcceptedSequence: number | null;
  headHistoryHash: string | null;
  headFinalizationHash: string | null;
  officialResultAppliedAt: string | null;
  finalizedHistoryRevision: number | null;
  finalizedHistoryHash: string | null;
  finalStateHash: string | null;
  finalizationHash: string | null;
  finalStateJsonValid: boolean;
  finalStateRunId: string | null;
  finalStateFinished: boolean;
  finalStateLastProcessedSequence: number | null;
  finalStateHomeScore: number | null;
  finalStateAwayScore: number | null;
  finalizationJsonValid: boolean;
  manifestRunId: string | null;
  manifestHistoryRevision: number | null;
  manifestHistoryHash: string | null;
  manifestFinalStateHash: string | null;
  incidentReportType: string | null;
  incidentReport: string | null;
};

const unavailable = (reason: MatchReportUnavailableReason): PlatformMatchReportAvailability => ({
  available: false,
  hasIncidentReport: false,
  unavailableReason: reason,
});

export function normalizedIncidentReport(type: string | null, value: string | null): string | null | undefined {
  if (type === null || type === "null") return null;
  if (type !== "text" || typeof value !== "string") return undefined;
  return value.trim() ? value : null;
}

export function platformMatchReportAvailability(source: PlatformMatchReportConsistencySource): PlatformMatchReportAvailability {
  if (!source.claimRunId || !source.headLifecycle) {
    return unavailable(source.gameStatus === "completed" ? "LEGACY_RESULT" : "NOT_FINALIZED");
  }
  if (source.headLifecycle !== "finalized") return unavailable("NOT_FINALIZED");

  const report = normalizedIncidentReport(source.incidentReportType, source.incidentReport);
  const consistent = source.gameStatus === "completed"
    && source.resultSource === "match_report"
    && source.gameHomeScore !== null
    && source.gameAwayScore !== null
    && Boolean(source.officialResultAppliedAt)
    && Boolean(source.headHistoryHash)
    && Boolean(source.headFinalizationHash)
    && source.headHistoryRevision !== null
    && source.headLastAcceptedSequence !== null
    && source.finalizedHistoryRevision === source.headHistoryRevision
    && source.finalizedHistoryHash === source.headHistoryHash
    && source.finalizationHash === source.headFinalizationHash
    && Boolean(source.finalStateHash)
    && source.finalStateJsonValid
    && source.finalizationJsonValid
    && source.finalStateRunId === source.claimRunId
    && source.finalStateFinished
    && source.finalStateLastProcessedSequence === source.headLastAcceptedSequence
    && source.finalStateHomeScore === source.gameHomeScore
    && source.finalStateAwayScore === source.gameAwayScore
    && source.manifestRunId === source.claimRunId
    && source.manifestHistoryRevision === source.finalizedHistoryRevision
    && source.manifestHistoryHash === source.finalizedHistoryHash
    && source.manifestFinalStateHash === source.finalStateHash
    && report !== undefined;

  return consistent
    ? { available: true, hasIncidentReport: report !== null }
    : unavailable("INCONSISTENT_DATA");
}
