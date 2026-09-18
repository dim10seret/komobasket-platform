import "server-only";

import { connection } from "next/server";
import { teams } from "@/data/teams";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export async function getPublicHistoricalTeamLogosWithDb(db: D1DatabaseBinding): Promise<Record<string, string | null>> {
  const result = await db.prepare(
    "SELECT id, NULLIF(TRIM(logo_url), '') AS logo_url FROM league_teams WHERE organization_id=?",
  ).bind("organization_komobasket").all<{ id: string; logo_url: string | null }>();
  const canonical = new Map((result.results ?? []).map(team => [team.id, team.logo_url]));
  return Object.fromEntries(teams.map(team => {
    // Preserve the historical import's stable Team ID, even after a canonical rename.
    const baseSlug = team.slug.startsWith(`${team.season}-`) ? team.slug.slice(team.season.length + 1) : team.slug;
    return [team.slug, canonical.get(`team_${baseSlug}`) ?? null];
  }));
}

export async function getPublicHistoricalTeamLogos(): Promise<Record<string, string | null>> {
  await connection();
  try {
    const env = await getKomoBasketCloudflareEnv();
    return env?.NEWS_DB ? await getPublicHistoricalTeamLogosWithDb(env.NEWS_DB) : {};
  } catch {
    // Missing canonical data must not resurrect an obsolete seasonal image.
    return {};
  }
}
