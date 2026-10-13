import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement, KomoBasketCloudflareEnv } from "@/types/cloudflare";
import { MvpGoogleAuthService, requireMvpVoterMutationOrigin } from "./mvp-google-auth.service";

const migration41 = readFileSync(new URL("../../cloudflare/migrations/0041_mvp_contest_foundation.sql", import.meta.url), "utf8");
const migration42 = readFileSync(new URL("../../cloudflare/migrations/0042_mvp_guest_voting_foundation.sql", import.meta.url), "utf8");
const migration43 = readFileSync(new URL("../../cloudflare/migrations/0043_mvp_google_voting_foundation.sql", import.meta.url), "utf8");
const callbackUrl = "http://localhost:3000/api/public/v1/mvp-google-auth/callback";
const poll = "/mvp/competitions/competition-a/tournaments/phase-a/contests/contest-a";
const secret = "A".repeat(43);
let sqlite: DatabaseSync;
let db: D1DatabaseBinding;
let env: KomoBasketCloudflareEnv;
let key: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;
let tokenClaims: Record<string, unknown>;
let lastCodeVerifier = "";

function prepared(sql: string, args: unknown[] = []): D1PreparedStatement {
  return {
    bind: (...values) => prepared(sql, values),
    first: async <T,>() => (sqlite.prepare(sql).get(...args) ?? null) as T | null,
    all: async <T,>() => ({ results: sqlite.prepare(sql).all(...args) as T[] }),
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
  };
}

function request(path: string, headers: HeadersInit = {}): Request {
  return new Request(`http://localhost:3000${path}`, { headers });
}

function cookieValue(response: Response, name: string): string {
  const entry = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`));
  return entry?.split(";")[0] ?? "";
}

async function jwt(claims: Record<string, unknown> = tokenClaims, signingKey = key): Promise<string> {
  return new SignJWT(claims).setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuedAt().setExpirationTime("5m").sign(signingKey);
}

function service(idToken?: string) {
  const fetchImpl = (async (_url: string | URL | Request, options?: RequestInit) => {
    lastCodeVerifier = new URLSearchParams(String(options?.body)).get("code_verifier") ?? "";
    return Response.json({ id_token: idToken ?? await jwt(tokenClaims) });
  }) as typeof fetch;
  return new MvpGoogleAuthService(db, env, fetchImpl, jwks);
}

async function start() {
  const response = await service().start(request(`/api/public/v1/mvp-google-auth/start?returnTo=${encodeURIComponent(poll)}`));
  const authorization = new URL(response.headers.get("location")!);
  tokenClaims.nonce = authorization.searchParams.get("nonce");
  return { response, authorization, stateCookie: cookieValue(response, "kb_mvp_login") };
}

async function callback(state: string, cookieHeader: string) {
  return service().callback(request(`/api/public/v1/mvp-google-auth/callback?state=${state}&code=synthetic-code`, { cookie: cookieHeader }));
}

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  key = pair.privateKey;
  jwks = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), kid: "test-key", alg: "RS256", use: "sig" }] });
});

beforeEach(() => {
  sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE league_phases(id TEXT PRIMARY KEY);
    CREATE TABLE league_players(id TEXT PRIMARY KEY);
    CREATE TABLE league_games(id TEXT PRIMARY KEY);
    CREATE TABLE league_teams(id TEXT PRIMARY KEY);
    CREATE TABLE league_app_users(id TEXT PRIMARY KEY);
    CREATE TABLE league_matchday_mvp_selections(id TEXT PRIMARY KEY);
    ${migration41}
    ${migration42}
    ${migration43}`);
  db = { prepare: (sql) => prepared(sql), batch: async () => [] };
  env = { NEWS_DB: db, MVP_GOOGLE_AUTH_ENABLED: "enabled", MVP_GOOGLE_CLIENT_ID: "synthetic-client",
    MVP_GOOGLE_CLIENT_SECRET: "synthetic-secret", MVP_GOOGLE_REDIRECT_URI: callbackUrl,
    MVP_GOOGLE_SUB_HMAC_KEY: secret, USER_LOGIN_RATE_LIMITER: { limit: async () => ({ success: true }) } };
  tokenClaims = { iss: "https://accounts.google.com", aud: "synthetic-client", sub: "google-sub-123" };
  lastCodeVerifier = "";
});
afterEach(() => sqlite.close());

