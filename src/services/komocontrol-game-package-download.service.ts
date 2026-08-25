import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import type { D1DatabaseBinding } from "@/types/cloudflare";
import {
  GamePackageUnavailableError,
  projectCurrentPublishedGamePackage,
  type PublishedGamePackageDownloadRow,
} from "@/services/komocontrol-game-package-download-core";

async function packageDatabase(): Promise<D1DatabaseBinding> {
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) throw new Error("KomoControl GamePackage database is unavailable.");
  return environment.NEWS_DB;
}

export async function downloadScorerGamePackage(organizationId: string, gameId: string) {
  const requestedGameId = gameId.trim();
  if (!requestedGameId) throw new GamePackageUnavailableError();
  const database = await packageDatabase();
  const row = await database.prepare(`SELECT p.id, p.game_id, p.organization_id, p.package_version,
    p.status, p.snapshot_json, p.snapshot_hash, p.published_at
    FROM league_komocontrol_game_packages p
    JOIN league_games g ON g.id = p.game_id
    JOIN league_competitions c ON c.id = g.competition_id
    WHERE p.game_id = ? AND p.organization_id = ? AND c.organization_id = ? AND p.status = 'published'
    LIMIT 1`).bind(requestedGameId, organizationId, organizationId).first<PublishedGamePackageDownloadRow>();
  return projectCurrentPublishedGamePackage(row, organizationId, requestedGameId);
}

export function gamePackageDownloadErrorResponse(error: unknown): Response | null {
  return error instanceof GamePackageUnavailableError
    ? Response.json({ error: { code: error.code } }, { status: error.status, headers: { "Cache-Control": "no-store, private" } })
    : null;
}
