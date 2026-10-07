import "server-only";

import { createHash } from "node:crypto";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import {
  normalizedIncidentReport,
  platformMatchReportMode,
  platformMatchReportAvailability,
  type PlatformMatchReport,
  type PlatformMatchReportAvailability,
  type PlatformMatchReportConsistencySource,
} from "@/lib/platform-match-report";
import type { D1DatabaseBinding } from "@/types/cloudflare";
import { parseMatchReportState, projectMatchReportPlayerLine, projectMatchReportTeamLine, projectPlatformMatchReportStatistics } from "@/lib/platform-match-report-statistics";
import type { PlatformMatchReportStatisticsLine } from "@/lib/platform-match-report";
import type { PublicTeamStatisticsSourceGame } from "@/lib/public-team-statistics";
import type { MatchEvent } from "../../komocontrol/shared/match-engine/types/event";
import { projectPublicLiveGame, type PublicLiveEventRow, type PublicLiveSource } from "./public-live-game-core";

type MatchReportDatabaseRow = {
  game_id: string; game_status: string | null; result_source: string | null;
  game_home_score: number | null; game_away_score: number | null; claim_run_id: string | null;
  head_lifecycle: string | null; head_history_revision: number | null; head_last_accepted_sequence: number | null;
  head_history_hash: string | null; head_finalization_hash: string | null; official_result_applied_at: string | null;
  finalized_history_revision: number | null; finalized_history_hash: string | null;
  final_state_hash: string | null; finalization_hash: string | null; final_state_json_valid: number | null;
  final_state_run_id: string | null; final_state_finished: number | null; final_state_last_sequence: number | null;
  final_state_home_score: number | null; final_state_away_score: number | null; finalization_json_valid: number | null;
  manifest_run_id: string | null; manifest_history_revision: number | null; manifest_history_hash: string | null;
  manifest_final_state_hash: string | null; incident_report_type: string | null; incident_report: string | null;
};

type MatchReportDetailRow = MatchReportDatabaseRow & {
  competition_name: string; season_name: string; phase_name: string | null; round_label: string | null;
  scheduled_date: string | null; scheduled_time: string | null; venue: string | null;
  phase_id?: string | null; played_round?: number | null; sort_phase?: number | null;
  sort_round?: number | null; sort_game?: number | null;
  home_team_id: string; home_team_name: string; home_logo_url: string | null;
  away_team_id: string; away_team_name: string; away_logo_url: string | null;
  head_updated_at: string | null; initial_state_json: string | null; initial_state_hash: string | null;
  package_snapshot_json?: string | null;
  configuration_json: string | null;
  final_state_json: string | null;
  finalization_json?: string | null;
};

type EventRow = { event_id: string; sequence: number; event_schema_version: number; event_json: string; event_hash: string };
type BatchEventRow = EventRow & { run_id: string };
type ParticipatingStatisticalGame = PublicTeamStatisticsSourceGame & {
  participatingPlayerIds: string[];
  homeTeamStatistics: PlatformMatchReportStatisticsLine;
  awayTeamStatistics: PlatformMatchReportStatisticsLine;
  phaseId: string;
  round: number | null;
  roundLabel: string | null;
  sortKey: readonly [string, string, number, number, number, string];
};
type StatisticalGame = PublicTeamStatisticsSourceGame & Partial<Pick<ParticipatingStatisticalGame,
  "participatingPlayerIds" | "homeTeamStatistics" | "awayTeamStatistics" | "phaseId" | "round" | "roundLabel" | "sortKey">>;

