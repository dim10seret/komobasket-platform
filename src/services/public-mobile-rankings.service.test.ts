import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";
import { MatchEngine } from "../../komocontrol/shared/match-engine/engine/match-engine";
import { createPlayer } from "../../komocontrol/shared/match-engine/models/player";
import type { MatchEvent } from "../../komocontrol/shared/match-engine/types/event";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: vi.fn() }));
vi.mock("./public-live-game-core", () => ({ projectPublicLiveGame: vi.fn(() => ({ score: { home: 10, away: 5 } })) }));

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { matchReportEfficiency } from "@/lib/platform-match-report-statistics";
import { projectPublicLiveGame } from "./public-live-game-core";
import { GET } from "@/app/api/public/v1/competitions/[competitionId]/rankings/route";
import { readMobileRankingsWithDb } from "./public-mobile-rankings.service";
import { readAuthoritativeCompetitionStatisticalGamesWithDb } from "./platform-match-report.service";

type Stats = Partial<{ points: number; twoPointMade: number; twoPointAttempts: number; threePointMade: number;
  threePointAttempts: number; freeThrowMade: number; freeThrowAttempts: number; offensiveRebounds: number;
  defensiveRebounds: number; assists: number; steals: number; blocks: number; turnovers: number }>;
type Player = { id: string; name?: string; stats?: Stats; starter?: boolean };
const request = (query: string, competitionId = "central") => new Request(`https://example.test/api/public/v1/competitions/${competitionId}/rankings?${query}`);
const context = (competitionId = "central") => ({ params: Promise.resolve({ competitionId }) });
const standard = { competitionId: "central", phaseIds: ["regular"], category: "points" as const, limit: 10 };
const sha = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const teamStatistics = { twoPointMade: 0, twoPointAttempts: 0, threePointMade: 0, threePointAttempts: 0,
  freeThrowMade: 0, freeThrowAttempts: 0, offensiveRebounds: 0, defensiveRebounds: 0, assists: 0,
  steals: 0, blocks: 0, turnovers: 0, personalFouls: 0, technicalFouls: 0, disruptiveFouls: 0,
  flagrantFouls: 0, disqualifyingFouls: 0 };

