import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

import { canonicalMvpChallenge, parseP256PublicKey } from "./mvp-guest-crypto";
import { MvpGuestVotingService, type MvpIntegrityVerifier } from "./mvp-guest-voting.service";
import { readMvpVoteResultsWithDb } from "./mvp-vote.service";

const foundation = readFileSync(new URL("../../cloudflare/migrations/0041_mvp_contest_foundation.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../../cloudflare/migrations/0042_mvp_guest_voting_foundation.sql", import.meta.url), "utf8");
let sqlite: DatabaseSync;
let db: D1DatabaseBinding;
let service: MvpGuestVotingService;
let integrity: MvpIntegrityVerifier;
let key: CryptoKeyPair;
let publicKeySpki: string;
let publicKeySha256: string;

function prepared(sql: string, args: unknown[] = []): D1PreparedStatement {
  return { bind: (...values) => prepared(sql, values),
    all: async <T,>() => ({ results: sqlite.prepare(sql).all(...args) as T[] }),
    first: async <T,>() => (sqlite.prepare(sql).get(...args) ?? null) as T | null,
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
  };
}

function encoded(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

async function signature(action: "register" | "vote", contestId: string, candidateId: string,
  credentialId: string, challenge: string): Promise<string> {
  const bytes = canonicalMvpChallenge({ action, contestId, candidateId, credentialId,
    publicKeySha256, challenge });
  const signed = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey,
    new Uint8Array(bytes).buffer);
  return encoded(new Uint8Array(signed));
}

async function challenge(action: "register" | "vote", candidateId = "candidate-a", contestId = "contest-a") {
  return service.issueChallenge({ action, contestId, candidateId, publicKeySpki });
}

async function register() {
  const issued = await challenge("register");
  const signed = await signature("register", "contest-a", "candidate-a", issued.credentialId, issued.challenge);
  const result = await service.register({ contestId: "contest-a", candidateId: "candidate-a",
    credentialId: issued.credentialId, challenge: issued.challenge,
    signature: signed, integrityToken: "synthetic-valid-integrity-token" });
  return { issued, result };
}

