import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import type { D1DatabaseBinding } from "@/types/cloudflare";
import { saveOfficialGameResultAndProgressSeriesWithDb } from "@/services/league-admin.service";
import {
  GameplaySyncValidationError,
  assertGameplayPackageLineage,
  assertGameplaySyncIdentity,
  decideGameplayConfigurationSync,
  decideGameplaySync,
  validateGameplaySync,
  type GameplaySyncDecision,
  type ValidatedGameplaySync,
} from "@/services/komocontrol-gameplay-sync-core";

type SafeScorerSession = {
  scorer: { id: string; username: string };
  organization: { id: string; name: string };
  session: { id: string; expiresAt: string; deviceId: string };
};

type PackageRow = {
  package_id: string;
  game_id: string;
  package_version: number;
  package_hash: string;
  package_status: string;
  organization_id: string;
  competition_id: string;
  snapshot_json: string;
};

type ClaimRow = { game_id: string; run_id: string; organization_id: string; scorer_id: string; device_id: string };
type SnapshotRow = { run_id: string; game_id: string; package_id: string; package_version: number; package_hash: string; organization_id: string; scorer_id: string; device_id: string };
type HeadRow = { event_history_revision: number; history_hash: string; finalization_hash: string | null; official_result_applied_at: string | null };
type CurrentConfigurationRow = { configuration_revision: number; configuration_hash: string };

export class GameplaySyncServiceError extends Error {
  constructor(readonly code: "SYNC_INVALID" | "SYNC_STALE" | "SYNC_INTEGRITY_CONFLICT" | "SYNC_RUN_CONFLICT" | "SYNC_UNAVAILABLE", readonly status: number) {
    super(code);
    this.name = "GameplaySyncServiceError";
  }
}

async function gameplayDatabase(): Promise<D1DatabaseBinding> {
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) throw new GameplaySyncServiceError("SYNC_UNAVAILABLE", 503);
  return environment.NEWS_DB;
}

function mapValidation(error: unknown): never {
  if (error instanceof GameplaySyncValidationError) {
    const status = error.code === "SYNC_STALE" ? 409 : error.code === "SYNC_INTEGRITY_CONFLICT" || error.code === "SYNC_RUN_CONFLICT" ? 409 : 400;
    throw new GameplaySyncServiceError(error.code, status);
  }
  if (error instanceof GameplaySyncServiceError) throw error;
  throw new GameplaySyncServiceError("SYNC_UNAVAILABLE", 503);
}

function assertStoredIdentity(input: ValidatedGameplaySync, row: SnapshotRow | null): void {
  if (!row) return;
  if (row.run_id !== input.runId || row.game_id !== input.gameId || row.package_id !== input.packageId || row.package_version !== input.packageVersion
    || row.package_hash !== input.packageHash || row.organization_id !== input.organizationId || row.scorer_id !== input.scorerId || row.device_id !== input.deviceId) {
    throw new GameplaySyncServiceError("SYNC_RUN_CONFLICT", 409);
  }
}

function eventRowsJson(input: ValidatedGameplaySync): string {
  return JSON.stringify(input.events.map((event) => ({
    eventId: event.eventId,
    sequence: event.sequence,
    eventSchemaVersion: event.eventSchemaVersion,
    eventJson: event.eventJson,
    eventHash: event.eventHash,
  })));
}

