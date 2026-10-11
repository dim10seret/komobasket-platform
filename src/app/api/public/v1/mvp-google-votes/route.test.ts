import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement, KomoBasketCloudflareEnv } from "@/types/cloudflare";
import { POST } from "./route";
import { GET } from "./me/route";

let env: KomoBasketCloudflareEnv;
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: async () => env }));

const migration41 = readFileSync(new URL("../../../../../../cloudflare/migrations/0041_mvp_contest_foundation.sql", import.meta.url), "utf8");
const migration42 = readFileSync(new URL("../../../../../../cloudflare/migrations/0042_mvp_guest_voting_foundation.sql", import.meta.url), "utf8");
const migration43 = readFileSync(new URL("../../../../../../cloudflare/migrations/0043_mvp_google_voting_foundation.sql", import.meta.url), "utf8");
const sessionToken = "v".repeat(43);
const csrf = "c".repeat(43);
let sqlite: DatabaseSync;
let db: D1DatabaseBinding;
let beforeInsert: (() => void) | null;
let limits: string[];

function prepared(sql: string, args: unknown[] = []): D1PreparedStatement {
  return {
    bind: (...values) => prepared(sql, values),
    first: async <T,>() => (sqlite.prepare(sql).get(...args) ?? null) as T | null,
    all: async <T,>() => ({ results: sqlite.prepare(sql).all(...args) as T[] }),
    run: async () => {
      if (sql.startsWith("INSERT INTO mvp_google_votes") && beforeInsert) {
        const action = beforeInsert;
        beforeInsert = null;
        action();
      }
      return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } };
    },
  };
}

