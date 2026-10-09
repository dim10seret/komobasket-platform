import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CanonicalAppUser } from "@/lib/app-user-identity";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

vi.mock("server-only", () => ({}));
vi.mock("@/services/public-mobile-competition.service", () => ({
  readCompetitionDetailWithDb: vi.fn(async (_db, id) => {
    if (id !== "competition-a" || !published) throw new Error("not public");
    return { organizationId: "org-a", tournamentGroups: [
      { id: "league-root", phaseIds: ["round-phase"] },
      { id: "cup-root", phaseIds: ["series-phase"] },
    ] };
  }),
}));

import { MvpFinalizationError, reconcileMvpContestIfDue, resolveMvpContestWithDb } from "./mvp-finalization.service";
import { PublicMvpContestError, readPublicMvpContestsWithDb } from "./public-mvp-contests.service";

const foundation = readFileSync(new URL("../../cloudflare/migrations/0041_mvp_contest_foundation.sql", import.meta.url), "utf8");
const voting = readFileSync(new URL("../../cloudflare/migrations/0042_mvp_guest_voting_foundation.sql", import.meta.url), "utf8");
const actor: CanonicalAppUser = { userId: "admin-a", email: "admin@example.test", displayName: "Admin", isSuperAdmin: false, isLocal: false };
const otherOperator: CanonicalAppUser = { userId: "admin-c", email: "second@example.test", displayName: "Second", isSuperAdmin: false, isLocal: false };
const outsider: CanonicalAppUser = { userId: "admin-b", email: "other@example.test", displayName: "Other", isSuperAdmin: false, isLocal: false };
let sqlite: DatabaseSync;
let db: D1DatabaseBinding;
let published: boolean;
let failAudit: boolean;
let batchTail: Promise<void>;
const now = Math.floor(Date.now() / 1000);

function prepared(sql: string, args: unknown[] = []): D1PreparedStatement {
  return {
    bind: (...values) => prepared(sql, values),
    all: async <T,>() => ({ results: sqlite.prepare(sql).all(...args) as T[] }),
    first: async <T,>() => (sqlite.prepare(sql).get(...args) ?? null) as T | null,
    run: async () => {
      if (failAudit && sql.includes("INSERT INTO league_audit_log")) throw new Error("audit unavailable");
      return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } };
    },
  };
}