function verifiedMobileSubstitutions(row: MatchReportDetailRow, events: PublicLiveEventRow[]): string[] {
  const hash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
  if (!row.initial_state_json || !row.initial_state_hash || !row.final_state_json || !row.final_state_hash
    || !row.finalization_json || !row.finalization_hash || !row.head_history_hash
    || row.head_last_accepted_sequence === null
    || hash(row.initial_state_json) !== row.initial_state_hash
    || hash(row.final_state_json) !== row.final_state_hash
    || hash(row.finalization_json) !== row.finalization_hash
    || events.length === 0) throw new Error("MOBILE_STATISTICAL_HISTORY_INVALID");

  let previousSequence = 0;
  let firstType: MatchEvent["type"] | null = null;
  let lastType: MatchEvent["type"] | null = null;
  const substitutions: string[] = [];
  const eventJson: string[] = [];
  for (const event of events) {
    if (event.eventSchemaVersion !== 2 || event.sequence <= previousSequence || hash(event.eventJson) !== event.eventHash) {
      throw new Error("MOBILE_STATISTICAL_HISTORY_INVALID");
    }
    const parsed = JSON.parse(event.eventJson) as MatchEvent;
    if (parsed.schemaVersion !== 2 || parsed.id !== event.eventId || parsed.sequence !== event.sequence) {
      throw new Error("MOBILE_STATISTICAL_HISTORY_INVALID");
    }
    if (firstType === null) firstType = parsed.type;
    lastType = parsed.type;
    previousSequence = event.sequence;
    eventJson.push(event.eventJson);
    if (parsed.type === "SUBSTITUTION") {
      if (typeof parsed.playerInId !== "string" || !parsed.playerInId) throw new Error("MOBILE_STATISTICAL_HISTORY_INVALID");
      substitutions.push(parsed.playerInId);
    }
  }
  if (firstType !== "MATCH_START" || lastType !== "MATCH_END"
    || previousSequence !== row.head_last_accepted_sequence
    || hash(`[${eventJson.join(",")}]`) !== row.head_history_hash) {
    throw new Error("MOBILE_STATISTICAL_HISTORY_INVALID");
  }
  return substitutions;
}

export type PlatformMatchReportReadResult =
  | { kind: "report"; report: PlatformMatchReport }
  | { kind: "unavailable"; availability: PlatformMatchReportAvailability };

export type PlatformMatchReportFinalizedSource = {
  report: PlatformMatchReport;
  packageSnapshotJson: string;
  currentConfigurationJson: string;
  finalStateJson: string;
  eventJson: string[];
};

export type PlatformMatchReportFinalizedSourceReadResult =
  | { kind: "report"; source: PlatformMatchReportFinalizedSource }
  | { kind: "unavailable"; availability: PlatformMatchReportAvailability };

const consistencyColumns = `
  g.id AS game_id, g.status AS game_status, g.result_source,
  g.home_score AS game_home_score, g.away_score AS game_away_score,
  claim.run_id AS claim_run_id, head.lifecycle AS head_lifecycle,
  head.event_history_revision AS head_history_revision,
  head.last_accepted_sequence AS head_last_accepted_sequence,
  head.history_hash AS head_history_hash, head.finalization_hash AS head_finalization_hash,
  head.official_result_applied_at,
  finalization.finalized_history_revision, finalization.finalized_history_hash,
  finalization.final_state_hash, finalization.finalization_hash,
  CASE WHEN finalization.final_state_json IS NOT NULL THEN json_valid(finalization.final_state_json) ELSE 0 END AS final_state_json_valid,
  CASE WHEN json_valid(finalization.final_state_json) THEN json_extract(finalization.final_state_json, '$.id') END AS final_state_run_id,
  CASE WHEN json_valid(finalization.final_state_json) THEN json_extract(finalization.final_state_json, '$.finished') END AS final_state_finished,
  CASE WHEN json_valid(finalization.final_state_json) THEN json_extract(finalization.final_state_json, '$.lastProcessedSequence') END AS final_state_last_sequence,
  CASE WHEN json_valid(finalization.final_state_json) THEN json_extract(finalization.final_state_json, '$.home.score') END AS final_state_home_score,
  CASE WHEN json_valid(finalization.final_state_json) THEN json_extract(finalization.final_state_json, '$.away.score') END AS final_state_away_score,
  CASE WHEN finalization.finalization_json IS NOT NULL THEN json_valid(finalization.finalization_json) ELSE 0 END AS finalization_json_valid,
  CASE WHEN json_valid(finalization.finalization_json) THEN json_extract(finalization.finalization_json, '$.runId') END AS manifest_run_id,
  CASE WHEN json_valid(finalization.finalization_json) THEN json_extract(finalization.finalization_json, '$.finalizedHistoryRevision') END AS manifest_history_revision,
  CASE WHEN json_valid(finalization.finalization_json) THEN json_extract(finalization.finalization_json, '$.finalizedHistoryHash') END AS manifest_history_hash,
  CASE WHEN json_valid(finalization.finalization_json) THEN json_extract(finalization.finalization_json, '$.finalStateHash') END AS manifest_final_state_hash,
  CASE WHEN json_valid(finalization.finalization_json) THEN json_type(finalization.finalization_json, '$.incidentReport') END AS incident_report_type,
  CASE WHEN json_valid(finalization.finalization_json) THEN json_extract(finalization.finalization_json, '$.incidentReport') END AS incident_report`;

