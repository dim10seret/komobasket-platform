import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

vi.mock("server-only", () => ({}));
const environment = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: async () => environment.current }));

import * as core from "./organization-user-auth-core";
import { setOrganizationUserPassword, createRevokeAllOrganizationUserSessionsStatement } from "./organization-user-auth.service";
import { OrganizationUserLoginService } from "./organization-user-login.service";
import { USER_CSRF_COOKIE, requireUserMutationOrigin } from "@/lib/organization-user-http";
import { POST as login } from "@/app/api/user/auth/login/route";
import { POST as logout } from "@/app/api/user/auth/logout/route";
import { GET as me } from "@/app/api/user/auth/me/route";

type LocalDatabase = {
  exec(sql: string): void;
  prepare(sql: string): { get(...values: unknown[]): unknown; all(...values: unknown[]): unknown[]; run(...values: unknown[]): unknown };
  close(): void;
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => LocalDatabase };
const schema = readFileSync(new URL("../../cloudflare/league-schema.sql", import.meta.url), "utf8");
const PASSWORD = "Disposable user password";
const CSRF = "c".repeat(43);
let database: LocalDatabase;
let db: D1DatabaseBinding;
let service: OrganizationUserLoginService;
let passwordHash: string;
let limiter = vi.fn(async (_input: { key: string }) => ({ success: true }));

function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
  return {
    bind: (...bound) => statement(sql, bound),
    first: async <T,>() => (database.prepare(sql).get(...values) as T | undefined) ?? null,
    all: async <T,>() => ({ success: true, results: database.prepare(sql).all(...values) as T[] }),
    run: async () => database.prepare(sql).run(...values),
  };
}

function request(action: string, body: unknown = {}, cookie = "", headers: Record<string, string> = {}) {
  return new Request(`https://example.test/api/user/auth/${action}`, {
    method: action === "me" ? "GET" : "POST",
    headers: { origin: "https://example.test", "sec-fetch-site": "same-origin", "content-type": "application/json",
      cookie: `${USER_CSRF_COOKIE}=${CSRF}; ${cookie}`, "x-kb-user-csrf": CSRF, ...headers },
    ...(action === "me" ? {} : { body: JSON.stringify(body) }),
  });
}

async function signIn(email = "user@example.test", password = PASSWORD) {
  const response = await login(request("login", { email, password }));
  return { response, cookie: response.headers.get("set-cookie")?.split(";")[0] ?? "" };
}