async function persistRevision(
  database: D1DatabaseBinding,
  input: ValidatedGameplaySync,
  decision: GameplaySyncDecision,
  configurationDecision: GameplaySyncDecision,
  current: HeadRow | null,
  currentConfiguration: CurrentConfigurationRow | null,
): Promise<void> {
  if (decision === "idempotent" && configurationDecision === "idempotent") return;
  const finalizationHash = input.finalization?.finalizationHash ?? null;
  const lifecycle = input.finalization ? "finalized" : "live";
  const statements: ReturnType<D1DatabaseBinding["prepare"]>[] = [];
  if (decision === "insert") {
    statements.push(database.prepare(`INSERT OR IGNORE INTO league_komocontrol_gameplay_game_claims
      (game_id, run_id, organization_id, scorer_id, device_id) VALUES (?, ?, ?, ?, ?)`)
      .bind(input.gameId, input.runId, input.organizationId, input.scorerId, input.deviceId));
    statements.push(database.prepare(`INSERT OR IGNORE INTO league_komocontrol_match_engine_snapshots_v1
      (run_id, game_id, package_id, package_version, package_hash, organization_id, scorer_id, device_id, started_at_utc,
       configuration_revision, configuration_hash, snapshot_schema_version, match_event_schema_version, initial_state_json, initial_state_hash)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM league_komocontrol_gameplay_game_claims WHERE game_id = ? AND run_id = ?)`)
      .bind(input.runId, input.gameId, input.packageId, input.packageVersion, input.packageHash, input.organizationId, input.scorerId, input.deviceId,
        input.startedAtUtc, input.configurationRevision, input.configurationHash, input.snapshotSchemaVersion, input.matchEventSchemaVersion,
        input.initialStateJson, input.initialStateHash, input.gameId, input.runId));
    statements.push(database.prepare(`INSERT INTO league_komocontrol_match_events_v2
      (run_id, event_id, sequence, event_schema_version, event_json, event_hash)
      SELECT ?, json_extract(value, '$.eventId'), json_extract(value, '$.sequence'), json_extract(value, '$.eventSchemaVersion'),
        json_extract(value, '$.eventJson'), json_extract(value, '$.eventHash')
      FROM json_each(?) WHERE EXISTS (SELECT 1 FROM league_komocontrol_match_engine_snapshots_v1 WHERE run_id = ?)`)
      .bind(input.runId, eventRowsJson(input), input.runId));
    statements.push(database.prepare(`INSERT INTO league_komocontrol_gameplay_heads
      (run_id, event_history_revision, last_accepted_sequence, history_hash, lifecycle, finalization_hash)
      SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM league_komocontrol_match_engine_snapshots_v1 WHERE run_id = ?)`)
      .bind(input.runId, input.eventHistoryRevision, input.lastAcceptedSequence, input.historyHash, lifecycle, finalizationHash, input.runId));
  } else if (decision === "replace") {
    statements.push(database.prepare(`DELETE FROM league_komocontrol_match_events_v2 WHERE run_id = ?
      AND EXISTS (SELECT 1 FROM league_komocontrol_gameplay_heads WHERE run_id = ? AND event_history_revision = ? AND history_hash = ?)`)
      .bind(input.runId, input.runId, current?.event_history_revision, current?.history_hash));
    statements.push(database.prepare(`INSERT INTO league_komocontrol_match_events_v2
      (run_id, event_id, sequence, event_schema_version, event_json, event_hash)
      SELECT ?, json_extract(value, '$.eventId'), json_extract(value, '$.sequence'), json_extract(value, '$.eventSchemaVersion'),
        json_extract(value, '$.eventJson'), json_extract(value, '$.eventHash') FROM json_each(?)`)
      .bind(input.runId, eventRowsJson(input)));
    statements.push(database.prepare("DELETE FROM league_komocontrol_match_finalizations_v1 WHERE run_id = ?").bind(input.runId));
    statements.push(database.prepare(`UPDATE league_komocontrol_gameplay_heads SET event_history_revision = ?, last_accepted_sequence = ?,
      history_hash = ?, lifecycle = ?, finalization_hash = ?, updated_at = CURRENT_TIMESTAMP
      WHERE run_id = ? AND event_history_revision = ? AND history_hash = ?`)
      .bind(input.eventHistoryRevision, input.lastAcceptedSequence, input.historyHash, lifecycle, finalizationHash,
        input.runId, current?.event_history_revision, current?.history_hash));
  }
  if (configurationDecision === "insert") {
    statements.push(database.prepare(`INSERT INTO league_komocontrol_current_game_configurations_v1
      (run_id, configuration_revision, configuration_hash, configuration_json)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM league_komocontrol_match_engine_snapshots_v1 WHERE run_id = ?)`)
      .bind(input.runId, input.currentConfigurationRevision, input.currentConfigurationHash, input.currentConfigurationJson, input.runId));
  } else if (configurationDecision === "replace") {
    statements.push(database.prepare(`UPDATE league_komocontrol_current_game_configurations_v1
      SET configuration_revision = ?, configuration_hash = ?, configuration_json = ?, updated_at = CURRENT_TIMESTAMP
      WHERE run_id = ? AND configuration_revision = ? AND configuration_hash = ?`)
      .bind(input.currentConfigurationRevision, input.currentConfigurationHash, input.currentConfigurationJson,
        input.runId, currentConfiguration?.configuration_revision, currentConfiguration?.configuration_hash));
  }
  if (input.finalization) {
    statements.push(database.prepare(`INSERT INTO league_komocontrol_match_finalizations_v1
      (run_id, finalized_history_revision, finalized_history_hash, final_state_json, final_state_hash, finalization_json, finalization_hash, finalized_at_utc)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (
        SELECT 1 FROM league_komocontrol_gameplay_heads WHERE run_id = ? AND event_history_revision = ? AND history_hash = ? AND finalization_hash = ?)`)
      .bind(input.runId, input.finalization.finalizedHistoryRevision, input.finalization.finalizedHistoryHash,
        input.finalization.finalStateJson, input.finalization.finalStateHash, input.finalization.finalizationJson,
        input.finalization.finalizationHash, input.finalization.finalizedAtUtc,
        input.runId, input.eventHistoryRevision, input.historyHash, input.finalization.finalizationHash));
  }
  try { await database.batch(statements); } catch { throw new GameplaySyncServiceError("SYNC_INTEGRITY_CONFLICT", 409); }
  const persisted = await database.prepare(`SELECT event_history_revision, history_hash, finalization_hash, official_result_applied_at
    FROM league_komocontrol_gameplay_heads WHERE run_id = ?`).bind(input.runId).first<HeadRow>();
  if (!persisted || persisted.event_history_revision !== input.eventHistoryRevision || persisted.history_hash !== input.historyHash
    || (persisted.finalization_hash ?? null) !== finalizationHash) throw new GameplaySyncServiceError("SYNC_RUN_CONFLICT", 409);
  const persistedConfiguration = await database.prepare(`SELECT configuration_revision, configuration_hash
    FROM league_komocontrol_current_game_configurations_v1 WHERE run_id = ?`).bind(input.runId).first<CurrentConfigurationRow>();
  if (!persistedConfiguration || persistedConfiguration.configuration_revision !== input.currentConfigurationRevision
    || persistedConfiguration.configuration_hash !== input.currentConfigurationHash) throw new GameplaySyncServiceError("SYNC_RUN_CONFLICT", 409);
}