function source(row: MatchReportDatabaseRow): PlatformMatchReportConsistencySource {
  return {
    gameId: row.game_id, gameStatus: row.game_status, resultSource: row.result_source,
    gameHomeScore: row.game_home_score, gameAwayScore: row.game_away_score, claimRunId: row.claim_run_id,
    headLifecycle: row.head_lifecycle, headHistoryRevision: row.head_history_revision,
    headLastAcceptedSequence: row.head_last_accepted_sequence, headHistoryHash: row.head_history_hash,
    headFinalizationHash: row.head_finalization_hash, officialResultAppliedAt: row.official_result_applied_at,
    finalizedHistoryRevision: row.finalized_history_revision, finalizedHistoryHash: row.finalized_history_hash,
    finalStateHash: row.final_state_hash, finalizationHash: row.finalization_hash,
    finalStateJsonValid: row.final_state_json_valid === 1, finalStateRunId: row.final_state_run_id,
    finalStateFinished: row.final_state_finished === 1, finalStateLastProcessedSequence: row.final_state_last_sequence,
    finalStateHomeScore: row.final_state_home_score, finalStateAwayScore: row.final_state_away_score,
    finalizationJsonValid: row.finalization_json_valid === 1, manifestRunId: row.manifest_run_id,
    manifestHistoryRevision: row.manifest_history_revision, manifestHistoryHash: row.manifest_history_hash,
    manifestFinalStateHash: row.manifest_final_state_hash, incidentReportType: row.incident_report_type,
    incidentReport: row.incident_report,
  };
}

export async function listPlatformMatchReportAvailabilityWithDb(database: D1DatabaseBinding, organizationId: string, competitionId?: string) {
  const result = await database.prepare(`SELECT ${consistencyColumns}
    FROM league_games g
    JOIN league_competitions competition ON competition.id=g.competition_id
    LEFT JOIN league_komocontrol_gameplay_game_claims claim ON claim.game_id=g.id
    LEFT JOIN league_komocontrol_gameplay_heads head ON head.run_id=claim.run_id
    LEFT JOIN league_komocontrol_match_finalizations_v1 finalization ON finalization.run_id=head.run_id
    WHERE competition.organization_id=?${competitionId ? " AND competition.id=?" : ""}`).bind(...(competitionId ? [organizationId, competitionId] : [organizationId])).all<MatchReportDatabaseRow>();
  return Object.fromEntries((result.results ?? []).map((row) => [row.game_id, platformMatchReportAvailability(source(row))]));
}

