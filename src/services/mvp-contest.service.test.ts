import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalAppUser } from "@/lib/app-user-identity";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

const reports = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/services/platform-match-report.service", () => ({
  readAuthoritativePhaseStatisticalGamesWithDb: reports.read,
  readAuthoritativeCompetitionStatisticalGamesWithDb: reports.read,
}));

import { mvpClosesAt, MvpContestError, previewMvpCandidatesWithDb, setPhaseMvpEnabledWithDb, startMvpContestWithDb } from "./mvp-contest.service";
import { addPlatformMvpCandidateWithDb, readPlatformMvpWithDb, setPlatformPhaseMvpWithDb,
  startPlatformMvpWithDb, updatePlatformMvpContestWithDb } from "./platform-mvp-management.service";
import { saveMatchdayMvpWithDb } from "./matchday-mvp.service";

const oldMigration = readFileSync(new URL("../../cloudflare/migrations/0035_matchday_mvp_selections.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../cloudflare/migrations/0041_mvp_contest_foundation.sql", import.meta.url), "utf8");
const votingMigration = readFileSync(new URL("../../cloudflare/migrations/0042_mvp_guest_voting_foundation.sql", import.meta.url), "utf8");
const actor: CanonicalAppUser = { userId: "admin-a", email: "admin@example.test", displayName: "Admin", isSuperAdmin: false, isLocal: false };
const stats = (efficiency: number) => ({ points: efficiency, rebounds: 5, assists: 3, efficiency });
const line = (id: string, efficiency: number) => ({ canonicalPlayerId: id, displayName: id, shirtNumber: "1", statistics: stats(efficiency) });
const report = (gameId: string, home: ReturnType<typeof line>[], away: ReturnType<typeof line>[], participants: string[], phaseId = "round-phase") => ({
  gameId, scheduledDate: "2026-10-01", scheduledTime: "18:00", homeTeamId: "team-a", homeTeamName: "Team A",
  awayTeamId: "team-b", awayTeamName: "Team B", homeScore: 80, awayScore: 70,
  homePlayers: home, awayPlayers: away, participatingPlayerIds: participants,
  homeTeamStatistics: stats(80), awayTeamStatistics: stats(70), phaseId, round: 1,
  roundLabel: "Round 1", sortKey: ["", "", 1, 1, 1, gameId],
});

