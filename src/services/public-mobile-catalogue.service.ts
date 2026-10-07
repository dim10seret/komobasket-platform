import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { RESERVED_ORGANIZATION_SLUGS } from "@/lib/organization-slug";
import {
  CANONICAL_PUBLIC_SEASON_START,
  PUBLIC_KOMOBASKET_ORGANIZATION_ID,
} from "@/services/public-competition.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export type SeasonSummary = {
  id: string;
  name: string;
  slug: string;
  startDate: string | null;
  endDate: string | null;
};

export type OrganizationSummary = {
  id: string;
  slug: string;
  name: string;
  logoUrl: string | null;
};

export type CompetitionSummary = {
  id: string;
  organizationId: string;
  seasonId: string;
  slug: string;
  name: string;
  type: string;
  logoUrl: string | null;
};

type SeasonRow = { id: string; name: string; slug: string; starts_on: string | null; ends_on: string | null };
type OrganizationRow = { id: string; slug: string; name: string; logo_url: string | null };
type CompetitionRow = {
  id: string;
  organization_id: string;
  season_id: string;
  slug: string;
  name: string;
  type: string;
  logo_url: string | null;
};

const SEASON_VISIBLE_SQL = `
  s.starts_on >= ?
  AND s.status IN ('active', 'completed')
`;

// Mirror the hosted slug resolver's public slug shape and reserved names.
const reservedSlugs = [...RESERVED_ORGANIZATION_SLUGS];
const ORGANIZATION_VISIBLE_SQL = `
  o.status = 'active'
  AND (
    o.id = ?
    OR (
      o.publication_status = 'published'
      AND o.slug = LOWER(TRIM(o.slug))
      AND o.slug GLOB '[a-z0-9]*'
      AND o.slug NOT GLOB '*[^a-z0-9-]*'
      AND o.slug NOT GLOB '*--*'
      AND o.slug NOT GLOB '*-'
      AND o.slug NOT IN (${reservedSlugs.map(() => "?").join(", ")})
    )
  )
`;

const COMPETITION_VISIBLE_SQL = `
  COALESCE(cp.lifecycle_status,
    CASE c.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END
  ) IN ('online', 'complete')
`;

const seasonBindings = [CANONICAL_PUBLIC_SEASON_START];
const organizationBindings = [PUBLIC_KOMOBASKET_ORGANIZATION_ID, ...reservedSlugs];

async function getCatalogueDb(): Promise<D1DatabaseBinding> {
  const db = (await getKomoBasketCloudflareEnv())?.NEWS_DB;
  if (!db) throw new Error("Public catalogue database unavailable");
  return db;
}

export async function listMobileSeasonsWithDb(db: D1DatabaseBinding): Promise<SeasonSummary[]> {
  const result = await db.prepare(`
    SELECT s.id, s.name, s.slug, s.starts_on, s.ends_on
      FROM league_seasons s
     WHERE ${SEASON_VISIBLE_SQL}
       AND EXISTS (
         SELECT 1
           FROM league_competitions c
           JOIN league_organizations o ON o.id = c.organization_id
           LEFT JOIN league_competition_publication cp ON cp.competition_id = c.id
          WHERE c.season_id = s.id
            AND ${ORGANIZATION_VISIBLE_SQL}
            AND ${COMPETITION_VISIBLE_SQL}
       )
     ORDER BY s.starts_on DESC, s.name DESC, s.id ASC
     LIMIT 100
  `).bind(...seasonBindings, ...organizationBindings).all<SeasonRow>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    startDate: row.starts_on,
    endDate: row.ends_on,
  }));
}

export async function listMobileOrganizationsWithDb(
  db: D1DatabaseBinding,
  seasonId: string,
): Promise<OrganizationSummary[] | null> {
  const result = await db.prepare(`
    SELECT DISTINCT o.id, o.slug, o.name, o.logo_url
      FROM league_organizations o
      JOIN league_competitions c ON c.organization_id = o.id
      JOIN league_seasons s ON s.id = c.season_id
      LEFT JOIN league_competition_publication cp ON cp.competition_id = c.id
     WHERE s.id = ?
       AND ${SEASON_VISIBLE_SQL}
       AND ${ORGANIZATION_VISIBLE_SQL}
       AND ${COMPETITION_VISIBLE_SQL}
     ORDER BY o.name COLLATE NOCASE ASC, o.id ASC
     LIMIT 500
  `).bind(seasonId, ...seasonBindings, ...organizationBindings).all<OrganizationRow>();

  const rows = result.results ?? [];
  if (!rows.length) return null;
  return rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name, logoUrl: row.logo_url }));
}

export async function listMobileCompetitionsWithDb(
  db: D1DatabaseBinding,
  seasonId: string,
  organizationId: string,
): Promise<CompetitionSummary[] | null> {
  const result = await db.prepare(`
    SELECT c.id, c.organization_id, c.season_id, c.slug, c.name, c.type, c.logo_url
      FROM league_competitions c
      JOIN league_seasons s ON s.id = c.season_id
      JOIN league_organizations o ON o.id = c.organization_id
      LEFT JOIN league_competition_publication cp ON cp.competition_id = c.id
     WHERE s.id = ?
       AND o.id = ?
       AND ${SEASON_VISIBLE_SQL}
       AND ${ORGANIZATION_VISIBLE_SQL}
       AND ${COMPETITION_VISIBLE_SQL}
     ORDER BY c.name COLLATE NOCASE ASC, c.id ASC
     LIMIT 500
  `).bind(seasonId, organizationId, ...seasonBindings, ...organizationBindings).all<CompetitionRow>();

  const rows = result.results ?? [];
  if (!rows.length) return null;
  return rows.map((row) => ({
    id: row.id,
    organizationId: row.organization_id,
    seasonId: row.season_id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    logoUrl: row.logo_url,
  }));
}

export async function readMobileCompetitionWithDb(
  db: D1DatabaseBinding,
  competitionId: string,
): Promise<CompetitionSummary | null> {
  const row = await db.prepare(`
    SELECT c.id, c.organization_id, c.season_id, c.slug, c.name, c.type, c.logo_url
      FROM league_competitions c
      JOIN league_seasons s ON s.id = c.season_id
      JOIN league_organizations o ON o.id = c.organization_id
      LEFT JOIN league_competition_publication cp ON cp.competition_id = c.id
     WHERE c.id = ?
       AND ${SEASON_VISIBLE_SQL}
       AND ${ORGANIZATION_VISIBLE_SQL}
       AND ${COMPETITION_VISIBLE_SQL}
     LIMIT 1
  `).bind(competitionId, ...seasonBindings, ...organizationBindings).first<CompetitionRow>();
  return row ? {
    id: row.id,
    organizationId: row.organization_id,
    seasonId: row.season_id,
    slug: row.slug,
    name: row.name,
    type: row.type,
    logoUrl: row.logo_url,
  } : null;
}

export async function listMobileSeasons() {
  return listMobileSeasonsWithDb(await getCatalogueDb());
}

export async function listMobileOrganizations(seasonId: string) {
  return listMobileOrganizationsWithDb(await getCatalogueDb(), seasonId);
}

export async function listMobileCompetitions(seasonId: string, organizationId: string) {
  return listMobileCompetitionsWithDb(await getCatalogueDb(), seasonId, organizationId);
}
