import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

const reports = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/services/platform-match-report.service", () => ({ readAuthoritativeCompetitionStatisticalGamesWithDb: reports.read }));

import { buildPublicCompetitionStatistics } from "@/lib/public-competition-statistics";
import { MatchdayMvpError, readMatchdayMvpWithDb, readPublicMatchdayMvpSelectionsWithDb, saveMatchdayMvpWithDb } from "./matchday-mvp.service";

type LocalDatabase = { exec(sql: string): void; prepare(sql: string): { get(...args: unknown[]): unknown; all(...args: unknown[]): unknown[]; run(...args: unknown[]): { changes: number | bigint } }; close(): void };
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new(path: string) => LocalDatabase };
const migration = readFileSync(new URL("../../cloudflare/migrations/0035_matchday_mvp_selections.sql", import.meta.url), "utf8");

const statistics = (points: number, rebounds: number, assists: number, efficiency: number) => ({ points, twoPointMade: 0, twoPointAttempts: 0, threePointMade: 0, threePointAttempts: 0, freeThrowMade: 0, freeThrowAttempts: 0, offensiveRebounds: 0, defensiveRebounds: rebounds, rebounds, assists, steals: 0, blocks: 0, turnovers: 0, fouls: 0, efficiency });
const player = (id: string, name: string, efficiency: number, points: number, rebounds = 0, assists = 0) => ({ canonicalPlayerId: id, displayName: name, shirtNumber: id.slice(-1), statistics: statistics(points, rebounds, assists, efficiency) });
const games = [
  { gameId: "game-a", scheduledDate: "2026-09-24", scheduledTime: "18:00", homeTeamId: "team-a", homeTeamName: "Team A", awayTeamId: "team-b", awayTeamName: "Team B", homeScore: 80, awayScore: 70, homePlayers: [player("player-1", "Alpha", 30, 20), player("player-2", "Beta", 29, 25), player("player-3", "Gamma", 28, 22)], awayPlayers: [player("player-4", "Delta", 27, 19)] },
  { gameId: "game-b", scheduledDate: "2026-09-24", scheduledTime: "20:00", homeTeamId: "team-c", homeTeamName: "Team C", awayTeamId: "team-d", awayTeamName: "Team D", homeScore: 75, awayScore: 74, homePlayers: [player("player-5", "Epsilon", 26, 18), player("player-6", "Zeta", 25, 17)], awayPlayers: [] },
];

let local: LocalDatabase;
let database: D1DatabaseBinding;
function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
  return {
    bind: (...args) => statement(sql, args),
    all: async <T,>() => ({ results: local.prepare(sql).all(...values) as T[] }),
    first: async <T,>() => (local.prepare(sql).get(...values) ?? null) as T | null,
    run: async () => { local.prepare(sql).run(...values); return {}; },
  };
}

