import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";
import { castMvpVoteWithDb, readMvpVoteResultsWithDb, type MvpVoteVerifier } from "./mvp-vote.service";

const foundation = readFileSync(new URL("../../cloudflare/migrations/0041_mvp_contest_foundation.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../cloudflare/migrations/0042_mvp_guest_voting_foundation.sql", import.meta.url), "utf8");
const keyA = "a".repeat(64);
const keyB = "b".repeat(64);
const challengeA = "c".repeat(64);
const challengeB = "d".repeat(64);
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

function credential(id: string, platform: "android" | "ios", key: string, challenge: string, status = "verified") {
  const now = Number((sqlite.prepare("SELECT unixepoch('now') AS now").get() as { now: number }).now);
  sqlite.prepare(`INSERT INTO anonymous_voter_credentials
    (id,platform,public_key_spki,public_key_sha256,attestation_provider,verification_status,
     assertion_counter,challenge_hash,challenge_expires_at,created_at,verified_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, platform, "synthetic-spki", key,
      platform === "android" ? "play_integrity" : "app_attest", status, 0, challenge, now + 100,
      now, status === "verified" ? now : null, now);
}

function verifier(id = "voter-a", platform: "android" | "ios" = "android", key = keyA,
  challenge = challengeA, assertionCounter: number | null = platform === "ios" ? 1 : null): MvpVoteVerifier {
  return { verify: async (input) => ({ credentialId: id, contestId: input.contestId,
    candidateId: input.candidateId, platform, publicKeySha256: key,
    challengeHash: challenge, assertionCounter }) };
}

function vote(contestId = "contest-a", candidateId = "candidate-a", evidence: unknown = {}) {
  return castMvpVoteWithDb(db, verifier(), { contestId, candidateId, evidence });
}

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE league_seasons(id TEXT PRIMARY KEY, starts_on TEXT, status TEXT);
    CREATE TABLE league_organizations(id TEXT PRIMARY KEY, slug TEXT, status TEXT, publication_status TEXT);
    CREATE TABLE league_competitions(id TEXT PRIMARY KEY, organization_id TEXT REFERENCES league_organizations(id),
      season_id TEXT REFERENCES league_seasons(id), status TEXT);
    CREATE TABLE league_competition_publication(competition_id TEXT PRIMARY KEY REFERENCES league_competitions(id),
      lifecycle_status TEXT);
    CREATE TABLE league_phases(id TEXT PRIMARY KEY, competition_id TEXT REFERENCES league_competitions(id));
    CREATE TABLE league_players(id TEXT PRIMARY KEY);
    CREATE TABLE league_games(id TEXT PRIMARY KEY);
    CREATE TABLE league_teams(id TEXT PRIMARY KEY);
    CREATE TABLE league_app_users(id TEXT PRIMARY KEY);
    CREATE TABLE league_matchday_mvp_selections(id TEXT PRIMARY KEY);
    ${foundation}
    ${migration}
    INSERT INTO league_seasons VALUES ('season-a','2026-09-01','active');
    INSERT INTO league_organizations VALUES ('organization-a','hosted-a','active','published');
    INSERT INTO league_competitions VALUES ('competition-a','organization-a','season-a','active');
    INSERT INTO league_competition_publication VALUES ('competition-a','online');
    INSERT INTO league_phases(id,competition_id,mvp_enabled) VALUES ('phase-a','competition-a',1);
    INSERT INTO league_players(id) VALUES ('player-a'),('player-b');
    INSERT INTO league_games(id) VALUES ('game-a');
    INSERT INTO league_teams(id) VALUES ('team-a');
    INSERT INTO league_app_users(id) VALUES ('operator-a');
    INSERT INTO mvp_contests(id,phase_id,scope_type,round_number,selection_method,status,results_visibility,
      opens_at,closes_at,created_by_user_id,created_at,updated_at)
      VALUES ('contest-a','phase-a','round',1,'app_poll','open','after_close',unixepoch('now')-10,
        unixepoch('now')+100,'operator-a',unixepoch('now')-10,unixepoch('now')-10),
        ('contest-b','phase-a','round',2,'app_poll','open','live',unixepoch('now')-10,
        unixepoch('now')+100,'operator-a',unixepoch('now')-10,unixepoch('now')-10);
    INSERT INTO mvp_candidates(id,contest_id,player_id,supporting_game_id,team_id,player_name,team_name,
      points,rebounds,assists,efficiency,origin,created_at)
      VALUES ('candidate-a','contest-a','player-a','game-a','team-a','Player A','Team A',10,2,1,12,'operator',unixepoch('now')),
        ('candidate-b','contest-a','player-b','game-a','team-a','Player B','Team A',8,3,2,11,'operator',unixepoch('now')),
        ('candidate-other','contest-b','player-a','game-a','team-a','Player A','Team A',10,2,1,12,'operator',unixepoch('now'));`);
  credential("voter-a", "android", keyA, challengeA);
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
});
afterEach(() => sqlite.close());

