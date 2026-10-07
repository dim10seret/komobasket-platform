import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: vi.fn() }));
vi.mock("./public-live-game-core", () => ({ projectPublicLiveGame: vi.fn(() => ({ score: { home: 10, away: 5 } })) }));

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { projectPublicLiveGame } from "./public-live-game-core";
import { GET } from "@/app/api/public/v1/competitions/[competitionId]/players/[playerId]/route";
import { readMobileRankingsWithDb } from "./public-mobile-rankings.service";
import { readMobilePlayerWithDb } from "./public-mobile-player.service";
import { readMobileOfficialMvpWithDb } from "./public-mobile-mvp.service";


type Stats = Partial<{ points: number; twoPointMade: number; twoPointAttempts: number; threePointMade: number;
  threePointAttempts: number; freeThrowMade: number; freeThrowAttempts: number; offensiveRebounds: number;
  defensiveRebounds: number; assists: number; steals: number; blocks: number; turnovers: number }>;
type Player = { id: string; name?: string; stats?: Stats; starter?: boolean; fouls?: number };
const request = (query: string, competitionId = "central", playerId = "p1") => new Request(`https://example.test/api/public/v1/competitions/${competitionId}/players/${playerId}?${query}`);
const context = (competitionId = "central", playerId = "p1") => ({ params: Promise.resolve({ competitionId, playerId }) });
const standard = { competitionId: "central", phaseIds: ["regular"], category: "points" as const, limit: 10 };
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const teamStatistics = { twoPointMade: 0, twoPointAttempts: 0, threePointMade: 0, threePointAttempts: 0,
  freeThrowMade: 0, freeThrowAttempts: 0, offensiveRebounds: 0, defensiveRebounds: 0, assists: 0,
  steals: 0, blocks: 0, turnovers: 0, personalFouls: 0, technicalFouls: 0, disruptiveFouls: 0,
  flagrantFouls: 0, disqualifyingFouls: 0 };