beforeEach(() => {
  local = new DatabaseSync(":memory:");
  local.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE league_organizations (id TEXT PRIMARY KEY);
    CREATE TABLE league_competitions (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES league_organizations(id));
    CREATE TABLE league_phases (id TEXT PRIMARY KEY, competition_id TEXT NOT NULL REFERENCES league_competitions(id), format TEXT NOT NULL, name TEXT);
    CREATE TABLE league_games (id TEXT PRIMARY KEY, competition_id TEXT NOT NULL REFERENCES league_competitions(id), phase_id TEXT NOT NULL REFERENCES league_phases(id), round_number INTEGER, round_label TEXT, status TEXT, game_order INTEGER);
    CREATE TABLE league_players (id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES league_organizations(id));
    ${migration}
    INSERT INTO league_organizations VALUES ('org-a'),('org-b');
    INSERT INTO league_competitions VALUES ('competition-a','org-a'),('competition-b','org-b');
    INSERT INTO league_phases VALUES ('phase-a','competition-a','standings','League'),('phase-b','competition-b','standings','Foreign');
    INSERT INTO league_games VALUES ('game-a','competition-a','phase-a',1,'1η Αγωνιστική','completed',1),('game-b','competition-a','phase-a',1,'1η Αγωνιστική','completed',2),('game-foreign','competition-b','phase-b',1,'1η Αγωνιστική','completed',1);
    INSERT INTO league_players VALUES ('player-1','org-a'),('player-2','org-a'),('player-3','org-a'),('player-4','org-a'),('player-5','org-a'),('player-6','org-a'),('player-foreign','org-b');`);
  database = { prepare: (sql) => statement(sql), batch: async () => [] };
  reports.read.mockResolvedValue(games);
});
afterEach(() => local.close());

describe("matchday MVP authoritative selection", () => {
  it("applies migration 0035 with one current selection per competition, phase and round", () => {
    expect(local.prepare("PRAGMA index_list('league_matchday_mvp_selections')").all().length).toBeGreaterThanOrEqual(2);
    expect(local.prepare("PRAGMA table_info('league_phases')").all().map((column) => String((column as { name: unknown }).name))).not.toContain("organization_id");
    expect(local.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("uses the exact Top Performance ranking and exposes five dynamic candidates", async () => {
    const state = await readMatchdayMvpWithDb(database, { organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1 });
    const top = buildPublicCompetitionStatistics({ games: games.map((game) => ({ ...game, roundNumber: 1 })), rounds: [{ roundNumber: 1, label: "1η Αγωνιστική", totalRealGames: 2 }] }).matchdays[0].topPerformance;
    expect(state.eligible).toBe(true);
    expect(state.selection).toBeNull();
    expect(state.candidates).toHaveLength(5);
    expect(state.otherPerformances).toHaveLength(1);
    expect(state.candidates[0].player.displayName).toBe(top?.player.displayName);
    expect(state.candidates.map((entry) => entry.playerId)).toEqual(["player-1", "player-2", "player-3", "player-4", "player-5"]);
  });
  it("blocks selection until every real game has an authoritative finalized report", async () => {
    reports.read.mockResolvedValue([games[0]]);
    const state = await readMatchdayMvpWithDb(database, { organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1 });
    expect(state.eligible).toBe(false);
    expect(state).toMatchObject({ candidates: [], otherPerformances: [], selection: null });
    await expect(saveMatchdayMvpWithDb(database, { organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1, gameId: "game-a", playerId: "player-1" })).rejects.toMatchObject({ code: "MATCHDAY_INCOMPLETE" });
  });
  it("reads the current selection after an eligible matchday has been saved", async () => {
    await saveMatchdayMvpWithDb(database, { organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1, gameId: "game-b", playerId: "player-6" });
    const state = await readMatchdayMvpWithDb(database, { organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1 });
    expect(state.selection).toMatchObject({ gameId: "game-b", playerId: "player-6", player: { displayName: "Zeta" } });
  });
  it("allows an eligible player outside the top five and updates the single current row", async () => {
    const first = await saveMatchdayMvpWithDb(database, { organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1, gameId: "game-b", playerId: "player-6" });
    expect(first.selection?.playerId).toBe("player-6");
    const second = await saveMatchdayMvpWithDb(database, { organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1, gameId: "game-a", playerId: "player-2" });
    expect(second.selection?.playerId).toBe("player-2");
    expect(local.prepare("SELECT COUNT(*) AS count FROM league_matchday_mvp_selections").get()).toEqual({ count: 1 });
  });
  it("rejects a player or game outside the eligible matchday", async () => {
    await expect(saveMatchdayMvpWithDb(database, { organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1, gameId: "game-foreign", playerId: "player-foreign" })).rejects.toMatchObject({ code: "PLAYER_NOT_ELIGIBLE" });
  });
  it("rejects cross-organization scope without exposing foreign candidates", async () => {
    reports.read.mockResolvedValue([{ ...games[0], gameId: "game-foreign", homePlayers: [player("player-foreign", "Foreign", 99, 99)] }]);
    reports.read.mockClear();
    await expect(readMatchdayMvpWithDb(database, { organizationId: "org-a", competitionId: "competition-b", phaseId: "phase-b", roundNumber: 1 })).rejects.toMatchObject({ code: "MATCHDAY_NOT_FOUND" });
    await expect(readMatchdayMvpWithDb(database, { organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-b", roundNumber: 1 })).rejects.toMatchObject({ code: "MATCHDAY_NOT_FOUND" });
    expect(reports.read).not.toHaveBeenCalled();
  });
  it("does not disguise an actual database failure as an empty matchday", async () => {
    const failure = new Error("D1_ERROR: read failed");
    const failingStatement: D1PreparedStatement = {
      bind: () => failingStatement,
      all: async () => { throw failure; },
      first: async () => { throw failure; },
      run: async () => { throw failure; },
    };
    const failingDatabase: D1DatabaseBinding = { prepare: () => failingStatement, batch: async () => [] };
    await expect(readMatchdayMvpWithDb(failingDatabase, { organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1 })).rejects.toThrow("D1_ERROR: read failed");
  });
  it("publishes only a stored selection that still matches authoritative eligible data", async () => {
    await saveMatchdayMvpWithDb(database, { organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1, gameId: "game-b", playerId: "player-6" });
    const selected = await readPublicMatchdayMvpSelectionsWithDb(database, "org-a", "competition-a", games.map((game) => ({ ...game, roundNumber: 1 })));
    expect(selected.get(1)?.player.displayName).toBe("Zeta");
    expect((await readPublicMatchdayMvpSelectionsWithDb(database, "org-b", "competition-b", [])).size).toBe(0);
  });
});