describe("Phase B1 public mobile rankings", () => {
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
        phase_order INTEGER, order_index INTEGER);
      CREATE TABLE league_teams (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, logo_url TEXT);
      CREATE TABLE league_season_teams (id TEXT PRIMARY KEY, season_id TEXT, team_id TEXT);
      CREATE TABLE league_competition_teams (id TEXT PRIMARY KEY, competition_id TEXT, season_team_id TEXT, status TEXT);
      CREATE TABLE league_players (id TEXT PRIMARY KEY, organization_id TEXT, display_name TEXT, photo_url TEXT);
      CREATE TABLE league_roster_memberships (id TEXT PRIMARY KEY, season_id TEXT, competition_id TEXT, player_id TEXT,
        team_id TEXT, status TEXT, joined_on TEXT, updated_at TEXT, shirt_number INTEGER);
      CREATE TABLE league_games (id TEXT PRIMARY KEY, competition_id TEXT, phase_id TEXT, status TEXT, result_source TEXT,
        home_score INTEGER, away_score INTEGER, round_label TEXT, scheduled_date TEXT, scheduled_time TEXT, venue TEXT,
        home_team_id TEXT, away_team_id TEXT, series_round_number INTEGER, round_number INTEGER, game_order INTEGER);
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
      foulState: { total: 0, status: "ELIGIBLE" },
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

  it("enforces A1 competition visibility and validates every phase before reading events", async () => {
    addGame("g1", "regular", [{ id: "p1", stats: { points: 8 } }]);
    const good = await GET(request("phaseIds=regular&category=points"), context());
    expect(good.status).toBe(200);
    expect((await good.json()).data).toHaveLength(1);
    for (const [competition, phase, status] of [
      ["hidden", "foreign", 404], ["central", "foreign", 400], ["central", "draft", 400],
      ["central", "missing", 400],
    ] as const) {
      const response = await GET(request(`phaseIds=${phase}&category=points`, competition), context(competition));
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });

  it("canonicalizes and deduplicates one or many selected phases, and excludes unrelated events", async () => {
    addGame("g1", "regular", [{ id: "p1", stats: { points: 8 } }]);
    addGame("g2", "series", [{ id: "p1", stats: { points: 12 } }]);
    addGame("g3", "foreign", [{ id: "p2", stats: { points: 30 } }], [], { competition: "hidden" });
    const one = await readMobileRankingsWithDb(db, standard);
    expect(one.data[0]).toMatchObject({ playerId: "p1", total: 8, gamesPlayed: 1 });
    expect(eventRows).toBe(2);
    eventRows = 0;
    const multiple = await readMobileRankingsWithDb(db, { ...standard, phaseIds: ["series", "regular", "series"] });
    expect(multiple.meta.phaseIds).toEqual(["regular", "series"]);
    expect(multiple.data[0]).toMatchObject({ playerId: "p1", total: 20, gamesPlayed: 2, perGameAverage: 10 });
    expect(eventRows).toBe(4);
    expect(queryCount).toBe(10);
  });

  it("aggregates canonical identity across transfers; uses current competition team then latest eligible team", async () => {
    addPlayer("p1", "Canonical One", "/p1.png");
    addPlayer("p2", "Same Name");
    addPlayer("p3", "Same Name");
    addGame("g1", "regular", [{ id: "p1", name: "Old Name", stats: { points: 8 } },
      { id: "p2", name: "Same Name", stats: { points: 3 } }], [], { date: "2027-10-01" });
    addGame("g2", "series", [{ id: "p3", name: "Same Name", stats: { points: 5 } }],
      [{ id: "p1", name: "Old Name", stats: { points: 12 } }], { date: "2027-10-02" });
    sqlite.prepare("INSERT INTO league_roster_memberships (id,season_id,competition_id,player_id,team_id,status,joined_on,updated_at) VALUES (?,?,?,?,?,?,?,?)")
      .run("membership-p1", "season-new", "central", "p1", "a", "active", "2027-10-03", "2027-10-03");
    const result = await readMobileRankingsWithDb(db, { ...standard, phaseIds: ["series", "regular"] });
    expect(result.data).toHaveLength(3);
    expect(result.data[0]).toMatchObject({ playerId: "p1", playerName: "Canonical One", playerPhotoUrl: "/p1.png",
      teamId: "a", teamName: "Alpha", teamLogoUrl: "/a.png", gamesPlayed: 2, total: 20 });
    expect(result.data.filter((row) => row.playerName === "Same Name").map((row) => row.playerId)).toEqual(["p3", "p2"]);
    sqlite.prepare("DELETE FROM league_roster_memberships WHERE id='membership-p1'").run();
    const fallback = await readMobileRankingsWithDb(db, { ...standard, phaseIds: ["series", "regular"] });
    expect(fallback.data[0]).toMatchObject({ playerId: "p1", teamId: "b", teamName: "Beta", teamLogoUrl: "/b.png" });
  });

  it("counts zero-stat starters and substitute-ins, while omitting unused bench players", async () => {
    addGame("g1", "regular", [
      { id: "starter", starter: true }, { id: "substitute", starter: false },
      { id: "unused", starter: false }, { id: "scorer", starter: true, stats: { points: 12 } },
    ], [], { substitutions: [{ team: "HOME", playerOutId: "starter", playerInId: "substitute" }] });
    const result = await readMobileRankingsWithDb(db, standard);
    expect(result.data).toHaveLength(3);
    expect(result.data.find((row) => row.playerId === "starter")).toMatchObject({ gamesPlayed: 1, total: 0, perGameAverage: 0 });
    expect(result.data.find((row) => row.playerId === "substitute")).toMatchObject({ gamesPlayed: 1, total: 0, perGameAverage: 0 });
    expect(result.data.find((row) => row.playerId === "scorer")).toMatchObject({ gamesPlayed: 1, total: 12, perGameAverage: 12 });
    expect(result.data.some((row) => row.playerId === "unused")).toBe(false);
  });

  it("uses the fast path only for phase-scoped mobile rankings", async () => {
    addGame("g1", "regular", [{ id: "p1", stats: { points: 8 } }]);
    await readMobileRankingsWithDb(db, standard);
    expect(projectPublicLiveGame).not.toHaveBeenCalled();
    const websiteGames = await readAuthoritativeCompetitionStatisticalGamesWithDb(db, "central", "organization_komobasket");
    expect(websiteGames).toHaveLength(1);
    expect(projectPublicLiveGame).toHaveBeenCalledTimes(1);
  });

  const corruptions: Array<[string, (run: string) => void]> = [
    ["deleted substitution", (run) => sqlite.prepare("DELETE FROM league_komocontrol_match_events_v2 WHERE run_id=? AND sequence=2").run(run)],
    ["modified event JSON", (run) => sqlite.prepare("UPDATE league_komocontrol_match_events_v2 SET event_json=json_set(event_json,'$.playerInId','other') WHERE run_id=? AND sequence=2").run(run)],
    ["altered event hash", (run) => sqlite.prepare("UPDATE league_komocontrol_match_events_v2 SET event_hash=? WHERE run_id=? AND sequence=2").run("0".repeat(64), run)],
    ["duplicate event sequence", (run) => sqlite.prepare("UPDATE league_komocontrol_match_events_v2 SET sequence=1 WHERE run_id=? AND sequence=2").run(run)],
    ["mismatched history hash with otherwise linked manifest", (run) => {
      const historyHash = "0".repeat(64);
      const manifest = JSON.parse((sqlite.prepare("SELECT finalization_json FROM league_komocontrol_match_finalizations_v1 WHERE run_id=?")
        .get(run) as { finalization_json: string }).finalization_json) as Record<string, unknown>;
      const finalizationJson = JSON.stringify({ ...manifest, finalizedHistoryHash: historyHash });
      const finalizationHash = sha(finalizationJson);
      sqlite.prepare("UPDATE league_komocontrol_gameplay_heads SET history_hash=?, finalization_hash=? WHERE run_id=?")
        .run(historyHash, finalizationHash, run);
      sqlite.prepare("UPDATE league_komocontrol_match_finalizations_v1 SET finalized_history_hash=?, finalization_json=?, finalization_hash=? WHERE run_id=?")
        .run(historyHash, finalizationJson, finalizationHash, run);
    }],
    ["final-state JSON/hash mismatch", (run) => sqlite.prepare("UPDATE league_komocontrol_match_finalizations_v1 SET final_state_json=json_set(final_state_json,'$.home.players[0].statistics.points',88) WHERE run_id=?").run(run)],
    ["finalized revision mismatch", (run) => sqlite.prepare("UPDATE league_komocontrol_match_finalizations_v1 SET finalized_history_revision=2 WHERE run_id=?").run(run)],
    ["finalization manifest/hash mismatch", (run) => sqlite.prepare("UPDATE league_komocontrol_match_finalizations_v1 SET finalization_json=json_set(finalization_json,'$.incidentReport','changed') WHERE run_id=?").run(run)],
    ["initial-state hash mismatch", (run) => sqlite.prepare("UPDATE league_komocontrol_match_engine_snapshots_v1 SET initial_state_hash=? WHERE run_id=?").run("0".repeat(64), run)],
  ];
  for (const [name, corrupt] of corruptions) {
    it(`fails closed for ${name}`, async () => {
      const run = "run-g1";
      addGame("g1", "regular", [{ id: "starter", starter: true }, { id: "incoming", starter: false }], [],
        { substitutions: [{ team: "HOME", playerOutId: "starter", playerInId: "incoming" }] });
      expect((await readMobileRankingsWithDb(db, standard)).data).toHaveLength(2);
      corrupt(run);
      expect((await readMobileRankingsWithDb(db, standard)).data).toEqual([]);
      expect(projectPublicLiveGame).not.toHaveBeenCalled();
    });
  }

  it("counts only the played game across rostered DNPs without changing source totals", async () => {
    addGame("g1", "regular", [{ id: "p1", starter: false, stats: { points: 10 } },
      { id: "out", starter: true }], [],
    { substitutions: [{ team: "HOME", playerOutId: "out", playerInId: "p1" }] });
    addGame("g2", "regular", [{ id: "p1", starter: false, stats: { points: 5 } }]);
    const result = await readMobileRankingsWithDb(db, standard);
    expect(result.data[0]).toMatchObject({ playerId: "p1", gamesPlayed: 1, total: 15, perGameAverage: 15 });
  });

  it("uses corrected gamesPlayed for a tied primary metric", async () => {
    addGame("g1", "regular", [
      { id: "z-player", starter: true, stats: { points: 5 } },
      { id: "a-player", starter: true, stats: { points: 5 } },
    ]);
    addGame("g2", "regular", [
      { id: "z-player", starter: false }, { id: "a-player", starter: true },
    ]);
    const result = await readMobileRankingsWithDb(db, standard);
    expect(result.data.map((row) => [row.playerId, row.gamesPlayed, (row as { total: number }).total]))
      .toEqual([["z-player", 1, 5], ["a-player", 2, 5]]);
  });

  it("counts a starter and later substitute across phases and teams under one canonical ID", async () => {
    addPlayer("p1", "Transferred Player");
    addGame("g1", "regular", [{ id: "p1", starter: true, stats: { points: 8 } }]);
    addGame("g2", "series", [{ id: "out", starter: true }],
      [{ id: "p1", starter: false, stats: { points: 12 } }, { id: "away-out", starter: true }],
      { substitutions: [{ team: "AWAY", playerOutId: "away-out", playerInId: "p1" }] });
    const result = await readMobileRankingsWithDb(db, { ...standard, phaseIds: ["series", "regular"] });
    expect(result.data.find((row) => row.playerId === "p1")).toMatchObject({
      playerName: "Transferred Player", teamId: "b", gamesPlayed: 2, total: 20, perGameAverage: 10,
    });
    expect(result.data.filter((row) => row.playerId === "p1")).toHaveLength(1);
  });

  it("uses a corrected substitution history when its current revision is finalized", async () => {
    addGame("real", "regular", [
      { id: "p1", starter: true }, { id: "p2", starter: false }, { id: "p3", starter: false },
    ], [{ id: "away", starter: true }], { lifecycle: "live" });
    function installHistory(incoming: "p2" | "p3", revision: number) {
      const run = "run-real";
      const engine = new MatchEngine({ id: run, rules: {
        schemaVersion: 1, rulesEdition: "FIBA_2026", minPlayers: 1, maxPlayers: 3, startingPlayers: 1,
        regulationPeriods: 1, regulationPeriodSeconds: 600, overtimeSeconds: 300, resultPolicy: "ALLOW_TIE",
        teamFoulPenaltyThreshold: 5, overtimeTeamFoulPolicy: "CARRY_FROM_FINAL_REGULATION",
      }, homeTeam: { id: "a", name: "Alpha", players: [
        createPlayer({ playerId: "p1", displayName: "p1", shirtNumber: "1", team: "HOME", onCourt: true }),
        createPlayer({ playerId: "p2", displayName: "p2", shirtNumber: "2", team: "HOME" }),
        createPlayer({ playerId: "p3", displayName: "p3", shirtNumber: "3", team: "HOME" }),
      ] }, awayTeam: { id: "b", name: "Beta", players: [
        createPlayer({ playerId: "away", displayName: "away", shirtNumber: "1", team: "AWAY", onCourt: true }),
      ] } });
      const initialJson = JSON.stringify(engine.getState());
      const events: MatchEvent[] = [];
      const emit = (event: Record<string, unknown>) => {
        const sequence = events.length + 1;
        const accepted = { ...event, schemaVersion: 2, id: `accepted-${sequence}`, sequence,
          occurredAt: Date.parse("2027-10-01T18:00:00Z") + sequence * 1000 } as MatchEvent;
        expect(engine.process(accepted).accepted).toBe(true);
        events.push(accepted);
      };
      emit({ type: "MATCH_START" });
      for (let shot = 0; shot < 5; shot++) emit({ type: "TWO_POINT", team: "HOME", playerId: "p1" });
      emit({ type: "THREE_POINT", team: "AWAY", playerId: "away" });
      emit({ type: "TWO_POINT", team: "AWAY", playerId: "away" });
      emit({ type: "SUBSTITUTION", team: "HOME", playerOutId: "p1", playerInId: incoming });
      emit({ type: "CLOCK_SET", remainingSeconds: 0 });
      emit({ type: "MATCH_END" });
      const finalJson = JSON.stringify(engine.getState());
      const eventJson = events.map((event) => JSON.stringify(event));
      const historyHash = sha(`[${eventJson.join(",")}]`);
      const finalHash = sha(finalJson);
      const finalizationJson = JSON.stringify({ runId: run, finalizedHistoryRevision: revision,
        finalizedHistoryHash: historyHash, finalStateHash: finalHash, incidentReport: null });
      const sealHash = sha(finalizationJson);
      sqlite.prepare("UPDATE league_komocontrol_match_engine_snapshots_v1 SET initial_state_json=?, initial_state_hash=? WHERE run_id=?")
        .run(initialJson, sha(initialJson), run);
      sqlite.prepare("UPDATE league_komocontrol_gameplay_heads SET event_history_revision=?, last_accepted_sequence=?, history_hash=?, finalization_hash=? WHERE run_id=?")
        .run(revision, events.length, historyHash, sealHash, run);
      sqlite.prepare("UPDATE league_komocontrol_match_finalizations_v1 SET finalized_history_revision=?, finalized_history_hash=?, final_state_json=?, final_state_hash=?, finalization_json=?, finalization_hash=? WHERE run_id=?")
        .run(revision, historyHash, finalJson, finalHash, finalizationJson, sealHash, run);
      sqlite.prepare("DELETE FROM league_komocontrol_match_events_v2 WHERE run_id=?").run(run);
      const insert = sqlite.prepare("INSERT INTO league_komocontrol_match_events_v2 VALUES (?,?,?,?,?,?)");
      events.forEach((event, index) => insert.run(run, event.id, event.sequence, 2, eventJson[index], sha(eventJson[index])));
    }
    installHistory("p2", 1);
    expect((await readMobileRankingsWithDb(db, standard)).data).toEqual([]);
    installHistory("p3", 2);
    sqlite.prepare("UPDATE league_komocontrol_gameplay_heads SET lifecycle='finalized' WHERE run_id='run-real'").run();
    const after = await readMobileRankingsWithDb(db, standard);
    expect(after.data.find((row) => row.playerId === "p3")).toMatchObject({ gamesPlayed: 1, total: 0 });
    expect(after.data.some((row) => row.playerId === "p2")).toBe(false);
    expect(after.data.find((row) => row.playerId === "p1")).toMatchObject({ gamesPlayed: 1, total: 10 });
  });

  it("includes finalized games only; manual results and live runs do not invent statistics", async () => {
    addGame("manual", "regular", [{ id: "manual-player", stats: { points: 99 } }], [], { source: "manual" });
    addGame("live", "regular", [{ id: "live-player", stats: { points: 99 } }], [], { lifecycle: "live" });
    addGame("scheduled", "regular", [{ id: "scheduled-player", stats: { points: 99 } }], [], { status: "scheduled" });
    addGame("final", "regular", [{ id: "final-player", stats: { points: 7 } }]);
    const result = await readMobileRankingsWithDb(db, standard);
    expect(result.data.map((row) => row.playerId)).toEqual(["final-player"]);
    expect(eventRows).toBe(2);
  });

  it("preserves counting metrics, rebound sum and existing EFF across two games", async () => {
    const stats = { points: 8, twoPointMade: 2, twoPointAttempts: 3, threePointMade: 1,
      threePointAttempts: 2, freeThrowMade: 1, freeThrowAttempts: 2, offensiveRebounds: 2,
      defensiveRebounds: 3, assists: 4, steals: 1, blocks: 1, turnovers: 1 };
    addGame("g1", "regular", [{ id: "p1", stats }]);
    addGame("g2", "series", [{ id: "p1", stats }]);
    const input = { ...standard, phaseIds: ["regular", "series"] };
    for (const [category, total] of [["points", 16], ["rebounds", 10], ["assists", 8],
      ["efficiency", 2 * matchReportEfficiency({ ...stats, rebounds: 5 })]] as const) {
      const result = await readMobileRankingsWithDb(db, { ...input, category });
      expect(result.data[0]).toMatchObject({ total, perGameAverage: total / 2, gamesPlayed: 2 });
    }
  });

  it("keeps all seven ranking DTOs, order and deterministic cursors stable from finalized totals", async () => {
    const stats = { points: 8, twoPointMade: 2, twoPointAttempts: 3, threePointMade: 1,
      threePointAttempts: 2, freeThrowMade: 1, freeThrowAttempts: 2, offensiveRebounds: 2,
      defensiveRebounds: 3, assists: 4, steals: 1, blocks: 1, turnovers: 1 };
    addGame("g1", "regular", [{ id: "p1", name: "Player One", stats }, { id: "p2", name: "Player Two" }]);
    addGame("g2", "regular", [{ id: "p1", name: "Player One", stats }, { id: "p2", name: "Player Two" }]);
    const expected = {
      points: { total: 16, perGameAverage: 8 },
      rebounds: { total: 10, perGameAverage: 5 },
      assists: { total: 8, perGameAverage: 4 },
      efficiency: { total: 2 * matchReportEfficiency({ ...stats, rebounds: 5 }),
        perGameAverage: matchReportEfficiency({ ...stats, rebounds: 5 }) },
      "2pt": { made: 4, attempted: 6, percentage: 4 / 6 * 100 },
      "3pt": { made: 2, attempted: 4, percentage: 50 },
      ft: { made: 2, attempted: 4, percentage: 50 },
    };
    for (const category of ["points", "rebounds", "assists", "efficiency", "2pt", "3pt", "ft"] as const) {
      const input = { ...standard, category, limit: 1 };
      const first = await readMobileRankingsWithDb(db, input);
      const repeated = await readMobileRankingsWithDb(db, input);
      expect(repeated).toEqual(first);
      expect(first.data[0]).toMatchObject({ rank: 1, playerId: "p1", playerName: "Player One",
        teamId: "a", gamesPlayed: 2, ...expected[category] });
      expect(first.meta.hasMore).toBe(true);
      const second = await readMobileRankingsWithDb(db, { ...input, cursor: first.meta.nextCursor! });
      expect(second.data[0]).toMatchObject({ rank: 2, playerId: "p2", playerName: "Player Two",
        teamId: "a", gamesPlayed: 2 });
      expect(second.meta.hasMore).toBe(false);
    }
    expect(projectPublicLiveGame).not.toHaveBeenCalled();
  });

  it("ranks shooting by makes with numeric percentages and null when attempts are zero", async () => {
    addGame("g1", "regular", [
      { id: "high", stats: { twoPointMade: 40, twoPointAttempts: 80, threePointMade: 10,
        threePointAttempts: 20, freeThrowMade: 5, freeThrowAttempts: 10 } },
      { id: "perfect", stats: { twoPointMade: 1, twoPointAttempts: 1, threePointMade: 1,
        threePointAttempts: 1, freeThrowMade: 1, freeThrowAttempts: 1 } },
      { id: "zero" },
    ]);
    for (const [category, made] of [["2pt", 40], ["3pt", 10], ["ft", 5]] as const) {
      const result = await readMobileRankingsWithDb(db, { ...standard, category });
      expect(result.data.map((row) => row.playerId)).toEqual(["high", "perfect", "zero"]);
      expect(result.data[0]).toMatchObject({ made, percentage: 50 });
      expect(result.data[1]).toMatchObject({ made: 1, percentage: 100 });
      expect(result.data[2]).toMatchObject({ made: 0, attempted: 0, percentage: null });
    }
  });

  it("defaults to Top 10, paginates without overlap and rejects stale or mismatched cursors", async () => {
    addGame("g1", "regular", Array.from({ length: 15 }, (_, index) => ({ id: `p${index}`, stats: { points: index } })));
    const first = await GET(request("phaseIds=regular&category=points"), context());
    expect(first.status).toBe(200);
    expect(first.headers.get("cache-control")).toBe("public, max-age=15, s-maxage=60");
    const page1 = await first.json();
    expect(page1.data).toHaveLength(10);
    expect(page1.meta.hasMore).toBe(true);
    const next = await GET(request(`phaseIds=regular&category=points&cursor=${page1.meta.nextCursor}`), context());
    const page2 = await next.json();
    expect(page2.data).toHaveLength(5);
    expect(page2.meta.nextCursor).toBeNull();
    expect(new Set([...page1.data, ...page2.data].map((row) => row.playerId)).size).toBe(15);
    const mismatch = await GET(request(`phaseIds=regular&category=rebounds&cursor=${page1.meta.nextCursor}`), context());
    expect(mismatch.status).toBe(400);
    addGame("g2", "regular", [{ id: "new", stats: { points: 99 } }], [], { revision: 2 });
    const stale = await GET(request(`phaseIds=regular&category=points&cursor=${page1.meta.nextCursor}`), context());
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe("STALE_CURSOR");
  });

  it("rejects a cursor after a synthetic accepted final-state revision update", async () => {
    addGame("g1", "regular", Array.from({ length: 12 }, (_, index) => ({ id: `p${index}`, stats: { points: index } })));
    const first = await readMobileRankingsWithDb(db, { ...standard, limit: 10 });
    const run = "run-g1";
    const finalState = JSON.parse((sqlite.prepare("SELECT final_state_json FROM league_komocontrol_match_finalizations_v1 WHERE run_id=?")
      .get(run) as { final_state_json: string }).final_state_json) as { home: { players: Array<{ statistics: { points: number } }> } };
    finalState.home.players[0].statistics.points = 99;
    const historyHash = (sqlite.prepare("SELECT history_hash FROM league_komocontrol_gameplay_heads WHERE run_id=?")
      .get(run) as { history_hash: string }).history_hash;
    const finalStateJson = JSON.stringify(finalState);
    const finalStateHash = sha(finalStateJson);
    const finalizationJson = JSON.stringify({ runId: run, finalizedHistoryRevision: 2,
      finalizedHistoryHash: historyHash, finalStateHash, incidentReport: null });
    const finalizationHash = sha(finalizationJson);
    sqlite.prepare("UPDATE league_komocontrol_gameplay_heads SET event_history_revision=2, finalization_hash=? WHERE run_id=?")
      .run(finalizationHash, run);
    sqlite.prepare("UPDATE league_komocontrol_match_finalizations_v1 SET finalized_history_revision=2, final_state_json=?, final_state_hash=?, finalization_json=?, finalization_hash=? WHERE run_id=?")
      .run(finalStateJson, finalStateHash, finalizationJson, finalizationHash, run);
    const response = await GET(request(`phaseIds=regular&category=points&cursor=${first.meta.nextCursor}`), context());
    expect(response.status).toBe(409);
    const fresh = await readMobileRankingsWithDb(db, standard);
    expect(fresh.data[0]).toMatchObject({ playerId: "p0", total: 99 });
  });

  it("uses canonical ID as the final stable tie breaker", async () => {
    addGame("g1", "regular", [
      { id: "z-player", name: "Same", stats: { points: 5 } },
      { id: "a-player", name: "Same", stats: { points: 5 } },
    ]);
    const result = await readMobileRankingsWithDb(db, standard);
    expect(result.data.map((row) => row.playerId)).toEqual(["a-player", "z-player"]);
  });

  it("returns empty success and safe bounded errors", async () => {
    const empty = await GET(request("phaseIds=regular&category=points"), context());
    expect(await empty.json()).toEqual({ data: [], meta: { competitionId: "central", phaseIds: ["regular"],
      category: "points", nextCursor: null, hasMore: false } });
    for (const [query, code] of [
      ["category=points", "INVALID_PHASES"], ["phaseIds=regular&category=steals", "INVALID_CATEGORY"],
      ["phaseIds=regular&category=points&limit=51", "INVALID_LIMIT"],
      ["phaseIds=regular&category=points&cursor=bad!", "INVALID_CURSOR"],
      [`phaseIds=${Array.from({ length: 13 }, (_, i) => `p${i}`).join(",")}&category=points`, "INVALID_PHASES"],
    ]) {
      const response = await GET(request(query), context());
      expect(response.status).toBe(400);
      expect((await response.json()).error.code).toBe(code);
    }
  });

  it("keeps D1 queries constant as games, players and rows grow", async () => {
    for (let player = 0; player < 30; player++) addPlayer(`p${player}`, `Player ${player}`);
    for (let game = 0; game < 20; game++) addGame(`g${game}`, "regular",
      Array.from({ length: 30 }, (_, player) => ({ id: `p${player}`, stats: { points: player } })));
    addGame("unrelated", "series", [{ id: "unrelated", stats: { points: 100 } }]);
    const response = await readMobileRankingsWithDb(db, { ...standard, limit: 50 });
    expect(response.data).toHaveLength(30);
    expect(response.data[0]).toMatchObject({ gamesPlayed: 20 });
    expect(queryCount).toBe(5);
    expect(eventRows).toBe(40);
    expect(JSON.stringify(response)).not.toContain("historyHash");
    expect(JSON.stringify(response)).not.toContain("event_json");
  });
});