beforeEach(() => {
  published = true;
  failAudit = false;
  batchTail = Promise.resolve();
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE league_seasons(id TEXT PRIMARY KEY, starts_on TEXT, status TEXT);
    CREATE TABLE league_organizations(id TEXT PRIMARY KEY, slug TEXT, name TEXT, status TEXT,
      publication_status TEXT);
    CREATE TABLE league_app_users(id TEXT PRIMARY KEY, status TEXT, is_super_admin INTEGER);
    CREATE TABLE league_organization_memberships(organization_id TEXT, user_id TEXT, role TEXT, status TEXT);
    CREATE TABLE league_competitions(id TEXT PRIMARY KEY, organization_id TEXT, season_id TEXT,
      slug TEXT, name TEXT, type TEXT, logo_url TEXT, status TEXT);
    CREATE TABLE league_competition_publication(competition_id TEXT PRIMARY KEY, lifecycle_status TEXT);
    CREATE TABLE league_phases(id TEXT PRIMARY KEY, competition_id TEXT, format TEXT,
      lifecycle_status TEXT DEFAULT 'active', previous_phase_id TEXT);
    CREATE TABLE league_players(id TEXT PRIMARY KEY, organization_id TEXT);
    CREATE TABLE league_teams(id TEXT PRIMARY KEY, organization_id TEXT, name TEXT);
    CREATE TABLE league_games(id TEXT PRIMARY KEY, competition_id TEXT, phase_id TEXT, round_number INTEGER,
      status TEXT, home_team_id TEXT, away_team_id TEXT);
    CREATE TABLE league_matchday_mvp_selections(id TEXT PRIMARY KEY, organization_id TEXT, competition_id TEXT,
      phase_id TEXT, round_number INTEGER, game_id TEXT, player_id TEXT, created_at TEXT, updated_at TEXT,
      UNIQUE(competition_id,phase_id,round_number));
    CREATE TABLE league_audit_log(id TEXT PRIMARY KEY, actor_email TEXT NOT NULL DEFAULT '', action TEXT NOT NULL,
      entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    ${foundation}
    ${voting}
    INSERT INTO league_seasons VALUES ('season-a','2026-09-01','active');
    INSERT INTO league_organizations VALUES
      ('org-a','hosted-a','Organization A','active','published'),
      ('org-b','hosted-b','Organization B','active','published');
    INSERT INTO league_app_users VALUES ('admin-a','active',0),('admin-b','active',0),('admin-c','active',0);
    INSERT INTO league_organization_memberships VALUES
      ('org-a','admin-a','admin','active'),('org-a','admin-c','admin','active'),
      ('org-b','admin-b','admin','active');
    INSERT INTO league_competitions VALUES
      ('competition-a','org-a','season-a','competition-a','Competition A','league',NULL,'active'),
      ('competition-b','org-b','season-a','competition-b','Competition B','league',NULL,'active');
    INSERT INTO league_competition_publication VALUES ('competition-a','online'),('competition-b','online');
    INSERT INTO league_phases(id,competition_id,format,previous_phase_id) VALUES
      ('league-root','competition-a','custom',NULL),('cup-root','competition-a','custom',NULL),
      ('round-phase','competition-a','standings','league-root'),
      ('series-phase','competition-a','series','cup-root'),
      ('foreign-phase','competition-b','standings',NULL);
    INSERT INTO league_players VALUES ('p1','org-a'),('p2','org-a'),('p3','org-a');
    INSERT INTO league_teams VALUES ('team-a','org-a','A'),('team-b','org-a','B');
    INSERT INTO league_games VALUES ('game-a','competition-a','round-phase',1,'completed','team-a','team-b'),
      ('game-s','competition-a','series-phase',NULL,'completed','team-a','team-b');`);
  db = {
    prepare: (sql) => prepared(sql),
    batch: async (statements) => {
      const preceding = batchTail;
      let release!: () => void;
      batchTail = new Promise<void>((resolve) => { release = resolve; });
      await preceding;
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
      finally { release(); }
    },
  };
});
afterEach(() => sqlite.close());

function makeContest(id: string, scope: "round" | "series", closesAt: number, visibility: "live" | "after_close" = "after_close") {
  const phase = scope === "round" ? "round-phase" : "series-phase";
  sqlite.prepare(`INSERT INTO mvp_contests
    (id,phase_id,scope_type,round_number,matchup_id,selection_method,status,results_visibility,
     opens_at,closes_at,created_by_user_id,created_at,updated_at)
    VALUES (?,?,?,?,?,'app_poll','open',?,?,?,'admin-a',?,?)`)
    .run(id, phase, scope, scope === "round" ? 1 : null, scope === "series" ? "matchup-1" : null,
      visibility, closesAt - 3600, closesAt, now, now);
  for (const [index, player] of ["p1", "p2", "p3"].entries()) {
    sqlite.prepare(`INSERT INTO mvp_candidates
      (id,contest_id,player_id,supporting_game_id,team_id,player_name,team_name,
       points,rebounds,assists,efficiency,origin,created_at)
      VALUES (?,?,?,?,? ,?,?,?,?,?,?, 'system',?)`)
      .run(`${id}-c${index + 1}`, id, player, scope === "round" ? "game-a" : "game-s",
        "team-a", `Player ${index + 1}`, "A", 20 + index, 5, 3, 25 + index, now);
  }
}

function vote(contestId: string, candidateNumber: number, count: number) {
  for (let i = 0; i < count; i++) {
    const credential = `credential-${contestId}-${candidateNumber}-${i}`;
    sqlite.prepare(`INSERT INTO anonymous_voter_credentials
      (id,platform,public_key_spki,public_key_sha256,attestation_provider,verification_status,
       created_at,verified_at,updated_at) VALUES (?,'android','synthetic',?,'play_integrity','verified',?,?,?)`)
      .run(credential, (Buffer.from(credential).toString("hex") + "0".repeat(64)).slice(0, 64), now, now, now);
    sqlite.prepare("INSERT INTO mvp_votes VALUES (?,?,?,?,?)")
      .run(`vote-${credential}`, contestId, `${contestId}-c${candidateNumber}`, credential, now);
  }
}

const status = (id: string) => sqlite.prepare("SELECT status,winner_player_id,official_matchday_selection_id FROM mvp_contests WHERE id=?").get(id);
const officials = () => sqlite.prepare("SELECT id,player_id FROM league_matchday_mvp_selections").all();

describe("MVP2C lazy finalization", () => {
  it("keeps a pre-deadline poll open and reconciles at and after the exact deadline", async () => {
    makeContest("future", "round", now + 3600);
    expect((await reconcileMvpContestIfDue(db, "future")).status).toBe("open");
    sqlite.prepare("UPDATE mvp_contests SET opens_at=?, closes_at=? WHERE id='future'").run(now - 3600, now);
    expect((await reconcileMvpContestIfDue(db, "future")).status).toBe("needs_operator_decision");
    makeContest("expired", "series", now - 1);
    expect((await reconcileMvpContestIfDue(db, "expired")).status).toBe("needs_operator_decision");
  });

  it("leaves manual MVP authority with the operator", async () => {
    makeContest("manual", "round", now - 1);
    sqlite.prepare("UPDATE mvp_contests SET selection_method='manual' WHERE id='manual'").run();
    expect((await reconcileMvpContestIfDue(db, "manual")).status).toBe("open");
    expect(officials()).toHaveLength(0);
  });

  it("finalizes one vote atomically into the existing round Official MVP selection", async () => {
    makeContest("round", "round", now - 1);
    vote("round", 2, 1);
    expect((await reconcileMvpContestIfDue(db, "round")).status).toBe("finalized");
    expect(status("round")).toMatchObject({ status: "finalized", winner_player_id: "p2" });
    expect(officials()).toHaveLength(1);
    expect(officials()[0]).toMatchObject({ player_id: "p2" });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("SELECT action FROM league_audit_log").get()).toEqual({ action: "mvp_auto_finalized" });
  });

  it("uses immutable ballot counts and publishes a series winner without a round selection", async () => {
    makeContest("series", "series", now - 1, "live");
    vote("series", 1, 2); vote("series", 2, 1);
    expect((await reconcileMvpContestIfDue(db, "series")).status).toBe("finalized");
    expect(status("series")).toMatchObject({ winner_player_id: "p1", official_matchday_selection_id: null });
    expect(officials()).toHaveLength(0);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    const read = await readPublicMvpContestsWithDb(db, { organizationId: "org-a", competitionId: "competition-a", rootPhaseId: "cup-root" });
    expect(read.history[0].official?.winner).toMatchObject({ playerId: "p1", performanceScope: "supporting_game",
      performance: { points: 20, rebounds: 5, assists: 3, efficiency: 25 } });
    expect(read.history[0].totalVotes).toBe(3);
  });

  it("requires an authorized operator to resolve a first-place tie", async () => {
    makeContest("tie", "round", now - 1);
    vote("tie", 1, 2); vote("tie", 2, 2); vote("tie", 3, 1);
    expect((await reconcileMvpContestIfDue(db, "tie")).status).toBe("tie_requires_resolution");
    await expect(resolveMvpContestWithDb(db, outsider, { contestId: "tie", candidateId: "tie-c1", reason: "review" })).rejects.toThrow();
    await expect(resolveMvpContestWithDb(db, actor, { contestId: "tie", candidateId: "tie-c3", reason: "review" }))
      .rejects.toThrow(MvpFinalizationError);
    const resolved = await resolveMvpContestWithDb(db, actor, { contestId: "tie", candidateId: "tie-c2", reason: "operator review" });
    expect(resolved.winner_player_id).toBe("p2");
    expect(sqlite.prepare("SELECT actor_email,action,details_json FROM league_audit_log").get())
      .toMatchObject({ actor_email: actor.email, action: "mvp_operator_resolved" });
    expect(String((sqlite.prepare("SELECT details_json FROM league_audit_log").get() as {details_json: string}).details_json))
      .toContain("operator review");
  });

  it("requires an eligible candidate and provenance for zero-vote resolution", async () => {
    makeContest("zero", "series", now - 1);
    expect((await reconcileMvpContestIfDue(db, "zero")).status).toBe("needs_operator_decision");
    await expect(resolveMvpContestWithDb(db, actor, { contestId: "zero", candidateId: "foreign", reason: "review" }))
      .rejects.toThrow(MvpFinalizationError);
    await expect(resolveMvpContestWithDb(db, actor, { contestId: "zero", candidateId: "zero-c1", reason: " " }))
      .rejects.toThrow(MvpFinalizationError);
    expect((await resolveMvpContestWithDb(db, actor, { contestId: "zero", candidateId: "zero-c3", reason: "no votes" })).status)
      .toBe("finalized");
  });

  it.each([
    ["tied round, same player", "round", true, true],
    ["tied round, different players", "round", true, false],
    ["zero-vote series, same player", "series", false, true],
    ["zero-vote series, different players", "series", false, false],
  ] as const)("commits only one operator action for %s", async (_label, scope, tied, samePlayer) => {
    makeContest("race", scope, now - 1);
    if (tied) { vote("race", 1, 1); vote("race", 2, 1); }
    await reconcileMvpContestIfDue(db, "race");
    const originalBatch = db.batch;
    let arrived = 0;
    let release!: () => void;
    const bothAtWrite = new Promise<void>((resolve) => { release = resolve; });
    db.batch = async (statements) => {
      arrived++;
      if (arrived === 2) release();
      await bothAtWrite;
      return originalBatch(statements);
    };
    const decisions = [
      { actor, candidateId: "race-c1", reason: "first operator review" },
      { actor: otherOperator, candidateId: samePlayer ? "race-c1" : "race-c2",
        reason: "second operator review" },
    ];
    const results = await Promise.allSettled(decisions.map((decision) => resolveMvpContestWithDb(db,
      decision.actor, { contestId: "race", candidateId: decision.candidateId, reason: decision.reason })));
    expect(arrived).toBe(2);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const failed = results.find((result) => result.status === "rejected");
    expect(failed).toMatchObject({ reason: { code: "ALREADY_FINALIZED", status: 409 } });
    const winningIndex = results.findIndex((result) => result.status === "fulfilled");
    const winningDecision = decisions[winningIndex];
    expect(status("race")).toMatchObject({ status: "finalized",
      winner_player_id: winningDecision.candidateId === "race-c1" ? "p1" : "p2" });
    expect(officials()).toHaveLength(scope === "round" ? 1 : 0);
    const audits = sqlite.prepare("SELECT actor_email, details_json FROM league_audit_log").all() as
      { actor_email: string; details_json: string }[];
    expect(audits).toHaveLength(1);
    expect(audits[0].actor_email).toBe(winningDecision.actor.email);
    expect(JSON.parse(audits[0].details_json)).toMatchObject({ resolution: winningDecision.reason });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });

  it("never overwrites a preexisting unrelated Official MVP", async () => {
    makeContest("conflict", "round", now - 1);
    vote("conflict", 1, 1);
    sqlite.prepare(`INSERT INTO league_matchday_mvp_selections VALUES
      ('manual','org-a','competition-a','round-phase',1,'game-a','p3','now','now')`).run();
    await expect(reconcileMvpContestIfDue(db, "conflict")).rejects.toThrow();
    expect(status("conflict")).toMatchObject({ status: "open", winner_player_id: null });
    expect(officials()).toEqual([{ id: "manual", player_id: "p3" }]);
  });

  it("rolls back a failed batch and safely retries once audit storage recovers", async () => {
    makeContest("retry", "round", now - 1);
    vote("retry", 1, 1);
    failAudit = true;
    await expect(reconcileMvpContestIfDue(db, "retry")).rejects.toThrow("audit unavailable");
    expect(status("retry")).toMatchObject({ status: "open", winner_player_id: null });
    expect(officials()).toHaveLength(0);
    failAudit = false;
    expect((await reconcileMvpContestIfDue(db, "retry")).status).toBe("finalized");
    expect(officials()).toHaveLength(1);
  });

  it("allows repeated and concurrent reads to publish only once", async () => {
    makeContest("repeat", "round", now - 1);
    vote("repeat", 1, 1);
    await Promise.all(Array.from({ length: 100 }, () => reconcileMvpContestIfDue(db, "repeat")));
    await reconcileMvpContestIfDue(db, "repeat");
    expect(officials()).toHaveLength(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM league_audit_log").get()).toEqual({ n: 1 });
  });

  it("finalizes an expired poll from a genuine public MVP GET service read", async () => {
    makeContest("lazy", "round", now - 1);
    vote("lazy", 3, 1);
    const read = await readPublicMvpContestsWithDb(db, {
      organizationId: "org-a", competitionId: "competition-a", rootPhaseId: "league-root",
    });
    expect(read.history[0]).toMatchObject({ status: "finalized", official: { winnerPlayerId: "p3" } });
    expect(officials()).toHaveLength(1);
  });

  it("hides after-close counts until finalized and scopes organization and tournament", async () => {
    makeContest("hidden", "round", now + 3600);
    vote("hidden", 1, 1);
    makeContest("live", "series", now + 3600, "live");
    vote("live", 2, 2);
    const read = await readPublicMvpContestsWithDb(db, { organizationId: "org-a", competitionId: "competition-a", rootPhaseId: "league-root" });
    expect(read.active[0]).toMatchObject({ resultsVisibility: "hidden", totalVotes: null });
    expect(read.active[0].candidates[0].votes).toBeNull();
    expect(read.serverTime).toEqual(expect.any(Number));
    const cup = await readPublicMvpContestsWithDb(db, { organizationId: "org-a", competitionId: "competition-a", rootPhaseId: "cup-root" });
    expect(cup.active[0]).toMatchObject({ resultsVisibility: "visible", totalVotes: 2 });
    expect(cup.active[0].candidates[1].votes).toBe(2);
    await expect(readPublicMvpContestsWithDb(db, { organizationId: "org-b", competitionId: "competition-a", rootPhaseId: "league-root" }))
      .rejects.toThrow(PublicMvpContestError);
    published = false;
    await expect(readPublicMvpContestsWithDb(db, { organizationId: "org-a", competitionId: "competition-a", rootPhaseId: "league-root" }))
      .rejects.toThrow(PublicMvpContestError);
  });

  it("keeps first-place tie counts hidden under after-close visibility", async () => {
    makeContest("hidden-tie", "round", now - 1);
    vote("hidden-tie", 1, 1); vote("hidden-tie", 2, 1);
    const read = await readPublicMvpContestsWithDb(db, {
      organizationId: "org-a", competitionId: "competition-a", rootPhaseId: "league-root",
    });
    expect(read.history[0]).toMatchObject({ status: "tie_requires_resolution",
      resultsVisibility: "hidden", totalVotes: null, official: null });
    expect(read.history[0].candidates.every((candidate) => candidate.votes === null)).toBe(true);
  });

  it.each([
    ["organization unpublication", "UPDATE league_organizations SET publication_status='unpublished' WHERE id='org-a'"],
    ["organization suspension", "UPDATE league_organizations SET status='suspended' WHERE id='org-a'"],
    ["ineligible season date", "UPDATE league_seasons SET starts_on='2025-09-01' WHERE id='season-a'"],
    ["ineligible season state", "UPDATE league_seasons SET status='draft' WHERE id='season-a'"],
    ["competition unpublication", "UPDATE league_competition_publication SET lifecycle_status='under_construction' WHERE competition_id='competition-a'"],
    ["competition ownership change", "UPDATE league_competitions SET organization_id='org-b' WHERE id='competition-a'"],
  ] as const)("rejects %s at the final SQL projection", async (_label, sql) => {
    makeContest("private", "round", now + 3600, "live");
    vote("private", 1, 1);
    const originalPrepare = db.prepare;
    let projectionReached = false;
    db.prepare = (query) => {
      if (query.includes("WITH RECURSIVE tournament_phase")) {
        projectionReached = true;
        sqlite.prepare(sql).run();
      }
      return originalPrepare(query);
    };
    await expect(readPublicMvpContestsWithDb(db, {
      organizationId: "org-a", competitionId: "competition-a", rootPhaseId: "league-root",
    })).rejects.toThrow(PublicMvpContestError);
    expect(projectionReached).toBe(true);
  });

  it("rechecks canonical root membership in the final SQL projection", async () => {
    makeContest("moved", "round", now + 3600, "live");
    vote("moved", 1, 1);
    const originalPrepare = db.prepare;
    db.prepare = (query) => {
      if (query.includes("WITH RECURSIVE tournament_phase")) {
        sqlite.prepare("UPDATE league_phases SET previous_phase_id='cup-root' WHERE id='round-phase'").run();
      }
      return originalPrepare(query);
    };
    const read = await readPublicMvpContestsWithDb(db, {
      organizationId: "org-a", competitionId: "competition-a", rootPhaseId: "league-root",
    });
    expect(read.active).toEqual([]);
    expect(read.history).toEqual([]);
  });
});
