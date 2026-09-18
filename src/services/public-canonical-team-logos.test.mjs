import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: vi.fn() }));
vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));

import { teams } from "@/data/teams";
import { getPublicHistoricalTeamLogosWithDb } from "./public-historical-team-logos.service";
import { CanonicalTeamLogoProvider } from "@/components/teams/CanonicalTeamLogoContext";
import TeamsGrid from "@/components/teams/TeamsGrid";
import TeamHero from "@/components/team/TeamHero";

const source = relative => readFileSync(new URL(relative, import.meta.url), "utf8");
const historical = teams.filter(team => {
  const slug = team.slug.startsWith(`${team.season}-`) ? team.slug.slice(team.season.length + 1) : team.slug;
  return slug === "sidream-team";
});
let sqlite, db;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE league_teams (id TEXT PRIMARY KEY, organization_id TEXT, logo_url TEXT); INSERT INTO league_teams VALUES ('team_sidream-team','organization_komobasket','/new-canonical.png')");
  db = { prepare(sql) { let values = []; const statement = { bind(...input) { values = input; return statement; }, async all() { return { results: sqlite.prepare(sql).all(...values) }; } }; return statement; } };
});
afterEach(() => sqlite.close());

describe("canonical Team logo rendering across public seasons", () => {
  it("uses one canonical logo for every archived SIDREAM season and reflects subsequent changes", async () => {
    expect(historical.length).toBeGreaterThan(1);
    for (const logo of ["/new-canonical.png", "/changed-canonical.png"]) {
      sqlite.prepare("UPDATE league_teams SET logo_url=?").run(logo);
      const logos = await getPublicHistoricalTeamLogosWithDb(db);
      for (const team of historical) expect(logos[team.slug]).toBe(logo);
    }
  });
  it.each([null, "", "   "])("never falls back to static seasonal artwork for canonical %s", async logo => {
    sqlite.prepare("UPDATE league_teams SET logo_url=?").run(logo);
    const logos = await getPublicHistoricalTeamLogosWithDb(db);
    for (const team of historical) expect(logos[team.slug]).toBeNull();
    const html = renderToStaticMarkup(React.createElement(CanonicalTeamLogoProvider, { logos }, React.createElement(TeamsGrid)));
    expect(html).not.toContain("<img");
    expect(html).not.toContain('src=""');
  });
  it("does not use another Organization's canonical logo", async () => {
    sqlite.exec("UPDATE league_teams SET organization_id='foreign-org'");
    const logos = await getPublicHistoricalTeamLogosWithDb(db);
    for (const team of historical) expect(logos[team.slug]).toBeNull();
  });
  it("renders the canonical image in the historical grid without changing Team identity", async () => {
    const logos = await getPublicHistoricalTeamLogosWithDb(db);
    const team = historical[0];
    const html = renderToStaticMarkup(React.createElement(CanonicalTeamLogoProvider, { logos }, React.createElement(TeamsGrid, { archiveSeason: team.season })));
    expect(html).toContain(encodeURIComponent("/new-canonical.png"));
    expect(html).toContain(team.name);
    expect(html).toContain(`/teams/${team.slug}`);
  });
  it("renders the existing Team hero safely with no canonical image", () => {
    const html = renderToStaticMarkup(React.createElement(TeamHero, { team: "Team", season: "2026-27", playerCount: 0, logo: "" }));
    expect(html).not.toContain("<img");
    expect(html).toContain("Team");
  });
  it("has no seasonal precedence in shared public/hosted, roster or Platform game projections", () => {
    for (const file of ["./public-competition.service.ts", "./public-team-roster.service.ts", "./komocontrol-admin.service.ts"]) {
      const sql = source(file);
      expect(sql).not.toMatch(/\b(?:st|home_st|away_st)\.logo_url/);
      expect(sql).toMatch(/NULLIF\(TRIM\((?:t|home)\.logo_url\), ''\)/);
    }
  });
  it("wires the same organization-scoped competition projection into central and hosted Team views", () => {
    const page = source("../components/competition/PublicCompetitionsView.tsx");
    expect(page).toContain("getPublicCompetitionContextForOrganization(organizationId");
    expect(page).toContain("rosterScope={{ organizationId");
  });
  it("does not copy canonical logos when adding season participations", () => {
    const service = source("./league-admin.service.ts");
    expect(service).toContain("(id,season_id,team_id,display_name) VALUES (?,?,?,?)");
    expect(service).not.toContain("input.logoUrl || team.logo_url");
    expect(service).toContain("st.display_name, NULLIF(TRIM(t.logo_url), '') AS logo_url");
  });
});
