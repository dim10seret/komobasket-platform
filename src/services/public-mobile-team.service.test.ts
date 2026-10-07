import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: vi.fn() }));
vi.mock("./public-live-game-core", () => ({ projectPublicLiveGame: vi.fn() }));
vi.mock("./public-mobile-competition.service", () => ({
  readCompetitionDetailWithDb: vi.fn(), readStandingsWithDb: vi.fn(),
}));

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { projectPublicLiveGame } from "./public-live-game-core";
import { readCompetitionDetailWithDb, readStandingsWithDb } from "./public-mobile-competition.service";
import { listMobileTeamsWithDb, readMobileTeamWithDb, readMobileTeamStatisticsWithDb } from "./public-mobile-team.service";
import { readMobilePlayerWithDb } from "./public-mobile-player.service";
import { GET as listRoute } from "@/app/api/public/v1/competitions/[competitionId]/teams/route";
import { GET as detailRoute } from "@/app/api/public/v1/competitions/[competitionId]/teams/[teamId]/route";
import { GET as statisticsRoute } from "@/app/api/public/v1/competitions/[competitionId]/teams/[teamId]/statistics/route";

type Stats = Partial<{ points: number; twoPointMade: number; twoPointAttempts: number;
  threePointMade: number; threePointAttempts: number; freeThrowMade: number; freeThrowAttempts: number;
  offensiveRebounds: number; defensiveRebounds: number; assists: number; steals: number;
  blocks: number; turnovers: number }>;
type Player = { id: string; stats?: Stats; fouls?: number };
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const teamStatistics = { twoPointMade: 0, twoPointAttempts: 0, threePointMade: 0, threePointAttempts: 0,
  freeThrowMade: 0, freeThrowAttempts: 0, offensiveRebounds: 0, defensiveRebounds: 0, assists: 0,
  steals: 0, blocks: 0, turnovers: 0, personalFouls: 0, technicalFouls: 0, disruptiveFouls: 0,
  flagrantFouls: 0, disqualifyingFouls: 0 };
const request = (suffix: string) => new Request(`https://example.test/api/public/v1/competitions/${suffix}`);
const teamContext = (competitionId = "central", teamId = "a") =>
  ({ params: Promise.resolve({ competitionId, teamId }) });

