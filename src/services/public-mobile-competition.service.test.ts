import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: vi.fn() }));

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { calculateStandings } from "@/lib/standings-calculator";
import { GET as getCompetition } from "@/app/api/public/v1/competitions/[competitionId]/route";
import { GET as getPhase } from "@/app/api/public/v1/competitions/[competitionId]/phases/[phaseId]/route";
import { GET as getGames } from "@/app/api/public/v1/competitions/[competitionId]/games/route";
import { GET as getHome } from "@/app/api/public/v1/competitions/[competitionId]/home/route";
import { GET as getStandings } from "@/app/api/public/v1/competitions/[competitionId]/standings/route";
import {
  listGamesWithDb,
  readCompetitionDetailWithDb,
  readCompetitionHomeWithDb,
  readPhaseDetailWithDb,
  readStandingsWithDb,
} from "./public-mobile-competition.service";

const request = (path: string) => new Request(`https://example.test${path}`);
const competitionContext = (id = "central") => ({ params: Promise.resolve({ competitionId: id }) });
const phaseContext = (competitionId = "central", phaseId = "regular") => ({ params: Promise.resolve({ competitionId, phaseId }) });

describe("Phase A2 public mobile competition API", () => {
  let sqlite: DatabaseSync;
  let db: D1DatabaseBinding;
  let queryCount: number;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`
      CREATE TABLE league_organizations (id TEXT PRIMARY KEY, slug TEXT, name TEXT, logo_url TEXT, status TEXT, publication_status TEXT);
      CREATE TABLE league_seasons (id TEXT PRIMARY KEY, name TEXT, slug TEXT, starts_on TEXT, ends_on TEXT, status TEXT);
      CREATE TABLE league_competitions (id TEXT PRIMARY KEY, organization_id TEXT, season_id TEXT, slug TEXT, name TEXT, type TEXT, logo_url TEXT, status TEXT);
      CREATE TABLE league_competition_publication (competition_id TEXT PRIMARY KEY, lifecycle_status TEXT);
      CREATE TABLE league_phases (id TEXT PRIMARY KEY, competition_id TEXT, name TEXT, format TEXT, phase_type TEXT, lifecycle_status TEXT, phase_order INTEGER, order_index INTEGER, previous_phase_id TEXT, settings_json TEXT);
      CREATE TABLE league_phase_rules (phase_id TEXT PRIMARY KEY, phase_kind TEXT, wins_required INTEGER, carry_over_enabled INTEGER, carry_over_source_phase_id TEXT, settings_json TEXT);
      CREATE TABLE league_teams (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, logo_url TEXT);
      CREATE TABLE league_season_teams (id TEXT PRIMARY KEY, season_id TEXT, team_id TEXT, display_name TEXT);
      CREATE TABLE league_competition_teams (id TEXT PRIMARY KEY, competition_id TEXT, season_team_id TEXT, status TEXT);
      CREATE TABLE league_games (id TEXT PRIMARY KEY, competition_id TEXT, phase_id TEXT, schedule_id TEXT, series_matchup_id TEXT, series_round_number INTEGER, cycle_number INTEGER, round_number INTEGER, game_order INTEGER, round_label TEXT, scheduled_date TEXT, scheduled_time TEXT, venue TEXT, home_team_id TEXT, away_team_id TEXT, home_score INTEGER, away_score INTEGER, status TEXT, result_source TEXT);
      CREATE TABLE league_game_administrative_results (id TEXT PRIMARY KEY, game_id TEXT, official_home_score INTEGER, official_away_score INTEGER, home_standings_points_override INTEGER, away_standings_points_override INTEGER);
      CREATE TABLE league_komocontrol_gameplay_game_claims (game_id TEXT PRIMARY KEY, run_id TEXT);
      CREATE TABLE league_komocontrol_gameplay_heads (run_id TEXT PRIMARY KEY, lifecycle TEXT);
      CREATE TABLE league_phase_schedules (id TEXT PRIMARY KEY, competition_id TEXT, phase_id TEXT);
      CREATE TABLE league_round_robin_planning_slots (id TEXT PRIMARY KEY, schedule_id TEXT, round_number INTEGER, game_order INTEGER);
      CREATE TABLE league_series_planning_slots (id TEXT PRIMARY KEY, competition_id TEXT, phase_id TEXT, matchup_id TEXT, series_round_number INTEGER, real_game_id TEXT);
      CREATE TABLE league_competition_venues (id TEXT PRIMARY KEY, competition_id TEXT, name TEXT, address TEXT, map_url TEXT);

      INSERT INTO league_organizations VALUES
        ('organization_komobasket','komobasket','KomoBasket',NULL,'active','unpublished'),
        ('hosted-org','hosted','Hosted',NULL,'active','published'),
        ('private-org','private','Private',NULL,'active','unpublished');
      INSERT INTO league_seasons VALUES
        ('season-old','2025-26','2025-26','2025-09-01',NULL,'completed'),
        ('season-new','Season 2027–28','2027-28','2027-09-01',NULL,'active');
      INSERT INTO league_competitions VALUES
        ('central','organization_komobasket','season-new','central','Central League','league','/central.png','active'),
        ('hosted-comp','hosted-org','season-new','hosted','Hosted Cup','cup',NULL,'active'),
        ('hidden-comp','private-org','season-new','hidden','Hidden','league',NULL,'active'),
        ('draft-comp','organization_komobasket','season-new','draft','Draft','league',NULL,'draft'),
        ('old-comp','organization_komobasket','season-old','old','Old','league',NULL,'active');
      INSERT INTO league_competition_publication VALUES
        ('central','online'),('hosted-comp','online'),('hidden-comp','online'),('draft-comp','under_construction'),('old-comp','online');
      INSERT INTO league_phases VALUES
        ('regular','central','Regular','standings','regular','active',1,1,NULL,'{}'),
        ('series','central','Playoffs','series','playoffs','active',2,2,'regular','{}'),
        ('custom','central','Custom','custom','custom','finalized',3,3,'series','{}'),
        ('branch','central','Branch','standings','play_out','active',4,4,'regular','{}'),
        ('private-phase','central','Private Phase','custom','custom','draft',5,5,NULL,'{}'),
        ('hosted-phase','hosted-comp','Hosted Phase','standings','regular','active',1,1,NULL,'{}'),
        ('hidden-phase','hidden-comp','Hidden Phase','standings','regular','active',1,1,NULL,'{}');
      ALTER TABLE league_phases ADD COLUMN tournament_name TEXT;
      INSERT INTO league_phase_rules VALUES
        ('regular','regular_season',NULL,0,NULL,'{"participantConfiguration":{"participantSourceType":"competition_participants"},"pointsForWin":3,"pointsForLoss":1,"tieBreakers":["head_to_head_point_diff"]}'),
        ('series','playoffs',2,0,NULL,'{"bracketConfiguration":{"matchups":[{"id":"m1","slotA":{"type":"fixed_team","teamId":"a"},"slotB":{"type":"fixed_team","teamId":"b"}}]}}'),
        ('custom','custom',NULL,0,NULL,'{}'),('branch','play_out',NULL,0,NULL,'{}'),
        ('hosted-phase','regular_season',NULL,0,NULL,'{}'),('hidden-phase','regular_season',NULL,0,NULL,'{}');
      INSERT INTO league_teams VALUES
        ('a','organization_komobasket','Alpha','/a.png'),
        ('b','organization_komobasket','Beta','/b.png'),
        ('c','organization_komobasket','Gamma',NULL),
        ('h','hosted-org','Hosted Team',NULL),
        ('h2','hosted-org','Hosted Second',NULL),
        ('x','private-org','Private Team',NULL);
      INSERT INTO league_season_teams VALUES
        ('sa','season-new','a','Alpha'),('sb','season-new','b','Beta'),
        ('sc','season-new','c','Gamma'),('sh','season-new','h','Hosted Team'),
        ('sh2','season-new','h2','Hosted Second'),
        ('sx','season-new','x','Private Team');
      INSERT INTO league_competition_teams VALUES
        ('ca','central','sa','active'),('cb','central','sb','active'),('cc','central','sc','active'),
        ('ch','hosted-comp','sh','active'),('ch2','hosted-comp','sh2','active'),('cx','hidden-comp','sx','active');
      INSERT INTO league_games VALUES
        ('g1','central','regular',NULL,NULL,NULL,1,1,1,'Round 1','2027-10-01','18:00','Arena','a','b',80,70,'completed','manual'),
        ('g7','central','regular',NULL,NULL,NULL,1,2,1,'Round 2','2027-10-02','19:00','Arena','b','a',90,80,'scheduled',NULL),
        ('g2','central','regular',NULL,NULL,NULL,1,3,1,'Round 3','2027-10-03','18:00','Arena','a','c',77,66,'scheduled',NULL),
        ('g3','central','regular',NULL,NULL,NULL,1,4,1,'Round 4','2027-10-04','18:00','Arena','b','c',NULL,NULL,'postponed',NULL),
        ('g4','central','regular',NULL,NULL,NULL,1,5,1,'Round 5','2027-10-05','18:00','Arena','b','c',NULL,NULL,'cancelled',NULL),
        ('g5','central','series',NULL,'m1',1,1,1,1,'Series 1','2027-10-06','20:00','Arena','a','b',NULL,NULL,'scheduled',NULL),
        ('g6','central','series',NULL,'m1',2,1,2,1,'Series 2','2027-10-07','20:00','Arena','a','b',NULL,NULL,'scheduled',NULL),
        ('g8','central','branch',NULL,NULL,NULL,1,1,1,'Branch 1','2027-10-08','18:00','Arena','a','c',NULL,NULL,'scheduled',NULL),
        ('cross-game','central','regular',NULL,NULL,NULL,1,99,1,'Private Round','2027-09-01','18:00','Arena','x','a',NULL,NULL,'scheduled',NULL),
        ('hosted-game','hosted-comp','hosted-phase',NULL,NULL,NULL,1,1,1,'Hosted Round','2027-10-01','18:00','','h','h2',NULL,NULL,'scheduled',NULL),
        ('hidden-game','hidden-comp','hidden-phase',NULL,NULL,NULL,1,1,1,'','2027-10-01','18:00','','x','x',NULL,NULL,'scheduled',NULL);
      INSERT INTO league_game_administrative_results VALUES ('ar1','g7',20,0,2,0);
      INSERT INTO league_komocontrol_gameplay_game_claims VALUES ('g6','run-live'),('hosted-game','run-hosted');
      INSERT INTO league_komocontrol_gameplay_heads VALUES ('run-live','live'),('run-hosted','live');
      INSERT INTO league_competition_venues VALUES ('venue1','central','Arena','Main Street','https://example.test/map');
    `);
    queryCount = 0;
    const statement = (sql: string, values: unknown[] = []): D1PreparedStatement => ({
      bind: (...bindings: unknown[]) => statement(sql, bindings),
      all: async <T,>() => {
        queryCount++;
        return { success: true, results: sqlite.prepare(sql).all(...values) as T[] };
      },
      first: async <T,>() => {
        queryCount++;
        return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null;
      },
      run: async () => { throw new Error("A2 must not write to D1"); },
    });
    db = { prepare: statement, batch: async () => { throw new Error("A2 must not batch writes"); } };
    vi.mocked(getKomoBasketCloudflareEnv).mockResolvedValue({ NEWS_DB: db } as never);
  });

  afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

  function addGame(id: string, date: string | null, time: string | null, status = "scheduled", homeScore: number | null = null, awayScore: number | null = null) {
    sqlite.prepare(`INSERT INTO league_games
      (id,competition_id,phase_id,cycle_number,round_number,game_order,round_label,scheduled_date,scheduled_time,venue,home_team_id,away_team_id,home_score,away_score,status)
      VALUES (?,'central','regular',1,6,1,'Round 6',?,?,'Arena','a','b',?,?,?)`)
      .run(id, date, time, homeScore, awayScore, status);
  }

  function addTournament(rootId = "cup-root") {
    sqlite.prepare(`UPDATE league_phases SET tournament_name=? WHERE id='regular'`).run(" KomoBasket League ");
    sqlite.prepare(`INSERT INTO league_phases
      (id,competition_id,name,format,phase_type,lifecycle_status,phase_order,order_index,previous_phase_id,settings_json,tournament_name)
      VALUES (?,'central','Cup Opening','series','cup','active',5,5,NULL,'{}',' Komo Cup ')`).run(rootId);
    sqlite.prepare(`INSERT INTO league_phases
      (id,competition_id,name,format,phase_type,lifecycle_status,phase_order,order_index,previous_phase_id,settings_json)
      VALUES ('cup-final','central','Cup Final','series','cup','active',6,6,?,'{}')`).run(rootId);
  }

  function addTournamentGame(id: string, phaseId: string, date: string, status = "scheduled",
    homeScore: number | null = null, awayScore: number | null = null) {
    sqlite.prepare(`INSERT INTO league_games
      (id,competition_id,phase_id,cycle_number,round_number,game_order,round_label,scheduled_date,scheduled_time,
       venue,home_team_id,away_team_id,home_score,away_score,status)
      VALUES (?,'central',?,1,1,1,'Cup Round',?,'18:00','Arena','a','b',?,?,?)`)
      .run(id, phaseId, date, homeScore, awayScore, status);
  }

  function markLive(id: string) {
    sqlite.prepare("INSERT INTO league_komocontrol_gameplay_game_claims VALUES (?,?)").run(id, `run-${id}`);
    sqlite.prepare("INSERT INTO league_komocontrol_gameplay_heads VALUES (?,'live')").run(`run-${id}`);
  }

  it("returns public competition detail with ordered phases, current phase and simultaneous activity", async () => {
    const detail = await readCompetitionDetailWithDb(db, "central");
    expect(detail).toMatchObject({ id: "central", organizationId: "organization_komobasket", seasonId: "season-new", currentPhaseId: "regular", activePhaseIds: ["regular", "series", "branch"] });
    expect(detail.phases.map((phase) => phase.id)).toEqual(["regular", "series", "custom", "branch"]);
    expect(detail.phases.map((phase) => phase.availableViews)).toEqual([
      ["schedule", "results", "standings"], ["matchups", "schedule", "results"], [], ["schedule", "results"],
    ]);
    expect(detail.phases[0]).toMatchObject({ isCurrent: true, rootPhaseId: "regular", previousPhaseId: null });
    expect(detail.phases[1]).toMatchObject({ isCurrent: false, rootPhaseId: "regular", previousPhaseId: "regular" });
    expect(queryCount).toBe(3);
    expect(detail.tournamentGroups).toEqual([{ id: "regular", name: "Regular", phaseIds: ["regular", "series", "custom", "branch"], currentPhaseId: "regular" }]);
    expect(Object.keys(detail).sort()).toEqual(["activePhaseIds", "currentPhaseId", "id", "logoUrl", "name", "organizationId", "phases", "seasonId", "slug", "type", "tournamentGroups"].sort());
  });

  it("rejects hidden, draft and old competitions while preserving published hosted access", async () => {
    await expect(readCompetitionDetailWithDb(db, "hidden-comp")).rejects.toMatchObject({ code: "COMPETITION_NOT_FOUND" });
    await expect(readCompetitionDetailWithDb(db, "draft-comp")).rejects.toMatchObject({ code: "COMPETITION_NOT_FOUND" });
    await expect(readCompetitionDetailWithDb(db, "old-comp")).rejects.toMatchObject({ code: "COMPETITION_NOT_FOUND" });
    expect((await readCompetitionDetailWithDb(db, "hosted-comp")).organizationId).toBe("hosted-org");
  });

  it("projects ordered League and Cup groups using website names and group-local current phases", async () => {
    addTournament();
    addTournamentGame("cup-scheduled", "cup-root", "2027-11-01");
    const detail = await readCompetitionDetailWithDb(db, "central");
    expect(detail.currentPhaseId).toBe("regular");
    expect(detail.tournamentGroups).toEqual([
      { id: "regular", name: "KomoBasket League", phaseIds: ["regular", "series", "custom", "branch"], currentPhaseId: "regular" },
      { id: "cup-root", name: "Komo Cup", phaseIds: ["cup-root", "cup-final"], currentPhaseId: "cup-root" },
    ]);
    expect(new Set(detail.tournamentGroups.flatMap((group) => group.phaseIds)).size).toBe(detail.phases.length);
    expect(queryCount).toBe(3);
    sqlite.exec("UPDATE league_phases SET tournament_name='  ' WHERE id='cup-root'");
    expect((await readCompetitionDetailWithDb(db, "central")).tournamentGroups[1].name).toBe("Cup Opening");
    sqlite.exec("UPDATE league_phases SET name='  ' WHERE id='cup-root'");
    expect((await readCompetitionDetailWithDb(db, "central")).tournamentGroups[1].name).toBe("cup-root");
  });

  it("fails safely for missing, cross-competition and cyclic predecessor graphs", async () => {
    for (const predecessor of ["missing", "hosted-phase", "series"]) {
      sqlite.prepare("UPDATE league_phases SET previous_phase_id=? WHERE id='regular'").run(predecessor);
      const response = await getCompetition(request("/api/public/v1/competitions/central"), competitionContext());
      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.json()).error.code).toBe("CATALOGUE_UNAVAILABLE");
    }
  });

  it("advances current selection by unresolved activity rather than highest phase order", async () => {
    sqlite.exec("UPDATE league_games SET status='completed',home_score=50,away_score=40 WHERE id IN ('g2','g3','g4')");
    const detail = await readCompetitionDetailWithDb(db, "central");
    expect(detail.currentPhaseId).toBe("series");
    expect(detail.activePhaseIds).toEqual(["series", "branch"]);
    expect((await readPhaseDetailWithDb(db, "central", "series")).isCurrent).toBe(true);
  });

  it("serves phase presentation and rejects cross-competition phases", async () => {
    const regular = await readPhaseDetailWithDb(db, "central", "regular");
    expect(regular.isCurrent).toBe(true);
    expect(regular.rounds.map((round) => round.number)).toEqual([1, 2, 3, 4, 5]);
    expect(regular.matchups).toEqual([]);
    const series = await readPhaseDetailWithDb(db, "central", "series");
    expect(series.availableViews).toEqual(["matchups", "schedule", "results"]);
    expect(series.matchups).toHaveLength(1);
    expect(series.matchups[0]).toMatchObject({ id: "m1", teamAId: "a", teamBId: "b" });
    expect((await readPhaseDetailWithDb(db, "central", "custom")).availableViews).toEqual([]);
    await expect(readPhaseDetailWithDb(db, "central", "hosted-phase")).rejects.toMatchObject({ code: "PHASE_NOT_FOUND" });
    await expect(readPhaseDetailWithDb(db, "central", "private-phase")).rejects.toMatchObject({ code: "PHASE_NOT_FOUND" });
    await expect(readPhaseDetailWithDb(db, "hidden-comp", "hidden-phase")).rejects.toMatchObject({ code: "COMPETITION_NOT_FOUND" });
    expect(Object.keys(series).sort()).toEqual(["availableViews", "competitionId", "format", "id", "isCurrent", "lifecycleStatus", "matchups", "name", "order", "phaseType", "previousPhaseId", "rootPhaseId", "rounds"].sort());
  });

  it("uses a fixed number of phase queries regardless of game count", async () => {
    await readPhaseDetailWithDb(db, "central", "regular");
    expect(queryCount).toBe(4);
    queryCount = 0;
    await readPhaseDetailWithDb(db, "central", "series");
    expect(queryCount).toBe(6);
  });

  it("pages deterministically and validates phase, team, status and round filters", async () => {
    const first = await listGamesWithDb(db, "central", { limit: 2 });
    expect(first.data.map((game) => game.id)).toEqual(["g1", "g7"]);
    expect(first.meta.hasMore).toBe(true);
    expect(first.meta.nextCursor).toBeTruthy();
    const second = await listGamesWithDb(db, "central", { limit: 2, cursor: first.meta.nextCursor! });
    expect(second.data.map((game) => game.id)).toEqual(["g2", "g3"]);
    expect((await listGamesWithDb(db, "central", { limit: 20, phaseId: "series" })).data.map((game) => game.id)).toEqual(["g5", "g6"]);
    expect((await listGamesWithDb(db, "central", { limit: 20, round: 4 })).data.map((game) => game.id)).toEqual(["g3"]);
    expect((await listGamesWithDb(db, "central", { limit: 20, status: "live" })).data.map((game) => game.id)).toEqual(["g6"]);
    expect((await listGamesWithDb(db, "central", { limit: 20, status: "postponed" })).data.map((game) => game.id)).toEqual(["g3"]);
    expect((await listGamesWithDb(db, "central", { limit: 20, status: "cancelled" })).data.map((game) => game.id)).toEqual(["g4"]);
    expect((await listGamesWithDb(db, "central", { limit: 20, status: "completed" })).data.map((game) => game.id)).toEqual(["g1", "g7"]);
    expect((await listGamesWithDb(db, "central", { limit: 20, teamId: "c" })).data.map((game) => game.id)).toEqual(["g2", "g3", "g4", "g8"]);
    await expect(listGamesWithDb(db, "central", { limit: 20, phaseId: "hosted-phase" })).rejects.toMatchObject({ code: "PHASE_NOT_FOUND" });
    await expect(listGamesWithDb(db, "central", { limit: 20, teamId: "h" })).rejects.toMatchObject({ code: "TEAM_NOT_FOUND" });
    await expect(listGamesWithDb(db, "central", { limit: 20, cursor: first.meta.nextCursor!, status: "completed" })).rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(listGamesWithDb(db, "hidden-comp", { limit: 20 })).rejects.toMatchObject({ code: "COMPETITION_NOT_FOUND" });
  });

  it("B2.1 keeps omitted and explicit ascending order identical, including existing cursors and DTOs", async () => {
    const implicit = await listGamesWithDb(db, "central", { limit: 2 });
    const explicit = await listGamesWithDb(db, "central", { limit: 2, order: "asc" });
    expect(explicit).toEqual(implicit);
    expect(implicit.data.map((game) => game.id)).toEqual(["g1", "g7"]);
    const implicitNext = await listGamesWithDb(db, "central", { limit: 2, cursor: implicit.meta.nextCursor! });
    const explicitNext = await listGamesWithDb(db, "central", { limit: 2, order: "asc", cursor: implicit.meta.nextCursor! });
    expect(explicitNext).toEqual(implicitNext);
    expect(Object.keys(explicit.data[0]).sort()).toEqual(Object.keys(implicit.data[0]).sort());
    const routeImplicit = await getGames(request("/api/public/v1/competitions/central/games?limit=2"), competitionContext());
    const routeExplicit = await getGames(request("/api/public/v1/competitions/central/games?limit=2&order=asc"), competitionContext());
    expect(await routeExplicit.json()).toEqual(await routeImplicit.json());
    expect(routeExplicit.headers.get("cache-control")).toBe("public, max-age=30, s-maxage=60");
  });

  it("scopes Games in SQL before ordering and pagination, composing root with status, phase and team", async () => {
    addTournament();
    addTournamentGame("cup-result", "cup-root", "2027-10-09", "completed", 70, 60);
    addTournamentGame("cup-upcoming", "cup-final", "2027-11-01");
    addTournamentGame("cup-upcoming-2", "cup-final", "2027-11-02");
    expect((await listGamesWithDb(db, "central", { rootPhaseId: "cup-root", limit: 1 })).data.map((game) => game.id)).toEqual(["cup-result"]);
    const scheduled = await listGamesWithDb(db, "central", { rootPhaseId: "cup-root", status: "scheduled", order: "asc", teamId: "a", limit: 1 });
    expect(scheduled.data.map((game) => game.id)).toEqual(["cup-upcoming"]);
    expect(scheduled.meta.hasMore).toBe(true);
    const next = await listGamesWithDb(db, "central", { rootPhaseId: "cup-root", status: "scheduled", teamId: "a", limit: 1, cursor: scheduled.meta.nextCursor! });
    expect(next.data.map((game) => game.id)).toEqual(["cup-upcoming-2"]);
    expect((await listGamesWithDb(db, "central", { rootPhaseId: "cup-root", status: "completed", order: "desc", limit: 5 })).data.map((game) => game.id)).toEqual(["cup-result"]);
    expect((await listGamesWithDb(db, "central", { rootPhaseId: "cup-root", phaseId: "cup-final", limit: 5 })).data.map((game) => game.id)).toEqual(["cup-upcoming", "cup-upcoming-2"]);
    await expect(listGamesWithDb(db, "central", { rootPhaseId: "cup-root", phaseId: "regular", limit: 5 }))
      .rejects.toMatchObject({ code: "PHASE_NOT_FOUND" });
    const scopedRoute = await getGames(request("/api/public/v1/competitions/central/games?rootPhaseId=cup-root&status=scheduled&order=asc&limit=1"), competitionContext());
    expect(scopedRoute.status).toBe(200);
    expect((await scopedRoute.json()).data[0].id).toBe("cup-upcoming");
    const invalidPair = await getGames(request("/api/public/v1/competitions/central/games?rootPhaseId=cup-root&phaseId=regular"), competitionContext());
    expect(invalidPair.status).toBe(404);
    expect(invalidPair.headers.get("cache-control")).toBe("no-store");
    expect((await invalidPair.json()).error.code).toBe("PHASE_NOT_FOUND");
    for (const invalid of ["cup-final", "hosted-phase", "missing"]) {
      await expect(listGamesWithDb(db, "central", { rootPhaseId: invalid, limit: 5 }))
        .rejects.toMatchObject({ code: "TOURNAMENT_NOT_FOUND" });
    }
    expect((await listGamesWithDb(db, "central", { limit: 1 })).data[0].id).toBe("g1");
  });

  it("binds Games cursors to the selected root and rejects cross-root or unscoped reuse", async () => {
    addTournament();
    addTournamentGame("cup-1", "cup-root", "2027-11-01");
    addTournamentGame("cup-2", "cup-root", "2027-11-02");
    const league = await listGamesWithDb(db, "central", { rootPhaseId: "regular", limit: 1 });
    const cup = await listGamesWithDb(db, "central", { rootPhaseId: "cup-root", limit: 1 });
    expect(league.meta.nextCursor).toBeTruthy();
    expect(cup.meta.nextCursor).toBeTruthy();
    for (const [rootPhaseId, cursor] of [["cup-root", league.meta.nextCursor], ["regular", cup.meta.nextCursor]] as const) {
      await expect(listGamesWithDb(db, "central", { rootPhaseId, limit: 1, cursor: cursor! }))
        .rejects.toMatchObject({ code: "INVALID_CURSOR" });
    }
    await expect(listGamesWithDb(db, "central", { limit: 1, cursor: cup.meta.nextCursor! }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
    const route = await getGames(request(`/api/public/v1/competitions/central/games?rootPhaseId=cup-root&limit=1&cursor=${league.meta.nextCursor}`), competitionContext());
    expect(route.status).toBe(400);
    expect(route.headers.get("cache-control")).toBe("no-store");
    expect((await route.json()).error.code).toBe("INVALID_CURSOR");
  });

  it("B2.1 reverses the complete deterministic key and paginates both directions without gaps", async () => {
    addGame("tie-a", "2027-10-03", "18:00");
    addGame("tie-b", "2027-10-03", "18:00");
    addGame("undated", null, null);
    const ascending = (await listGamesWithDb(db, "central", { limit: 50 })).data.map((game) => game.id);
    const descending = (await listGamesWithDb(db, "central", { limit: 50, order: "desc" })).data.map((game) => game.id);
    expect(descending).toEqual([...ascending].reverse());
    expect(ascending.indexOf("tie-a")).toBeLessThan(ascending.indexOf("tie-b"));
    expect(descending.indexOf("tie-b")).toBeLessThan(descending.indexOf("tie-a"));
    for (const order of ["asc", "desc"] as const) {
      const received: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await listGamesWithDb(db, "central", { limit: 2, order, ...(cursor ? { cursor } : {}) });
        received.push(...page.data.map((game) => game.id));
        expect(page.meta.hasMore).toBe(Boolean(page.meta.nextCursor));
        cursor = page.meta.nextCursor ?? undefined;
      } while (cursor);
      expect(received).toEqual(order === "asc" ? ascending : descending);
      expect(new Set(received).size).toBe(received.length);
    }
  });

  it("B2.1 binds cursors to direction and rejects invalid order safely", async () => {
    const asc = await listGamesWithDb(db, "central", { limit: 1 });
    const desc = await listGamesWithDb(db, "central", { limit: 1, order: "desc" });
    await expect(listGamesWithDb(db, "central", { limit: 1, order: "desc", cursor: asc.meta.nextCursor! }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
    await expect(listGamesWithDb(db, "central", { limit: 1, order: "asc", cursor: desc.meta.nextCursor! }))
      .rejects.toMatchObject({ code: "INVALID_CURSOR" });
    for (const [order, cursor] of [["desc", asc.meta.nextCursor!], ["asc", desc.meta.nextCursor!]] as const) {
      const response = await getGames(request(`/api/public/v1/competitions/central/games?limit=1&order=${order}&cursor=${cursor}`), competitionContext());
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.json()).error.code).toBe("INVALID_CURSOR");
    }
    for (const path of ["order=reverse", "order=ASC", "order=asc&order=desc", "order=%27%3Bdrop%20table"] ) {
      const response = await getGames(request(`/api/public/v1/competitions/central/games?${path}`), competitionContext());
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.json()).error.code).toBe("INVALID_FILTER");
    }
  });

  it("B2.1 serves nearest team fixtures and newest team results with unchanged query counts", async () => {
    for (let index = 1; index <= 6; index++) {
      addGame(`future-${index}`, `2027-11-${String(index).padStart(2, "0")}`, "18:00");
      addGame(`result-${index}`, `2027-10-${String(index + 10).padStart(2, "0")}`, "18:00", "completed", 70 + index, 60);
    }
    queryCount = 0;
    const upcoming = await getGames(request("/api/public/v1/competitions/central/games?teamId=a&status=scheduled&order=asc&limit=5"), competitionContext());
    expect(upcoming.status).toBe(200);
    expect((await upcoming.json()).data.map((game: { id: string }) => game.id)).toEqual(["g2", "g5", "g8", "future-1", "future-2"]);
    expect(queryCount).toBe(3);
    queryCount = 0;
    const recent = await getGames(request("/api/public/v1/competitions/central/games?teamId=a&status=completed&order=desc&limit=5"), competitionContext());
    expect(recent.status).toBe(200);
    expect((await recent.json()).data.map((game: { id: string }) => game.id))
      .toEqual(["result-6", "result-5", "result-4", "result-3", "result-2"]);
    expect(queryCount).toBe(3);
  });

  it("B2.1 applies ordering to every existing public status without redefining it", async () => {
    addGame("scheduled-new", "2027-12-01", "18:00");
    addGame("completed-new", "2027-12-02", "18:00", "completed", 80, 70);
    addGame("postponed-new", "2027-12-03", "18:00", "postponed");
    addGame("cancelled-new", "2027-12-04", "18:00", "cancelled");
    addGame("live-new", "2027-12-05", "18:00");
    sqlite.prepare("INSERT INTO league_komocontrol_gameplay_game_claims VALUES (?,?)").run("live-new", "run-live-new");
    sqlite.prepare("INSERT INTO league_komocontrol_gameplay_heads VALUES (?,?)").run("run-live-new", "live");
    for (const status of ["scheduled", "live", "completed", "postponed", "cancelled"] as const) {
      const asc = (await listGamesWithDb(db, "central", { limit: 50, status })).data;
      const desc = (await listGamesWithDb(db, "central", { limit: 50, status, order: "desc" })).data;
      expect(desc.map((game) => game.id)).toEqual(asc.map((game) => game.id).reverse());
      expect(desc.every((game) => game.status === status)).toBe(true);
    }
  });

  it("projects official results, null scheduled scores, postponed/cancelled and live URL without internals", async () => {
    const games = (await listGamesWithDb(db, "central", { limit: 20 })).data;
    const byId = new Map(games.map((game) => [game.id, game]));
    expect(byId.get("g1")).toMatchObject({ status: "completed", homeScore: 80, awayScore: 70 });
    expect(byId.get("g7")).toMatchObject({ status: "completed", homeScore: 20, awayScore: 0 });
    expect(byId.get("g2")).toMatchObject({ status: "scheduled", homeScore: null, awayScore: null, scheduledDate: "2027-10-03", scheduledTime: "18:00" });
    expect(byId.get("g3")?.status).toBe("postponed");
    expect(byId.get("g4")?.status).toBe("cancelled");
    expect(byId.get("g6")).toMatchObject({ status: "live", webLiveUrl: "https://komobasket.gr/competitions/games/g6/live" });
    expect((await listGamesWithDb(db, "hosted-comp", { limit: 20 })).data[0]).toMatchObject({
      id: "hosted-game", status: "live", webLiveUrl: "https://komobasket.gr/hosted/competitions/games/hosted-game/live",
    });
    expect(byId.get("g1")?.venue).toEqual({ name: "Arena", address: "Main Street", mapUrl: "https://example.test/map" });
    expect(Object.keys(byId.get("g1")!).sort()).toEqual(["awayScore", "awayTeam", "competitionId", "homeScore", "homeTeam", "id", "phaseId", "round", "roundLabel", "scheduledDate", "scheduledTime", "status", "venue", "webLiveUrl"].sort());
    expect(games.some((game) => game.id === "hidden-game")).toBe(false);
    expect(games.some((game) => game.id === "cross-game")).toBe(false);
    expect(queryCount).toBe(4);
  });

  it("reuses the authoritative standings calculator with tie rules and administrative overrides", async () => {
    const standings = await readStandingsWithDb(db, "central", "regular");
    const expected = calculateStandings({
      phaseId: "regular",
      teams: [{ id: "a", name: "Alpha" }, { id: "b", name: "Beta" }, { id: "c", name: "Gamma" }],
      games: [
        { id: "g1", phaseId: "regular", homeTeamId: "a", awayTeamId: "b", homeScore: 80, awayScore: 70, status: "completed" },
        { id: "g7", phaseId: "regular", homeTeamId: "b", awayTeamId: "a", homeScore: 20, awayScore: 0, status: "completed", homeStandingsPointsOverride: 2, awayStandingsPointsOverride: 0 },
      ],
      rules: { pointsForWin: 3, pointsForLoss: 1 },
      tieBreakers: ["head_to_head_point_diff"],
    });
    expect(standings.map((row) => row.teamId)).toEqual(expected.orderedRows.map((row) => row.teamId));
    expect(standings[0]).toMatchObject({ teamId: "b", rank: 1, standingsPoints: 3, gamesPlayed: 2 });
    expect(standings[1]).toMatchObject({ teamId: "a", rank: 2, standingsPoints: 3, gamesPlayed: 2 });
    expect(Object.keys(standings[0]).sort()).toEqual(["gamesPlayed", "losses", "pointDifference", "pointsAgainst", "pointsFor", "rank", "standingsPoints", "teamId", "teamLogoUrl", "teamName", "wins"].sort());
    expect(queryCount).toBe(4);
    await expect(readStandingsWithDb(db, "central", "series")).rejects.toMatchObject({ code: "STANDINGS_NOT_AVAILABLE" });
    await expect(readStandingsWithDb(db, "central", "branch")).rejects.toMatchObject({ code: "STANDINGS_NOT_AVAILABLE" });
    await expect(readStandingsWithDb(db, "central", "hosted-phase")).rejects.toMatchObject({ code: "PHASE_NOT_FOUND" });
    await expect(readStandingsWithDb(db, "hidden-comp", "hidden-phase")).rejects.toMatchObject({ code: "COMPETITION_NOT_FOUND" });
  });

  it("smokes all real A2 routes with safe envelopes, errors and cache headers", async () => {
    let response = await getCompetition(request("/api/public/v1/competitions/central"), competitionContext());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=1800");
    expect((await response.json()).data.currentPhaseId).toBe("regular");

    response = await getPhase(request("/api/public/v1/competitions/central/phases/series"), phaseContext("central", "series"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=1800");
    expect((await response.json()).data.matchups).toHaveLength(1);

    response = await getGames(request("/api/public/v1/competitions/central/games?status=completed&limit=1"), competitionContext());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30, s-maxage=60");
    expect(Object.keys(await response.json()).sort()).toEqual(["data", "meta"]);

    response = await getStandings(request("/api/public/v1/competitions/central/standings?phaseId=regular"), competitionContext());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
    expect((await response.json()).data).toHaveLength(3);

    response = await getGames(request("/api/public/v1/competitions/central/games?status=finished"), competitionContext());
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_FILTER");
    response = await getGames(request("/api/public/v1/competitions/central/games?limit=51"), competitionContext());
    expect(response.status).toBe(400);
    response = await getGames(request("/api/public/v1/competitions/central/games?cursor=%%%"), competitionContext());
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_CURSOR");
    response = await getStandings(request("/api/public/v1/competitions/central/standings?phaseId=series"), competitionContext());
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("STANDINGS_NOT_AVAILABLE");
    response = await getCompetition(request("/api/public/v1/competitions/hidden-comp"), competitionContext("hidden-comp"));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("COMPETITION_NOT_FOUND");
    response = await getStandings(request("/api/public/v1/competitions/central/standings"), competitionContext());
    expect(response.status).toBe(400);
    response = await getPhase(request("/api/public/v1/competitions/central/phases/hosted-phase"), phaseContext("central", "hosted-phase"));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("PHASE_NOT_FOUND");
  });

  it("masks database failures without SQL or stack traces", async () => {
    vi.mocked(getKomoBasketCloudflareEnv).mockRejectedValueOnce(new Error("internal SQL details"));
    const response = await getCompetition(request("/api/public/v1/competitions/central"), competitionContext());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: {
      code: "CATALOGUE_UNAVAILABLE", message: "Public competition data is temporarily unavailable.",
    } });
  });

  it("A3 serves a bounded central Home DTO with A2 phase parity and fixed query count", async () => {
    const detail = await readCompetitionDetailWithDb(db, "central");
    queryCount = 0;
    const response = await getHome(request("/api/public/v1/competitions/central/home"), competitionContext());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=15, s-maxage=30");
    const { data: home } = await response.json();
    expect(home.competition).toEqual({ id: "central", organizationId: "organization_komobasket", seasonId: "season-new", slug: "central", name: "Central League", type: "league", logoUrl: "/central.png" });
    expect(home.currentPhaseId).toBe(detail.currentPhaseId);
    expect(home.activePhaseIds).toEqual(detail.activePhaseIds);
    expect(home.currentPhase).toEqual(detail.phases.find((phase) => phase.id === detail.currentPhaseId));
    expect(home.currentRound).toEqual({ number: 3, label: "Round 3" });
    expect(home.liveGames.map((game: { id: string }) => game.id)).toEqual(["g6"]);
    expect(home.upcomingGames.map((game: { id: string }) => game.id)).toEqual(["g2", "g5", "g8"]);
    expect(home.recentResults.map((game: { id: string }) => game.id)).toEqual(["g7", "g1"]);
    expect(home.recentResults[0]).toMatchObject({ status: "completed", homeScore: 20, awayScore: 0 });
    expect(home.standingsPreview).toHaveLength(3);
    expect(queryCount).toBe(9);
    expect(Object.keys(home).sort()).toEqual(["competition", "currentPhaseId", "currentPhase", "activePhaseIds", "currentRound", "liveGames", "upcomingGames", "recentResults", "standingsPreview"].sort());
    expect(Object.keys(home.liveGames[0]).sort()).toEqual(["awayScore", "awayTeam", "competitionId", "homeScore", "homeTeam", "id", "phaseId", "round", "roundLabel", "scheduledDate", "scheduledTime", "status", "venue", "webLiveUrl"].sort());
  });

  it("scopes Home phase, round and all bounded game sections to a selected tournament", async () => {
    addTournament();
    for (let index = 1; index <= 4; index++) {
      const id = `league-live-${index}`;
      addGame(id, `2027-10-${String(index).padStart(2, "0")}`, "17:00");
      markLive(id);
    }
    for (let index = 1; index <= 5; index++) addGame(`league-up-${index}`, `2027-10-${String(index + 10).padStart(2, "0")}`, "17:00");
    for (let index = 1; index <= 6; index++) addGame(`league-result-${index}`, `2027-12-${String(index).padStart(2, "0")}`, "17:00", "completed", 70, 60);
    addTournamentGame("cup-live", "cup-root", "2027-11-01");
    markLive("cup-live");
    addTournamentGame("cup-upcoming", "cup-root", "2027-11-02");
    addTournamentGame("cup-result", "cup-root", "2027-10-20", "completed", 60, 50);
    const baseline = await readCompetitionHomeWithDb(db, "central");
    expect(baseline.currentPhaseId).toBe("regular");
    queryCount = 0;
    const cup = await readCompetitionHomeWithDb(db, "central", "cup-root");
    expect(cup.currentPhaseId).toBe("cup-root");
    expect(cup.currentRound).toEqual({ number: 1, label: "Cup Round" });
    expect(cup.activePhaseIds).toEqual(["cup-root"]);
    expect(cup.liveGames.map((game) => game.id)).toEqual(["cup-live"]);
    expect(cup.upcomingGames.map((game) => game.id)).toEqual(["cup-upcoming"]);
    expect(cup.recentResults.map((game) => game.id)).toEqual(["cup-result"]);
    expect(cup.standingsPreview).toBeNull();
    expect(queryCount).toBe(7);
    const league = await readCompetitionHomeWithDb(db, "central", "regular");
    expect(league.currentPhaseId).toBe("regular");
    expect(league.standingsPreview).not.toBeNull();
    expect(league.liveGames.every((game) => game.phaseId !== "cup-root")).toBe(true);
    expect(league.upcomingGames.every((game) => game.phaseId !== "cup-root")).toBe(true);
    expect(league.recentResults.every((game) => game.phaseId !== "cup-root")).toBe(true);
    const response = await getHome(request("/api/public/v1/competitions/central/home?rootPhaseId=cup-root"), competitionContext());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=15, s-maxage=30");
    expect((await response.json()).data.currentPhaseId).toBe("cup-root");
  });

  it("returns an empty scoped Home safely and rejects invalid, foreign or descendant roots", async () => {
    addTournament();
    sqlite.exec(`INSERT INTO league_phases
      (id,competition_id,name,format,phase_type,lifecycle_status,phase_order,order_index,previous_phase_id,settings_json)
      VALUES ('empty-root','central','Empty','custom','custom','active',7,7,NULL,'{}')`);
    const empty = await readCompetitionHomeWithDb(db, "central", "empty-root");
    expect(empty.currentPhaseId).toBeNull();
    expect(empty.currentRound).toBeNull();
    expect(empty.liveGames).toEqual([]);
    expect(empty.upcomingGames).toEqual([]);
    expect(empty.recentResults).toEqual([]);
    expect(empty.standingsPreview).toBeNull();
    for (const invalid of ["cup-final", "hosted-phase", "missing"]) {
      const response = await getHome(request(`/api/public/v1/competitions/central/home?rootPhaseId=${invalid}`), competitionContext());
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect((await response.json()).error.code).toBe("TOURNAMENT_NOT_FOUND");
    }
    const duplicate = await getHome(request("/api/public/v1/competitions/central/home?rootPhaseId=regular&rootPhaseId=cup-root"), competitionContext());
    expect(duplicate.status).toBe(400);
    const hidden = await getHome(request("/api/public/v1/competitions/hidden-comp/home?rootPhaseId=hidden-phase"), competitionContext("hidden-comp"));
    expect(hidden.status).toBe(404);
    expect((await hidden.json()).error.code).toBe("COMPETITION_NOT_FOUND");
  });

  it("A3 rejects hidden and ineligible competitions while preserving hosted and central rules", async () => {
    for (const id of ["hidden-comp", "draft-comp", "old-comp"]) {
      const response = await getHome(request(`/api/public/v1/competitions/${id}/home`), competitionContext(id));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect((await response.json()).error.code).toBe("COMPETITION_NOT_FOUND");
    }
    const hosted = await readCompetitionHomeWithDb(db, "hosted-comp");
    expect(hosted.competition.organizationId).toBe("hosted-org");
    expect(hosted.liveGames[0]).toMatchObject({ id: "hosted-game", webLiveUrl: "https://komobasket.gr/hosted/competitions/games/hosted-game/live" });
    expect(hosted.standingsPreview).toBeNull();
    expect((await readCompetitionHomeWithDb(db, "central")).competition.organizationId).toBe("organization_komobasket");
  });

  it("A3 advances to the same series phase as A2 and returns no fabricated standings", async () => {
    sqlite.exec("UPDATE league_games SET status='completed',home_score=50,away_score=40 WHERE id IN ('g2','g3','g4')");
    const detail = await readCompetitionDetailWithDb(db, "central");
    queryCount = 0;
    const home = await readCompetitionHomeWithDb(db, "central");
    expect(home.currentPhaseId).toBe(detail.currentPhaseId);
    expect(home.activePhaseIds).toEqual(detail.activePhaseIds);
    expect(home.currentPhase?.format).toBe("series");
    expect(home.currentRound).toEqual({ number: 1, label: "Series 1" });
    expect(home.standingsPreview).toBeNull();
    expect(queryCount).toBe(7);
  });

  it("A3 returns null round and preview when no phase has unresolved public activity", async () => {
    sqlite.exec("UPDATE league_games SET status='completed',home_score=50,away_score=40 WHERE competition_id='central'");
    sqlite.exec("UPDATE league_komocontrol_gameplay_heads SET lifecycle='completed'");
    const detail = await readCompetitionDetailWithDb(db, "central");
    queryCount = 0;
    const home = await readCompetitionHomeWithDb(db, "central");
    expect(home.currentPhaseId).toBe(detail.currentPhaseId);
    expect(home.activePhaseIds).toEqual(detail.activePhaseIds);
    expect(home.currentPhase).toBeNull();
    expect(home.currentRound).toBeNull();
    expect(home.standingsPreview).toBeNull();
    expect(queryCount).toBe(6);
  });

  it("A3 bounds live discovery without replaying games or changing live URLs", async () => {
    for (let i = 0; i < 5; i++) {
      const id = `live-extra-${i}`;
      addGame(id, `2027-10-${String(i + 9).padStart(2, "0")}`, "20:00");
      sqlite.prepare("INSERT INTO league_komocontrol_gameplay_game_claims VALUES (?,?)").run(id, `run-${id}`);
      sqlite.prepare("INSERT INTO league_komocontrol_gameplay_heads VALUES (?,'live')").run(`run-${id}`);
    }
    const home = await readCompetitionHomeWithDb(db, "central");
    expect(home.liveGames).toHaveLength(3);
    expect(home.liveGames.every((game) => game.status === "live" && game.webLiveUrl?.endsWith(`/games/${game.id}/live`))).toBe(true);
    expect(queryCount).toBe(9);
  });

  it("A3 orders dated scheduled games without assuming a timezone or instant cutoff", async () => {
    for (let i = 3; i <= 8; i++) addGame(`up-${i}`, `2027-10-${String(i).padStart(2, "0")}`, i === 3 ? "19:00" : "08:00");
    addGame("still-scheduled", "2024-01-01", "08:00");
    addGame("undated", null, null);
    const home = await readCompetitionHomeWithDb(db, "central");
    expect(home.upcomingGames).toHaveLength(5);
    expect(home.upcomingGames.slice(0, 3).map((game) => game.id)).toEqual(["still-scheduled", "g2", "up-3"]);
    expect(home.upcomingGames.every((game) => game.status === "scheduled" && game.scheduledDate !== null && !["g3", "g4", "g7", "cross-game", "undated"].includes(game.id))).toBe(true);
    const localKeys = home.upcomingGames.map((game) => `${game.scheduledDate} ${game.scheduledTime}`);
    expect(localKeys).toEqual([...localKeys].sort());
    expect(queryCount).toBe(9);
  });

  it("A3 returns at most five official completed results, newest first", async () => {
    for (let i = 3; i <= 8; i++) addGame(`result-${i}`, `2027-10-${String(i).padStart(2, "0")}`, "20:00", "completed", 70 + i, 60 + i);
    const home = await readCompetitionHomeWithDb(db, "central");
    expect(home.recentResults.map((game) => game.id)).toEqual(["result-8", "result-7", "result-6", "result-5", "result-4"]);
    expect(home.recentResults.every((game) => game.status === "completed" && game.homeScore !== null && game.awayScore !== null)).toBe(true);
    expect(queryCount).toBe(9);
  });

  it("A3 previews only the authoritative Top 5 with a constant query count", async () => {
    for (const id of ["d", "e", "f"]) {
      sqlite.prepare("INSERT INTO league_teams VALUES (?,'organization_komobasket',?,NULL)").run(id, id.toUpperCase());
      sqlite.prepare("INSERT INTO league_season_teams VALUES (?,'season-new',?,?)").run(`s${id}`, id, id.toUpperCase());
      sqlite.prepare("INSERT INTO league_competition_teams VALUES (?,'central',?,'active')").run(`c${id}`, `s${id}`);
    }
    const full = await readStandingsWithDb(db, "central", "regular");
    expect(full).toHaveLength(6);
    queryCount = 0;
    const home = await readCompetitionHomeWithDb(db, "central");
    expect(home.standingsPreview).toEqual(full.slice(0, 5));
    expect(queryCount).toBe(9);
  });

  it("A3 returns safe route errors and masks infrastructure failures", async () => {
    let response = await getHome(request("/api/public/v1/competitions/central/home?limit=5"), competitionContext());
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_FILTER");
    response = await getHome(request("/api/public/v1/competitions/invalid/home"), competitionContext(" "));
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_COMPETITION_ID");
    vi.mocked(getKomoBasketCloudflareEnv).mockRejectedValueOnce(new Error("internal SQL details"));
    response = await getHome(request("/api/public/v1/competitions/central/home"), competitionContext());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ error: { code: "CATALOGUE_UNAVAILABLE", message: "Public competition data is temporarily unavailable." } });
  });
});