describe("MVP4A.1 Google OIDC and sessions", () => {
  it("creates an OIDC redirect with state, nonce, S256 PKCE and only identity scopes", async () => {
    const { response, authorization, stateCookie } = await start();
    expect(response.status).toBe(302);
    expect(authorization.origin).toBe("https://accounts.google.com");
    expect(authorization.searchParams.get("redirect_uri")).toBe(callbackUrl);
    expect(authorization.searchParams.get("scope")).toBe("openid profile");
    expect(authorization.searchParams.get("scope")?.split(" ")).toEqual(["openid", "profile"]);
    expect(authorization.searchParams.get("scope")).not.toContain("email");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(authorization.searchParams.get("state")).toBe(stateCookie.split("=")[1]);
    expect(authorization.searchParams.get("nonce")).toHaveLength(43);
    expect(response.headers.getSetCookie().join(" ")).toContain("HttpOnly");
    expect(response.headers.getSetCookie().join(" ")).not.toContain("Secure");
  });

  it("uses host-only Secure cookies and the fixed HTTPS callback in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      env.MVP_GOOGLE_REDIRECT_URI = "https://komobasket.gr/api/public/v1/mvp-google-auth/callback";
      const response = await service().start(new Request(`https://komobasket.gr/api/public/v1/mvp-google-auth/start?returnTo=${encodeURIComponent(poll)}`,
        { headers: { "cf-connecting-ip": "192.0.2.1" } }));
      expect(response.headers.getSetCookie().join(" ")).toContain("__Host-kb_mvp_login=");
      expect(response.headers.getSetCookie().join(" ")).toContain("Secure");
      expect(response.headers.getSetCookie().join(" ")).toContain("HttpOnly");
      expect(response.headers.getSetCookie().join(" ")).not.toContain("Domain=");
      expect(new URL(response.headers.get("location")!).searchParams.get("redirect_uri"))
        .toBe(env.MVP_GOOGLE_REDIRECT_URI);
      await expect(service().start(new Request(`https://evil.example/api/public/v1/mvp-google-auth/start?returnTo=${encodeURIComponent(poll)}`,
        { headers: { "cf-connecting-ip": "192.0.2.1" } }))).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE" });
    } finally { vi.unstubAllEnvs(); }
  });

  it("rejects external and malformed return paths", async () => {
    for (const path of ["https://evil.example/", "//evil.example/", "/admin", `${poll}?next=x`]) {
      await expect(service().start(request(`/api/public/v1/mvp-google-auth/start?returnTo=${encodeURIComponent(path)}`)))
        .rejects.toMatchObject({ code: "INVALID_REQUEST" });
    }
  });

  it("rejects absent or altered state and consumes a valid state only once", async () => {
    const login = await start();
    const state = login.authorization.searchParams.get("state")!;
    await expect(callback("x".repeat(43), login.stateCookie)).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    await expect(callback(state, "")).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    await callback(state, login.stateCookie);
    await expect(callback(state, login.stateCookie)).rejects.toMatchObject({ code: "INVALID_LOGIN" });
  });

  it("exchanges with the original PKCE verifier and issues a hashed, bounded session", async () => {
    const login = await start();
    const state = login.authorization.searchParams.get("state")!;
    const response = await callback(state, login.stateCookie);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(poll);
    expect(lastCodeVerifier).toHaveLength(43);
    const encoded = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(lastCodeVerifier)));
    const challenge = btoa(String.fromCharCode(...encoded)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    expect(challenge).toBe(login.authorization.searchParams.get("code_challenge"));
    const session = cookieValue(response, "kb_mvp_session");
    expect(session).toMatch(/^kb_mvp_session=[A-Za-z0-9_-]{43}$/);
    const stored = sqlite.prepare("SELECT token_hash,expires_at-created_at AS ttl FROM mvp_google_sessions WHERE kind='voter'").get() as { token_hash: string; ttl: number };
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.token_hash).not.toContain(session.split("=")[1]);
    expect(stored.ttl).toBe(7 * 24 * 60 * 60);
    const result = await service().session(request("/api/public/v1/mvp-google-auth/session", { cookie: session }));
    expect((await result.json()).authenticated).toBe(true);
    expect(JSON.stringify(await service().session(request("/api/public/v1/mvp-google-auth/session")))).not.toContain("google-sub-123");
  });

  it("deduplicates Google sub without persisting email or profile", async () => {
    tokenClaims = { ...tokenClaims, email: "synthetic@example.invalid", name: "Synthetic Voter",
      picture: "https://example.invalid/synthetic.png" };
    for (let i = 0; i < 2; i++) {
      const login = await start();
      await callback(login.authorization.searchParams.get("state")!, login.stateCookie);
    }
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_voters").get()).toEqual({ n: 1 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_sessions WHERE kind='voter'").get()).toEqual({ n: 2 });
    expect(migration43).not.toMatch(/\bemail\b|\bprofile\b/i);
    const stored = JSON.stringify(sqlite.prepare("SELECT * FROM mvp_google_voters").all());
    expect(stored).not.toContain("synthetic@example.invalid");
    expect(stored).not.toContain("Synthetic Voter");
    expect(stored).not.toContain("synthetic.png");
  });

  it.each([
    ["incorrect issuer", { iss: "https://attacker.example" }],
    ["incorrect audience", { aud: "another-client" }],
    ["missing issuer", { iss: undefined }],
    ["missing audience", { aud: undefined }],
    ["missing sub", { sub: undefined }],
    ["invalid sub", { sub: "" }],
    ["incorrect nonce", { nonce: "wrong" }],
    ["missing nonce", { nonce: undefined }],
    ["incorrect authorized presenter", { azp: "another-client" }],
  ])("rejects %s", async (_label, override) => {
    const login = await start();
    tokenClaims = { ...tokenClaims, ...override };
    await expect(callback(login.authorization.searchParams.get("state")!, login.stateCookie))
      .rejects.toMatchObject({ code: "INVALID_LOGIN" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_voters").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_sessions WHERE kind='voter'").get()).toEqual({ n: 0 });
  });

  it("rejects expired and incorrectly signed ID tokens", async () => {
    const original = tokenClaims;
    const login = await start();
    const nonce = login.authorization.searchParams.get("nonce")!;
    const badKey = await generateKeyPair("RS256");
    const badToken = await jwt({ ...original, nonce }, badKey.privateKey);
    const badService = new MvpGoogleAuthService(db, env, (async () => Response.json({ id_token: badToken })) as typeof fetch, jwks);
    await expect(badService.callback(request(`/api/public/v1/mvp-google-auth/callback?state=${login.authorization.searchParams.get("state")}&code=x`, { cookie: login.stateCookie })))
      .rejects.toMatchObject({ code: "INVALID_LOGIN" });
    const second = await start();
    const expired = await new SignJWT({ ...original, nonce: second.authorization.searchParams.get("nonce") })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuedAt(0).setExpirationTime(1).sign(key);
    const expiredService = new MvpGoogleAuthService(db, env, (async () => Response.json({ id_token: expired })) as typeof fetch, jwks);
    await expect(expiredService.callback(request(`/api/public/v1/mvp-google-auth/callback?state=${second.authorization.searchParams.get("state")}&code=x`, { cookie: second.stateCookie })))
      .rejects.toMatchObject({ code: "INVALID_LOGIN" });
  });

  it("rejects a signed ID token without exp before creating a voter session", async () => {
    const login = await start();
    const noExpiry = await new SignJWT(tokenClaims)
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuedAt().sign(key);
    await expect(service(noExpiry).callback(request(
      `/api/public/v1/mvp-google-auth/callback?state=${login.authorization.searchParams.get("state")}&code=x`,
      { cookie: login.stateCookie },
    ))).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_voters").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_sessions WHERE kind='voter'").get()).toEqual({ n: 0 });
  });

  it.each([
    ["non-numeric", "tomorrow"],
    ["null", null],
    ["expired", 1],
  ])("rejects a signed ID token with %s exp before creating a voter session", async (_label, exp) => {
    const login = await start();
    const invalidExpiry = await new SignJWT({ ...tokenClaims, exp })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuedAt().sign(key);
    await expect(service(invalidExpiry).callback(request(
      `/api/public/v1/mvp-google-auth/callback?state=${login.authorization.searchParams.get("state")}&code=x`,
      { cookie: login.stateCookie },
    ))).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_voters").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_sessions WHERE kind='voter'").get()).toEqual({ n: 0 });
  });

  it("accepts a signed ID token with a valid future exp", async () => {
    const login = await start();
    const futureExpiry = await new SignJWT({ ...tokenClaims, exp: Math.floor(Date.now() / 1000) + 300 })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuedAt().sign(key);
    const response = await service(futureExpiry).callback(request(
      `/api/public/v1/mvp-google-auth/callback?state=${login.authorization.searchParams.get("state")}&code=x`,
      { cookie: login.stateCookie },
    ));
    expect(response.status).toBe(302);
    const session = cookieValue(response, "kb_mvp_session");
    expect((await (await service().session(request("/api/public/v1/mvp-google-auth/session", { cookie: session }))).json()).authenticated).toBe(true);
  });

  it("rejects a signed ID token without iat before creating a voter session", async () => {
    const login = await start();
    const noIssuedAt = await new SignJWT({ ...tokenClaims, exp: Math.floor(Date.now() / 1000) + 300 })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(key);
    await expect(service(noIssuedAt).callback(request(
      `/api/public/v1/mvp-google-auth/callback?state=${login.authorization.searchParams.get("state")}&code=x`,
      { cookie: login.stateCookie },
    ))).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_voters").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_sessions WHERE kind='voter'").get()).toEqual({ n: 0 });
  });

  it.each([
    ["null", null],
    ["non-numeric", "yesterday"],
  ])("rejects a signed ID token with %s iat before creating a voter session", async (_label, iat) => {
    const login = await start();
    const invalidIssuedAt = await new SignJWT({ ...tokenClaims, iat, exp: Math.floor(Date.now() / 1000) + 300 })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(key);
    await expect(service(invalidIssuedAt).callback(request(
      `/api/public/v1/mvp-google-auth/callback?state=${login.authorization.searchParams.get("state")}&code=x`,
      { cookie: login.stateCookie },
    ))).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_voters").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_sessions WHERE kind='voter'").get()).toEqual({ n: 0 });
  });

  it("accepts a current numeric iat with the configured string audience", async () => {
    const login = await start();
    const valid = await new SignJWT({ ...tokenClaims, iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300 })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).sign(key);
    const response = await service(valid).callback(request(
      `/api/public/v1/mvp-google-auth/callback?state=${login.authorization.searchParams.get("state")}&code=x`,
      { cookie: login.stateCookie },
    ));
    expect(response.status).toBe(302);
    const session = cookieValue(response, "kb_mvp_session");
    expect((await (await service().session(request("/api/public/v1/mvp-google-auth/session", { cookie: session }))).json()).authenticated).toBe(true);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_voters").get()).toEqual({ n: 1 });
  });

  it("rejects a signed ID token with an additional untrusted audience", async () => {
    const login = await start();
    const extraAudience = await jwt({ ...tokenClaims, aud: ["synthetic-client", "untrusted-client"] });
    await expect(service(extraAudience).callback(request(
      `/api/public/v1/mvp-google-auth/callback?state=${login.authorization.searchParams.get("state")}&code=x`,
      { cookie: login.stateCookie },
    ))).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_voters").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_sessions WHERE kind='voter'").get()).toEqual({ n: 0 });
  });

  it.each([
    ["additional audience despite correct azp", ["synthetic-client", "untrusted-client"], "synthetic-client"],
    ["empty array", [], undefined],
    ["duplicate audiences", ["synthetic-client", "synthetic-client"], undefined],
    ["non-string audience element", ["synthetic-client", 42], undefined],
  ])("rejects %s before creating a voter session", async (_label, aud, azp) => {
    const login = await start();
    const invalidAudience = await jwt({ ...tokenClaims, aud, azp });
    await expect(service(invalidAudience).callback(request(
      `/api/public/v1/mvp-google-auth/callback?state=${login.authorization.searchParams.get("state")}&code=x`,
      { cookie: login.stateCookie },
    ))).rejects.toMatchObject({ code: "INVALID_LOGIN" });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_voters").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mvp_google_sessions WHERE kind='voter'").get()).toEqual({ n: 0 });
  });

  it("accepts a single-element audience array for the configured client", async () => {
    const login = await start();
    const validAudience = await jwt({ ...tokenClaims, aud: ["synthetic-client"] });
    const response = await service(validAudience).callback(request(
      `/api/public/v1/mvp-google-auth/callback?state=${login.authorization.searchParams.get("state")}&code=x`,
      { cookie: login.stateCookie },
    ));
    expect(response.status).toBe(302);
    const session = cookieValue(response, "kb_mvp_session");
    expect((await (await service().session(request("/api/public/v1/mvp-google-auth/session", { cookie: session }))).json()).authenticated).toBe(true);
  });

  it("rejects expired login state and expired or revoked sessions", async () => {
    const login = await start();
    sqlite.exec("UPDATE mvp_google_sessions SET created_at=1,expires_at=2 WHERE kind='login'");
    await expect(callback(login.authorization.searchParams.get("state")!, login.stateCookie))
      .rejects.toMatchObject({ code: "INVALID_LOGIN" });
    const second = await start();
    const response = await callback(second.authorization.searchParams.get("state")!, second.stateCookie);
    const session = cookieValue(response, "kb_mvp_session");
    sqlite.exec("UPDATE mvp_google_sessions SET created_at=1,expires_at=2 WHERE kind='voter'");
    expect((await (await service().session(request("/api/public/v1/mvp-google-auth/session", { cookie: session }))).json()).authenticated).toBe(false);
    sqlite.exec("UPDATE mvp_google_sessions SET expires_at=unixepoch('now')+100 WHERE kind='voter'");
    const sessionResult = await service().session(request("/api/public/v1/mvp-google-auth/session", { cookie: session }));
    const csrf = (await sessionResult.json()).csrfToken as string;
    await service().logout(new Request("http://localhost:3000/api/public/v1/mvp-google-auth/logout", { method: "POST",
      headers: { cookie: `${session}; kb_mvp_csrf=${csrf}`, origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "x-kb-mvp-csrf": csrf } }));
    expect((await (await service().session(request("/api/public/v1/mvp-google-auth/session", { cookie: session }))).json()).authenticated).toBe(false);
  });

  it("rotates an old session and keeps staff cookies separate", async () => {
    const login = await start();
    const first = await callback(login.authorization.searchParams.get("state")!, login.stateCookie);
    const old = cookieValue(first, "kb_mvp_session");
    const second = await start();
    const newer = await callback(second.authorization.searchParams.get("state")!, `${second.stateCookie}; ${old}`);
    expect(cookieValue(newer, "kb_mvp_session")).not.toBe(old);
    expect((await (await service().session(request("/api/public/v1/mvp-google-auth/session", { cookie: old }))).json()).authenticated).toBe(false);
    expect((await (await service().session(request("/api/public/v1/mvp-google-auth/session", { cookie: "__Host-kb_user_session=staff" }))).json()).authenticated).toBe(false);
  });

  it("rejects logout without same-origin CSRF proof", () => {
    for (const headers of [{}, { origin: "https://evil.example", "x-kb-mvp-csrf": "x".repeat(43) }]) {
      expect(() => requireMvpVoterMutationOrigin(new Request("http://localhost:3000/api/public/v1/mvp-google-auth/logout", { method: "POST", headers })))
        .toThrow();
    }
  });

  it("fails closed on missing configuration or disabled flag", async () => {
    env.MVP_GOOGLE_AUTH_ENABLED = undefined;
    await expect(start()).rejects.toMatchObject({ code: "AUTH_DISABLED" });
    env.MVP_GOOGLE_AUTH_ENABLED = "enabled";
    env.MVP_GOOGLE_SUB_HMAC_KEY = undefined;
    await expect(start()).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE" });
  });

  it("enforces schema FKs, uniqueness, immutable ballots, and integrity", async () => {
    expect(sqlite.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(() => sqlite.prepare("INSERT INTO mvp_google_sessions(id,kind,voter_id,token_hash,created_at,expires_at) VALUES ('bad','voter','missing',?,1,2)").run("b".repeat(64))).toThrow();
    sqlite.prepare("INSERT INTO mvp_google_voters VALUES ('voter-a',?,1)").run("a".repeat(64));
    expect(() => sqlite.prepare("INSERT INTO mvp_google_voters VALUES ('voter-b',?,1)").run("a".repeat(64))).toThrow();
    sqlite.prepare("INSERT INTO mvp_google_sessions(id,kind,voter_id,token_hash,created_at,expires_at) VALUES ('session-a','voter','voter-a',?,1,2)").run("b".repeat(64));
    expect(() => sqlite.prepare("INSERT INTO mvp_google_sessions(id,kind,voter_id,token_hash,created_at,expires_at) VALUES ('session-b','voter','voter-a',?,1,2)").run("b".repeat(64))).toThrow();
    expect(() => sqlite.prepare("INSERT INTO mvp_google_votes VALUES ('vote-a','missing','candidate','voter-a',1)").run()).toThrow();
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("reserves a canonical, unique and immutable Google ballot schema", () => {
    sqlite.exec(`INSERT INTO league_phases(id) VALUES ('phase-a');
      INSERT INTO league_players(id) VALUES ('player-a');
      INSERT INTO league_games(id) VALUES ('game-a');
      INSERT INTO league_teams(id) VALUES ('team-a');
      INSERT INTO league_app_users(id) VALUES ('operator-a');
      INSERT INTO mvp_contests(id,phase_id,scope_type,round_number,selection_method,status,
        results_visibility,opens_at,closes_at,created_by_user_id,created_at,updated_at)
        VALUES ('contest-a','phase-a','round',1,'app_poll','open','after_close',1,2000000000,'operator-a',1,1),
          ('contest-b','phase-a','round',2,'app_poll','open','after_close',1,2000000000,'operator-a',1,1);
      INSERT INTO mvp_candidates(id,contest_id,player_id,supporting_game_id,team_id,player_name,
        team_name,points,rebounds,assists,efficiency,origin,created_at)
        VALUES ('candidate-a','contest-a','player-a','game-a','team-a','Player','Team',1,1,1,1,'operator',1),
          ('candidate-b','contest-b','player-a','game-a','team-a','Player','Team',1,1,1,1,'operator',1);
      INSERT INTO mvp_google_voters VALUES ('voter-a','${"a".repeat(64)}',1);
      INSERT INTO mvp_google_votes VALUES ('vote-a','contest-a','candidate-a','voter-a',1);`);
    expect(() => sqlite.prepare("INSERT INTO mvp_google_votes VALUES ('vote-b','contest-a','candidate-a','voter-a',2)").run()).toThrow();
    expect(() => sqlite.prepare("INSERT INTO mvp_google_votes VALUES ('vote-b','contest-a','candidate-b','voter-a',2)").run()).toThrow();
    expect(() => sqlite.prepare("UPDATE mvp_google_votes SET candidate_id='candidate-b' WHERE id='vote-a'").run()).toThrow();
    expect(() => sqlite.prepare("DELETE FROM mvp_google_votes WHERE id='vote-a'").run()).toThrow();
    expect(sqlite.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
});