async function applyOfficialResult(database: D1DatabaseBinding, input: ValidatedGameplaySync, packageRow: PackageRow): Promise<boolean> {
  if (!input.finalization) return false;
  const head = await database.prepare(`SELECT event_history_revision, history_hash, finalization_hash, official_result_applied_at
    FROM league_komocontrol_gameplay_heads WHERE run_id = ?`).bind(input.runId).first<HeadRow>();
  if (head?.official_result_applied_at) return true;
  const rules = input.finalState.rules;
  if (rules.resultPolicy !== "ALLOW_TIE" && rules.resultPolicy !== "REQUIRE_WINNER") throw new GameplaySyncServiceError("SYNC_INVALID", 400);
  await saveOfficialGameResultAndProgressSeriesWithDb(database, {
    gameId: input.gameId,
    competitionId: packageRow.competition_id,
    homeScore: input.finalState.home.score,
    awayScore: input.finalState.away.score,
    resultSource: "match_report",
    allowTie: rules.resultPolicy === "ALLOW_TIE",
  }, `komocontrol:${input.scorerId}`);
  await database.prepare(`UPDATE league_komocontrol_gameplay_heads SET official_result_applied_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE run_id = ? AND finalization_hash = ? AND official_result_applied_at IS NULL`)
    .bind(input.runId, input.finalization.finalizationHash).run();
  return true;
}

