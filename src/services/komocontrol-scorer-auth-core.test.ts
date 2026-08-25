import { describe, expect, it } from "vitest";

import { createScorerPasswordHash, verifyScorerPassword } from "./komocontrol-scorer-credentials";
import {
  ScorerAuthError,
  ScorerSessionAuthority,
  bearerToken,
  generateOpaqueSessionToken,
  hashOpaqueSessionToken,
  type NewSessionRecord,
  type ScorerAuthStore,
  type ScorerRecord,
  type SessionRecord,
} from "./komocontrol-scorer-auth-core";

const NOW = new Date("2026-08-25T12:00:00.000Z");

class FakeStore implements ScorerAuthStore {
  scorer: ScorerRecord | null = null;
  sessions: NewSessionRecord[] = [];
  records = new Map<string, SessionRecord>();

  async findScorerByNormalizedUsername(normalizedUsername: string) {
    return this.scorer?.normalizedUsername === normalizedUsername ? this.scorer : null;
  }

  async createSession(session: NewSessionRecord) {
    this.sessions.push(session);
    if (!this.scorer) throw new Error("Missing scorer fixture.");
    this.records.set(session.tokenHash, {
      ...session,
      revokedAt: null,
      scorer: {
        id: this.scorer.id,
        organizationId: this.scorer.organizationId,
        organizationName: this.scorer.organizationName,
        username: this.scorer.username,
        normalizedUsername: this.scorer.normalizedUsername,
        status: this.scorer.status,
        credentialVersion: this.scorer.credentialVersion,
      },
    });
  }

  async findSessionByTokenHash(tokenHash: string) {
    return this.records.get(tokenHash) ?? null;
  }

  async revokeSessionByTokenHash(tokenHash: string, revokedAt: string) {
    const record = this.records.get(tokenHash);
    if (record && record.revokedAt === null) record.revokedAt = revokedAt;
  }
}

async function fixture(status: "active" | "disabled" = "active") {
  const store = new FakeStore();
  store.scorer = {
    id: "scorer-a",
    organizationId: "organization-a",
    organizationName: "Organization A",
    username: "Scorer",
    normalizedUsername: "scorer",
    passwordHash: await createScorerPasswordHash("synthetic-password"),
    status,
    credentialVersion: 3,
  };
  return { store, authority: new ScorerSessionAuthority(store, () => new Date(NOW)) };
}

async function login() {
  const value = await fixture();
  const result = await value.authority.login({ username: "SCORER", password: "synthetic-password", deviceId: "device-a" });
  return { ...value, result, record: value.store.sessions[0] };
}

describe("KomoControl scorer authentication", () => {
  it("verifies the canonical PBKDF2 credential format", async () => {
    const hash = await createScorerPasswordHash("synthetic-password");
    expect(await verifyScorerPassword("synthetic-password", hash)).toBe(true);
    expect(await verifyScorerPassword("synthetic-password", "malformed")).toBe(false);
  });

  it("rejects a wrong password", async () => {
    const { authority } = await fixture();
    await expect(authority.login({ username: "scorer", password: "wrong", deviceId: "device-a" })).rejects.toMatchObject({ code: "AUTH_INVALID" });
  });

  it("rejects a disabled scorer", async () => {
    const { authority } = await fixture("disabled");
    await expect(authority.login({ username: "scorer", password: "synthetic-password", deviceId: "device-a" })).rejects.toMatchObject({ code: "AUTH_INVALID" });
  });

  it("generates a high-entropy transport-safe opaque token", () => {
    const first = generateOpaqueSessionToken();
    expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateOpaqueSessionToken()).not.toBe(first);
  });

  it("stores only the token hash", async () => {
    const { result, record } = await login();
    expect(record.tokenHash).toBe(await hashOpaqueSessionToken(result.token));
    expect(record.tokenHash).not.toBe(result.token);
  });

  it("resolves a valid session with canonical Organization context", async () => {
    const { authority, result } = await login();
    await expect(authority.resolve(`Bearer ${result.token}`)).resolves.toMatchObject({ organization: { id: "organization-a" } });
  });

  it("rejects an expired session", async () => {
    const { authority, result, store, record } = await login();
    store.records.get(record.tokenHash)!.expiresAt = "2026-08-25T11:59:59.000Z";
    await expect(authority.resolve(`Bearer ${result.token}`)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("rejects a revoked session", async () => {
    const { authority, result, store, record } = await login();
    store.records.get(record.tokenHash)!.revokedAt = NOW.toISOString();
    await expect(authority.resolve(`Bearer ${result.token}`)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("rejects a credential-version mismatch", async () => {
    const { authority, result, store, record } = await login();
    store.records.get(record.tokenHash)!.scorer.credentialVersion += 1;
    await expect(authority.resolve(`Bearer ${result.token}`)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("rejects malformed bearer credentials", () => {
    expect(() => bearerToken("Bearer short")).toThrow(ScorerAuthError);
  });

  it("logout revokes the current token and resolution then fails", async () => {
    const { authority, result } = await login();
    await authority.logout(`Bearer ${result.token}`);
    await expect(authority.resolve(`Bearer ${result.token}`)).rejects.toMatchObject({ code: "SESSION_INVALID" });
  });

  it("allows multiple sessions for one scorer", async () => {
    const { authority, store } = await fixture();
    await authority.login({ username: "scorer", password: "synthetic-password", deviceId: "device-a" });
    await authority.login({ username: "scorer", password: "synthetic-password", deviceId: "device-b" });
    expect(store.sessions).toHaveLength(2);
  });

  it("does not leak password or token-hash fields in safe DTOs", async () => {
    const { authority, result } = await login();
    const dto = await authority.resolve(`Bearer ${result.token}`);
    expect(JSON.stringify(dto)).not.toMatch(/password|tokenHash|normalizedUsername/);
  });

  it("uses stable errors without exposing account existence", async () => {
    const { authority, store } = await fixture();
    store.scorer = null;
    await expect(authority.login({ username: "missing", password: "synthetic-password", deviceId: "device-a" })).rejects.toMatchObject({ code: "AUTH_INVALID" });
  });
});