describe("MVP2A guest vote foundation", () => {
  it("applies two platform-neutral tables with foreign keys, identity uniqueness and immutable ballots", () => {
    const names = (sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('mvp_votes','anonymous_voter_credentials') ORDER BY name").all() as { name: string }[]).map((row) => row.name);
    expect(names).toEqual(["anonymous_voter_credentials", "mvp_votes"]);
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
    expect(() => credential("duplicate-key", "android", keyA, challengeB)).toThrow();
    expect(() => credential("pending-ios", "ios", keyB, challengeB, "pending")).not.toThrow();
    expect(() => sqlite.prepare(`INSERT INTO anonymous_voter_credentials
      (id,platform,public_key_spki,public_key_sha256,attestation_provider,created_at,updated_at)
      VALUES ('bad-platform','windows','key',?, 'play_integrity',1,1)`).run("e".repeat(64))).toThrow();
    expect(() => sqlite.prepare(`INSERT INTO anonymous_voter_credentials
      (id,platform,public_key_spki,public_key_sha256,attestation_provider,created_at,updated_at)
      VALUES ('bad-time','android','key',?, 'play_integrity',0,0)`).run("f".repeat(64))).toThrow();
    const columns = (sqlite.prepare("PRAGMA table_info(anonymous_voter_credentials)").all() as { name: string }[]).map((row) => row.name);
    expect(columns).not.toContain("device_id");
    expect(columns).not.toContain("hardware_id");
    expect(() => sqlite.prepare("INSERT INTO mvp_votes VALUES ('bad','contest-a','candidate-other','voter-a',1)").run()).toThrow();
  });

  it("requires a verifier and a matching verified credential rather than a client UUID", async () => {
    await expect(castMvpVoteWithDb(db, null as unknown as MvpVoteVerifier,
      { contestId: "contest-a", candidateId: "candidate-a", evidence: "client-uuid" }))
      .rejects.toMatchObject({ code: "UNVERIFIED_VOTER" });
    await expect(castMvpVoteWithDb(db, { verify: async () => "voter-a" as never },
      { contestId: "contest-a", candidateId: "candidate-a", evidence: "client-uuid" }))
      .rejects.toMatchObject({ code: "UNVERIFIED_VOTER" });
    await expect(castMvpVoteWithDb(db, { verify: async () => ({ credentialId: "voter-a",
      contestId: "contest-b", candidateId: "candidate-a", platform: "android", publicKeySha256: keyA,
      challengeHash: challengeA, assertionCounter: null }) },
    { contestId: "contest-a", candidateId: "candidate-a", evidence: {} }))
      .rejects.toMatchObject({ code: "UNVERIFIED_VOTER" });
    await expect(castMvpVoteWithDb(db, verifier("missing"),
      { contestId: "contest-a", candidateId: "candidate-a", evidence: {} }))
      .rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    await expect(castMvpVoteWithDb(db, verifier("voter-a", "android", keyB),
      { contestId: "contest-a", candidateId: "candidate-a", evidence: {} }))
      .rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    sqlite.prepare("UPDATE anonymous_voter_credentials SET verification_status='revoked', revoked_at=unixepoch('now') WHERE id='voter-a'").run();
    await expect(vote()).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
  });

  it("atomically accepts one ballot, consumes its challenge, and preserves the accepted choice", async () => {
    const accepted = await vote();
    expect(accepted).toMatchObject({ contestId: "contest-a", candidateId: "candidate-a", existing: false });
    expect(sqlite.prepare("SELECT challenge_hash,challenge_expires_at FROM anonymous_voter_credentials WHERE id='voter-a'").get())
      .toEqual({ challenge_hash: null, challenge_expires_at: null });
    expect((await vote()).existing).toBe(true);
    await expect(vote("contest-a", "candidate-b")).rejects.toMatchObject({ code: "ALREADY_VOTED" });
    expect(() => sqlite.prepare("UPDATE mvp_votes SET candidate_id='candidate-b'").run()).toThrow();
    expect(() => sqlite.prepare("DELETE FROM mvp_votes").run()).toThrow();
    expect(() => sqlite.prepare("INSERT INTO mvp_votes VALUES ('duplicate','contest-a','candidate-b','voter-a',1)").run()).toThrow();
    await expect(vote("contest-b", "candidate-other")).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
  });

  it("rejects a candidate from another contest and disabled or closed contests at insertion time", async () => {
    await expect(vote("contest-a", "candidate-other")).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    sqlite.prepare("UPDATE mvp_contests SET closes_at=unixepoch('now') WHERE id='contest-a'").run();
    await expect(vote()).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    sqlite.prepare("UPDATE mvp_contests SET closes_at=unixepoch('now')+100, opens_at=unixepoch('now')+1 WHERE id='contest-a'").run();
    await expect(vote()).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    sqlite.prepare("UPDATE mvp_contests SET opens_at=unixepoch('now') WHERE id='contest-a'").run();
    sqlite.prepare("UPDATE league_phases SET mvp_enabled=0 WHERE id='phase-a'").run();
    await expect(vote()).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    sqlite.prepare("UPDATE league_phases SET mvp_enabled=1 WHERE id='phase-a'").run();
    await expect(vote()).resolves.toMatchObject({ existing: false });
  });

  it("requires current season, organization and competition publication in the guarded write", async () => {
    sqlite.prepare("UPDATE league_competition_publication SET lifecycle_status='under_construction'").run();
    await expect(vote()).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    sqlite.prepare("UPDATE league_competition_publication SET lifecycle_status='online'").run();
    sqlite.prepare("UPDATE league_organizations SET publication_status='unpublished'").run();
    await expect(vote()).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    sqlite.prepare("UPDATE league_organizations SET publication_status='published',status='suspended'").run();
    await expect(vote()).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    sqlite.prepare("UPDATE league_organizations SET status='active',slug='admin'").run();
    await expect(vote()).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    sqlite.prepare("UPDATE league_organizations SET slug='hosted-a'").run();
    sqlite.prepare("UPDATE league_seasons SET starts_on='2025-09-01'").run();
    await expect(vote()).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    sqlite.prepare("UPDATE league_seasons SET starts_on='2026-09-01',status='draft'").run();
    await expect(vote()).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_votes").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT challenge_hash FROM anonymous_voter_credentials WHERE id='voter-a'").get())
      .toEqual({ challenge_hash: challengeA });
    sqlite.prepare("UPDATE league_seasons SET status='active'").run();
    await expect(vote()).resolves.toMatchObject({ existing: false });
  });

  it("preserves the central KomoBasket publication exception", async () => {
    sqlite.prepare("INSERT INTO league_organizations VALUES ('organization_komobasket','komobasket','active','unpublished')").run();
    sqlite.prepare("UPDATE league_competitions SET organization_id='organization_komobasket'").run();
    await expect(vote()).resolves.toMatchObject({ existing: false });
  });

  it("allows only one of two concurrent attempts for different candidates", async () => {
    const attempts = await Promise.allSettled([vote("contest-a", "candidate-a"), vote("contest-a", "candidate-b")]);
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_votes").get()).toEqual({ n: 1 });
  });

  it("supports iOS counter advancement without Android-specific schema", async () => {
    credential("voter-ios", "ios", keyB, challengeB);
    const input = { contestId: "contest-a", candidateId: "candidate-b", evidence: {} };
    await expect(castMvpVoteWithDb(db, verifier("voter-ios", "ios", keyB, challengeB, 0), input))
      .rejects.toMatchObject({ code: "UNVERIFIED_VOTER" });
    await castMvpVoteWithDb(db, verifier("voter-ios", "ios", keyB, challengeB, 1), input);
    expect(sqlite.prepare("SELECT assertion_counter FROM anonymous_voter_credentials WHERE id='voter-ios'").get())
      .toEqual({ assertion_counter: 1 });
    sqlite.prepare("UPDATE anonymous_voter_credentials SET challenge_hash=?,challenge_expires_at=unixepoch('now')+100 WHERE id='voter-ios'")
      .run(challengeB);
    const another = { contestId: "contest-b", candidateId: "candidate-other", evidence: {} };
    await expect(castMvpVoteWithDb(db, verifier("voter-ios", "ios", keyB, challengeB, 1), another))
      .rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    await expect(castMvpVoteWithDb(db, verifier("voter-ios", "ios", keyB, challengeB, 2), another))
      .resolves.toMatchObject({ existing: false });
  });

  it("groups live counts while hiding all totals and candidate rankings until finalization", async () => {
    await vote();
    expect(await readMvpVoteResultsWithDb(db, "contest-a")).toEqual({ contestId: "contest-a", visibility: "hidden" });
    sqlite.prepare("UPDATE mvp_contests SET results_visibility='live' WHERE id='contest-a'").run();
    expect(await readMvpVoteResultsWithDb(db, "contest-a")).toEqual({ contestId: "contest-a",
      visibility: "visible", totalVotes: 1, candidates: [
        { candidateId: "candidate-a", votes: 1 }, { candidateId: "candidate-b", votes: 0 },
      ] });
    sqlite.prepare("UPDATE mvp_contests SET results_visibility='after_close' WHERE id='contest-a'").run();
    expect(await readMvpVoteResultsWithDb(db, "contest-a")).toEqual({ contestId: "contest-a", visibility: "hidden" });
  });
});
