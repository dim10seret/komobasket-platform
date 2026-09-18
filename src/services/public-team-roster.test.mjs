import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: vi.fn() }));
import { getPublicTeamRosterWithDb } from "./public-team-roster.service";

const scope = { organizationId: "org-a", seasonId: "season-a", competitionId: "competition-a", teamId: "team-a" };
let sqlite;
let calls;
let db;
beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE league_seasons (id TEXT PRIMARY KEY, starts_on TEXT, status TEXT);
    CREATE TABLE league_competitions (id TEXT PRIMARY KEY, season_id TEXT, organization_id TEXT, status TEXT);
    CREATE TABLE league_competition_publication (competition_id TEXT PRIMARY KEY, lifecycle_status TEXT);
    CREATE TABLE league_teams (id TEXT PRIMARY KEY, organization_id TEXT, logo_url TEXT);
    CREATE TABLE league_season_teams (id TEXT PRIMARY KEY, season_id TEXT, team_id TEXT, logo_url TEXT);
    CREATE TABLE league_competition_teams (id TEXT PRIMARY KEY, competition_id TEXT, season_team_id TEXT, status TEXT);
    CREATE TABLE league_players (id TEXT PRIMARY KEY, organization_id TEXT, first_name TEXT, last_name TEXT, display_name TEXT);
    CREATE TABLE league_roster_memberships (id TEXT PRIMARY KEY, season_id TEXT, competition_id TEXT, team_id TEXT, player_id TEXT, shirt_number INTEGER, status TEXT);
    INSERT INTO league_seasons VALUES ('season-a','2026-09-01','active'),('season-old','2026-01-01','completed');
    INSERT INTO league_competitions VALUES ('competition-a','season-a','org-a','active'),('competition-b','season-a','org-a','active'),('competition-old','season-old','org-a','completed');
    INSERT INTO league_teams VALUES ('team-a','org-a','/canonical.png'),('team-b','org-a',NULL),('foreign-team','org-b','/foreign.png');
    INSERT INTO league_season_teams VALUES ('st-a','season-a','team-a','/season-2026.png'),('st-old','season-old','team-a','/historical.png');
    INSERT INTO league_competition_teams VALUES ('ct-a','competition-a','st-a','active'),('ct-b','competition-b','st-a','active'),('ct-old','competition-old','st-old','active');
    INSERT INTO league_players VALUES ('p-a','org-a','ΔΗΜΗΤΡΙΟΣ','ΓΑΚΗΣ','OLD DISPLAY'),('p-b','org-a',NULL,NULL,'LEGACY NAME'),('foreign-player','org-b','FOREIGN','PLAYER','SECRET FOREIGN NAME');
    INSERT INTO league_roster_memberships VALUES ('r-a','season-a','competition-a','team-a','p-a',8,'active'),('r-b','season-a','competition-a','team-a','p-b',NULL,'active'),('r-old','season-old','competition-old','team-a','p-a',99,'active');
  `);
  calls = [];
  db = { prepare(sql) { let values = []; const statement = { bind(...input) { values = input; return statement; }, async all() { calls.push({ sql, values }); return { results: sqlite.prepare(sql).all(...values) }; } }; return statement; } };
});
afterEach(() => sqlite.close());

describe("isolated public Team roster and participation identity", () => {
  it("uses the canonical logo even when the selected season logo differs", async () => {
    expect((await getPublicTeamRosterWithDb(db, scope)).logoUrl).toBe("/canonical.png");
  });
  it.each([null, "", "   "])("ignores a seasonal logo of %s", async (logo) => {
    sqlite.prepare("UPDATE league_season_teams SET logo_url=? WHERE id='st-a'").run(logo);
    expect((await getPublicTeamRosterWithDb(db, scope)).logoUrl).toBe("/canonical.png");
  });
  it("leaves absent logos absent", async () => {
    sqlite.exec("UPDATE league_season_teams SET logo_url=NULL; UPDATE league_teams SET logo_url=NULL;");
    expect((await getPublicTeamRosterWithDb(db, scope)).logoUrl).toBeNull();
  });
  it.each([null, "", "   "])("does not fall back to a seasonal logo when canonical is %s", async (logo) => {
    sqlite.prepare("UPDATE league_teams SET logo_url=? WHERE id='team-a'").run(logo);
    expect((await getPublicTeamRosterWithDb(db, scope)).logoUrl).toBeNull();
  });
  it("reflects one canonical update across seasons and competitions without copying seasonal logos", async () => {
    sqlite.exec("UPDATE league_teams SET logo_url='/new-canonical.png' WHERE id='team-a'");
    for (const selected of [scope, { ...scope, competitionId: "competition-b" }, { ...scope, seasonId: "season-old", competitionId: "competition-old" }]) {
      expect((await getPublicTeamRosterWithDb(db, selected)).logoUrl).toBe("/new-canonical.png");
    }
    expect(sqlite.prepare("SELECT logo_url FROM league_season_teams ORDER BY id").all().map(row => row.logo_url)).toEqual(["/season-2026.png", "/historical.png"]);
  });
  it("returns an existing roster with no game/statistics/report tables at all", async () => {
    const roster = await getPublicTeamRosterWithDb(db, scope);
    expect(roster.players).toEqual([
      { id: "p-a", displayName: "ΔΗΜΗΤΡΙΟΣ ΓΑΚΗΣ", shirtNumber: 8 },
      { id: "p-b", displayName: "LEGACY NAME", shirtNumber: null },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0].sql).not.toMatch(/league_games|match_report|gameplay|statistics|game_events/i);
  });
  it("uses only the requested competition and its membership shirt number", async () => {
    sqlite.exec("INSERT INTO league_roster_memberships VALUES ('r-other','season-a','competition-b','team-a','p-a',19,'active')");
    expect((await getPublicTeamRosterWithDb(db, scope)).players[0].shirtNumber).toBe(8);
    expect((await getPublicTeamRosterWithDb(db, { ...scope, competitionId: "competition-b" })).players).toEqual([{ id: "p-a", displayName: "ΔΗΜΗΤΡΙΟΣ ΓΑΚΗΣ", shirtNumber: 19 }]);
  });
  it("keeps previous-season roster separate while sharing the current canonical logo", async () => {
    const previous = await getPublicTeamRosterWithDb(db, { ...scope, seasonId: "season-old", competitionId: "competition-old" });
    expect(previous.logoUrl).toBe("/canonical.png");
    expect(previous.players.map(p => p.shirtNumber)).toEqual([99]);
    expect((await getPublicTeamRosterWithDb(db, scope)).players.map(p => p.shirtNumber)).toEqual([8, null]);
  });
  it("keeps the existing roster ordering and preserves jersey zero", async () => {
    sqlite.exec("UPDATE league_roster_memberships SET shirt_number=0 WHERE id='r-b'");
    expect((await getPublicTeamRosterWithDb(db, scope)).players.map(p => p.shirtNumber)).toEqual([0, 8]);
  });
  it("excludes inactive memberships without hiding the team identity", async () => {
    sqlite.exec("UPDATE league_roster_memberships SET status='inactive'");
    expect(await getPublicTeamRosterWithDb(db, scope)).toEqual({ logoUrl: "/canonical.png", players: [] });
  });
  it("never projects a foreign player even through a malformed membership", async () => {
    sqlite.exec("INSERT INTO league_roster_memberships VALUES ('r-foreign','season-a','competition-a','team-a','foreign-player',1,'active')");
    const roster = await getPublicTeamRosterWithDb(db, scope);
    expect(roster.players).toHaveLength(2);
    expect(JSON.stringify(roster)).not.toContain("FOREIGN");
  });
  it.each([
    { organizationId: "org-b" }, { seasonId: "season-old" },
    { teamId: "team-b" }, { teamId: "foreign-team" }, { competitionId: "missing" },
  ])("fails closed for a mismatched scope %s", async (override) => {
    expect(await getPublicTeamRosterWithDb(db, { ...scope, ...override })).toBeNull();
  });
  it("requires the participation season to match the competition", async () => {
    sqlite.exec("UPDATE league_season_teams SET season_id='season-old' WHERE id='st-a'");
    expect(await getPublicTeamRosterWithDb(db, scope)).toBeNull();
  });
  it("does not expose inactive participation", async () => {
    sqlite.exec("UPDATE league_competition_teams SET status='inactive' WHERE id='ct-a'");
    expect(await getPublicTeamRosterWithDb(db, scope)).toBeNull();
  });
  it("respects public competition visibility", async () => {
    sqlite.exec("INSERT INTO league_competition_publication VALUES ('competition-a','under_construction')");
    expect(await getPublicTeamRosterWithDb(db, scope)).toBeNull();
  });
  it("uses display_name if either structured name is unexpectedly missing", async () => {
    sqlite.exec("UPDATE league_players SET last_name=NULL WHERE id='p-a'");
    expect((await getPublicTeamRosterWithDb(db, scope)).players[0].displayName).toBe("OLD DISPLAY");
  });
});
