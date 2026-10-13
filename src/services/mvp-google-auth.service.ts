import "server-only";

import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { D1DatabaseBinding, KomoBasketCloudflareEnv } from "@/types/cloudflare";

const GOOGLE_ISSUER = "https://accounts.google.com";
const GOOGLE_AUTHORIZATION = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));
const CALLBACK_PATH = "/api/public/v1/mvp-google-auth/callback";
const VOTER_TTL = 7 * 24 * 60 * 60;
const LOGIN_TTL = 5 * 60;
const ID = "[A-Za-z0-9_-]{1,160}";
const RETURN_PATH = new RegExp(`^/mvp/competitions/${ID}/tournaments/${ID}/contests/${ID}$`);
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

type LoginRow = { nonce: string; code_verifier: string; return_path: string };
type SessionRow = { voter_id: string };
type AuthConfig = { clientId: string; clientSecret: string; redirectUri: string; hmacKey: string };

export class MvpGoogleAuthError extends Error {
  constructor(readonly code: "AUTH_DISABLED" | "AUTH_UNAVAILABLE" | "INVALID_REQUEST" | "INVALID_LOGIN" | "UNAUTHENTICATED") {
    super(code);
  }
}

function bytesBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(): string { return bytesBase64Url(crypto.getRandomValues(new Uint8Array(32))); }
function randomNonce(): string { return randomToken(); }