export async function readPlatformMatchReportFinalizedSourceWithDb(
  database: D1DatabaseBinding,
  gameId: string,
  organizationId: string,
): Promise<PlatformMatchReportFinalizedSourceReadResult> {
  const row = await database.prepare(`SELECT ${consistencyColumns},
      competition.name AS competition_name, season.name AS season_name, phase.name AS phase_name,
      g.round_label, g.scheduled_date, g.scheduled_time, g.venue,
      home.id AS home_team_id, home.name AS home_team_name, home.logo_url AS home_logo_url,
      away.id AS away_team_id, away.name AS away_team_name, away.logo_url AS away_logo_url,
      head.updated_at AS head_updated_at, snapshot.initial_state_json, snapshot.initial_state_hash,
      game_package.snapshot_json AS package_snapshot_json,
      configuration.configuration_json, finalization.final_state_json
    FROM league_games g
    JOIN league_competitions competition ON competition.id=g.competition_id
    JOIN league_seasons season ON season.id=competition.season_id
    LEFT JOIN league_phases phase ON phase.id=g.phase_id
    JOIN league_teams home ON home.id=g.home_team_id
    JOIN league_teams away ON away.id=g.away_team_id
    LEFT JOIN league_komocontrol_gameplay_game_claims claim ON claim.game_id=g.id
    LEFT JOIN league_komocontrol_gameplay_heads head ON head.run_id=claim.run_id
    LEFT JOIN league_komocontrol_match_engine_snapshots_v1 snapshot ON snapshot.run_id=head.run_id
    LEFT JOIN league_komocontrol_game_packages game_package ON game_package.id=snapshot.package_id
    LEFT JOIN league_komocontrol_current_game_configurations_v1 configuration ON configuration.run_id=head.run_id
    LEFT JOIN league_komocontrol_match_finalizations_v1 finalization ON finalization.run_id=head.run_id
    WHERE g.id=? AND competition.organization_id=? LIMIT 1`).bind(gameId, organizationId).first<MatchReportDetailRow>();
  if (!row) return { kind: "unavailable", availability: { available: false, hasIncidentReport: false, unavailableReason: "NOT_FINALIZED" } };
  const availability = platformMatchReportAvailability(source(row));
  if (!availability.available) return { kind: "unavailable", availability };
  if (!row.claim_run_id || !row.head_history_hash || !row.head_updated_at || !row.initial_state_json || !row.initial_state_hash
    || !row.package_snapshot_json || !row.final_state_json
    || row.head_history_revision === null || row.head_last_accepted_sequence === null) {
    return { kind: "unavailable", availability: { available: false, hasIncidentReport: false, unavailableReason: "INCONSISTENT_DATA" } };
  }

  const eventResult = await database.prepare(`SELECT event_id, sequence, event_schema_version, event_json, event_hash
    FROM league_komocontrol_match_events_v2 WHERE run_id=? ORDER BY sequence, event_id`)
    .bind(row.claim_run_id).all<EventRow>();
  const liveSource: PublicLiveSource = {
    gameId: row.game_id, lifecycle: "finalized", eventHistoryRevision: row.head_history_revision,
    lastAcceptedSequence: row.head_last_accepted_sequence, historyHash: row.head_history_hash,
    updatedAt: row.head_updated_at, initialStateJson: row.initial_state_json, initialStateHash: row.initial_state_hash,
    currentConfigurationJson: row.configuration_json, homeLogoUrl: row.home_logo_url, awayLogoUrl: row.away_logo_url,
  };
  const events: PublicLiveEventRow[] = (eventResult.results ?? []).map((event) => ({
    eventId: event.event_id, sequence: Number(event.sequence), eventSchemaVersion: Number(event.event_schema_version),
    eventJson: event.event_json, eventHash: event.event_hash,
  }));
  try {
    const projection = projectPublicLiveGame(liveSource, events);
    if (projection.score.home !== row.game_home_score || projection.score.away !== row.game_away_score) throw new Error("INCONSISTENT_SCORE");
    const incidentReport = normalizedIncidentReport(row.incident_report_type, row.incident_report);
    if (incidentReport === undefined) throw new Error("INVALID_INCIDENT_REPORT");
    const statistics = projectPlatformMatchReportStatistics(
      parseMatchReportState(row.initial_state_json),
      parseMatchReportState(row.final_state_json),
    );
    const report: PlatformMatchReport = {
      mode: platformMatchReportMode(row.package_snapshot_json),
      availability,
      game: {
        gameId: row.game_id, competition: row.competition_name, season: row.season_name,
        phase: row.phase_name, round: row.round_label, scheduledDate: row.scheduled_date,
        scheduledTime: row.scheduled_time, venue: row.venue?.trim() || null,
        homeTeam: { teamId: row.home_team_id, name: row.home_team_name, logoUrl: row.home_logo_url },
        awayTeam: { teamId: row.away_team_id, name: row.away_team_name, logoUrl: row.away_logo_url },
        finalScore: projection.score,
        winner: projection.score.home === projection.score.away ? null : projection.score.home > projection.score.away ? "HOME" : "AWAY",
        periodScores: projection.periodScores,
      },
      statistics,
      incidentReport,
    };
    if (!row.configuration_json) throw new Error("MISSING_FINAL_CONFIGURATION");
    return {
      kind: "report",
      source: {
        report,
        packageSnapshotJson: row.package_snapshot_json,
        currentConfigurationJson: row.configuration_json,
        finalStateJson: row.final_state_json,
        eventJson: events.map((event) => event.eventJson),
      },
    };
  } catch {
    return { kind: "unavailable", availability: { available: false, hasIncidentReport: false, unavailableReason: "INCONSISTENT_DATA" } };
  }
}

