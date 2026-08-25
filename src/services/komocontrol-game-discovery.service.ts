import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import type { D1DatabaseBinding } from "@/types/cloudflare";
import { projectAvailableGames, type PublishedGamePackageRow } from "@/services/komocontrol-game-discovery-core";

async function discoveryDatabase(): Promise<D1DatabaseBinding> {
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) throw new Error("KomoControl Game discovery database is unavailable.");
  return environment.NEWS_DB;
}

export async function listScorerAvailableGames(organizationId: string) {
  const database = await discoveryDatabase();
  const rows = (await database.prepare(`SELECT id, game_id, organization_id, package_version, status, snapshot_json, published_at
    FROM league_komocontrol_game_packages WHERE organization_id = ? AND status = 'published'
    ORDER BY published_at ASC, game_id ASC`).bind(organizationId).all<PublishedGamePackageRow>()).results ?? [];
  return projectAvailableGames(rows, organizationId);
}