async function sha256Hex(value: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeKey(value: string): Uint8Array | null {
  if (!TOKEN.test(value)) return null;
  try {
    const decoded = atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=");
    if (decoded.length !== 32) return null;
    return Uint8Array.from(decoded, (letter) => letter.charCodeAt(0));
  } catch { return null; }
}

async function subjectHash(keyText: string, subject: string): Promise<string> {
  const keyBytes = decodeKey(keyText);
  if (!keyBytes) throw new MvpGoogleAuthError("AUTH_UNAVAILABLE");
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key,
    new TextEncoder().encode(`${GOOGLE_ISSUER}\n${subject}`)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookie(request: Request, name: string): string | null {
  const parts = (request.headers.get("cookie") ?? "").split(";").map((part) => part.trim());
  const matches = parts.filter((part) => part.startsWith(`${name}=`));
  return matches.length === 1 ? matches[0].slice(name.length + 1) : null;
}

function names(request: Request) {
  const url = new URL(request.url);
  const local = process.env.NODE_ENV !== "production"
    && (url.hostname === "localhost" || url.hostname === "127.0.0.1") && url.protocol === "http:";
  if (!local && (url.protocol !== "https:" || url.host !== "komobasket.gr")) {
    throw new MvpGoogleAuthError("AUTH_UNAVAILABLE");
  }
  return local
    ? { state: "kb_mvp_login", session: "kb_mvp_session", csrf: "kb_mvp_csrf", secure: false }
    : { state: "__Host-kb_mvp_login", session: "__Host-kb_mvp_session",
      csrf: "__Host-kb_mvp_csrf", secure: true };
}

function setCookie(name: string, value: string, maxAge: number, secure: boolean): string {
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`;
}

function headers(): Headers {
  return new Headers({ "Cache-Control": "no-store, private", "Vary": "Cookie",
    "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" });
}

function json(value: unknown, status = 200, cookies: string[] = []): Response {
  const out = headers();
  for (const item of cookies) out.append("Set-Cookie", item);
  return Response.json(value, { status, headers: out });
}

function redirect(path: string, cookies: string[] = []): Response {
  const out = headers();
  out.set("Location", path);
  for (const item of cookies) out.append("Set-Cookie", item);
  return new Response(null, { status: 302, headers: out });
}

function configured(env: KomoBasketCloudflareEnv, request: Request): AuthConfig {
  if (env.MVP_GOOGLE_AUTH_ENABLED !== "enabled") throw new MvpGoogleAuthError("AUTH_DISABLED");
  const { MVP_GOOGLE_CLIENT_ID: clientId, MVP_GOOGLE_CLIENT_SECRET: clientSecret,
    MVP_GOOGLE_REDIRECT_URI: redirectUri, MVP_GOOGLE_SUB_HMAC_KEY: hmacKey } = env;
  if (!env.NEWS_DB || !clientId || !clientSecret || !redirectUri || !hmacKey
    || !decodeKey(hmacKey) || !env.USER_LOGIN_RATE_LIMITER
    || redirectUri !== new URL(CALLBACK_PATH, request.url).toString()) {
    throw new MvpGoogleAuthError("AUTH_UNAVAILABLE");
  }
  return { clientId, clientSecret, redirectUri, hmacKey };
}

async function rateLimit(env: KomoBasketCloudflareEnv, request: Request): Promise<void> {
  const address = request.headers.get("cf-connecting-ip")
    ?? (process.env.NODE_ENV !== "production" ? "local" : null);
  if (!address || !env.USER_LOGIN_RATE_LIMITER) throw new MvpGoogleAuthError("AUTH_UNAVAILABLE");
  const result = await env.USER_LOGIN_RATE_LIMITER.limit({ key: `mvp-google-auth:${await sha256Hex(address)}` });
  if (!result.success) throw new MvpGoogleAuthError("AUTH_UNAVAILABLE");
}

export function requireMvpVoterMutationOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const site = request.headers.get("sec-fetch-site");
  const n = names(request);
  if (origin !== new URL(request.url).origin || (site && site !== "same-origin")
    || !TOKEN.test(cookie(request, n.csrf) ?? "")
    || request.headers.get("x-kb-mvp-csrf") !== cookie(request, n.csrf)) {
    throw new MvpGoogleAuthError("INVALID_REQUEST");
  }
}

/** Server-only voter identity. The cookie value and its hash must never enter a public DTO. */
export async function resolveMvpGoogleVoterSession(db: D1DatabaseBinding,
  env: KomoBasketCloudflareEnv, request: Request): Promise<{ voterId: string; tokenHash: string } | null> {
  configured(env, request);
  const token = cookie(request, names(request).session);
  if (!token || !TOKEN.test(token)) return null;
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare(`SELECT voter_id FROM mvp_google_sessions
    WHERE kind='voter' AND token_hash=? AND revoked_at IS NULL
      AND expires_at>unixepoch('now')`).bind(tokenHash).first<SessionRow>();
  return row ? { voterId: row.voter_id, tokenHash } : null;
}

export class MvpGoogleAuthService {
  constructor(private readonly db: D1DatabaseBinding, private readonly env: KomoBasketCloudflareEnv,
    private readonly fetchImpl: typeof fetch = fetch, private readonly jwks: JWTVerifyGetKey = GOOGLE_JWKS) {}

  async start(request: Request): Promise<Response> {
    const config = configured(this.env, request);
    await rateLimit(this.env, request);
    const n = names(request);
    const returnPath = new URL(request.url).searchParams.get("returnTo") ?? "";
    if (!RETURN_PATH.test(returnPath)) throw new MvpGoogleAuthError("INVALID_REQUEST");
    // No scheduler is needed for short-lived login rows or expired/revoked voter sessions.
    await this.db.prepare(`DELETE FROM mvp_google_sessions
      WHERE expires_at<=unixepoch('now') OR (revoked_at IS NOT NULL AND revoked_at<=unixepoch('now')-86400)`).run();
    const state = randomToken();
    const nonce = randomNonce();
    const verifier = randomToken();
    const challenge = bytesBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    await this.db.prepare(`INSERT INTO mvp_google_sessions
      (id,kind,token_hash,nonce,code_verifier,return_path,created_at,expires_at)
      VALUES (?,'login',?,?,?,?,unixepoch('now'),unixepoch('now')+?)`)
      .bind(`mvp_login_${crypto.randomUUID()}`, await sha256Hex(state), nonce, verifier, returnPath, LOGIN_TTL).run();
    const url = new URL(GOOGLE_AUTHORIZATION);
    for (const [key, value] of Object.entries({ client_id: config.clientId,
      redirect_uri: config.redirectUri, response_type: "code", scope: "openid profile",
      state, nonce, code_challenge: challenge, code_challenge_method: "S256" })) url.searchParams.set(key, value);
    return redirect(url.toString(), [setCookie(n.state, state, LOGIN_TTL, n.secure)]);
  }

  async callback(request: Request): Promise<Response> {
    const config = configured(this.env, request);
    await rateLimit(this.env, request);
    const n = names(request);
    const url = new URL(request.url);
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const saved = cookie(request, n.state);
    if (!state || !TOKEN.test(state) || state !== saved || !code || code.length > 4096
      || url.searchParams.has("error")) throw new MvpGoogleAuthError("INVALID_LOGIN");
    // DELETE RETURNING consumes state before an external token request; concurrent callbacks cannot reuse it.
    const login = await this.db.prepare(`DELETE FROM mvp_google_sessions
      WHERE kind='login' AND token_hash=? AND expires_at>unixepoch('now')
      RETURNING nonce,code_verifier,return_path`).bind(await sha256Hex(state)).first<LoginRow>();
    if (!login || !RETURN_PATH.test(login.return_path)) throw new MvpGoogleAuthError("INVALID_LOGIN");
    const response = await this.fetchImpl(GOOGLE_TOKEN, { method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ code, client_id: config.clientId,
        client_secret: config.clientSecret, redirect_uri: config.redirectUri,
        grant_type: "authorization_code", code_verifier: login.code_verifier }),
      cache: "no-store" });
    if (!response.ok) throw new MvpGoogleAuthError("INVALID_LOGIN");
    const tokens: unknown = await response.json();
    const idToken = tokens && typeof tokens === "object" && "id_token" in tokens
      ? (tokens as { id_token: unknown }).id_token : null;
    if (typeof idToken !== "string" || idToken.length > 16_384) throw new MvpGoogleAuthError("INVALID_LOGIN");
    let sub: string;
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, { issuer: GOOGLE_ISSUER,
        audience: config.clientId, algorithms: ["RS256"], requiredClaims: ["exp", "iat"], clockTolerance: 30 });
      const singleClientAudience = payload.aud === config.clientId
        || (Array.isArray(payload.aud) && payload.aud.length === 1 && payload.aud[0] === config.clientId);
      if (!singleClientAudience || payload.nonce !== login.nonce || typeof payload.sub !== "string"
        || !/^[\x21-\x7e]{1,255}$/.test(payload.sub)
        || (payload.azp !== undefined && payload.azp !== config.clientId)) throw new Error();
      sub = payload.sub;
    } catch { throw new MvpGoogleAuthError("INVALID_LOGIN"); }
    const digest = await subjectHash(config.hmacKey, sub);
    const voterId = `mvp_google_${crypto.randomUUID()}`;
    await this.db.prepare(`INSERT INTO mvp_google_voters (id,subject_hash,created_at)
      VALUES (?,?,unixepoch('now')) ON CONFLICT(subject_hash) DO NOTHING`)
      .bind(voterId, digest).run();
    const voter = await this.db.prepare("SELECT id FROM mvp_google_voters WHERE subject_hash=?")
      .bind(digest).first<{ id: string }>();
    if (!voter) throw new MvpGoogleAuthError("AUTH_UNAVAILABLE");
    const old = cookie(request, n.session);
    if (old && TOKEN.test(old)) await this.db.prepare(`UPDATE mvp_google_sessions
      SET revoked_at=unixepoch('now') WHERE kind='voter' AND token_hash=? AND revoked_at IS NULL`)
      .bind(await sha256Hex(old)).run();
    const token = randomToken();
    await this.db.prepare(`INSERT INTO mvp_google_sessions
      (id,kind,voter_id,token_hash,created_at,expires_at)
      VALUES (?,'voter',?,?,unixepoch('now'),unixepoch('now')+?)`)
      .bind(`mvp_session_${crypto.randomUUID()}`, voter.id, await sha256Hex(token), VOTER_TTL).run();
    return redirect(login.return_path, [setCookie(n.state, "", 0, n.secure),
      setCookie(n.session, token, VOTER_TTL, n.secure)]);
  }

  async session(request: Request): Promise<Response> {
    configured(this.env, request);
    const n = names(request);
    const token = cookie(request, n.session);
    const voter = token && TOKEN.test(token) ? await this.db.prepare(`SELECT voter_id FROM mvp_google_sessions
      WHERE kind='voter' AND token_hash=? AND revoked_at IS NULL
        AND expires_at>unixepoch('now')`).bind(await sha256Hex(token)).first<SessionRow>() : null;
    const previousCsrf = cookie(request, n.csrf);
    const csrf = previousCsrf && TOKEN.test(previousCsrf) ? previousCsrf : randomToken();
    return json({ authenticated: Boolean(voter), csrfToken: csrf }, 200,
      [setCookie(n.csrf, csrf, VOTER_TTL, n.secure)]);
  }

  async logout(request: Request): Promise<Response> {
    configured(this.env, request);
    requireMvpVoterMutationOrigin(request);
    const n = names(request);
    const token = cookie(request, n.session);
    if (token && TOKEN.test(token)) await this.db.prepare(`UPDATE mvp_google_sessions
      SET revoked_at=unixepoch('now') WHERE kind='voter' AND token_hash=? AND revoked_at IS NULL`)
      .bind(await sha256Hex(token)).run();
    return json({ ok: true }, 200, [setCookie(n.session, "", 0, n.secure),
      setCookie(n.csrf, "", 0, n.secure)]);
  }
}

export async function handleMvpGoogleAuth(request: Request, operation: "start" | "callback" | "session" | "logout"): Promise<Response> {
  try {
    const env = await import("@/lib/cloudflare").then(({ getKomoBasketCloudflareEnv }) => getKomoBasketCloudflareEnv());
    if (!env) throw new MvpGoogleAuthError("AUTH_UNAVAILABLE");
    const service = new MvpGoogleAuthService(env.NEWS_DB!, env);
    return await service[operation](request);
  } catch (error) {
    const code = error instanceof MvpGoogleAuthError ? error.code : "AUTH_UNAVAILABLE";
    const status = code === "AUTH_DISABLED" ? 404 : code === "INVALID_REQUEST" ? 400
      : code === "INVALID_LOGIN" || code === "UNAUTHENTICATED" ? 401 : 503;
    return json({ error: { code } }, status);
  }
}