describe("Phase B2 public mobile teams", () => {
  let sqlite: DatabaseSync;
  let db: D1DatabaseBinding;
  let queryCount: number;
  let eventRows: number;
  let selectedGameRows: number;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE league_organizations (id TEXT PRIMARY KEY, slug TEXT, status TEXT, publication_status TEXT);
      CREATE TABLE league_seasons (id TEXT PRIMARY KEY, name TEXT, starts_on TEXT, status TEXT);
      CREATE TABLE league_competitions (id TEXT PRIMARY KEY, organization_id TEXT, season_id TEXT, slug TEXT,
        name TEXT, type TEXT, logo_url TEXT, status TEXT);
      CREATE TABLE league_competition_publication (competition_id TEXT PRIMARY KEY, lifecycle_status TEXT);
      CREATE TABLE league_phases (id TEXT PRIMARY KEY, competition_id TEXT, lifecycle_status TEXT, name TEXT,
        phase_order INTEGER, order_index INTEGER);
      CREATE TABLE league_teams (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, logo_url TEXT);
      CREATE TABLE league_season_teams (id TEXT PRIMARY KEY, season_id TEXT, team_id TEXT, display_name TEXT);
      CREATE TABLE league_competition_teams (id TEXT PRIMARY KEY, competition_id TEXT, season_team_id TEXT, status TEXT);
      CREATE TABLE league_players (id TEXT PRIMARY KEY, organization_id TEXT, display_name TEXT, photo_url TEXT,
        private_note TEXT);
      CREATE TABLE league_roster_memberships (id TEXT PRIMARY KEY, season_id TEXT, competition_id TEXT,
        player_id TEXT, team_id TEXT, status TEXT, joined_on TEXT, updated_at TEXT, shirt_number INTEGER,
        private_note TEXT);
      CREATE TABLE league_games (id TEXT PRIMARY KEY, competition_id TEXT, phase_id TEXT, status TEXT,
        result_source TEXT, home_score INTEGER, away_score INTEGER, round_label TEXT, scheduled_date TEXT,
        scheduled_time TEXT, venue TEXT, home_team_id TEXT, away_team_id TEXT,
        series_round_number INTEGER, round_number INTEGER, game_order INTEGER);
      CREATE TABLE league_komocontrol_gameplay_game_claims (game_id TEXT PRIMARY KEY, run_id TEXT);
      CREATE TABLE league_komocontrol_gameplay_heads (run_id TEXT PRIMARY KEY, lifecycle TEXT,
        event_history_revision INTEGER, last_accepted_sequence INTEGER, history_hash TEXT,
        finalization_hash TEXT, official_result_applied_at TEXT, updated_at TEXT);
      CREATE TABLE league_komocontrol_match_engine_snapshots_v1 (run_id TEXT PRIMARY KEY,
        initial_state_json TEXT, initial_state_hash TEXT);
      CREATE TABLE league_komocontrol_current_game_configurations_v1 (run_id TEXT PRIMARY KEY, configuration_json TEXT);
      CREATE TABLE league_komocontrol_match_finalizations_v1 (run_id TEXT PRIMARY KEY,
        finalized_history_revision INTEGER, finalized_history_hash TEXT, final_state_json TEXT,
        final_state_hash TEXT, finalization_json TEXT, finalization_hash TEXT);
      CREATE TABLE league_komocontrol_match_events_v2 (run_id TEXT, event_id TEXT, sequence INTEGER,
        event_schema_version INTEGER, event_json TEXT, event_hash TEXT);
      INSERT INTO league_organizations VALUES
        ('organization_komobasket','komobasket','active','unpublished'),
        ('hidden-org','hidden','active','unpublished');
      INSERT INTO league_seasons VALUES
        ('season-new','Season 2027–28','2027-09-01','active'),
        ('season-old','2025–26','2025-09-01','completed');
      INSERT INTO league_competitions VALUES
        ('central','organization_komobasket','season-new','central','Central League','league',NULL,'active'),
        ('other-public','organization_komobasket','season-new','other-public','Other League','league',NULL,'active'),
        ('hidden','hidden-org','season-new','hidden','Hidden League','league',NULL,'active'),
        ('old','organization_komobasket','season-old','old','Old League','league',NULL,'active');
      INSERT INTO league_competition_publication VALUES
        ('central','online'),('other-public','online'),('hidden','online'),('old','online');
      INSERT INTO league_phases (id,competition_id,lifecycle_status,name) VALUES
        ('regular','central','active','Regular'),('series','central','finalized','Series'),
        ('draft','central','draft','Draft'),('foreign','hidden','active','Foreign');
      INSERT INTO league_teams VALUES
        ('a','organization_komobasket','Alpha','/a.png'),
        ('b','organization_komobasket','Beta','/b.png'),
        ('unrelated','organization_komobasket','Unrelated',NULL),
        ('other-org','hidden-org','Other Org',NULL);
      INSERT INTO league_season_teams VALUES
        ('sa','season-new','a',NULL),('sb','season-new','b','Beta 2027'),
        ('su','season-new','unrelated',NULL),('so','season-new','other-org',NULL),
        ('sa-old','season-old','a',NULL);
      INSERT INTO league_competition_teams VALUES
        ('ca','central','sa','active'),('cb','central','sb','active'),
        ('cu','other-public','su','active'),('co','central','so','active'),
        ('cold','central','sa-old','active');
    `);
    queryCount = 0;
    eventRows = 0;
    selectedGameRows = 0;
    const statement = (sql: string, values: unknown[] = []): D1PreparedStatement => ({
      bind: (...bindings: unknown[]) => statement(sql, bindings),
      all: async <T,>() => {
        queryCount++;
        const rows = sqlite.prepare(sql).all(...values) as T[];
        if (sql.includes("FROM league_komocontrol_match_events_v2 event")) eventRows += rows.length;
        if (sql.includes("FROM league_games g\n      JOIN league_competitions")) selectedGameRows += rows.length;
        return { success: true, results: rows };
      },
      first: async <T,>() => { queryCount++; return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null; },
      run: async () => { throw new Error("B2 must not write to D1"); },
    });
    db = { prepare: statement, batch: async () => { throw new Error("B2 must not batch writes"); } };
    vi.mocked(getKomoBasketCloudflareEnv).mockResolvedValue({ NEWS_DB: db } as never);
    vi.mocked(readCompetitionDetailWithDb).mockResolvedValue({
      currentPhaseId: "regular", phases: [{ id: "regular", availableViews: ["standings"] }],
    } as never);
    vi.mocked(readStandingsWithDb).mockResolvedValue([
      { teamId: "a", rank: 1, gamesPlayed: 2, wins: 2, losses: 0 },
      { teamId: "b", rank: 2, gamesPlayed: 2, wins: 0, losses: 2 },
    ] as never);
  });

  afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

  function addMembership(id: string, playerId: string, teamId: string, status = "active",
    joined = "2027-09-01", season = "season-new", competition = "central") {
    sqlite.prepare("INSERT INTO league_roster_memberships VALUES (?,?,?,?,?,?,?,?,?,?)")
      .run(id, season, competition, playerId, teamId, status, joined, joined, 7, "secret movement note");
  }

  function addPlayer(id: string, name = id, organization = "organization_komobasket") {
    sqlite.prepare("INSERT INTO league_players VALUES (?,?,?,?,?)")
      .run(id, organization, name, `/${id}.png`, "secret player note");
  }

  function runPlayer(player: Player, team: "HOME" | "AWAY") {
    return { playerId: player.id, displayName: player.id, shirtNumber: "7", onCourt: true, team,
      foulState: { total: player.fouls ?? 0, status: "ELIGIBLE" },
      statistics: { points: 0, twoPointMade: 0, twoPointAttempts: 0, threePointMade: 0,
        threePointAttempts: 0, freeThrowMade: 0, freeThrowAttempts: 0, offensiveRebounds: 0,
        defensiveRebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, ...player.stats } };
  }

  function runTeamStatistics(players: Player[], extras: { technicalFouls?: number; offensiveRebounds?: number } = {}) {
    const sum = (key: keyof Stats) => players.reduce((total, player) => total + (player.stats?.[key] ?? 0), 0);
    return { ...teamStatistics,
      twoPointMade: sum("twoPointMade"), twoPointAttempts: sum("twoPointAttempts"),
      threePointMade: sum("threePointMade"), threePointAttempts: sum("threePointAttempts"),
      freeThrowMade: sum("freeThrowMade"), freeThrowAttempts: sum("freeThrowAttempts"),
      offensiveRebounds: sum("offensiveRebounds") + (extras.offensiveRebounds ?? 0),
      defensiveRebounds: sum("defensiveRebounds"), assists: sum("assists"), steals: sum("steals"),
      blocks: sum("blocks"), turnovers: sum("turnovers"),
      personalFouls: players.reduce((total, player) => total + (player.fouls ?? 0), 0),
      technicalFouls: extras.technicalFouls ?? 0,
    };
  }

  function addGame(id: string, phaseId: string, home: Player[], away: Player[] = [], options: {
    status?: string; source?: string; lifecycle?: string; homeTeamId?: string; awayTeamId?: string;
    homeTeamExtras?: { technicalFouls?: number; offensiveRebounds?: number };
  } = {}) {
    const run = `run-${id}`;
    const source = options.source ?? "match_report";
    sqlite.prepare("INSERT INTO league_games (id,competition_id,phase_id,status,result_source,home_score,away_score,round_label,scheduled_date,scheduled_time,venue,home_team_id,away_team_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, "central", phaseId, options.status ?? "completed", source, 10, 5,
        "Round 1", "2027-10-01", "18:00", "Arena", options.homeTeamId ?? "a", options.awayTeamId ?? "b");
    if (source === "manual") return;
    const events = [{ type: "MATCH_START" }, { type: "MATCH_END" }].map((event, index) =>
      ({ ...event, schemaVersion: 2, id: `event-${id}-${index + 1}`, sequence: index + 1,
        occurredAt: Date.parse("2027-10-01") + index * 1000 }));
    const state = (finished: boolean) => JSON.stringify({ id: run, finished,
      lastProcessedSequence: finished ? events.length : 0,
      home: { score: 10, players: home.map((player) => runPlayer(player, "HOME")),
        statistics: runTeamStatistics(home, options.homeTeamExtras) },
      away: { score: 5, players: away.map((player) => runPlayer(player, "AWAY")),
        statistics: runTeamStatistics(away) } });
    const initialStateJson = state(false);
    const finalStateJson = state(true);
    const eventJson = events.map((event) => JSON.stringify(event));
    const historyHash = sha(`[${eventJson.join(",")}]`);
    const finalStateHash = sha(finalStateJson);
    const finalizationJson = JSON.stringify({ runId: run, finalizedHistoryRevision: 1,
      finalizedHistoryHash: historyHash, finalStateHash, incidentReport: null });
    const finalizationHash = sha(finalizationJson);
    sqlite.prepare("INSERT INTO league_komocontrol_gameplay_game_claims VALUES (?,?)").run(id, run);
    sqlite.prepare("INSERT INTO league_komocontrol_gameplay_heads VALUES (?,?,?,?,?,?,?,?)")
      .run(run, options.lifecycle ?? "finalized", 1, events.length, historyHash, finalizationHash,
        "2027-10-01T00:00:00Z", "2027-10-01T00:00:00Z");
    sqlite.prepare("INSERT INTO league_komocontrol_match_engine_snapshots_v1 VALUES (?,?,?)")
      .run(run, initialStateJson, sha(initialStateJson));
    sqlite.prepare("INSERT INTO league_komocontrol_current_game_configurations_v1 VALUES (?,?)").run(run, "{}");
    sqlite.prepare("INSERT INTO league_komocontrol_match_finalizations_v1 VALUES (?,?,?,?,?,?,?)")
      .run(run, 1, historyHash, finalStateJson, finalStateHash, finalizationJson, finalizationHash);
    const insert = sqlite.prepare("INSERT INTO league_komocontrol_match_events_v2 VALUES (?,?,?,?,?,?)");
    events.forEach((event, index) => insert.run(run, event.id, event.sequence, 2, eventJson[index], sha(eventJson[index])));
  }

  it("lists only canonical public competition teams with a bounded, safe DTO", async () => {
    expect(await listMobileTeamsWithDb(db, "central")).toEqual([
      { id: "a", name: "Alpha", logoUrl: "/a.png" },
      { id: "b", name: "Beta 2027", logoUrl: "/b.png" },
    ]);
    expect(queryCount).toBe(2);
    await expect(listMobileTeamsWithDb(db, "hidden")).rejects.toMatchObject({ code: "COMPETITION_NOT_FOUND" });
    await expect(listMobileTeamsWithDb(db, "old")).rejects.toMatchObject({ code: "COMPETITION_NOT_FOUND" });
    expect((await listRoute(request("central/teams"), { params: Promise.resolve({ competitionId: "central" }) })).headers
      .get("cache-control")).toBe("public, max-age=120, s-maxage=600");
  });

  it("reads the latest active current roster and hides private data and movement history", async () => {
    for (const id of ["transfer", "same-name-1", "same-name-2", "departed", "old-season", "other-comp", "foreign"]) {
      addPlayer(id, id.startsWith("same") ? "Same Name" : id,
        id === "foreign" ? "hidden-org" : "organization_komobasket");
    }
    addMembership("old", "transfer", "a", "transferred", "2027-09-01");
    addMembership("new", "transfer", "b", "active", "2027-09-02");
    addMembership("one", "same-name-1", "a");
    addMembership("two", "same-name-2", "a");
    addMembership("departed", "departed", "a", "departed");
    addMembership("old-season", "old-season", "a", "active", "2025-09-01", "season-old");
    addMembership("other-comp", "other-comp", "a", "active", "2027-09-01", "hidden");
    addMembership("foreign", "foreign", "a");
    const alpha = await readMobileTeamWithDb(db, "central", "a");
    expect(alpha).toMatchObject({ id: "a", organizationId: "organization_komobasket",
      competitionId: "central", seasonId: "season-new",
      overview: { currentPhaseId: "regular", standings: { phaseId: "regular", rank: 1, gamesPlayed: 2,
        wins: 2, losses: 0 } } });
    expect(alpha.roster.map((player) => player.playerId).sort()).toEqual(["same-name-1", "same-name-2"]);
    expect(alpha.roster[0]).toMatchObject({ playerName: "Same Name", photoUrl: "/same-name-1.png", jerseyNumber: "7" });
    expect(JSON.stringify(alpha)).not.toMatch(/secret|transferred|departed|membership/);
    expect(queryCount).toBe(3);
    const beta = await readMobileTeamWithDb(db, "central", "b");
    expect(beta.roster).toEqual([{ playerId: "transfer", playerName: "transfer",
      photoUrl: "/transfer.png", jerseyNumber: "7" }]);
    await expect(readMobileTeamWithDb(db, "central", "unrelated")).rejects.toMatchObject({ code: "TEAM_NOT_FOUND" });
    await expect(readMobileTeamWithDb(db, "other-public", "a")).rejects.toMatchObject({ code: "TEAM_NOT_FOUND" });
    await expect(readMobileTeamWithDb(db, "central", "other-org")).rejects.toMatchObject({ code: "TEAM_NOT_FOUND" });
    await expect(readMobileTeamWithDb(db, "hidden", "a")).rejects.toMatchObject({ code: "COMPETITION_NOT_FOUND" });
  });

  it("keeps overview nullable outside standings and follows A3's selected phase", async () => {
    vi.mocked(readCompetitionDetailWithDb).mockResolvedValue({ currentPhaseId: "series",
      phases: [{ id: "regular", availableViews: ["standings"] },
        { id: "series", availableViews: ["schedule", "results"] }] } as never);
    const detail = await readMobileTeamWithDb(db, "central", "a");
    expect(detail.roster).toEqual([]);
    expect(detail.overview).toEqual({ currentPhaseId: "series", standings: null });
    expect(readStandingsWithDb).not.toHaveBeenCalled();
    expect(queryCount).toBe(3);
    const response = await detailRoute(request("central/teams/a"), teamContext());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
  });

  it("scopes only Team Detail standings overview while preserving identity and roster", async () => {
    addPlayer("player-a");
    addMembership("membership-a", "player-a", "a");
    vi.mocked(readCompetitionDetailWithDb).mockResolvedValue({
      currentPhaseId: "regular",
      phases: [{ id: "regular", availableViews: ["standings"] }, { id: "series", availableViews: ["schedule", "results"] }],
      tournamentGroups: [
        { id: "regular", name: "League", phaseIds: ["regular"], currentPhaseId: "regular" },
        { id: "series", name: "Cup", phaseIds: ["series"], currentPhaseId: "series" },
      ],
    } as never);
    const baseline = await readMobileTeamWithDb(db, "central", "a");
    const league = await readMobileTeamWithDb(db, "central", "a", "regular");
    const cup = await readMobileTeamWithDb(db, "central", "a", "series");
    expect(league).toEqual(baseline);
    expect(cup.id).toBe(baseline.id);
    expect(cup.roster).toEqual(baseline.roster);
    expect(cup.overview).toEqual({ currentPhaseId: "series", standings: null });
    const response = await detailRoute(request("central/teams/a?rootPhaseId=series"), teamContext());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
    expect((await response.json()).data.overview.standings).toBeNull();
    for (const root of ["missing", "foreign"]) {
      const missing = await detailRoute(request(`central/teams/a?rootPhaseId=${root}`), teamContext());
      expect(missing.status).toBe(404);
      expect(missing.headers.get("cache-control")).toBe("no-store");
      expect((await missing.json()).error.code).toBe("TOURNAMENT_NOT_FOUND");
    }
    const duplicate = await detailRoute(request("central/teams/a?rootPhaseId=regular&rootPhaseId=series"), teamContext());
    expect(duplicate.status).toBe(400);
  });

  it("validates phase ownership and team context before reading statistical history", async () => {
    for (const phaseIds of [["foreign"], ["draft"], ["missing"]]) {
      await expect(readMobileTeamStatisticsWithDb(db, "central", "a", phaseIds))
        .rejects.toMatchObject({ code: "PHASE_NOT_FOUND" });
    }
    await expect(readMobileTeamStatisticsWithDb(db, "central", "unrelated", ["regular"]))
      .rejects.toMatchObject({ code: "TEAM_NOT_FOUND" });
    await expect(readMobileTeamStatisticsWithDb(db, "other-public", "a", ["regular"]))
      .rejects.toMatchObject({ code: "TEAM_NOT_FOUND" });
    await expect(readMobileTeamStatisticsWithDb(db, "hidden", "a", ["foreign"]))
      .rejects.toMatchObject({ code: "COMPETITION_NOT_FOUND" });
    expect(eventRows).toBe(0);
    expect(selectedGameRows).toBe(0);
  });

  it("aggregates one or many phases once from verified finalized games, excluding manual/live results", async () => {
    const stats = { points: 8, twoPointMade: 2, twoPointAttempts: 3, threePointMade: 1,
      threePointAttempts: 2, freeThrowMade: 1, freeThrowAttempts: 2, offensiveRebounds: 2,
      defensiveRebounds: 3, assists: 4, steals: 1, blocks: 1, turnovers: 1 };
    addGame("g1", "regular", [{ id: "transfer", stats, fouls: 2 }]);
    addGame("g2", "series", [{ id: "transfer", stats, fouls: 2 }]);
    addGame("manual", "regular", [{ id: "manual", stats }], [], { source: "manual" });
    addGame("live", "regular", [{ id: "live", stats }], [], { lifecycle: "live" });
    const one = await readMobileTeamStatisticsWithDb(db, "central", "a", ["regular"]);
    expect(one).toMatchObject({ phaseIds: ["regular"], gamesPlayed: 1,
      totals: { pointsScored: 10, pointsAllowed: 5, twoPointMade: 2, rebounds: 5, fouls: 2 } });
    const before = queryCount;
    const all = await readMobileTeamStatisticsWithDb(db, "central", "a", ["series", "regular", "series"]);
    expect(queryCount - before).toBe(5);
    expect(all.phaseIds).toEqual(["regular", "series"]);
    expect(all.gamesPlayed).toBe(2);
    expect(all.totals).toMatchObject({ pointsScored: 20, pointsAllowed: 10,
      twoPointMade: 4, twoPointAttempts: 6, threePointMade: 2, threePointAttempts: 4,
      freeThrowMade: 2, freeThrowAttempts: 4, offensiveRebounds: 4,
      defensiveRebounds: 6, rebounds: 10, assists: 8, steals: 2, blocks: 2,
      turnovers: 2, fouls: 4 });
    expect(all.perGame).toMatchObject({ pointsScored: 10, pointsAllowed: 5, rebounds: 5, fouls: 2 });
    expect(all.shooting).toEqual({ twoPoint: { made: 4, attempted: 6, percentage: 4 / 6 * 100 },
      threePoint: { made: 2, attempted: 4, percentage: 50 },
      freeThrow: { made: 2, attempted: 4, percentage: 50 } });
    expect(eventRows).toBe(6);
    expect(projectPublicLiveGame).not.toHaveBeenCalled();
  });

  it("counts a transferred player's lines for the team they represented in each game", async () => {
    addGame("before-transfer", "regular", [{ id: "transfer", stats: { points: 8 } }]);
    addGame("after-transfer", "series", [{ id: "other" }],
      [{ id: "transfer", stats: { points: 12 } }], { homeTeamId: "b", awayTeamId: "a" });
    const alpha = await readMobileTeamStatisticsWithDb(db, "central", "a", ["regular", "series"]);
    expect(alpha.gamesPlayed).toBe(2);
    expect(alpha.totals).toMatchObject({ pointsScored: 15, pointsAllowed: 15 });
    expect(alpha.perGame).toMatchObject({ pointsScored: 7.5, pointsAllowed: 7.5 });
    expect(eventRows).toBe(4);
  });

  it("uses finalized team counters for team-only rebounds and technical fouls", async () => {
    addGame("team-only", "regular", [{ id: "player", stats: { offensiveRebounds: 2 } }], [],
      { homeTeamExtras: { offensiveRebounds: 1, technicalFouls: 1 } });
    const result = await readMobileTeamStatisticsWithDb(db, "central", "a", ["regular"]);
    expect(result.totals).toMatchObject({ offensiveRebounds: 3, rebounds: 3, fouls: 1 });
    expect(result.gamesPlayed).toBe(1);
  });

  it("fails closed for tampered finalized event history", async () => {
    addGame("sealed", "regular", [{ id: "player", stats: { points: 8 } }]);
    sqlite.prepare("UPDATE league_komocontrol_match_events_v2 SET event_hash=? WHERE run_id=? AND sequence=2")
      .run("0".repeat(64), "run-sealed");
    const result = await readMobileTeamStatisticsWithDb(db, "central", "a", ["regular"]);
    expect(result.gamesPlayed).toBe(0);
    expect(result.totals.pointsScored).toBe(0);
    expect(projectPublicLiveGame).not.toHaveBeenCalled();
  });

  it("returns zero metrics, null shooting percentages and a successful statistics response for no eligible games", async () => {
    addGame("manual", "regular", [], [], { source: "manual" });
    const result = await readMobileTeamStatisticsWithDb(db, "central", "a", ["regular"]);
    expect(result.gamesPlayed).toBe(0);
    expect(Object.values(result.totals).every((value) => value === 0)).toBe(true);
    expect(Object.values(result.perGame).every((value) => value === 0)).toBe(true);
    expect(Object.values(result.shooting).every((value) => value.percentage === null)).toBe(true);
    const response = await statisticsRoute(request("central/teams/a/statistics?phaseIds=regular"), teamContext());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=15, s-maxage=60");
  });

  it("returns safe route errors with no-store caching", async () => {
    const missing = await statisticsRoute(request("central/teams/a/statistics"), teamContext());
    const foreign = await statisticsRoute(request("central/teams/a/statistics?phaseIds=foreign"), teamContext());
    const unrelated = await detailRoute(request("central/teams/unrelated"), teamContext("central", "unrelated"));
    expect([missing.status, foreign.status, unrelated.status]).toEqual([400, 404, 404]);
    for (const response of [missing, foreign, unrelated]) {
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("keeps twenty selected games bounded at five reads and zero replay", async () => {
    for (let index = 0; index < 20; index++) {
      addGame(`scale-${index}`, index % 2 ? "series" : "regular",
        [{ id: `home-${index}`, stats: { points: 10 } }], [{ id: `away-${index}` }]);
    }
    const started = performance.now();
    const result = await readMobileTeamStatisticsWithDb(db, "central", "a", ["regular", "series"]);
    const elapsedMs = performance.now() - started;
    expect(result.gamesPlayed).toBe(20);
    expect(result.totals.pointsScored).toBe(200);
    expect(queryCount).toBe(5);
    expect(eventRows).toBe(40);
    expect(selectedGameRows).toBe(20);
    expect(projectPublicLiveGame).not.toHaveBeenCalled();
    console.info(`B2 fixture: games=20, event rows=40, player-game lines projected=40, team lines aggregated=20, queries=5, replays=0, elapsedMs=${elapsedMs.toFixed(2)}`);
  });

  it("opens a B2 roster player in B3 before any finalized statistical game", async () => {
    addPlayer("rookie", "Roster Rookie");
    addMembership("rookie-membership", "rookie", "a");
    const team = await readMobileTeamWithDb(db, "central", "a");
    expect(team.roster.some((player) => player.playerId === "rookie")).toBe(true);
    const profile = (await readMobilePlayerWithDb(db, {
      competitionId: "central", playerId: "rookie", phaseIds: ["regular"],
    })).data;
    expect(profile).toMatchObject({ id: "rookie", name: "Roster Rookie", gamesPlayed: 0,
      currentTeam: { id: "a" }, jerseyNumber: "7", recentGames: [] });
    expect(profile.perGame.points).toBeNull();
  });
});