export async function readPlatformMatchReportWithDb(
  database: D1DatabaseBinding,
  gameId: string,
  organizationId: string,
): Promise<PlatformMatchReportReadResult> {
  const result = await readPlatformMatchReportFinalizedSourceWithDb(database, gameId, organizationId);
  return result.kind === "report" ? { kind: "report", report: result.source.report } : result;
}

export async function readPlatformMatchReport(gameId: string, organizationId: string) {
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) throw new Error("MATCH_REPORT_UNAVAILABLE");
  return readPlatformMatchReportWithDb(environment.NEWS_DB, gameId, organizationId);
}

async function readAuthoritativeStatisticalGamesWithDb(
  database: D1DatabaseBinding,
  competitionId: string,
  organizationId: string,
  teamId: string | null,
  phaseIds: readonly string[] | null = null,
  gameId: string | null = null,
): Promise<StatisticalGame[]> {
  const teamClause = teamId ? " AND (g.home_team_id=? OR g.away_team_id=?)" : "";
  const phaseClause = phaseIds ? ` AND g.phase_id IN (${phaseIds.map(() => "?").join(",")})` : "";
  const gameClause = gameId ? " AND g.id=?" : "";
  const bindings = [...(teamId ? [competitionId, organizationId, teamId, teamId] : [competitionId, organizationId]),
    ...(phaseIds ?? []), ...(gameId ? [gameId] : [])];
  const eventSql = phaseIds ? `SELECT event.run_id, event.event_id, event.sequence, event.event_schema_version, event.event_json, event.event_hash
      FROM league_komocontrol_match_events_v2 event
      WHERE event.run_id IN (
        SELECT claim.run_id FROM league_komocontrol_gameplay_game_claims claim
        JOIN league_games g ON g.id=claim.game_id
        JOIN league_competitions competition ON competition.id=g.competition_id
        JOIN league_komocontrol_gameplay_heads head ON head.run_id=claim.run_id
        WHERE g.competition_id=? AND competition.organization_id=?${teamClause}${phaseClause}${gameClause}
          AND head.lifecycle='finalized' AND g.status='completed' AND g.result_source='match_report'
          AND head.official_result_applied_at IS NOT NULL
      ) ORDER BY event.run_id, event.sequence, event.event_id`
    : `SELECT event.run_id, event.event_id, event.sequence, event.event_schema_version, event.event_json, event.event_hash
      FROM league_komocontrol_match_events_v2 event
      JOIN league_komocontrol_gameplay_game_claims claim ON claim.run_id=event.run_id
      JOIN league_games g ON g.id=claim.game_id
      JOIN league_competitions competition ON competition.id=g.competition_id
      WHERE g.competition_id=? AND competition.organization_id=?${teamClause}${gameClause}
      ORDER BY event.run_id, event.sequence, event.event_id`;
  const [candidateResult, eventResult] = await Promise.all([
    database.prepare(`SELECT ${consistencyColumns},
        competition.name AS competition_name, season.name AS season_name, phase.name AS phase_name,
        g.round_label, g.scheduled_date, g.scheduled_time, g.venue,
        ${phaseIds ? `g.phase_id, COALESCE(g.series_round_number,g.round_number) AS played_round,
          COALESCE(phase.phase_order,phase.order_index,2147483647) AS sort_phase,
          COALESCE(g.series_round_number,g.round_number,2147483647) AS sort_round,
          COALESCE(g.game_order,2147483647) AS sort_game,` : ""}
        home.id AS home_team_id, home.name AS home_team_name, home.logo_url AS home_logo_url,
        away.id AS away_team_id, away.name AS away_team_name, away.logo_url AS away_logo_url,
        head.updated_at AS head_updated_at, snapshot.initial_state_json, snapshot.initial_state_hash,
        configuration.configuration_json, finalization.final_state_json${phaseIds ? ", finalization.finalization_json" : ""}
      FROM league_games g
      JOIN league_competitions competition ON competition.id=g.competition_id
      JOIN league_seasons season ON season.id=competition.season_id
      LEFT JOIN league_phases phase ON phase.id=g.phase_id
      JOIN league_teams home ON home.id=g.home_team_id
      JOIN league_teams away ON away.id=g.away_team_id
      LEFT JOIN league_komocontrol_gameplay_game_claims claim ON claim.game_id=g.id
      LEFT JOIN league_komocontrol_gameplay_heads head ON head.run_id=claim.run_id
      LEFT JOIN league_komocontrol_match_engine_snapshots_v1 snapshot ON snapshot.run_id=head.run_id
      LEFT JOIN league_komocontrol_current_game_configurations_v1 configuration ON configuration.run_id=head.run_id
      LEFT JOIN league_komocontrol_match_finalizations_v1 finalization ON finalization.run_id=head.run_id
      WHERE g.competition_id=? AND competition.organization_id=?${teamClause}${phaseClause}${gameClause}
      ORDER BY COALESCE(g.scheduled_date, '9999-99-99'), COALESCE(g.scheduled_time, '99:99'), g.id`)
      .bind(...bindings).all<MatchReportDetailRow>(),
    database.prepare(eventSql)
      .bind(...bindings).all<BatchEventRow>(),
  ]);
  const eventsByRun = new Map<string, PublicLiveEventRow[]>();
  for (const event of eventResult.results ?? []) {
    const events = eventsByRun.get(event.run_id) ?? [];
    events.push({ eventId: event.event_id, sequence: Number(event.sequence), eventSchemaVersion: Number(event.event_schema_version), eventJson: event.event_json, eventHash: event.event_hash });
    eventsByRun.set(event.run_id, events);
  }
  return (candidateResult.results ?? []).flatMap((row): StatisticalGame[] => {
    const availability = platformMatchReportAvailability(source(row));
    if (!availability.available || !row.claim_run_id || !row.head_history_hash || !row.head_updated_at
      || !row.initial_state_json || !row.initial_state_hash || !row.final_state_json
      || row.head_history_revision === null || row.head_last_accepted_sequence === null) return [];
    try {
      const substitutions = phaseIds ? verifiedMobileSubstitutions(row, eventsByRun.get(row.claim_run_id) ?? []) : null;
      const projection = phaseIds ? null : projectPublicLiveGame({
        gameId: row.game_id,
        lifecycle: "finalized",
        eventHistoryRevision: row.head_history_revision,
        lastAcceptedSequence: row.head_last_accepted_sequence,
        historyHash: row.head_history_hash,
        updatedAt: row.head_updated_at,
        initialStateJson: row.initial_state_json,
        initialStateHash: row.initial_state_hash,
        currentConfigurationJson: row.configuration_json,
        homeLogoUrl: row.home_logo_url,
        awayLogoUrl: row.away_logo_url,
      }, eventsByRun.get(row.claim_run_id) ?? []);
      const initialState = parseMatchReportState(row.initial_state_json);
      const finalState = parseMatchReportState(row.final_state_json);
      projectPlatformMatchReportStatistics(initialState, finalState);
      const score = projection?.score ?? { home: finalState.home.score, away: finalState.away.score };
      if (score.home !== row.game_home_score || score.away !== row.game_away_score
        || finalState.home.score !== score.home || finalState.away.score !== score.away
        || (phaseIds && initialState.id !== row.claim_run_id)) return [];
      const participatingPlayerIds = phaseIds ? new Set([
        ...initialState.home.players.filter((player) => player.onCourt).map((player) => player.playerId),
        ...initialState.away.players.filter((player) => player.onCourt).map((player) => player.playerId),
      ]) : null;
      for (const playerId of substitutions ?? []) participatingPlayerIds?.add(playerId);
      const sourcePlayers = (players: typeof finalState.home.players) => players.map((player) => ({
        canonicalPlayerId: player.playerId,
        displayName: player.displayName,
        shirtNumber: player.shirtNumber,
        statistics: projectMatchReportPlayerLine(player),
      }));
      return [{
        gameId: row.game_id,
        scheduledDate: row.scheduled_date,
        scheduledTime: row.scheduled_time,
        homeTeamId: row.home_team_id,
        homeTeamName: row.home_team_name,
        awayTeamId: row.away_team_id,
        awayTeamName: row.away_team_name,
        homeScore: score.home,
        awayScore: score.away,
        homePlayers: sourcePlayers(finalState.home.players),
        awayPlayers: sourcePlayers(finalState.away.players),
        ...(participatingPlayerIds ? {
          participatingPlayerIds: [...participatingPlayerIds],
          homeTeamStatistics: projectMatchReportTeamLine(finalState.home),
          awayTeamStatistics: projectMatchReportTeamLine(finalState.away),
          phaseId: row.phase_id!, round: row.played_round ?? null, roundLabel: row.round_label?.trim() || null,
          sortKey: [row.scheduled_date ?? "9999-12-31", row.scheduled_time ?? "99:99",
            row.sort_phase ?? 2147483647, row.sort_round ?? 2147483647,
            row.sort_game ?? 2147483647, row.game_id] as const,
        } : {}),
      }];
    } catch {
      return [];
    }
  });
}