function count() {
  return (sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_votes").get() as { n: number }).n;
}

function selected() {
  return sqlite.prepare("SELECT candidate_id FROM mvp_google_votes WHERE contest_id='contest-a'")
    .get() as { candidate_id: string } | undefined;
}

function voteRequest(candidateId = "candidate-a", options: { cookie?: string; origin?: string;
  csrfHeader?: string; body?: unknown; ip?: string } = {}) {
  const body = options.body ?? { contestId: "contest-a", candidateId };
  return new Request("http://localhost:3000/api/public/v1/mvp-google-votes", { method: "POST",
    headers: { "content-type": "application/json", "cookie": options.cookie ?? `kb_mvp_session=${sessionToken}; kb_mvp_csrf=${csrf}`,
      "origin": options.origin ?? "http://localhost:3000", "x-kb-mvp-csrf": options.csrfHeader ?? csrf,
      "cf-connecting-ip": options.ip ?? "192.0.2.1" }, body: JSON.stringify(body) });
}

function myRequest(cookie = `kb_mvp_session=${sessionToken}`, contestId = "contest-a") {
  return new Request(`http://localhost:3000/api/public/v1/mvp-google-votes/me?contestId=${contestId}`,
    { headers: { cookie } });
}

beforeEach(async () => {
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
    ${migration41}
    ${migration42}
    ${migration43}
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
        ('contest-b','phase-a','round',2,'app_poll','open','after_close',unixepoch('now')-10,
        unixepoch('now')+100,'operator-a',unixepoch('now')-10,unixepoch('now')-10);
    INSERT INTO mvp_candidates(id,contest_id,player_id,supporting_game_id,team_id,player_name,team_name,
      points,rebounds,assists,efficiency,origin,created_at)
      VALUES ('candidate-a','contest-a','player-a','game-a','team-a','Player A','Team A',10,2,1,12,'operator',unixepoch('now')),
        ('candidate-b','contest-a','player-b','game-a','team-a','Player B','Team A',8,3,2,11,'operator',unixepoch('now')),
        ('candidate-other','contest-b','player-a','game-a','team-a','Player A','Team A',10,2,1,12,'operator',unixepoch('now'));
    INSERT INTO mvp_google_voters VALUES ('voter-a','${"a".repeat(64)}',unixepoch('now'));
  `);
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",
    new TextEncoder().encode(sessionToken))), (byte) => byte.toString(16).padStart(2, "0")).join("");
  sqlite.prepare(`INSERT INTO mvp_google_sessions
    (id,kind,voter_id,token_hash,created_at,expires_at)
    VALUES ('session-a','voter','voter-a',?,unixepoch('now'),unixepoch('now')+3600)`).run(digest);
  db = { prepare: (sql) => prepared(sql), batch: async () => [] };
  limits = [];
  beforeInsert = null;
  env = { NEWS_DB: db, MVP_GOOGLE_AUTH_ENABLED: "enabled", MVP_GOOGLE_VOTING_ENABLED: "enabled",
    MVP_PUBLIC_READ_ENABLED: "enabled", MVP_GOOGLE_CLIENT_ID: "synthetic-client",
    MVP_GOOGLE_CLIENT_SECRET: "synthetic-secret",
    MVP_GOOGLE_REDIRECT_URI: "http://localhost:3000/api/public/v1/mvp-google-auth/callback",
    MVP_GOOGLE_SUB_HMAC_KEY: "A".repeat(43), USER_LOGIN_RATE_LIMITER: { limit: async ({ key }) => {
      limits.push(key);
      return { success: true };
    } } };
});
afterEach(() => sqlite.close());

describe("MVP4A.2 Google ballot API with actual SQLite constraints", () => {
  it("accepts one ballot, then returns stable same-choice status without another insert", async () => {
    const first = await POST(voteRequest());
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ data: { contestId: "contest-a", candidateId: "candidate-a", alreadyVoted: false } });
    expect(first.headers.get("cache-control")).toContain("no-store");
    expect(count()).toBe(1);
    const again = await POST(voteRequest());
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ data: { alreadyVoted: true } });
    expect(count()).toBe(1);
    expect(limits).toHaveLength(4);
  });

  it("rejects a changed choice and preserves the original immutable ballot", async () => {
    await POST(voteRequest());
    expect((await POST(voteRequest("candidate-b"))).status).toBe(409);
    expect(selected()).toEqual({ candidate_id: "candidate-a" });
    expect(() => sqlite.exec("UPDATE mvp_google_votes SET candidate_id='candidate-b'")).toThrow();
    expect(() => sqlite.exec("DELETE FROM mvp_google_votes")).toThrow();
    expect(count()).toBe(1);
  });

  it("allows at most one accepted ballot for simultaneous submissions", async () => {
    const responses = await Promise.all([POST(voteRequest()), POST(voteRequest("candidate-b"))]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(count()).toBe(1);
  });

  it.each(["", `kb_mvp_session=${"x".repeat(43)}`, "__Host-kb_user_session=staff"])
  ("rejects missing, invalid and staff-only voter sessions: %s", async (cookie) => {
    expect((await POST(voteRequest("candidate-a", { cookie }))).status).toBe(401);
    expect(count()).toBe(0);
  });

  it.each(["expired", "revoked"])("rejects %s voter sessions", async (state) => {
    sqlite.exec(state === "expired"
      ? "UPDATE mvp_google_sessions SET created_at=unixepoch('now')-100,expires_at=unixepoch('now')-1 WHERE id='session-a'"
      : "UPDATE mvp_google_sessions SET revoked_at=unixepoch('now') WHERE id='session-a'");
    expect((await POST(voteRequest())).status).toBe(401);
    expect(count()).toBe(0);
  });

  it("rejects missing or invalid CSRF and a cross-origin request", async () => {
    expect((await POST(voteRequest("candidate-a", { csrfHeader: "" }))).status).toBe(403);
    expect((await POST(voteRequest("candidate-a", { csrfHeader: "x".repeat(43) }))).status).toBe(403);
    expect((await POST(voteRequest("candidate-a", { origin: "https://evil.example" }))).status).toBe(403);
    expect(count()).toBe(0);
  });

  it("fails closed when flags, configuration or the limiter are missing or reject", async () => {
    env.MVP_GOOGLE_VOTING_ENABLED = undefined;
    expect((await POST(voteRequest())).status).toBe(404);
    env.MVP_GOOGLE_VOTING_ENABLED = "enabled";
    env.MVP_GOOGLE_AUTH_ENABLED = undefined;
    expect((await POST(voteRequest())).status).toBe(404);
    env.MVP_GOOGLE_AUTH_ENABLED = "enabled";
    env.MVP_PUBLIC_READ_ENABLED = undefined;
    expect((await POST(voteRequest())).status).toBe(503);
    env.MVP_PUBLIC_READ_ENABLED = "enabled";
    env.USER_LOGIN_RATE_LIMITER = undefined;
    expect((await POST(voteRequest())).status).toBe(503);
    env.USER_LOGIN_RATE_LIMITER = { limit: async () => ({ success: false }) };
    expect((await POST(voteRequest())).status).toBe(429);
    expect(count()).toBe(0);
  });

  it("rejects malformed bodies and client-supplied voter identity", async () => {
    const wrongType = voteRequest();
    wrongType.headers.set("content-type", "text/plain");
    expect((await POST(wrongType)).status).toBe(400);
    expect((await POST(voteRequest("candidate-a", { body: { contestId: "contest-a", candidateId: "candidate-a", voterId: "voter-a" } }))).status).toBe(400);
    expect((await POST(voteRequest("candidate-a", { body: { contestId: "contest-a", candidateId: 1 } }))).status).toBe(400);
    expect((await POST(voteRequest("candidate-a", { body: { contestId: "contest-a", candidateId: "x".repeat(5000) } }))).status).toBe(413);
    expect(count()).toBe(0);
  });

  it.each([
    ["missing contest", "missing", "candidate-a"],
    ["missing candidate", "contest-a", "missing"],
    ["foreign contest candidate", "contest-a", "candidate-other"],
  ])("rejects %s", async (_label, contestId, candidateId) => {
    const result = await POST(voteRequest(candidateId, { body: { contestId, candidateId } }));
    expect(result.status).toBe(404);
    expect(count()).toBe(0);
  });

  it.each([
    ["disabled phase", "UPDATE league_phases SET mvp_enabled=0 WHERE id='phase-a'"],
    ["unpublished organization", "UPDATE league_organizations SET publication_status='draft' WHERE id='organization-a'"],
    ["unpublished competition", "UPDATE league_competition_publication SET lifecycle_status='under_construction' WHERE competition_id='competition-a'"],
    ["hidden season", "UPDATE league_seasons SET starts_on='2025-09-01' WHERE id='season-a'"],
    ["poll not open", "UPDATE mvp_contests SET opens_at=unixepoch('now')+1,closes_at=unixepoch('now')+100 WHERE id='contest-a'"],
    ["poll closed", "UPDATE mvp_contests SET closes_at=unixepoch('now')-1 WHERE id='contest-a'"],
    ["exact closing boundary", "UPDATE mvp_contests SET closes_at=unixepoch('now') WHERE id='contest-a'"],
    ["non-open status", "UPDATE mvp_contests SET status='needs_operator_decision' WHERE id='contest-a'"],
  ])("rejects %s inside guarded SQL", async (_label, change) => {
    sqlite.exec(change);
    expect((await POST(voteRequest())).status).toBe(404);
    expect(count()).toBe(0);
  });

  it.each([
    ["closed contest", "UPDATE mvp_contests SET status='needs_operator_decision' WHERE id='contest-a'"],
    ["changed deadline", "UPDATE mvp_contests SET closes_at=unixepoch('now') WHERE id='contest-a'"],
    ["changed publication", "UPDATE league_competition_publication SET lifecycle_status='under_construction' WHERE competition_id='competition-a'"],
    ["revoked session", "UPDATE mvp_google_sessions SET revoked_at=unixepoch('now') WHERE id='session-a'"],
  ])("rejects %s changed immediately before the actual insert", async (_label, change) => {
    beforeInsert = () => sqlite.exec(change);
    expect((await POST(voteRequest())).status).toBe(404);
    expect(count()).toBe(0);
  });

  it("does not allow another organization's candidate to be selected", async () => {
    sqlite.exec(`INSERT INTO league_organizations VALUES ('organization-b','hosted-b','active','published');
      INSERT INTO league_competitions VALUES ('competition-b','organization-b','season-a','active');
      INSERT INTO league_competition_publication VALUES ('competition-b','online');
      INSERT INTO league_phases(id,competition_id,mvp_enabled) VALUES ('phase-b','competition-b',1);
      INSERT INTO mvp_contests(id,phase_id,scope_type,round_number,selection_method,status,results_visibility,
        opens_at,closes_at,created_by_user_id,created_at,updated_at)
        VALUES ('contest-c','phase-b','round',1,'app_poll','open','after_close',unixepoch('now')-1,
          unixepoch('now')+100,'operator-a',1,1);
      INSERT INTO mvp_candidates(id,contest_id,player_id,supporting_game_id,team_id,player_name,team_name,
        points,rebounds,assists,efficiency,origin,created_at)
        VALUES ('candidate-c','contest-c','player-a','game-a','team-a','Player','Team',1,1,1,1,'operator',1);`);
    expect((await POST(voteRequest("candidate-c"))).status).toBe(404);
    expect(count()).toBe(0);
  });

  it("returns only this voter's private ballot status, without identities or totals", async () => {
    expect(await (await GET(myRequest())).json()).toEqual({ data: { contestId: "contest-a", voted: false, candidateId: null } });
    await POST(voteRequest());
    const result = await GET(myRequest());
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toContain("no-store");
    expect(await result.json()).toEqual({ data: { contestId: "contest-a", voted: true, candidateId: "candidate-a" } });
    expect((await GET(myRequest("__Host-kb_user_session=staff"))).status).toBe(401);
    expect((await GET(myRequest(undefined, "missing"))).status).toBe(404);
  });

  it("does not reveal private ballot status after publication is withdrawn", async () => {
    await POST(voteRequest());
    sqlite.exec("UPDATE league_competition_publication SET lifecycle_status='under_construction' WHERE competition_id='competition-a'");
    expect((await GET(myRequest())).status).toBe(404);
    expect(count()).toBe(1);
  });

  it("preserves schema integrity and leaves native votes and finalization untouched", async () => {
    await POST(voteRequest());
    expect(sqlite.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_votes").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT status,winner_player_id,finalized_at FROM mvp_contests WHERE id='contest-a'").get())
      .toEqual({ status: "open", winner_player_id: null, finalized_at: null });
  });

});