let sqlite: DatabaseSync;
let db: D1DatabaseBinding;
function prepared(sql: string, args: unknown[] = []): D1PreparedStatement {
  return {
    bind: (...values) => prepared(sql, values),
    all: async <T,>() => ({ results: sqlite.prepare(sql).all(...args) as T[] }),
    first: async <T,>() => (sqlite.prepare(sql).get(...args) ?? null) as T | null,
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
  };
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE league_organizations (id TEXT PRIMARY KEY, slug TEXT, name TEXT, status TEXT);
    CREATE TABLE league_seasons (id TEXT PRIMARY KEY, name TEXT, starts_on TEXT);
    CREATE TABLE league_app_users (id TEXT PRIMARY KEY, status TEXT, is_super_admin INTEGER);
    CREATE TABLE league_organization_memberships (organization_id TEXT, user_id TEXT, role TEXT, status TEXT);
    CREATE TABLE league_competitions (id TEXT PRIMARY KEY, organization_id TEXT REFERENCES league_organizations(id), season_id TEXT, name TEXT);
    CREATE TABLE league_phases (id TEXT PRIMARY KEY, competition_id TEXT REFERENCES league_competitions(id), format TEXT,
      name TEXT, previous_phase_id TEXT, tournament_name TEXT, order_index INTEGER DEFAULT 0,
      settings_json TEXT NOT NULL DEFAULT '{}', lifecycle_status TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE league_phase_rules (phase_id TEXT PRIMARY KEY, wins_required INTEGER, carry_over_enabled INTEGER,
      carry_over_source_phase_id TEXT, settings_json TEXT);
    CREATE TABLE league_phase_schedules (id TEXT PRIMARY KEY, phase_id TEXT REFERENCES league_phases(id));
    CREATE TABLE league_round_robin_planning_slots (id TEXT PRIMARY KEY, schedule_id TEXT REFERENCES league_phase_schedules(id),
      round_number INTEGER, game_order INTEGER);
    CREATE TABLE league_teams (id TEXT PRIMARY KEY, organization_id TEXT, name TEXT);
    CREATE TABLE league_season_teams (season_id TEXT, team_id TEXT, display_name TEXT, UNIQUE(season_id,team_id));
    CREATE TABLE league_players (id TEXT PRIMARY KEY, organization_id TEXT);
    CREATE TABLE league_games (id TEXT PRIMARY KEY, competition_id TEXT REFERENCES league_competitions(id),
      phase_id TEXT REFERENCES league_phases(id), schedule_id TEXT, round_number INTEGER, round_label TEXT,
      game_order INTEGER, status TEXT, result_source TEXT, series_matchup_id TEXT, series_round_number INTEGER,
      home_team_id TEXT, away_team_id TEXT, home_score INTEGER, away_score INTEGER, scheduled_date TEXT, scheduled_time TEXT);
    ${oldMigration}
    ${migration}
    ${votingMigration}
    CREATE TABLE league_audit_log (id TEXT PRIMARY KEY, actor_email TEXT, action TEXT NOT NULL, entity_type TEXT,
      entity_id TEXT, details_json TEXT, created_at TEXT);
    INSERT INTO league_organizations VALUES ('org-a','a','Organization A','active'),('org-b','b','Organization B','active');
    INSERT INTO league_seasons VALUES ('season-a','2026–27','2026-09-01');
    INSERT INTO league_app_users VALUES ('admin-a','active',0),('viewer-a','active',0),('admin-b','active',0);
    INSERT INTO league_organization_memberships VALUES ('org-a','admin-a','admin','active'),('org-a','viewer-a','viewer','active'),('org-b','admin-b','admin','active');
    INSERT INTO league_competitions VALUES ('competition-a','org-a','season-a','Competition A'),('competition-b','org-b','season-a','Competition B');
    INSERT INTO league_phases (id,competition_id,format) VALUES
      ('round-phase','competition-a','standings'),('series-phase','competition-a','series'),('foreign-phase','competition-b','standings');
    UPDATE league_phases SET mvp_enabled=1 WHERE id IN ('round-phase','series-phase');
    INSERT INTO league_phase_schedules VALUES ('round-schedule','round-phase'),('series-schedule','series-phase');
    INSERT INTO league_round_robin_planning_slots VALUES ('slot-a','round-schedule',1,1),('slot-b','round-schedule',1,2);
    INSERT INTO league_teams VALUES ('team-a','org-a','Team A'),('team-b','org-a','Team B');
    INSERT INTO league_season_teams VALUES ('season-a','team-a','Season Team A'),('season-a','team-b','Season Team B');
    INSERT INTO league_players VALUES ('p1','org-a'),('p2','org-a'),('p3','org-a'),('p4','org-a'),('p5','org-a'),('p6','org-a'),('bench','org-a');
    INSERT INTO league_games VALUES
      ('round-a','competition-a','round-phase','round-schedule',1,'Round 1',1,'completed','match_report',NULL,NULL,'team-a','team-b',80,70,'2026-10-01','18:00'),
      ('round-b','competition-a','round-phase','round-schedule',1,'Round 1',2,'completed','match_report',NULL,NULL,'team-a','team-b',81,71,'2026-10-01','20:00'),
      ('series-a','competition-a','series-phase','series-schedule',NULL,'',1,'completed','match_report','matchup-1',1,'team-a','team-b',80,70,'2026-10-02','18:00');
    INSERT INTO league_phase_rules VALUES ('series-phase',1,0,NULL,'{"bracketConfiguration":{"matchups":[{"id":"matchup-1","slotA":{"type":"fixed_team","teamId":"team-a"},"slotB":{"type":"fixed_team","teamId":"team-b"}},{"id":"bye-1","slotA":{"type":"fixed_team","teamId":"team-a"},"slotB":{"type":"bye"}}]}}');`);
  db = {
    prepare: (sql) => prepared(sql),
    batch: async (statements) => {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  reports.read.mockResolvedValue([
    report("round-a", [line("p1", 30), line("p2", 29), line("p3", 28), line("bench", 100)], [line("p4", 27)], ["p1", "p2", "p3", "p4"]),
    report("round-b", [line("p1", 35), line("p5", 26)], [line("p6", 25)], ["p1", "p5", "p6"]),
    report("series-a", [line("p1", 31), line("bench", 200)], [line("p2", 20)], ["p1", "p2"], "series-phase"),
  ]);
});
afterEach(() => { sqlite.close(); vi.clearAllMocks(); });

const round = { phaseId: "round-phase", scopeType: "round" as const, roundNumber: 1 };
const series = { phaseId: "series-phase", scopeType: "series" as const, matchupId: "matchup-1" };

describe("MVP1 contest foundation", () => {
  it("applies additive schema, foreign keys, default-off phase flag and scope constraints", () => {
    expect(sqlite.prepare("SELECT mvp_enabled FROM league_phases WHERE id='foreign-phase'").get()).toEqual({ mvp_enabled: 0 });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_contests").get()).toEqual({ n: 0 });
    expect(() => sqlite.prepare(`INSERT INTO mvp_contests
      (id,phase_id,scope_type,round_number,selection_method,status,results_visibility,opens_at,closes_at,created_by_user_id,created_at,updated_at)
      VALUES ('bad','round-phase','series',1,'app_poll','open','after_close',1,2,'admin-a',1,1)`).run()).toThrow();
  });

  it("reuses EFF ordering, takes five distinct participating players, and snapshots the best game", async () => {
    const preview = await previewMvpCandidatesWithDb(db, actor, round);
    expect(preview.suggested.map((candidate) => candidate.playerId)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(preview.eligible.map((candidate) => candidate.playerId)).toEqual(["p1", "p2", "p3", "p4", "p5", "p6"]);
    expect(preview.eligible.find((candidate) => candidate.playerId === "p1")?.gameId).toBe("round-b");
    const clientClock = vi.spyOn(Date, "now").mockReturnValue(0);
    const started = await startMvpContestWithDb(db, actor, { ...round, candidatePlayerIds: ["p1", "p6"], durationHours: 48 });
    clientClock.mockRestore();
    expect(started).toMatchObject({ resultsVisibility: "after_close", status: "open" });
    expect(started.closesAt - started.opensAt).toBe(48 * 3600);
    expect(started.serverTime).toBe(started.opensAt);
    expect(started.opensAt).toBeGreaterThan(0);
    expect(sqlite.prepare("SELECT player_id,supporting_game_id,points,origin,proposal_rank FROM mvp_candidates ORDER BY player_id").all())
      .toEqual([{ player_id: "p1", supporting_game_id: "round-b", points: 35, origin: "system", proposal_rank: 1 },
        { player_id: "p6", supporting_game_id: "round-b", points: 25, origin: "operator", proposal_rank: null }]);
  });

  it("rejects incomplete and postponed rounds, missing planning games, and unverified reports", async () => {
    sqlite.prepare("UPDATE league_games SET status='postponed' WHERE id='round-b'").run();
    await expect(previewMvpCandidatesWithDb(db, actor, round)).rejects.toMatchObject({ code: "SCOPE_INCOMPLETE" });
    sqlite.prepare("UPDATE league_games SET status='completed' WHERE id='round-b'").run();
    sqlite.prepare("DELETE FROM league_games WHERE id='round-b'").run();
    await expect(previewMvpCandidatesWithDb(db, actor, round)).rejects.toMatchObject({ code: "SCOPE_INCOMPLETE" });
    sqlite.prepare(`INSERT INTO league_games VALUES ('round-b','competition-a','round-phase','round-schedule',1,'Round 1',2,'completed','match_report',NULL,NULL,'team-a','team-b',81,71,'2026-10-01','20:00')`).run();
    reports.read.mockResolvedValue([report("round-a", [line("p1", 30)], [], ["p1"])]);
    await expect(previewMvpCandidatesWithDb(db, actor, round)).rejects.toMatchObject({ code: "EVIDENCE_REVIEW_REQUIRED" });
  });

  it("validates series matchup identity, competitive outcome, and rejects BYE-only scopes", async () => {
    const preview = await previewMvpCandidatesWithDb(db, actor, series);
    expect(preview.suggested.map((candidate) => candidate.playerId)).toEqual(["p1", "p2"]);
    expect(preview.suggested[0]).toMatchObject({ gameId: "series-a", statistics: { points: 31 } });
    await expect(previewMvpCandidatesWithDb(db, actor, { ...series, matchupId: "unknown" })).rejects.toMatchObject({ code: "SCOPE_NOT_FOUND" });
    await expect(previewMvpCandidatesWithDb(db, actor, { ...series, matchupId: "bye-1" })).rejects.toMatchObject({ code: "NO_ELIGIBLE_PLAYERS" });
    sqlite.prepare("UPDATE league_games SET status='postponed' WHERE id='series-a'").run();
    await expect(previewMvpCandidatesWithDb(db, actor, series)).rejects.toMatchObject({ code: "SCOPE_INCOMPLETE" });
  });

  it("enforces canonical round and series scope uniqueness in SQLite", async () => {
    await expect(previewMvpCandidatesWithDb(db, actor, { ...round, roundNumber: 0 }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    const first = await startMvpContestWithDb(db, actor, { ...series, candidatePlayerIds: ["p1"], durationHours: 24 });
    await expect(startMvpContestWithDb(db, actor, { ...series, candidatePlayerIds: ["p1"], durationHours: 24 }))
      .rejects.toMatchObject({ code: "CONTEST_CONFLICT" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_contests WHERE scope_type='series'").get()).toEqual({ n: 1 });
    expect(() => sqlite.prepare(`INSERT INTO mvp_contests
      (id,phase_id,scope_type,matchup_id,selection_method,status,results_visibility,opens_at,closes_at,created_by_user_id,created_at,updated_at)
      VALUES ('duplicate','series-phase','series','matchup-1','app_poll','open','after_close',1,2,'admin-a',1,1)`).run()).toThrow();
    expect(() => sqlite.prepare(`INSERT INTO mvp_candidates
      (id,contest_id,player_id,supporting_game_id,team_id,player_name,team_name,points,rebounds,assists,efficiency,origin,created_at)
      VALUES ('duplicate-candidate',?,'p1','series-a','team-a','p1','Team A',31,5,3,31,'operator',1)`).run(first.id)).toThrow();
  });

  it("validates duration and explicit UTC-offset deadlines", () => {
    const now = 1791547200;
    for (const hours of [24, 48, 72]) expect(mvpClosesAt({ durationHours: hours }, now)).toBe(now + hours * 3600);
    expect(mvpClosesAt({ closesAt: "2026-10-11T15:00:00+03:00" }, now)).toBe(now + 48 * 3600);
    for (const input of [{ closesAt: "2026-10-11T15:00:00" }, { closesAt: "2026-02-30T15:00:00Z" },
      { durationHours: 0 }, { durationHours: 48, closesAt: "2026-10-11T12:00:00Z" }, { closesAt: "2026-10-09T12:00:00Z" }]) {
      expect(() => mvpClosesAt(input, now)).toThrow(MvpContestError);
    }
  });

  it("enforces visibility, selected-player uniqueness and eligibility", async () => {
    for (const input of [
      { ...round, candidatePlayerIds: ["p1"], durationHours: 24, resultsVisibility: "hidden" },
      { ...round, candidatePlayerIds: ["p1", "p1"], durationHours: 24 },
      { ...round, candidatePlayerIds: ["bench"], durationHours: 24 },
    ]) await expect(startMvpContestWithDb(db, actor, input as never)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const started = await startMvpContestWithDb(db, actor, { ...round, candidatePlayerIds: ["p1"], durationHours: 24, resultsVisibility: "live" });
    expect(started.resultsVisibility).toBe("live");
  });

  it("enforces organization management and explicit phase enablement", async () => {
    const viewer = { ...actor, userId: "viewer-a" };
    const foreign = { ...actor, userId: "admin-b" };
    await expect(startMvpContestWithDb(db, viewer, { ...round, candidatePlayerIds: ["p1"], durationHours: 24 })).rejects.toThrow();
    await expect(startMvpContestWithDb(db, foreign, { ...round, candidatePlayerIds: ["p1"], durationHours: 24 })).rejects.toThrow();
    await setPhaseMvpEnabledWithDb(db, actor, "round-phase", false);
    await expect(previewMvpCandidatesWithDb(db, actor, round)).rejects.toMatchObject({ code: "SCOPE_NOT_FOUND" });
    await setPhaseMvpEnabledWithDb(db, actor, "round-phase", true);
    expect((await previewMvpCandidatesWithDb(db, actor, round)).suggested.length).toBe(5);
  });

  it("rejects existing Official MVPs and preserves legacy manual selection", async () => {
    sqlite.prepare(`INSERT INTO league_matchday_mvp_selections
      (id,organization_id,competition_id,phase_id,round_number,game_id,player_id)
      VALUES ('legacy','org-a','competition-a','round-phase',1,'round-a','p1')`).run();
    await expect(startMvpContestWithDb(db, actor, { ...round, candidatePlayerIds: ["p1"], durationHours: 24 }))
      .rejects.toMatchObject({ code: "OFFICIAL_MVP_EXISTS" });
    expect(sqlite.prepare("SELECT id FROM league_matchday_mvp_selections").all()).toEqual([{ id: "legacy" }]);
  });

  it("creates at most one contest per scope and rejects concurrent starts", async () => {
    const input = { ...round, candidatePlayerIds: ["p1"], durationHours: 24 };
    const results = await Promise.allSettled([startMvpContestWithDb(db, actor, input), startMvpContestWithDb(db, actor, input)]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_contests").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_candidates").get()).toEqual({ n: 1 });
  });

  it("rolls back the contest if any candidate insert fails", async () => {
    const original = db.batch;
    db.batch = async (statements) => original([statements[0], ...statements.slice(1), statements[1]]);
    await expect(startMvpContestWithDb(db, actor, { ...round, candidatePlayerIds: ["p1"], durationHours: 24 }))
      .rejects.toMatchObject({ code: "CONTEST_CONFLICT" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_contests").get()).toEqual({ n: 0 });
  });

  it("keeps the existing manual writer from changing an open managed round", async () => {
    await startMvpContestWithDb(db, actor, { ...round, candidatePlayerIds: ["p1"], durationHours: 24 });
    await expect(saveMatchdayMvpWithDb(db, { organizationId: "org-a", competitionId: "competition-a", phaseId: "round-phase",
      roundNumber: 1, gameId: "round-a", playerId: "p1" })).rejects.toMatchObject({ code: "MATCHDAY_INCOMPLETE" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM league_matchday_mvp_selections").get()).toEqual({ n: 0 });
  });

  it("reads only the selected organization's catalogue and has both local MVP migrations", async () => {
    const view = await readPlatformMvpWithDb(db, actor, "org-a");
    expect(view.competitions.map((competition) => competition.id)).toEqual(["competition-a"]);
    expect(view.phases.map((phase) => phase.id)).toEqual(["round-phase", "series-phase"]);
    expect(view.scopes.some((item) => item.round_number === 1)).toBe(true);
    expect(view.scopes.find((item) => item.series_matchup_id === "matchup-1"))
      .toMatchObject({ home_team_name: "Season Team A", away_team_name: "Season Team B" });
    expect(view.occupiedScopes).toEqual([]);
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='mvp_votes'").get()).toEqual({ name: "mvp_votes" });
    await expect(readPlatformMvpWithDb(db, actor, "org-b")).rejects.toThrow();
  });

  it("guards phase disablement during an open poll and enforces organization roles", async () => {
    const started = await startMvpContestWithDb(db, actor, { ...round, candidatePlayerIds: ["p1"], durationHours: 48 });
    await expect(setPlatformPhaseMvpWithDb(db, actor, "org-a", "round-phase", false))
      .rejects.toMatchObject({ code: "CONTEST_CONFLICT", status: 409 });
    expect(sqlite.prepare("SELECT mvp_enabled FROM league_phases WHERE id='round-phase'").get()).toEqual({ mvp_enabled: 1 });
    await expect(setPlatformPhaseMvpWithDb(db, { ...actor, userId: "viewer-a" }, "org-a", "series-phase", false)).rejects.toThrow();
    await expect(setPlatformPhaseMvpWithDb(db, actor, "org-b", "round-phase", false)).rejects.toThrow();
    expect(started.status).toBe("open");
  });

  it("starts an editable round poll, adds a fresh eligible candidate and safely adjusts settings", async () => {
    const preview = await previewMvpCandidatesWithDb(db, actor, round);
    expect(preview.suggested.map((candidate) => candidate.playerId)).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    const started = await startPlatformMvpWithDb(db, actor, "org-a", { ...round, candidatePlayerIds: ["p2"], durationHours: 48 });
    expect(started.closesAt - started.opensAt).toBe(48 * 3600);
    await expect(startPlatformMvpWithDb(db, actor, "org-a", { ...round, candidatePlayerIds: ["p2"], durationHours: 48 }))
      .rejects.toMatchObject({ code: "CONTEST_CONFLICT" });
    await expect(startPlatformMvpWithDb(db, actor, "org-b", { ...series, candidatePlayerIds: ["p1"], durationHours: 48 })).rejects.toThrow();
    await addPlatformMvpCandidateWithDb(db, actor, "org-a", started.id, "p6");
    expect(sqlite.prepare("SELECT player_id,origin FROM mvp_candidates ORDER BY player_id").all())
      .toEqual([{ player_id: "p2", origin: "system" }, { player_id: "p6", origin: "operator" }]);
    await expect(addPlatformMvpCandidateWithDb(db, actor, "org-a", started.id, "p6"))
      .rejects.toMatchObject({ code: "CONTEST_CONFLICT" });
    await expect(addPlatformMvpCandidateWithDb(db, { ...actor, userId: "viewer-a" }, "org-a", started.id, "p5")).rejects.toThrow();
    const later = new Date((started.opensAt + 72 * 3600) * 1000).toISOString().replace(".000Z", "Z");
    await updatePlatformMvpContestWithDb(db, actor, "org-a", { contestId: started.id, closesAt: later });
    await updatePlatformMvpContestWithDb(db, actor, "org-a", { contestId: started.id, resultsVisibility: "live" });
    expect(sqlite.prepare("SELECT closes_at,results_visibility FROM mvp_contests WHERE id=?").get(started.id))
      .toEqual({ closes_at: started.opensAt + 72 * 3600, results_visibility: "live" });
    expect((await readPlatformMvpWithDb(db, actor, "org-a")).contests[0]).toMatchObject({ totalVotes: 0, status: "open" });
    expect((await readPlatformMvpWithDb(db, actor, "org-a")).occupiedScopes)
      .toContainEqual({ phase_id: "round-phase", scope_type: "round", round_number: 1, matchup_id: null });
    const viewer = await readPlatformMvpWithDb(db, { ...actor, userId: "viewer-a" }, "org-a");
    expect(viewer.contests[0].totalVotes).toBeNull();
    expect(viewer.contests[0].candidates.every((candidate) => candidate.votes === null)).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM league_audit_log").get()).toEqual({ n: 3 });
  });

  it("rejects updates after closing and permits canonical series starts", async () => {
    const started = await startPlatformMvpWithDb(db, actor, "org-a", { ...series, candidatePlayerIds: ["p1"],
      closesAt: new Date((Math.floor(Date.now() / 1000) + 48 * 3600) * 1000).toISOString().replace(".000Z", "Z") });
    expect(started.scopeType).toBe("series");
    sqlite.prepare("UPDATE mvp_contests SET opens_at=unixepoch('now')-3600,closes_at=unixepoch('now')-1 WHERE id=?").run(started.id);
    await expect(addPlatformMvpCandidateWithDb(db, actor, "org-a", started.id, "p2"))
      .rejects.toMatchObject({ code: "CONTEST_NOT_OPEN" });
    await expect(updatePlatformMvpContestWithDb(db, actor, "org-a", { contestId: started.id, resultsVisibility: "live" }))
      .rejects.toMatchObject({ code: "CONTEST_NOT_OPEN" });
    expect(sqlite.prepare("SELECT status FROM mvp_contests WHERE id=?").get(started.id))
      .toEqual({ status: "needs_operator_decision" });
  });
});