beforeAll(async () => { passwordHash = await core.hashOrganizationUserPassword(PASSWORD); });
beforeEach(() => {
  database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys=ON");
  for (const table of ["league_organizations", "league_app_users", "league_organization_memberships", "league_user_credentials", "league_user_sessions"]) {
    const ddl = schema.match(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\s*\\([\\s\\S]*?\\);`))?.[0];
    if (!ddl) throw new Error(`Missing canonical fixture schema: ${table}`);
    database.exec(ddl);
  }
  database.exec(`INSERT INTO league_organizations(id,slug,name) VALUES ('org-a','local-a','Local Organization A'),('org-b','local-b','Local Organization B');
    INSERT INTO league_app_users(id,email,normalized_email,display_name) VALUES ('user-a','user@example.test','user@example.test','Local Test User');
    INSERT INTO league_organization_memberships(id,organization_id,user_id,role) VALUES ('member-a','org-a','user-a','admin');`);
  database.prepare("INSERT INTO league_user_credentials VALUES ('user-a',?,1,?,?)").run(passwordHash, new Date().toISOString(), new Date().toISOString());
  db = { prepare: statement, batch: async (statements) => {
    database.exec("BEGIN");
    try { const result = []; for (const item of statements) result.push(await item.run()); database.exec("COMMIT"); return result; }
    catch (error) { database.exec("ROLLBACK"); throw error; }
  } };
  limiter = vi.fn(async (_input: { key: string }) => ({ success: true }));
  environment.current = { NEWS_DB: db, USER_LOGIN_RATE_LIMITER: { limit: limiter } };
  service = new OrganizationUserLoginService(db, { limit: limiter });
});
afterEach(() => { vi.restoreAllMocks(); database.close(); });

describe("Organization-user login and canonical session integration", () => {
  it("normalizes email, creates only a hashed seven-day session and exposes safe metadata", async () => {
    const logs = vi.spyOn(console, "log");
    const { response, cookie } = await signIn("  USER@example.test  ");
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain('"organizationId":"org-a"');
    expect(body).not.toMatch(/password|salt|credential|token|access_subject/i);
    expect(body).not.toContain(PASSWORD);
    const raw = cookie.split("=")[1];
    const stored = database.prepare("SELECT * FROM league_user_sessions").get() as { token_hash: string; created_at: string; expires_at: string };
    expect(stored.token_hash).toBe(await core.hashOrganizationUserSessionToken(raw));
    expect(JSON.stringify(stored)).not.toContain(raw);
    expect(Date.parse(stored.expires_at) - Date.parse(stored.created_at)).toBe(604800000);
    expect(response.headers.get("set-cookie")).toBe(`${cookie}; Max-Age=604800; Path=/; HttpOnly; Secure; SameSite=Lax`);
    expect(logs).not.toHaveBeenCalled();
    expect(limiter.mock.calls[0][0].key).toBe(await core.hashOrganizationUserSessionToken("user@example.test"));
  });

  it.each(["wrong password", "unknown", "disabled", "super admin", "missing credential"])("denies %s with the identical generic response and no session", async (reason) => {
    if (reason === "disabled") database.exec("UPDATE league_app_users SET status='disabled'");
    if (reason === "super admin") database.exec("UPDATE league_app_users SET is_super_admin=1");
    if (reason === "missing credential") database.exec("DELETE FROM league_user_credentials");
    const { response } = await signIn(reason === "unknown" ? "unknown@example.test" : undefined, reason === "wrong password" ? "wrong password" : undefined);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "INVALID_CREDENTIALS", error: "Λανθασμένο email ή κωδικός." });
    expect(database.prepare("SELECT * FROM league_user_sessions").all()).toHaveLength(0);
  });

  it("rejects valid credentials without an active membership before session creation", async () => {
    database.exec("UPDATE league_organization_memberships SET status='revoked'");
    expect((await signIn()).response.status).toBe(403);
    expect(database.prepare("SELECT * FROM league_user_sessions").all()).toHaveLength(0);
  });

  it("supports one/multiple organizations, admin/viewer and rejects foreign IDs or viewer writes", async () => {
    database.exec("INSERT INTO league_organization_memberships(id,organization_id,user_id,role) VALUES ('member-b','org-b','user-a','viewer')");
    const { session } = await service.login("user@example.test", PASSWORD);
    expect((await service.resolve(session.token)).memberships).toHaveLength(2);
    expect((await service.requireOrganization(session.token, "org-a", "manage")).membership.role).toBe("admin");
    expect((await service.requireOrganization(session.token, "org-b")).membership.role).toBe("viewer");
    await expect(service.requireOrganization(session.token, "foreign")).rejects.toMatchObject({ status: 403 });
    await expect(service.requireOrganization(session.token, "org-b", "manage")).rejects.toMatchObject({ status: 403 });
    database.exec("UPDATE league_organization_memberships SET status='revoked' WHERE organization_id='org-a'");
    await expect(service.requireOrganization(session.token, "org-a")).rejects.toMatchObject({ status: 403 });
    expect((await service.resolve(session.token)).memberships).toHaveLength(1);
  });

  it.each([
    "UPDATE league_user_sessions SET expires_at='2000-01-01T00:00:00Z'",
    "UPDATE league_user_sessions SET revoked_at='2026-01-01T00:00:00Z'",
    "UPDATE league_user_credentials SET credential_version=2",
    "UPDATE league_app_users SET status='disabled'",
    "UPDATE league_app_users SET is_super_admin=1",
  ])("rejects a session after authoritative state change: %s", async (sql) => {
    const { cookie } = await signIn(); database.exec(sql);
    expect((await me(request("me", {}, cookie))).status).toBe(401);
  });

  it("rejects a suspended organization and revoked membership immediately", async () => {
    const { cookie } = await signIn(); database.exec("UPDATE league_organizations SET status='suspended'");
    expect((await me(request("me", {}, cookie))).status).toBe(403);
  });

  it("logs out idempotently, clears the cookie, and rejects the old cookie", async () => {
    const { cookie } = await signIn();
    const response = await logout(request("logout", {}, cookie));
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
    expect((await me(request("me", {}, cookie))).status).toBe(401);
    expect((await logout(request("logout", {}, cookie))).status).toBe(200);
    expect((await logout(request("logout"))).status).toBe(200);
    expect((database.prepare("SELECT revoked_at FROM league_user_sessions").get() as { revoked_at: string }).revoked_at).toBeTruthy();
  });

  it("uses the existing password-reset service and invalidates old passwords and sessions", async () => {
    const { cookie } = await signIn();
    await setOrganizationUserPassword("user-a", "Replacement local password");
    expect((await me(request("me", {}, cookie))).status).toBe(401);
    expect((await signIn()).response.status).toBe(401);
    expect((await signIn("user@example.test", "Replacement local password")).response.status).toBe(200);
  });

  it("preserves memberships and credential after email change with the existing revocation hook", async () => {
    const { cookie } = await signIn();
    await db.batch([
      db.prepare("UPDATE league_app_users SET email=?,normalized_email=? WHERE id='user-a'").bind("new@example.test", "new@example.test"),
      createRevokeAllOrganizationUserSessionsStatement(db, "user-a", new Date().toISOString()),
    ]);
    expect((await me(request("me", {}, cookie))).status).toBe(401);
    expect((await signIn()).response.status).toBe(401);
    const next = await signIn("new@example.test");
    expect(next.response.status).toBe(200);
    expect((await next.response.json()).memberships).toHaveLength(1);
  });

  it("does not mint a session when the credential resets during password verification", async () => {
    const verify = core.verifyOrganizationUserPassword;
    vi.spyOn(core, "verifyOrganizationUserPassword").mockImplementationOnce(async (password, hash) => {
      const valid = await verify(password, hash);
      database.exec("UPDATE league_user_credentials SET credential_version=2");
      return valid;
    });
    expect((await signIn()).response.status).toBe(401);
    expect(database.prepare("SELECT * FROM league_user_sessions").all()).toHaveLength(0);
  });
});

describe("User Origin, CSRF, bounded JSON and native rate-limit boundary", () => {
  it.each([
    { origin: "https://evil.test" }, { origin: "" }, { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" }, { "x-kb-user-csrf": "" }, { "x-kb-user-csrf": "x".repeat(43) },
    { cookie: "" },
  ])("denies invalid Origin/CSRF proof without querying auth: %j", async (headers) => {
    expect((await login(request("login", { email: "user@example.test", password: PASSWORD }, "", headers))).status).toBe(403);
    expect(limiter).not.toHaveBeenCalled();
  });

  it("accepts exact Origin and valid host-bound double-submit proof", () => {
    expect(() => requireUserMutationOrigin(request("login"))).not.toThrow();
  });

  it("requires JSON and caps body size", async () => {
    expect((await login(request("login", {}, "", { "content-type": "application/x-www-form-urlencoded" }))).status).toBe(415);
    expect((await login(request("login", { password: "x".repeat(5000) }))).status).toBe(413);
  });

  it("bootstraps CSRF on an unauthenticated no-store /me response, without CORS", async () => {
    const response = await me(new Request("https://example.test/api/user/auth/me"));
    expect(response.status).toBe(401);
    expect((await response.json()).csrfToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.headers.get("set-cookie")).toContain(`${USER_CSRF_COOKIE}=`);
    expect(response.headers.get("set-cookie")).not.toContain("Domain=");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.has("access-control-allow-origin")).toBe(false);
  });

  it.each(["user@example.test", "unknown@example.test"])("throttles before password derivation without revealing %s", async (email) => {
    let count = 0;
    limiter.mockImplementation(async () => ({ success: ++count <= 5 }));
    for (let index = 0; index < 5; index += 1) expect((await signIn(email, "wrong password")).response.status).toBe(401);
    const verify = vi.spyOn(core, "verifyOrganizationUserPassword");
    const { response } = await signIn(email);
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(await response.json()).toEqual({ code: "RATE_LIMITED", error: "Πολλές προσπάθειες σύνδεσης. Δοκιμάστε ξανά σε ένα λεπτό." });
    expect(verify).not.toHaveBeenCalled();
  });

  it.each(["missing", "unavailable"])("fails closed when the limiter is %s", async (condition) => {
    if (condition === "missing") delete environment.current.USER_LOGIN_RATE_LIMITER;
    else limiter.mockRejectedValueOnce(new Error("Binding unavailable"));
    const verify = vi.spyOn(core, "verifyOrganizationUserPassword");
    expect((await signIn()).response.status).toBe(503);
    expect(verify).not.toHaveBeenCalled();
  });
});