export async function syncScorerGameplay(session: SafeScorerSession, routeRunId: string, payload: unknown) {
  try {
    const input = validateGameplaySync(payload, routeRunId);
    assertGameplaySyncIdentity({ scorerId: session.scorer.id, organizationId: session.organization.id, deviceId: session.session.deviceId }, input);
    const database = await gameplayDatabase();
    const packageRow = await database.prepare(`SELECT p.id AS package_id, p.game_id, p.package_version, p.snapshot_hash AS package_hash,
      p.status AS package_status, p.organization_id, p.snapshot_json, g.competition_id
      FROM league_komocontrol_game_packages p
      JOIN league_games g ON g.id = p.game_id
      JOIN league_competitions c ON c.id = g.competition_id
      WHERE p.id = ? AND p.game_id = ? AND p.organization_id = ? AND c.organization_id = ? LIMIT 1`)
      .bind(input.packageId, input.gameId, input.organizationId, input.organizationId).first<PackageRow>();
    if (!packageRow || packageRow.package_version !== input.packageVersion || packageRow.package_hash !== input.packageHash
      || !["published", "superseded"].includes(packageRow.package_status)) throw new GameplaySyncServiceError("SYNC_INVALID", 400);
    assertGameplayPackageLineage(input, packageRow.snapshot_json);
    const claim = await database.prepare(`SELECT game_id, run_id, organization_id, scorer_id, device_id
      FROM league_komocontrol_gameplay_game_claims WHERE game_id = ? OR run_id = ? LIMIT 1`)
      .bind(input.gameId, input.runId).first<ClaimRow>();
    if (claim && (claim.game_id !== input.gameId || claim.run_id !== input.runId || claim.organization_id !== input.organizationId
      || claim.scorer_id !== input.scorerId || claim.device_id !== input.deviceId)) throw new GameplaySyncServiceError("SYNC_RUN_CONFLICT", 409);
    const snapshot = await database.prepare(`SELECT run_id, game_id, package_id, package_version, package_hash, organization_id, scorer_id, device_id
      FROM league_komocontrol_match_engine_snapshots_v1 WHERE run_id = ?`).bind(input.runId).first<SnapshotRow>();
    assertStoredIdentity(input, snapshot);
    const current = await database.prepare(`SELECT event_history_revision, history_hash, finalization_hash, official_result_applied_at
      FROM league_komocontrol_gameplay_heads WHERE run_id = ?`).bind(input.runId).first<HeadRow>();
    const currentConfiguration = await database.prepare(`SELECT configuration_revision, configuration_hash
      FROM league_komocontrol_current_game_configurations_v1 WHERE run_id = ?`).bind(input.runId).first<CurrentConfigurationRow>();
    const decision = decideGameplaySync(current ? {
      eventHistoryRevision: current.event_history_revision,
      historyHash: current.history_hash,
      finalizationHash: current.finalization_hash,
    } : null, input);
    const configurationDecision = decideGameplayConfigurationSync(currentConfiguration ? {
      configurationRevision: currentConfiguration.configuration_revision,
      configurationHash: currentConfiguration.configuration_hash,
    } : null, input);
    await persistRevision(database, input, decision, configurationDecision, current ?? null, currentConfiguration ?? null);
    const officialResultApplied = await applyOfficialResult(database, input, packageRow);
    return {
      runId: input.runId,
      acknowledgedHistoryRevision: input.eventHistoryRevision,
      acknowledgedHistoryHash: input.historyHash,
      acknowledgedConfigurationRevision: input.currentConfigurationRevision,
      acknowledgedConfigurationHash: input.currentConfigurationHash,
      acknowledgedFinalizationHash: input.finalization?.finalizationHash ?? null,
      officialResultApplied,
      status: decision === "idempotent" ? "idempotent" as const : "accepted" as const,
    };
  } catch (error) { return mapValidation(error); }
}

export function gameplaySyncErrorResponse(error: unknown): Response {
  const mapped = error instanceof GameplaySyncServiceError ? error : new GameplaySyncServiceError("SYNC_UNAVAILABLE", 503);
  return Response.json({ error: { code: mapped.code } }, { status: mapped.status, headers: { "Cache-Control": "no-store, private" } });
}