beforeEach(async () => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE league_seasons(id TEXT PRIMARY KEY, name TEXT, slug TEXT, starts_on TEXT, ends_on TEXT, status TEXT);
    CREATE TABLE league_organizations(id TEXT PRIMARY KEY, slug TEXT, name TEXT, logo_url TEXT,
      status TEXT, publication_status TEXT);
    CREATE TABLE league_competitions(id TEXT PRIMARY KEY, organization_id TEXT REFERENCES league_organizations(id),
      season_id TEXT REFERENCES league_seasons(id), slug TEXT, name TEXT, type TEXT, logo_url TEXT, status TEXT);
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
    INSERT INTO league_seasons VALUES ('season-a','Season 2026–27','season-2026','2026-09-01',NULL,'active');
    INSERT INTO league_organizations VALUES ('organization-a','hosted-a','Hosted A',NULL,'active','published'),
      ('organization-b','hosted-b','Hosted B',NULL,'active','unpublished');
    INSERT INTO league_competitions VALUES ('competition-a','organization-a','season-a','competition-a',
      'Competition A','league',NULL,'active'),('competition-b','organization-b','season-a','competition-b',
      'Competition B','league',NULL,'active');
    INSERT INTO league_competition_publication VALUES ('competition-a','online'),('competition-b','online');
    INSERT INTO league_phases(id,competition_id,mvp_enabled) VALUES
      ('phase-a','competition-a',1),('phase-b','competition-b',1);
    INSERT INTO league_players(id) VALUES ('player-a'),('player-b');
    INSERT INTO league_games(id) VALUES ('game-a');
    INSERT INTO league_teams(id) VALUES ('team-a');
    INSERT INTO league_app_users(id) VALUES ('operator-a');
    INSERT INTO mvp_contests(id,phase_id,scope_type,round_number,selection_method,status,results_visibility,
      opens_at,closes_at,created_by_user_id,created_at,updated_at)
      VALUES ('contest-a','phase-a','round',1,'app_poll','open','after_close',unixepoch('now')-10,
        unixepoch('now')+100,'operator-a',unixepoch('now')-10,unixepoch('now')-10),
        ('contest-foreign','phase-b','round',1,'app_poll','open','live',unixepoch('now')-10,
        unixepoch('now')+100,'operator-a',unixepoch('now')-10,unixepoch('now')-10);
    INSERT INTO mvp_candidates(id,contest_id,player_id,supporting_game_id,team_id,player_name,team_name,
      points,rebounds,assists,efficiency,origin,created_at)
      VALUES ('candidate-a','contest-a','player-a','game-a','team-a','Player A','Team A',10,2,1,12,'operator',unixepoch('now')),
        ('candidate-b','contest-a','player-b','game-a','team-a','Player B','Team A',8,3,2,11,'operator',unixepoch('now')),
        ('candidate-foreign','contest-foreign','player-a','game-a','team-a','Player A','Team A',8,3,2,11,'operator',unixepoch('now'));`);
  db = { prepare: (sql) => prepared(sql), batch: async (statements) => {
    sqlite.exec("BEGIN");
    try { const results = [];
      for (const statement of statements) results.push(await statement.run());
      sqlite.exec("COMMIT"); return results;
    } catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  } };
  key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  publicKeySpki = encoded(new Uint8Array(await crypto.subtle.exportKey("spki", key.publicKey)));
  publicKeySha256 = (await parseP256PublicKey(publicKeySpki)).sha256;
  integrity = { verify: vi.fn(async (token: string, requestHash: string) => {
    if (token !== "synthetic-valid-integrity-token" || !/^[0-9a-f]{64}$/.test(requestHash)) throw Error("bad verdict");
  }) };
  service = new MvpGuestVotingService(db, integrity);
});
afterEach(() => sqlite.close());

describe("MVP2B guest challenge and credential protocol", () => {
  it("registers a signed Android credential with a server challenge and no login", async () => {
    const { issued, result } = await register();
    expect(issued).toMatchObject({ protocolVersion: 1, credentialId: result.credentialId });
    expect(issued.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(integrity.verify).toHaveBeenCalledWith("synthetic-valid-integrity-token", issued.requestHash);
    expect(sqlite.prepare("SELECT verification_status,challenge_hash,challenge_expires_at FROM anonymous_voter_credentials").get())
      .toEqual({ verification_status: "verified", challenge_hash: null, challenge_expires_at: null });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
  });

  it("rejects invalid public keys, missing or expired challenges and invalid signatures", async () => {
    await expect(service.issueChallenge({ action: "register", contestId: "contest-a",
      candidateId: "candidate-a", publicKeySpki: "not-a-key" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    const issued = await challenge("register");
    const proof = { contestId: "contest-a", candidateId: "candidate-a", credentialId: issued.credentialId,
      challenge: issued.challenge, signature: "invalid", integrityToken: "synthetic-valid-integrity-token" };
    await expect(service.register(proof)).rejects.toMatchObject({ code: "INVALID_PROOF" });
    expect(integrity.verify).not.toHaveBeenCalled();
    await expect(service.register({ ...proof, challenge: "z".repeat(43) }))
      .rejects.toMatchObject({ code: "INVALID_PROOF" });
    sqlite.prepare("UPDATE anonymous_voter_credentials SET challenge_expires_at=unixepoch('now')-1").run();
    await expect(service.register({ ...proof, signature: await signature("register", "contest-a",
      "candidate-a", issued.credentialId, issued.challenge) })).rejects.toMatchObject({ code: "INVALID_PROOF" });
  });

  it("binds proof to the exact contest, candidate, key and action", async () => {
    const issued = await challenge("register");
    const signed = await signature("register", "contest-a", "candidate-a", issued.credentialId, issued.challenge);
    const base = { contestId: "contest-a", candidateId: "candidate-a", credentialId: issued.credentialId,
      challenge: issued.challenge, signature: signed, integrityToken: "synthetic-valid-integrity-token" };
    await expect(service.register({ ...base, candidateId: "candidate-b" }))
      .rejects.toMatchObject({ code: "INVALID_PROOF" });
    await expect(service.register({ ...base, contestId: "contest-foreign", candidateId: "candidate-foreign" }))
      .rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    await expect(service.vote(base)).rejects.toMatchObject({ code: "CREDENTIAL_UNAVAILABLE" });
    await expect(service.register(base)).resolves.toMatchObject({ verified: true });
  });

  it("keeps a credential pending when the integrity verifier rejects registration", async () => {
    const issued = await challenge("register");
    const proof = { contestId: "contest-a", candidateId: "candidate-a", credentialId: issued.credentialId,
      challenge: issued.challenge, signature: await signature("register", "contest-a", "candidate-a",
        issued.credentialId, issued.challenge), integrityToken: "synthetic-invalid-integrity-token" };
    await expect(service.register(proof)).rejects.toThrow("bad verdict");
    expect(sqlite.prepare("SELECT verification_status, challenge_hash FROM anonymous_voter_credentials").get())
      .toEqual({ verification_status: "pending", challenge_hash: issued.requestHash });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_votes").get()).toEqual({ n: 0 });
  });

  it("casts one immutable ballot and rejects replay, changed candidate and concurrent duplicates", async () => {
    await register();
    const issued = await challenge("vote");
    const proof = { contestId: "contest-a", candidateId: "candidate-a", credentialId: issued.credentialId,
      challenge: issued.challenge, signature: await signature("vote", "contest-a", "candidate-a",
        issued.credentialId, issued.challenge), integrityToken: "synthetic-valid-integrity-token" };
    const attempts = await Promise.allSettled([service.vote(proof), service.vote(proof)]);
    expect(attempts.some((item) => item.status === "fulfilled" && item.value.existing === false)).toBe(true);
    expect(attempts.filter((item) => item.status === "fulfilled" && item.value.existing === false)).toHaveLength(1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_votes").get()).toEqual({ n: 1 });
    await expect(service.vote(proof)).rejects.toMatchObject({ code: "INVALID_PROOF" });
    await expect(service.vote({ ...proof, candidateId: "candidate-b" }))
      .rejects.toMatchObject({ code: "INVALID_PROOF" });
    expect(await readMvpVoteResultsWithDb(db, "contest-a"))
      .toEqual({ contestId: "contest-a", visibility: "hidden" });
  });

  it("rejects a ballot when publication changes while integrity verification is pending", async () => {
    await register();
    const issued = await challenge("vote");
    const proof = { contestId: "contest-a", candidateId: "candidate-a", credentialId: issued.credentialId,
      challenge: issued.challenge, signature: await signature("vote", "contest-a", "candidate-a",
        issued.credentialId, issued.challenge), integrityToken: "synthetic-valid-integrity-token" };
    let verificationEntered!: () => void;
    let releaseVerification!: () => void;
    const entered = new Promise<void>((resolve) => { verificationEntered = resolve; });
    const gate = new Promise<void>((resolve) => { releaseVerification = resolve; });
    integrity.verify = vi.fn(async () => { verificationEntered(); await gate; });

    const pendingVote = service.vote(proof);
    await entered;
    sqlite.prepare("UPDATE league_competition_publication SET lifecycle_status='under_construction' WHERE competition_id='competition-a'").run();
    releaseVerification();

    await expect(pendingVote).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_votes").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT challenge_hash FROM anonymous_voter_credentials WHERE id=?")
      .get(issued.credentialId)).toEqual({ challenge_hash: issued.requestHash });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("PRAGMA quick_check").get()).toEqual({ quick_check: "ok" });
  });

  it("rejects closed/disabled contests and cross-organization selections", async () => {
    await expect(challenge("register", "candidate-foreign", "contest-foreign"))
      .rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    await expect(challenge("register", "candidate-foreign", "contest-a"))
      .rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    sqlite.prepare("UPDATE mvp_contests SET closes_at=unixepoch('now') WHERE id='contest-a'").run();
    await expect(challenge("register")).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
    sqlite.prepare("UPDATE mvp_contests SET closes_at=unixepoch('now')+100").run();
    sqlite.prepare("UPDATE league_phases SET mvp_enabled=0 WHERE id='phase-a'").run();
    await expect(challenge("register")).rejects.toMatchObject({ code: "CONTEST_UNAVAILABLE" });
  });
});
