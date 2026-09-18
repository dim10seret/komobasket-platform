import { describe, expect, it } from "vitest";

import {
  ORGANIZATION_USER_PASSWORD_MAX_LENGTH,
  ORGANIZATION_USER_SESSION_COOKIE_NAME,
  ORGANIZATION_USER_SESSION_TTL_SECONDS,
  OrganizationUserAuthAuthority,
  hashOrganizationUserPassword,
  hashOrganizationUserSessionToken,
  serializeOrganizationUserSessionCookie,
  verifyOrganizationUserPassword,
  type NewOrganizationUserSessionRecord,
  type OrganizationUserAuthStore,
  type OrganizationUserRecord,
  type OrganizationUserSessionRecord,
} from "./organization-user-auth-core";

const NOW = new Date("2026-09-08T12:00:00.000Z");
const USER_ID = "app_user_organization_admin";
const VALID_PASSWORD = "correct horse battery staple";

class FakeStore implements OrganizationUserAuthStore {
  users = new Map<string, OrganizationUserRecord>();
  sessions = new Map<string, OrganizationUserSessionRecord>();

  async findUserById(userId: string) {
    return this.users.get(userId) ?? null;
  }

  async setCredentialAndRevokeSessions(input: {
    userId: string;
    passwordHash: string;
    changedAt: string;
  }) {
    const user = this.users.get(input.userId);
    if (!user || user.isSuperAdmin) return user ?? null;
    user.passwordHash = input.passwordHash;
    user.credentialVersion = (user.credentialVersion ?? 0) + 1;
    await this.revokeAllSessionsByUserId(user.id, input.changedAt);
    return user;
  }

  async createSession(session: NewOrganizationUserSessionRecord) {
    const user = this.users.get(session.userId);
    if (!user) throw new Error("Missing user fixture.");
    this.sessions.set(session.tokenHash, {
      ...session,
      revokedAt: null,
      user,
    });
  }

  async findSessionByTokenHash(tokenHash: string) {
    return this.sessions.get(tokenHash) ?? null;
  }

  async revokeSessionById(sessionId: string, revokedAt: string) {
    for (const session of this.sessions.values()) {
      if (session.id === sessionId && session.revokedAt === null) session.revokedAt = revokedAt;
    }
  }

  async revokeAllSessionsByUserId(userId: string, revokedAt: string) {
    for (const session of this.sessions.values()) {
      if (session.userId === userId && session.revokedAt === null) session.revokedAt = revokedAt;
    }
  }
}

function createUser(overrides: Partial<OrganizationUserRecord> = {}): OrganizationUserRecord {
  return {
    id: USER_ID,
    email: "admin@example.test",
    normalizedEmail: "admin@example.test",
    status: "active",
    isSuperAdmin: false,
    passwordHash: null,
    credentialVersion: null,
    ...overrides,
  };
}

function fixture(overrides: Partial<OrganizationUserRecord> = {}) {
  const store = new FakeStore();
  store.users.set(USER_ID, createUser(overrides));
  return {
    store,
    authority: new OrganizationUserAuthAuthority(store, () => new Date(NOW)),
  };
}

async function authenticatedFixture(overrides: Partial<OrganizationUserRecord> = {}) {
  const value = fixture(overrides);
  await value.authority.setPassword(USER_ID, VALID_PASSWORD);
  const session = await value.authority.createSession(USER_ID);
  const tokenHash = await hashOrganizationUserSessionToken(session.token);
  return { ...value, session, record: value.store.sessions.get(tokenHash)! };
}