export function readAuthoritativeTeamStatisticalGamesWithDb(
  database: D1DatabaseBinding,
  competitionId: string,
  teamId: string,
  organizationId: string,
) {
  return readAuthoritativeStatisticalGamesWithDb(database, competitionId, organizationId, teamId);
}

export function readAuthoritativeCompetitionStatisticalGamesWithDb(
  database: D1DatabaseBinding,
  competitionId: string,
  organizationId: string,
) {
  return readAuthoritativeStatisticalGamesWithDb(database, competitionId, organizationId, null);
}

export async function readAuthoritativePhaseStatisticalGamesWithDb(
  database: D1DatabaseBinding,
  competitionId: string,
  organizationId: string,
  phaseIds: readonly string[],
  teamId: string | null = null,
  gameId: string | null = null,
): Promise<ParticipatingStatisticalGame[]> {
  const games = await readAuthoritativeStatisticalGamesWithDb(database, competitionId, organizationId, teamId, phaseIds, gameId);
  return games.map((game) => {
    if (!game.participatingPlayerIds || !game.homeTeamStatistics || !game.awayTeamStatistics
      || !game.phaseId || !game.sortKey) {
      throw new Error("MISSING_STATISTICAL_PARTICIPATION");
    }
    return { ...game, participatingPlayerIds: game.participatingPlayerIds,
      homeTeamStatistics: game.homeTeamStatistics, awayTeamStatistics: game.awayTeamStatistics,
      phaseId: game.phaseId, round: game.round ?? null, roundLabel: game.roundLabel ?? null,
      sortKey: game.sortKey };
  });
}
