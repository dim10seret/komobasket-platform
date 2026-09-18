import { createHash } from "node:crypto";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import type { D1DatabaseBinding } from "@/types/cloudflare";
import { projectPublicLiveGame, type PublicLiveEventRow, type PublicLiveGame, type PublicLiveSource } from "./public-live-game-core";

const PUBLIC_ORGANIZATION_ID = "organization_komobasket";

type PublicLiveGameRow = {
  game_id: string;
  home_logo_url: string | null;
  away_logo_url: string | null;
  run_id: string | null;
  lifecycle: string | null;
  event_history_revision: number | null;
  last_accepted_sequence: number | null;
  history_hash: string | null;
  head_updated_at: string | null;
  initial_state_hash: string | null;
  configuration_revision: number | null;
  configuration_hash: string | null;
};

type PublicLiveProjectionRow = {
  initial_state_json: string | null;
  initial_state_hash: string | null;
  configuration_json: string | null;
  configuration_revision: number | null;
  configuration_hash: string | null;
};

type PublicLiveEventDatabaseRow = {
  event_id: string;
  sequence: number;
  event_schema_version: number;
  event_json: string;
  event_hash: string;
};

export type PublicLiveGameReadResult =
  | { kind: "game"; etag: string; game: PublicLiveGame }
  | { kind: "not-modified"; etag: string }
  | { kind: "not-live"; gameId: string };

export class PublicLiveGameServiceError extends Error {
  constructor(readonly code: "PUBLIC_LIVE_NOT_FOUND" | "PUBLIC_LIVE_CORRUPTED" | "PUBLIC_LIVE_UNAVAILABLE") {
    super(code);
    this.name = "PublicLiveGameServiceError";
  }
}

export type PublicLiveValidatorState = {
  runId: string;
  lifecycle: "live" | "finalized";
  eventHistoryRevision: number;
  lastAcceptedSequence: number;
  historyHash: string;
  headUpdatedAt: string;
  initialStateHash: string;
  configurationRevision: number | null;
  configurationHash: string | null;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
};

export function publicLiveEtag(state: PublicLiveValidatorState): string {
  const digest = createHash("sha256").update(JSON.stringify([
    state.runId,
    state.lifecycle,
    state.eventHistoryRevision,
    state.lastAcceptedSequence,
    state.historyHash,
    state.headUpdatedAt,
    state.initialStateHash,
    state.configurationRevision,
    state.configurationHash,
    state.homeLogoUrl,
    state.awayLogoUrl,
  ])).digest("hex");
  return `"public-live-${digest}"`;
}

