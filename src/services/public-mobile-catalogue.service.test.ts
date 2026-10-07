import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

vi.mock("server-only", () => ({}));

import {
  listMobileCompetitionsWithDb,
  listMobileOrganizationsWithDb,
  listMobileSeasonsWithDb,
} from "./public-mobile-catalogue.service";

describe("public mobile catalogue D1 projection", () => {
  let sqlite: DatabaseSync;
  let db: D1DatabaseBinding;
  let queryCount: number;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE league_organizations (
        id TEXT PRIMARY KEY, slug TEXT, name TEXT, logo_url TEXT,
        status TEXT, publication_status TEXT
      );
      CREATE TABLE league_seasons (
        id TEXT PRIMARY KEY, name TEXT, slug TEXT, starts_on TEXT, ends_on TEXT, status TEXT
      );
      CREATE TABLE league_competitions (
        id TEXT PRIMARY KEY, organization_id TEXT, season_id TEXT,
        slug TEXT, name TEXT, type TEXT, logo_url TEXT, status TEXT
      );
      CREATE TABLE league_competition_publication (competition_id TEXT PRIMARY KEY, lifecycle_status TEXT);

      INSERT INTO league_organizations VALUES
        ('organization_komobasket', 'komobasket', 'Central', '/central.png', 'active', 'unpublished'),
        ('org-hosted', 'hosted', 'Hosted', '/hosted.png', 'active', 'published'),
        ('org-hidden', 'hidden', 'Hidden', NULL, 'active', 'unpublished'),
        ('org-suspended', 'suspended', 'Suspended', NULL, 'suspended', 'published'),
        ('org-reserved', 'admin', 'Reserved', NULL, 'active', 'published'),
        ('org-bad-slug', 'Bad Slug', 'Bad Slug', NULL, 'active', 'published');

      INSERT INTO league_seasons VALUES
        ('season-old', '2025-26', '2025-26', '2025-09-01', '2026-06-01', 'completed'),
        ('season-boundary', 'Opening Season', 'opening-season', '2026-01-01', NULL, 'active'),
        ('season-current', '2026-27', '2026-27', '2026-09-01', '2027-06-01', 'active'),
        ('season-next', 'Season 2027–28', '2027-28', '2027-09-01', NULL, 'active'),
        ('season-private', '2028-29', '2028-29', '2028-09-01', NULL, 'active'),
        ('season-draft', '2029-30', '2029-30', '2029-09-01', NULL, 'draft');

      INSERT INTO league_competitions VALUES
        ('competition-old', 'organization_komobasket', 'season-old', 'old', 'Old', 'league', NULL, 'active'),
        ('competition-boundary', 'organization_komobasket', 'season-boundary', 'boundary', 'Boundary League', 'league', NULL, 'active'),
        ('competition-central', 'organization_komobasket', 'season-current', 'central', 'Central League', 'league', '/central-league.png', 'active'),
        ('competition-hosted', 'org-hosted', 'season-current', 'hosted', 'Hosted Cup', 'cup', NULL, 'active'),
        ('competition-hidden', 'org-hidden', 'season-current', 'hidden', 'Hidden League', 'league', NULL, 'active'),
        ('competition-suspended', 'org-suspended', 'season-current', 'suspended', 'Suspended League', 'league', NULL, 'active'),
        ('competition-reserved', 'org-reserved', 'season-current', 'reserved', 'Reserved League', 'league', NULL, 'active'),
        ('competition-bad-slug', 'org-bad-slug', 'season-current', 'bad', 'Bad League', 'league', NULL, 'active'),
        ('competition-draft', 'org-hosted', 'season-current', 'draft', 'Draft Cup', 'cup', NULL, 'draft'),
        ('competition-offline', 'org-hosted', 'season-current', 'offline', 'Offline Cup', 'cup', NULL, 'active'),
        ('competition-next', 'org-hosted', 'season-next', 'next', 'Next League', 'league', NULL, 'completed'),
        ('competition-private', 'org-hidden', 'season-private', 'private', 'Private League', 'league', NULL, 'active'),
        ('competition-draft-season', 'organization_komobasket', 'season-draft', 'draft-season', 'Draft Season League', 'league', NULL, 'active');

      INSERT INTO league_competition_publication VALUES
        ('competition-offline', 'under_construction');
    `);

    queryCount = 0;
    const statement = (sql: string, values: unknown[] = []): D1PreparedStatement => ({
      bind: (...bindings: unknown[]) => statement(sql, bindings),
      all: async <T,>() => {
        queryCount += 1;
        return { success: true, results: sqlite.prepare(sql).all(...values) as T[] };
      },
      first: async () => { throw new Error("Unexpected D1 first query"); },
      run: async () => { throw new Error("Catalogue must never write to D1"); },
    });
    db = {
      prepare: statement,
      batch: async () => { throw new Error("Catalogue must never batch D1 writes"); },
    };
  });

  afterEach(() => sqlite.close());

  it("returns only seasons with a visible competition at or after the mobile launch season", async () => {
    expect(await listMobileSeasonsWithDb(db)).toEqual([
      { id: "season-next", name: "Season 2027–28", slug: "2027-28", startDate: "2027-09-01", endDate: null },
      { id: "season-current", name: "2026-27", slug: "2026-27", startDate: "2026-09-01", endDate: "2027-06-01" },
      { id: "season-boundary", name: "Opening Season", slug: "opening-season", startDate: "2026-01-01", endDate: null },
    ]);
    expect(queryCount).toBe(1);
  });

  it("keeps catalogue eligibility unchanged when only a season display name changes", async () => {
    const seasonIds = (await listMobileSeasonsWithDb(db)).map((season) => season.id);
    const organizations = await listMobileOrganizationsWithDb(db, "season-current");
    const competitions = await listMobileCompetitionsWithDb(db, "season-current", "org-hosted");

    sqlite.prepare("UPDATE league_seasons SET name = ? WHERE id = ?").run("Autumn Basketball", "season-current");

    expect((await listMobileSeasonsWithDb(db)).map((season) => season.id)).toEqual(seasonIds);
    expect(await listMobileOrganizationsWithDb(db, "season-current")).toEqual(organizations);
    expect(await listMobileCompetitionsWithDb(db, "season-current", "org-hosted")).toEqual(competitions);
  });

  it("keeps a future free-form named season available through all three catalogue queries", async () => {
    expect((await listMobileSeasonsWithDb(db)).some((season) => season.id === "season-next")).toBe(true);
    expect(await listMobileOrganizationsWithDb(db, "season-next")).toEqual([
      { id: "org-hosted", slug: "hosted", name: "Hosted", logoUrl: "/hosted.png" },
    ]);
    expect(await listMobileCompetitionsWithDb(db, "season-next", "org-hosted")).toEqual([
      {
        id: "competition-next", organizationId: "org-hosted", seasonId: "season-next",
        slug: "next", name: "Next League", type: "league", logoUrl: null,
      },
    ]);
  });

  it("includes central and published hosted organizations, without indirect private exposure", async () => {
    expect(await listMobileOrganizationsWithDb(db, "season-current")).toEqual([
      { id: "organization_komobasket", slug: "komobasket", name: "Central", logoUrl: "/central.png" },
      { id: "org-hosted", slug: "hosted", name: "Hosted", logoUrl: "/hosted.png" },
    ]);
    expect(queryCount).toBe(1);
    expect(await listMobileOrganizationsWithDb(db, "season-private")).toBeNull();
    expect(await listMobileOrganizationsWithDb(db, "season-old")).toBeNull();
    expect(await listMobileOrganizationsWithDb(db, "missing")).toBeNull();
  });

  it("binds both IDs and returns only published competitions in their selected context", async () => {
    expect(await listMobileCompetitionsWithDb(db, "season-current", "org-hosted")).toEqual([
      {
        id: "competition-hosted", organizationId: "org-hosted", seasonId: "season-current",
        slug: "hosted", name: "Hosted Cup", type: "cup", logoUrl: null,
      },
    ]);
    expect(queryCount).toBe(1);
    expect(await listMobileCompetitionsWithDb(db, "season-current", "organization_komobasket")).toEqual([
      {
        id: "competition-central", organizationId: "organization_komobasket", seasonId: "season-current",
        slug: "central", name: "Central League", type: "league", logoUrl: "/central-league.png",
      },
    ]);
    expect(await listMobileCompetitionsWithDb(db, "season-next", "organization_komobasket")).toBeNull();
    expect(await listMobileCompetitionsWithDb(db, "season-current", "org-hidden")).toBeNull();
    expect(await listMobileCompetitionsWithDb(db, "season-old", "organization_komobasket")).toBeNull();
    expect(await listMobileCompetitionsWithDb(db, "missing", "org-hosted")).toBeNull();
  });
});