describe("Phase B3 public mobile player profile", () => {
  let sqlite: DatabaseSync;
  let db: D1DatabaseBinding;
  let queryCount: number;
  let eventRows: number;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE league_organizations (id TEXT PRIMARY KEY, slug TEXT, status TEXT, publication_status TEXT);
      CREATE TABLE league_seasons (id TEXT PRIMARY KEY, name TEXT, starts_on TEXT, status TEXT);
      CREATE TABLE league_competitions (id TEXT PRIMARY KEY, organization_id TEXT, season_id TEXT, slug TEXT, name TEXT, type TEXT, logo_url TEXT, status TEXT);
      CREATE TABLE league_competition_publication (competition_id TEXT PRIMARY KEY, lifecycle_status TEXT);
      CREATE TABLE league_phases (id TEXT PRIMARY KEY, competition_id TEXT, lifecycle_status TEXT, name TEXT,
        phase_order INTEGER, order_index INTEGER, format TEXT DEFAULT 'standings');
      CREATE TABLE league_teams (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, logo_url TEXT);
      CREATE TABLE league_season_teams (id TEXT PRIMARY KEY, season_id TEXT, team_id TEXT);
      CREATE TABLE league_competition_teams (id TEXT PRIMARY KEY, competition_id TEXT, season_team_id TEXT, status TEXT);
      CREATE TABLE league_players (id TEXT PRIMARY KEY, organization_id TEXT, display_name TEXT, photo_url TEXT);
      CREATE TABLE league_roster_memberships (id TEXT PRIMARY KEY, season_id TEXT, competition_id TEXT, player_id TEXT,
        team_id TEXT, status TEXT, joined_on TEXT, updated_at TEXT, shirt_number INTEGER);
      CREATE TABLE league_games (id TEXT PRIMARY KEY, competition_id TEXT, phase_id TEXT, status TEXT, result_source TEXT,
        home_score INTEGER, away_score INTEGER, round_label TEXT, scheduled_date TEXT, scheduled_time TEXT, venue TEXT,
        home_team_id TEXT, away_team_id TEXT, series_round_number INTEGER, round_number INTEGER, game_order INTEGER);
      CREATE TABLE league_matchday_mvp_selections (id TEXT PRIMARY KEY, organization_id TEXT, competition_id TEXT,
        phase_id TEXT, round_number INTEGER, game_id TEXT, player_id TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE league_komocontrol_gameplay_game_claims (game_id TEXT PRIMARY KEY, run_id TEXT);
      CREATE TABLE league_komocontrol_gameplay_heads (run_id TEXT PRIMARY KEY, lifecycle TEXT, event_history_revision INTEGER,
        last_accepted_sequence INTEGER, history_hash TEXT, finalization_hash TEXT, official_result_applied_at TEXT, updated_at TEXT);
      CREATE TABLE league_komocontrol_match_engine_snapshots_v1 (run_id TEXT PRIMARY KEY, initial_state_json TEXT, initial_state_hash TEXT);
      CREATE TABLE league_komocontrol_current_game_configurations_v1 (run_id TEXT PRIMARY KEY, configuration_json TEXT);
      CREATE TABLE league_komocontrol_match_finalizations_v1 (run_id TEXT PRIMARY KEY, finalized_history_revision INTEGER,
        finalized_history_hash TEXT, final_state_json TEXT, final_state_hash TEXT, finalization_json TEXT, finalization_hash TEXT);
      CREATE TABLE league_komocontrol_match_events_v2 (run_id TEXT, event_id TEXT, sequence INTEGER, event_schema_version INTEGER,
        event_json TEXT, event_hash TEXT);
      INSERT INTO league_organizations VALUES ('organization_komobasket','komobasket','active','unpublished'),
        ('hidden-org','hidden','active','unpublished');
      INSERT INTO league_seasons VALUES ('season-new','2027–28','2027-09-01','active');
      INSERT INTO league_competitions VALUES
        ('central','organization_komobasket','season-new','central','Central League','league',NULL,'active'),
        ('hidden','hidden-org','season-new','hidden','Hidden League','league',NULL,'active');
      INSERT INTO league_competition_publication VALUES ('central','online'),('hidden','online');
      INSERT INTO league_phases (id,competition_id,lifecycle_status,name) VALUES ('regular','central','active','Regular'),('series','central','active','Series'),
        ('draft','central','draft','Draft'),('foreign','hidden','active','Foreign');
      INSERT INTO league_teams VALUES ('a','organization_komobasket','Alpha','/a.png'),
        ('b','organization_komobasket','Beta','/b.png'),('x','hidden-org','Hidden',NULL);
      INSERT INTO league_season_teams VALUES ('sa','season-new','a'),('sb','season-new','b');
      INSERT INTO league_competition_teams VALUES ('ca','central','sa','active'),('cb','central','sb','active');
    `);
    queryCount = 0;
    eventRows = 0;
    const statement = (sql: string, values: unknown[] = []): D1PreparedStatement => ({
      bind: (...bindings: unknown[]) => statement(sql, bindings),
      all: async <T,>() => {
        queryCount++;
        const rows = sqlite.prepare(sql).all(...values) as T[];
        if (sql.includes("FROM league_komocontrol_match_events_v2 event")) eventRows += rows.length;
        return { success: true, results: rows };
      },
      first: async <T,>() => { queryCount++; return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null; },
      run: async () => { throw new Error("B1 cannot write to D1"); },
    });
    db = { prepare: statement, batch: async () => { throw new Error("B1 cannot batch writes"); } };
    vi.mocked(getKomoBasketCloudflareEnv).mockResolvedValue({ NEWS_DB: db } as never);
  });

  afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

  function addPlayer(id: string, name = id, photo: string | null = null) {
    sqlite.prepare("INSERT INTO league_players VALUES (?,?,?,?)").run(id, "organization_komobasket", name, photo);
  }

  function runPlayer(player: Player, team: "HOME" | "AWAY") {
    return {
      playerId: player.id, displayName: player.name ?? player.id, shirtNumber: "7", onCourt: player.starter ?? true, team,
      foulState: { total: player.fouls ?? 0, status: "ELIGIBLE" },
      statistics: {
        points: 0, twoPointMade: 0, twoPointAttempts: 0, threePointMade: 0, threePointAttempts: 0,
        freeThrowMade: 0, freeThrowAttempts: 0, offensiveRebounds: 0, defensiveRebounds: 0,
        assists: 0, steals: 0, blocks: 0, turnovers: 0, ...player.stats,
      },
    };
  }

  function addGame(id: string, phaseId: string, home: Player[], away: Player[] = [], options: {
    status?: string; source?: string; lifecycle?: string; revision?: number; date?: string; competition?: string;
    substitutions?: Array<{ team: "HOME" | "AWAY"; playerInId: string; playerOutId: string }>;
  } = {}) {
    const competition = options.competition ?? "central";
    const status = options.status ?? "completed";
    const source = options.source ?? "match_report";
    const lifecycle = options.lifecycle ?? "finalized";
    const revision = options.revision ?? 1;
    const run = `run-${id}`;
    const date = options.date ?? "2027-10-01";
    sqlite.prepare("INSERT INTO league_games (id,competition_id,phase_id,status,result_source,home_score,away_score,round_label,scheduled_date,scheduled_time,venue,home_team_id,away_team_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, competition, phaseId, status, source, 10, 5, "Round 1", date, "18:00", "Arena", "a", "b");
    if (source === "manual") return;
    const events = [{ type: "MATCH_START" }, ...(options.substitutions ?? []).map((substitution) => ({
      type: "SUBSTITUTION", ...substitution,
    })), { type: "MATCH_END" }].map((event, index) => ({ ...event, schemaVersion: 2, id: `event-${id}-${index + 1}`,
      sequence: index + 1, occurredAt: Date.parse(date) + index * 1000 }));
    const state = (finished: boolean) => {
      const homePlayers = home.map((player) => runPlayer(player, "HOME"));
      const awayPlayers = away.map((player) => runPlayer(player, "AWAY"));
      if (finished) for (const substitution of options.substitutions ?? []) {
        const roster = substitution.team === "HOME" ? homePlayers : awayPlayers;
        const outgoing = roster.find((player) => player.playerId === substitution.playerOutId);
        const incoming = roster.find((player) => player.playerId === substitution.playerInId);
        if (!outgoing || !incoming) throw new Error("Invalid participation fixture");
        outgoing.onCourt = false;
        incoming.onCourt = true;
      }
      return JSON.stringify({ id: run, finished, lastProcessedSequence: finished ? events.length : 0,
        home: { score: 10, players: homePlayers, statistics: teamStatistics },
        away: { score: 5, players: awayPlayers, statistics: teamStatistics } });
    };
    const initialStateJson = state(false);
    const finalStateJson = state(true);
    const eventJson = events.map((event) => JSON.stringify(event));
    const historyHash = sha(`[${eventJson.join(",")}]`);
    const finalStateHash = sha(finalStateJson);
    const finalizationJson = JSON.stringify({ runId: run, finalizedHistoryRevision: revision,
      finalizedHistoryHash: historyHash, finalStateHash, incidentReport: null });
    const finalizationHash = sha(finalizationJson);
    sqlite.prepare("INSERT INTO league_komocontrol_gameplay_game_claims VALUES (?,?)").run(id, run);
    sqlite.prepare("INSERT INTO league_komocontrol_gameplay_heads VALUES (?,?,?,?,?,?,?,?)")
      .run(run, lifecycle, revision, events.length, historyHash, finalizationHash, "2027-10-01T00:00:00Z", "2027-10-01T00:00:00Z");
    sqlite.prepare("INSERT INTO league_komocontrol_match_engine_snapshots_v1 VALUES (?,?,?)").run(run, initialStateJson, sha(initialStateJson));
    sqlite.prepare("INSERT INTO league_komocontrol_current_game_configurations_v1 VALUES (?,?)").run(run, "{}");
    sqlite.prepare("INSERT INTO league_komocontrol_match_finalizations_v1 VALUES (?,?,?,?,?,?,?)")
      .run(run, revision, historyHash, finalStateJson, finalStateHash, finalizationJson, finalizationHash);
    events.forEach((event, index) => sqlite.prepare("INSERT INTO league_komocontrol_match_events_v2 VALUES (?,?,?,?,?,?)")
      .run(run, event.id, event.sequence, 2, eventJson[index], sha(eventJson[index])));
  }

  function addMembership(id: string, playerId: string, teamId = "a", status = "active", competition = "central") {
    sqlite.prepare(`INSERT INTO league_roster_memberships
      (id,season_id,competition_id,player_id,team_id,status,joined_on,updated_at,shirt_number)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(id, "season-new", competition, playerId, teamId, status,
      "2027-10-03", "2027-10-03", 7);
  }

  const profileInput = (phaseIds = ["regular"], playerId = "p1") => ({ competitionId: "central", playerId, phaseIds });

  it("returns roster-only players with zero totals, null averages, empty recent games and scoped identity", async () => {
    addPlayer("p1", "Canonical One", "/p1.png");
    addMembership("m1", "p1");
    const response = await GET(request("phaseIds=regular"), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=15, s-maxage=60");
    const profile = (await response.json()).data;
    expect(profile).toMatchObject({ id: "p1", name: "Canonical One", photoUrl: "/p1.png",
      competitionId: "central", seasonId: "season-new", currentTeam: { id: "a", name: "Alpha" },
      jerseyNumber: "7", gamesPlayed: 0, recentGames: [] });
    expect(Object.values(profile.totals).every((value) => value === 0)).toBe(true);
    expect(Object.values(profile.perGame).every((value) => value === null)).toBe(true);
    expect(profile.shooting.twoPoint).toEqual({ made: 0, attempted: 0, percentage: null });
    expect(queryCount).toBe(5);
    expect(eventRows).toBe(0);
    expect(projectPublicLiveGame).not.toHaveBeenCalled();
  });

  it("rejects unrelated and foreign players and hidden competitions without revealing identity", async () => {
    addPlayer("p1", "Private Global Player");
    addMembership("foreign-membership", "p1", "a", "active", "hidden");
    sqlite.prepare("INSERT INTO league_competitions VALUES (?,?,?,?,?,?,?,?)")
      .run("other-public", "organization_komobasket", "season-new", "other-public", "Other League", "league", null, "active");
    sqlite.prepare("INSERT INTO league_competition_publication VALUES (?,?)").run("other-public", "online");
    sqlite.prepare("INSERT INTO league_phases (id,competition_id,lifecycle_status,name) VALUES (?,?,?,?)")
      .run("other-phase", "other-public", "active", "Other Phase");
    sqlite.prepare("INSERT INTO league_competition_teams VALUES (?,?,?,?)").run("other-a", "other-public", "sa", "active");
    addMembership("other-membership", "p1", "a", "active", "other-public");
    const otherProfile = await GET(request("phaseIds=other-phase", "other-public"), context("other-public"));
    expect(otherProfile.status).toBe(200);
    for (const [competitionId, playerId, phaseIds, status] of [
      ["central", "p1", "regular", 404], ["central", "missing", "regular", 404],
      ["hidden", "p1", "foreign", 404], ["central", "p1", "foreign", 400],
      ["central", "p1", "draft", 400],
    ] as const) {
      const response = await GET(request(`phaseIds=${phaseIds}`, competitionId, playerId), context(competitionId, playerId));
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(await response.json())).not.toContain("Private Global Player");
    }
  });

  it("requires valid phase scope, canonicalizes duplicates, and validates every phase", async () => {
    addPlayer("p1"); addMembership("m1", "p1");
    addGame("g1", "regular", [{ id: "p1", stats: { points: 5 } }]);
    addGame("g2", "series", [{ id: "p1", stats: { points: 7 } }]);
    const result = await readMobilePlayerWithDb(db, profileInput(["series", "regular", "series"]));
    expect(result.data.phaseIds).toEqual(["regular", "series"]);
    expect(result.data.gamesPlayed).toBe(2);
    expect(result.data.totals.points).toBe(12);
    for (const query of ["", "phaseIds=", "phaseIds=regular,foreign", "phaseIds=regular,draft",
      `phaseIds=${Array.from({ length: 13 }, (_, index) => `p${index}`).join(",")}`,
      "phaseIds=regular&phaseIds=series", "phaseIds=regular&extra=1"]) {
      const response = await GET(request(query), context());
      expect(response.status).toBe(400);
    }
  });

  it("uses B1.2 participation and matches B1 totals, averages, shooting and EFF", async () => {
    addPlayer("p1", "Canonical One", "/p1.png");
    addMembership("m1", "p1");
    addGame("g1", "regular", [{ id: "p1", stats: { points: 8, twoPointMade: 2, twoPointAttempts: 4,
      threePointMade: 1, threePointAttempts: 2, freeThrowMade: 1, freeThrowAttempts: 2,
      offensiveRebounds: 2, defensiveRebounds: 3, assists: 4, steals: 2, blocks: 1, turnovers: 1 }, fouls: 2 }]);
    addGame("g2", "series", [{ id: "p1", starter: false }, { id: "other", starter: true }], [],
      { date: "2027-10-02", substitutions: [{ team: "HOME", playerInId: "p1", playerOutId: "other" }] });
    addGame("g3", "regular", [{ id: "p1", starter: false }], [], { date: "2027-10-03" });
    const profile = (await readMobilePlayerWithDb(db, profileInput(["series", "regular"]))).data;
    expect(profile.gamesPlayed).toBe(2);
    expect(profile.recentGames.map((game) => game.gameId)).toEqual(["g2", "g1"]);
    expect(profile.recentGames[0]).toMatchObject({ points: 0, playerTeam: { id: "a" },
      opponentTeam: { id: "b" }, teamScore: 10, opponentScore: 5, outcome: "win" });
    expect(profile.totals).toMatchObject({ points: 8, offensiveRebounds: 2, defensiveRebounds: 3,
      rebounds: 5, assists: 4, steals: 2, blocks: 1, turnovers: 1, fouls: 2 });
    expect(profile.perGame).toMatchObject({ points: 4, rebounds: 2.5, assists: 2,
      steals: 1, blocks: 0.5, turnovers: 0.5, fouls: 1 });
    expect(profile.shooting).toEqual({ twoPoint: { made: 2, attempted: 4, percentage: 50 },
      threePoint: { made: 1, attempted: 2, percentage: 50 },
      freeThrow: { made: 1, attempted: 2, percentage: 50 } });
    for (const category of ["points", "rebounds", "assists", "efficiency", "2pt", "3pt", "ft"] as const) {
      const rankings = await readMobileRankingsWithDb(db, { ...standard, phaseIds: ["regular", "series"], category });
      const row = rankings.data.find((candidate) => candidate.playerId === "p1")!;
      expect(row.gamesPlayed).toBe(profile.gamesPlayed);
      if ("total" in row) {
        const total = profile.totals[category];
        expect(row.total).toBe(total);
        expect(row.perGameAverage).toBe(total / profile.gamesPlayed);
      } else {
        const value = category === "2pt" ? profile.shooting.twoPoint
          : category === "3pt" ? profile.shooting.threePoint : profile.shooting.freeThrow;
        expect(row).toMatchObject(value);
      }
    }
    expect(projectPublicLiveGame).not.toHaveBeenCalled();
  });

  it("keeps departed players visible and preserves historical game teams after transfers", async () => {
    addPlayer("p1", "Transferred");
    addMembership("old", "p1", "a", "departed");
    addGame("g1", "regular", [{ id: "p1", stats: { points: 3 } }], [], { date: "2027-10-01" });
    addGame("g2", "regular", [], [{ id: "p1", stats: { points: 6 } }], { date: "2027-10-02" });
    let profile = (await readMobilePlayerWithDb(db, profileInput())).data;
    expect(profile.currentTeam?.id).toBe("b");
    expect(profile.recentGames.map((game) => game.playerTeam.id)).toEqual(["b", "a"]);
    expect(profile.recentGames[0]).toMatchObject({ outcome: "loss", teamScore: 5, opponentScore: 10 });
    addMembership("new", "p1", "a");
    profile = (await readMobilePlayerWithDb(db, profileInput())).data;
    expect(profile.currentTeam?.id).toBe("a");
    expect(profile.jerseyNumber).toBe("7");
    expect(profile.recentGames.map((game) => game.playerTeam.id)).toEqual(["b", "a"]);
  });

  it("bounds recent games to five in A2 stored order while counting all appearances", async () => {
    addPlayer("p1"); addMembership("m1", "p1");
    for (let index = 1; index <= 8; index++) {
      addGame(`g${index}`, index % 2 ? "regular" : "series", [{ id: "p1", starter: index !== 8,
        stats: { points: index } }], [], { date: "2027-10-01" });
      sqlite.prepare("UPDATE league_games SET game_order=? WHERE id=?").run(index, `g${index}`);
    }
    sqlite.prepare("UPDATE league_phases SET phase_order=1 WHERE id='regular'").run();
    sqlite.prepare("UPDATE league_phases SET phase_order=2 WHERE id='series'").run();
    const profile = (await readMobilePlayerWithDb(db, profileInput(["regular", "series"]))).data;
    expect(profile.gamesPlayed).toBe(7);
    expect(profile.recentGames.map((game) => game.gameId)).toEqual(["g6", "g4", "g2", "g7", "g5"]);
    expect(profile.recentGames).toHaveLength(5);
  });

  it("counts a zero-stat starter and excludes an unused bench player", async () => {
    addPlayer("p1"); addPlayer("bench");
    addMembership("m1", "p1"); addMembership("m2", "bench");
    addGame("g1", "regular", [{ id: "p1", starter: true }, { id: "bench", starter: false }]);
    const starter = (await readMobilePlayerWithDb(db, profileInput())).data;
    const bench = (await readMobilePlayerWithDb(db, profileInput(["regular"], "bench"))).data;
    expect(starter).toMatchObject({ gamesPlayed: 1, recentGames: [{ gameId: "g1", points: 0 }] });
    expect(starter.perGame.points).toBe(0);
    expect(bench).toMatchObject({ gamesPlayed: 0, recentGames: [] });
    expect(bench.perGame.points).toBeNull();
  });

  it("excludes corrupted history and keeps query count bounded for twenty games", async () => {
    addPlayer("p1"); addMembership("m1", "p1");
    for (let index = 1; index <= 20; index++) {
      addGame(`g${index}`, index % 2 ? "regular" : "series", [{ id: "p1", stats: { points: 1 } }]);
    }
    sqlite.prepare("UPDATE league_komocontrol_match_events_v2 SET event_json='{}' WHERE run_id='run-g20' AND sequence=1").run();
    const started = performance.now();
    const profile = (await readMobilePlayerWithDb(db, profileInput(["regular", "series"]))).data;
    const elapsedMs = performance.now() - started;
    expect(profile.gamesPlayed).toBe(19);
    expect(profile.totals.points).toBe(19);
    expect(profile.recentGames).toHaveLength(5);
    expect(queryCount).toBe(5);
    expect(eventRows).toBe(40);
    expect(projectPublicLiveGame).not.toHaveBeenCalled();
    expect(elapsedMs).toBeGreaterThanOrEqual(0);
    console.info(`B3 local fixture: games=20 appearances=19 playerGameLines=20 eventRows=${eventRows} queries=${queryCount} replay=0 elapsedMs=${elapsedMs.toFixed(2)}`);
  });

  it("C1 reads only the selected game's verified full history and keeps an official choice after integrity loss", async () => {
    addPlayer("p1", "Canonical One", "/p1.png");
    addGame("g1", "regular", [{ id: "p1", stats: { points: 8, offensiveRebounds: 2, defensiveRebounds: 3,
      assists: 4 } }]);
    addGame("g2", "regular", [{ id: "other", stats: { points: 20 } }]);
    sqlite.prepare("UPDATE league_games SET round_number=7 WHERE id IN ('g1','g2')").run();
    sqlite.prepare("INSERT INTO league_matchday_mvp_selections VALUES (?,?,?,?,?,?,?,?,?)")
      .run("official-1", "organization_komobasket", "central", "regular", 7, "g1", "p1",
        "2027-10-02T10:00:00Z", "2027-10-03T11:00:00Z");
    const input = { competitionId: "central", phaseId: "regular", round: 7 };
    const result = (await readMobileOfficialMvpWithDb(db, input)).data;
    expect(result).toMatchObject({ id: "official-1", gameId: "g1", player: { id: "p1", name: "Canonical One" },
      team: { id: "a" }, performance: { points: 8, rebounds: 5, assists: 4 } });
    expect(queryCount).toBe(5);
    expect(eventRows).toBe(2);
    expect(projectPublicLiveGame).not.toHaveBeenCalled();

    sqlite.prepare("UPDATE league_komocontrol_match_events_v2 SET event_json='{}' WHERE run_id='run-g1' AND sequence=1").run();
    const corrupted = (await readMobileOfficialMvpWithDb(db, input)).data;
    expect(corrupted).toMatchObject({ id: "official-1", player: { id: "p1" }, team: null, performance: null });
    expect(projectPublicLiveGame).not.toHaveBeenCalled();
  });
});