describe("Organization-user auth foundation", () => {
  it("stores a versioned PBKDF2 hash rather than plaintext and verifies only the correct password", async () => {
    const hash = await hashOrganizationUserPassword(VALID_PASSWORD);
    expect(hash).toMatch(/^v1\$pbkdf2-sha256\$100000\$/);
    expect(Buffer.from(hash.split("$")[3], "base64url")).toHaveLength(16);
    expect(Buffer.from(hash.split("$")[4], "base64url")).toHaveLength(32);
    expect(hash).not.toContain(VALID_PASSWORD);
    await expect(verifyOrganizationUserPassword(VALID_PASSWORD, hash)).resolves.toBe(true);
    await expect(verifyOrganizationUserPassword("wrong-password", hash)).resolves.toBe(false);
  });

  it("uses a fresh salt for each hash of the same password", async () => {
    const first = await hashOrganizationUserPassword(VALID_PASSWORD);
    const second = await hashOrganizationUserPassword(VALID_PASSWORD);
    expect(second).not.toBe(first);
    expect(second.split("$")[3]).not.toBe(first.split("$")[3]);
    expect(second.split("$")[4]).not.toBe(first.split("$")[4]);
  });

  it.each([50_000, 600_000])("verifies the encoded %i iteration count rather than the current default", async (iterations) => {
    const salt = new Uint8Array(16).fill(7);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(VALID_PASSWORD), "PBKDF2", false, ["deriveBits"]);
    const derived = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
    const encoded = ["v1", "pbkdf2-sha256", String(iterations), Buffer.from(salt).toString("base64url"), Buffer.from(derived).toString("base64url")].join("$");
    await expect(verifyOrganizationUserPassword(VALID_PASSWORD, encoded)).resolves.toBe(true);
  });

  it("rejects invalid iteration counts before derivation", async () => {
    const fields = (await hashOrganizationUserPassword(VALID_PASSWORD)).split("$");
    for (const iterations of ["", "0", "-1", "1.5", "NaN", "Infinity", "4294967296"]) {
      fields[2] = iterations;
      await expect(verifyOrganizationUserPassword(VALID_PASSWORD, fields.join("$"))).resolves.toBe(false);
    }
  });

  it.each([10, 128])("accepts the exact %i-character password boundary", async (length) => {
    const password = "x".repeat(length);
    const encoded = await hashOrganizationUserPassword(password);
    await expect(verifyOrganizationUserPassword(password, encoded)).resolves.toBe(true);
  });

  it("enforces the 10-to-128 character password boundary without trimming valid values", async () => {
    await expect(hashOrganizationUserPassword("123456789")).rejects.toMatchObject({ code: "PASSWORD_INVALID" });
    await expect(hashOrganizationUserPassword(" ".repeat(10))).rejects.toMatchObject({ code: "PASSWORD_INVALID" });
    await expect(hashOrganizationUserPassword("x".repeat(ORGANIZATION_USER_PASSWORD_MAX_LENGTH + 1))).rejects.toMatchObject({ code: "PASSWORD_INVALID" });
    const spaced = "  valid password  ";
    const hash = await hashOrganizationUserPassword(spaced);
    await expect(verifyOrganizationUserPassword(spaced, hash)).resolves.toBe(true);
    await expect(verifyOrganizationUserPassword(spaced.trim(), hash)).resolves.toBe(false);
  });

  it("denies credential creation for a canonical Super Admin", async () => {
    const { authority } = fixture({ isSuperAdmin: true });
    await expect(authority.setPassword(USER_ID, VALID_PASSWORD)).rejects.toMatchObject({ code: "SUPER_ADMIN_FORBIDDEN" });
  });

  it("creates a normal Organization-user credential at version 1", async () => {
    const { authority, store } = fixture();
    await expect(authority.setPassword(USER_ID, VALID_PASSWORD)).resolves.toMatchObject({ credentialVersion: 1 });
    expect(store.users.get(USER_ID)?.passwordHash).not.toBe(VALID_PASSWORD);
  });

  it("replaces a password, increments its version, and rejects the old password", async () => {
    const { authority } = fixture();
    await authority.setPassword(USER_ID, VALID_PASSWORD);
    await expect(authority.setPassword(USER_ID, "replacement password")).resolves.toMatchObject({ credentialVersion: 2 });
    await expect(authority.verifyCredential(USER_ID, VALID_PASSWORD)).resolves.toBe(false);
    await expect(authority.verifyCredential(USER_ID, "replacement password")).resolves.toBe(true);
  });

  it("stores only the SHA-256 hash of a random 32-byte session token", async () => {
    const { session, record } = await authenticatedFixture();
    expect(session.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(record.tokenHash).toBe(await hashOrganizationUserSessionToken(session.token));
    expect(record.tokenHash).not.toBe(session.token);
  });

  it("resolves a valid seven-day session to its canonical user", async () => {
    const { authority, session } = await authenticatedFixture();
    await expect(authority.resolveSession(session.token)).resolves.toEqual({
      sessionId: session.sessionId,
      userId: USER_ID,
      email: "admin@example.test",
      expiresAt: new Date(NOW.getTime() + ORGANIZATION_USER_SESSION_TTL_SECONDS * 1_000).toISOString(),
    });
  });

  it("denies an expired session", async () => {
    const { authority, session, record } = await authenticatedFixture();
    record.expiresAt = new Date(NOW.getTime() - 1).toISOString();
    await expect(authority.resolveSession(session.token)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("denies a revoked session", async () => {
    const { authority, session } = await authenticatedFixture();
    await authority.revokeSession(session.sessionId);
    await expect(authority.resolveSession(session.token)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("denies a session after the canonical user is disabled", async () => {
    const { authority, session, store } = await authenticatedFixture();
    store.users.get(USER_ID)!.status = "disabled";
    await expect(authority.resolveSession(session.token)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("denies a credential-version mismatch", async () => {
    const { authority, session, store } = await authenticatedFixture();
    store.users.get(USER_ID)!.credentialVersion! += 1;
    await expect(authority.resolveSession(session.token)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("denies a Super Admin session even if stored state becomes malformed", async () => {
    const { authority, session, store } = await authenticatedFixture();
    store.users.get(USER_ID)!.isSuperAdmin = true;
    await expect(authority.resolveSession(session.token)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("revokes every existing session when the password is replaced", async () => {
    const { authority } = fixture();
    await authority.setPassword(USER_ID, VALID_PASSWORD);
    const first = await authority.createSession(USER_ID);
    const second = await authority.createSession(USER_ID);
    await authority.setPassword(USER_ID, "replacement password");
    await expect(authority.resolveSession(first.token)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(authority.resolveSession(second.token)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("supports explicit revocation of all sessions", async () => {
    const { authority } = fixture();
    await authority.setPassword(USER_ID, VALID_PASSWORD);
    const first = await authority.createSession(USER_ID);
    const second = await authority.createSession(USER_ID);
    await authority.revokeAllSessions(USER_ID);
    await expect(authority.resolveSession(first.token)).rejects.toMatchObject({ code: "SESSION_INVALID" });
    await expect(authority.resolveSession(second.token)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("serializes the locked __Host cookie attributes without a Domain", async () => {
    const { session } = await authenticatedFixture();
    const cookie = serializeOrganizationUserSessionCookie(session.token);
    expect(cookie).toContain(`${ORGANIZATION_USER_SESSION_COOKIE_NAME}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain(`Max-Age=${ORGANIZATION_USER_SESSION_TTL_SECONDS}`);
    expect(cookie).not.toMatch(/Domain=/i);
  });
});
