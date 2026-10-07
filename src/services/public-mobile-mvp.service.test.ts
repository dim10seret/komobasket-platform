import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

const verified = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: vi.fn() }));
vi.mock("@/services/platform-match-report.service", () => ({ readAuthoritativePhaseStatisticalGamesWithDb: verified.read }));

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { GET } from "@/app/api/public/v1/competitions/[competitionId]/mvp/route";
import { readMobileOfficialMvpWithDb } from "./public-mobile-mvp.service";

const migration = readFileSync(new URL("../../cloudflare/migrations/0035_matchday_mvp_selections.sql", import.meta.url), "utf8");
const input = { competitionId: "central", phaseId: "regular", round: 7 };
const request = (query = "phaseId=regular&round=7", competitionId = "central") =>
  new Request(`https://example.test/api/public/v1/competitions/${competitionId}/mvp?${query}`);
const context = (competitionId = "central") => ({ params: Promise.resolve({ competitionId }) });
const line = (id: string, points: number) => ({ canonicalPlayerId: id, statistics: {
  points, rebounds: 5, assists: 3, efficiency: 14,
} });
const game = { gameId: "g1", homePlayers: [line("p1", 12)], awayPlayers: [line("p2", 9)] };

describe("Phase C1 official public MVP", () => {
  let sqlite: DatabaseSync;
  let db: D1DatabaseBinding;
  let queryCount: number;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`PRAGMA foreign_keys=ON;
      CREATE TABLE league_organizations (id TEXT PRIMARY KEY, slug TEXT, status TEXT, publication_status TEXT);
      CREATE TABLE league_seasons (id TEXT PRIMARY KEY, name TEXT, starts_on TEXT, status TEXT);
      CREATE TABLE league_competitions (id TEXT PRIMARY KEY, organization_id TEXT, season_id TEXT,
        slug TEXT, name TEXT, type TEXT, logo_url TEXT, status TEXT);
      CREATE TABLE league_competition_publication (competition_id TEXT PRIMARY KEY, lifecycle_status TEXT);
      CREATE TABLE league_phases (id TEXT PRIMARY KEY, competition_id TEXT, format TEXT, lifecycle_status TEXT);
      CREATE TABLE league_teams (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT, logo_url TEXT);
      CREATE TABLE league_players (id TEXT PRIMARY KEY, organization_id TEXT, display_name TEXT, photo_url TEXT);
      CREATE TABLE league_games (id TEXT PRIMARY KEY, competition_id TEXT, phase_id TEXT, round_number INTEGER,
        status TEXT, home_team_id TEXT, away_team_id TEXT);
      ${migration}
      INSERT INTO league_organizations VALUES ('organization_komobasket','komobasket','active','unpublished'),
        ('hidden-org','hidden','active','unpublished');
      INSERT INTO league_seasons VALUES ('season-new','2027–28','2027-09-01','active');
      INSERT INTO league_competitions VALUES
        ('central','organization_komobasket','season-new','central','Central League','league',NULL,'active'),
        ('hidden','hidden-org','season-new','hidden','Hidden League','league',NULL,'active');
      INSERT INTO league_competition_publication VALUES ('central','online'),('hidden','online');
      INSERT INTO league_phases VALUES ('regular','central','standings','active'),
        ('series','central','series','active'),('foreign','hidden','standings','active');
      INSERT INTO league_teams VALUES ('a','organization_komobasket','Alpha','/a.png'),
        ('b','organization_komobasket','Beta','/b.png'),('x','hidden-org','Hidden',NULL);
      INSERT INTO league_players VALUES ('p1','organization_komobasket','Canonical One','/p1.png'),
        ('p2','organization_komobasket','Canonical Two',NULL),('foreign-player','hidden-org','Hidden',NULL);
      INSERT INTO league_games VALUES ('g1','central','regular',7,'completed','a','b'),
        ('g2','central','regular',7,'scheduled','a','b'),('g8','central','regular',8,'completed','a','b'),
        ('g-foreign','hidden','foreign',7,'completed','x','x');
      INSERT INTO league_matchday_mvp_selections
        (id,organization_id,competition_id,phase_id,round_number,game_id,player_id,created_at,updated_at)
        VALUES ('official-1','organization_komobasket','central','regular',7,'g1','p1',
          '2027-10-02T10:00:00Z','2027-10-03T11:00:00Z');`);
    queryCount = 0;
    const statement = (sql: string, values: unknown[] = []): D1PreparedStatement => ({
      bind: (...bindings: unknown[]) => statement(sql, bindings),
      all: async <T,>() => { queryCount++; return { success: true, results: sqlite.prepare(sql).all(...values) as T[] }; },
      first: async <T,>() => { queryCount++; return (sqlite.prepare(sql).get(...values) as T | undefined) ?? null; },
      run: async () => { throw new Error("C1 cannot write to D1"); },
    });
    db = { prepare: statement, batch: async () => { throw new Error("C1 cannot batch writes"); } };
    vi.mocked(getKomoBasketCloudflareEnv).mockResolvedValue({ NEWS_DB: db } as never);
    verified.read.mockResolvedValue([game]);
  });

  afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

  it("returns only the stored official selection with canonical identity and verified performance", async () => {
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
    const body = await response.json();
    expect(body.data).toEqual({
      id: "official-1", competitionId: "central", phaseId: "regular", round: 7, gameId: "g1",
      player: { id: "p1", name: "Canonical One", photoUrl: "/p1.png" },
      team: { id: "a", name: "Alpha", logoUrl: "/a.png" },
      performance: { points: 12, rebounds: 5, assists: 3, efficiency: 14 },
      selectedAt: "2027-10-03T11:00:00Z",
    });
    expect(JSON.stringify(body)).not.toMatch(/organization_id|created_at|admin|notes|event|hash|candidate/);
    expect(verified.read).toHaveBeenCalledWith(db, "central", "organization_komobasket", ["regular"], null, "g1");
    expect(queryCount).toBe(3);
  });

  it("returns a cached null data envelope for a valid round with no official selection", async () => {
    sqlite.prepare("DELETE FROM league_matchday_mvp_selections").run();
    const response = await GET(request(), context());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: null });
    expect(response.headers.get("cache-control")).toBe("public, max-age=60, s-maxage=300");
    expect(verified.read).not.toHaveBeenCalled();
    expect(queryCount).toBe(3);
  });

  it("does not promote the highest EFF player when no official selection is stored", async () => {
    sqlite.prepare("DELETE FROM league_matchday_mvp_selections").run();
    verified.read.mockResolvedValue([{ ...game, homePlayers: [line("p1", 99)] }]);
    expect((await readMobileOfficialMvpWithDb(db, input)).data).toBeNull();
    expect(verified.read).not.toHaveBeenCalled();
  });

  it("preserves the official identity if finalized statistical detail is unavailable", async () => {
    verified.read.mockResolvedValue([]);
    const result = (await readMobileOfficialMvpWithDb(db, input)).data;
    expect(result).toMatchObject({ id: "official-1", gameId: "g1", player: { id: "p1", name: "Canonical One" },
      team: null, performance: null });
  });

  it("resolves an away player to the actual game team, not a name match", async () => {
    sqlite.prepare("UPDATE league_matchday_mvp_selections SET player_id='p2' WHERE id='official-1'").run();
    const result = (await readMobileOfficialMvpWithDb(db, input)).data;
    expect(result).toMatchObject({ player: { id: "p2", name: "Canonical Two" },
      team: { id: "b", name: "Beta", logoUrl: "/b.png" },
      performance: { points: 9 } });
  });

  it("rejects hidden competitions, foreign phases and rounds with no valid matchday", async () => {
    for (const [competitionId, phaseId, round] of [
      ["hidden", "foreign", 7], ["central", "foreign", 7], ["central", "series", 7],
      ["central", "regular", 99],
    ] as const) {
      const response = await GET(request(`phaseId=${phaseId}&round=${round}`, competitionId), context(competitionId));
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.stringify(await response.json())).not.toContain("Canonical One");
    }
    expect(verified.read).not.toHaveBeenCalled();
  });

  it("rejects invalid, missing, repeated and extra query parameters", async () => {
    for (const query of ["", "phaseId=regular", "round=7", "phaseId=regular&round=0",
      "phaseId=regular&round=-1", "phaseId=regular&round=1.5", "phaseId=regular&round=10001",
      "phaseId=regular&round=7&round=7", "phaseId=regular&round=7&extra=1"]) {
      const response = await GET(request(query), context());
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
    expect(verified.read).not.toHaveBeenCalled();
  });

  it("rejects a stored row pointing to a foreign game or player", async () => {
    sqlite.prepare("UPDATE league_matchday_mvp_selections SET game_id='g-foreign' WHERE id='official-1'").run();
    expect((await readMobileOfficialMvpWithDb(db, input)).data).toBeNull();
    sqlite.prepare("UPDATE league_matchday_mvp_selections SET game_id='g8' WHERE id='official-1'").run();
    expect((await readMobileOfficialMvpWithDb(db, input)).data).toBeNull();
    sqlite.prepare("UPDATE league_matchday_mvp_selections SET game_id='g1',player_id='foreign-player' WHERE id='official-1'").run();
    expect((await readMobileOfficialMvpWithDb(db, input)).data).toBeNull();
    expect(verified.read).not.toHaveBeenCalled();
  });

  it("masks statistical-read failures and SQL details with a non-cacheable error", async () => {
    verified.read.mockRejectedValue(new Error("D1_ERROR: internal SQL details"));
    const response = await GET(request(), context());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await response.json())).not.toMatch(/D1_ERROR|internal SQL/);
  });
});