export async function readPublicLiveGameWithDb(
  database: D1DatabaseBinding,
  gameId: string,
  options: { ifNoneMatch?: string | null; nowMs?: number } = {},
  organizationId = PUBLIC_ORGANIZATION_ID,
): Promise<PublicLiveGameReadResult> {
  const row = await database.prepare(`
    SELECT g.id AS game_id, home.logo_url AS home_logo_url, away.logo_url AS away_logo_url,
           claim.run_id, head.lifecycle, head.event_history_revision, head.last_accepted_sequence,
           head.history_hash, head.updated_at AS head_updated_at,
           snapshot.initial_state_hash, configuration.configuration_revision, configuration.configuration_hash
      FROM league_games g
      JOIN league_competitions competition ON competition.id=g.competition_id
      JOIN league_teams home ON home.id=g.home_team_id
      JOIN league_teams away ON away.id=g.away_team_id
      LEFT JOIN league_komocontrol_gameplay_game_claims claim ON claim.game_id=g.id
      LEFT JOIN league_komocontrol_gameplay_heads head ON head.run_id=claim.run_id
      LEFT JOIN league_komocontrol_match_engine_snapshots_v1 snapshot ON snapshot.run_id=head.run_id
      LEFT JOIN league_komocontrol_current_game_configurations_v1 configuration ON configuration.run_id=head.run_id
     WHERE g.id=? AND competition.organization_id=?
     LIMIT 1
  `).bind(gameId, organizationId).first<PublicLiveGameRow>();
  if (!row) throw new PublicLiveGameServiceError("PUBLIC_LIVE_NOT_FOUND");
  if (row.lifecycle !== "live" && row.lifecycle !== "finalized") return { kind: "not-live", gameId };
  if (!row.run_id || row.event_history_revision === null || row.last_accepted_sequence === null || !row.history_hash
    || !row.head_updated_at || !row.initial_state_hash) throw new PublicLiveGameServiceError("PUBLIC_LIVE_CORRUPTED");
  const currentEtag = publicLiveEtag({
    runId: row.run_id,
    lifecycle: row.lifecycle,
    eventHistoryRevision: row.event_history_revision,
    lastAcceptedSequence: row.last_accepted_sequence,
    historyHash: row.history_hash,
    headUpdatedAt: row.head_updated_at,
    initialStateHash: row.initial_state_hash,
    configurationRevision: row.configuration_revision,
    configurationHash: row.configuration_hash,
    homeLogoUrl: row.home_logo_url,
    awayLogoUrl: row.away_logo_url,
  });
  if (options.ifNoneMatch === currentEtag) return { kind: "not-modified", etag: currentEtag };

  const projection = await database.prepare(`
    SELECT snapshot.initial_state_json, snapshot.initial_state_hash,
           configuration.configuration_json, configuration.configuration_revision, configuration.configuration_hash
      FROM league_komocontrol_match_engine_snapshots_v1 snapshot
      LEFT JOIN league_komocontrol_current_game_configurations_v1 configuration ON configuration.run_id=snapshot.run_id
     WHERE snapshot.run_id=?
     LIMIT 1
  `).bind(row.run_id).first<PublicLiveProjectionRow>();
  if (!projection?.initial_state_json || projection.initial_state_hash !== row.initial_state_hash
    || projection.configuration_revision !== row.configuration_revision
    || projection.configuration_hash !== row.configuration_hash) throw new PublicLiveGameServiceError("PUBLIC_LIVE_CORRUPTED");

  const eventResult = await database.prepare(`SELECT event_id, sequence, event_schema_version, event_json, event_hash
      FROM league_komocontrol_match_events_v2 WHERE run_id=? ORDER BY sequence, event_id`)
    .bind(row.run_id).all<PublicLiveEventDatabaseRow>();
  const source: PublicLiveSource = {
    gameId: row.game_id,
    lifecycle: row.lifecycle,
    eventHistoryRevision: row.event_history_revision,
    lastAcceptedSequence: row.last_accepted_sequence,
    historyHash: row.history_hash,
    updatedAt: row.head_updated_at,
    initialStateJson: projection.initial_state_json,
    initialStateHash: projection.initial_state_hash,
    currentConfigurationJson: projection.configuration_json,
    homeLogoUrl: row.home_logo_url,
    awayLogoUrl: row.away_logo_url,
  };
  const events: PublicLiveEventRow[] = (eventResult.results ?? []).map((event) => ({
    eventId: event.event_id,
    sequence: Number(event.sequence),
    eventSchemaVersion: Number(event.event_schema_version),
    eventJson: event.event_json,
    eventHash: event.event_hash,
  }));
  try {
    return { kind: "game", etag: currentEtag, game: projectPublicLiveGame(source, events, options.nowMs) };
  } catch {
    throw new PublicLiveGameServiceError("PUBLIC_LIVE_CORRUPTED");
  }
}

export async function readPublicLiveGame(
  gameId: string,
  options: { ifNoneMatch?: string | null; nowMs?: number } = {},
): Promise<PublicLiveGameReadResult> {
  return readPublicLiveGameForOrganization(PUBLIC_ORGANIZATION_ID, gameId, options);
}

export async function readPublicLiveGameForOrganization(
  organizationId: string,
  gameId: string,
  options: { ifNoneMatch?: string | null; nowMs?: number } = {},
): Promise<PublicLiveGameReadResult> {
  const normalizedGameId = gameId.trim();
  if (!normalizedGameId) throw new PublicLiveGameServiceError("PUBLIC_LIVE_NOT_FOUND");
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) throw new PublicLiveGameServiceError("PUBLIC_LIVE_UNAVAILABLE");
  return readPublicLiveGameWithDb(environment.NEWS_DB, normalizedGameId, options, organizationId);
}
