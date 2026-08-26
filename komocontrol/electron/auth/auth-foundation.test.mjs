import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import contracts from "../../dist-electron/auth/auth-contracts.cjs";
import clientModule from "../../dist-electron/auth/platform-auth-client.cjs";
import storeModule from "../../dist-electron/auth/secure-session-store.cjs";
import coordinatorModule from "../../dist-electron/auth/auth-coordinator.cjs";

const { AuthFlowError } = contracts;
const { PlatformAuthClient } = clientModule;
const { SecureSessionStore } = storeModule;
const { AuthCoordinator } = coordinatorModule;
const roots = [];
const token = "A".repeat(43);
const deviceId = "device-12345678";
const context = { scorerId: "scorer-1", username: "test", organizationId: "organization_komobasket", organizationName: "KomoBasket", sessionId: "session-1", deviceId, expiresAt: "2099-08-26T00:00:00.000Z" };
function envelope(overrides = {}) { return { schemaVersion: 1, opaqueToken: token, sessionId: context.sessionId, scorerId: context.scorerId, username: context.username, organizationId: context.organizationId, organizationName: context.organizationName, deviceId, validatedAtUtc: "2026-01-01T00:00:00.000Z", expiresAtUtc: context.expiresAt, ...overrides }; }

function root() { const value = fs.mkdtempSync(path.join(os.tmpdir(), "komocontrol-kc5b4-")); roots.push(value); return value; }
function cipher() { return { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.concat([Buffer.from([0x4b]), Buffer.from(value).map((byte) => byte ^ 0xaa)]), decryptString: (value) => { if (value[0] !== 0x4b) throw new Error("corrupt"); return Buffer.from(value.subarray(1)).map((byte) => byte ^ 0xaa).toString("utf8"); } }; }
function store() { return new SecureSessionStore(path.join(root(), "secure", "session.bin"), cipher()); }
function response(status, data) { return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } }); }
function fakeClient(overrides = {}) { return { login: vi.fn(async () => ({ token, ...context })), getSession: vi.fn(async () => context), logout: vi.fn(async () => undefined), listGames: vi.fn(async () => []), downloadGamePackage: vi.fn(async () => { throw new Error("unused"); }), ...overrides }; }

afterEach(() => {
    vi.restoreAllMocks();
    for (const value of roots.splice(0)) { if (!path.resolve(value).startsWith(path.resolve(os.tmpdir()))) throw new Error("Unsafe test cleanup path."); fs.rmSync(value, { recursive: true, force: true }); }
});

describe("SecureSessionStore", () => {
    it("persists encrypted bytes atomically without plaintext", () => {
        const secureStore = store(); secureStore.saveToken(token); const bytes = fs.readFileSync(secureStore.sessionPath);
        expect(bytes.includes(Buffer.from(token))).toBe(false); expect(secureStore.loadToken()).toBe(token); expect(fs.readdirSync(path.dirname(secureStore.sessionPath))).toEqual(["session.bin"]);
    });
    it("replaces and clears a session", () => {
        const secureStore = store(); secureStore.saveToken(token); secureStore.saveToken("B".repeat(43)); expect(secureStore.loadToken()).toBe("B".repeat(43)); secureStore.clearSession(); expect(secureStore.hasSession()).toBe(false);
    });
    it("round-trips a versioned encrypted authorization envelope without plaintext auth material", () => {
        const secureStore = store(); secureStore.saveAuthorization(envelope()); const bytes = fs.readFileSync(secureStore.sessionPath);
        expect(bytes.includes(Buffer.from(token))).toBe(false); expect(bytes.includes(Buffer.from(context.scorerId))).toBe(false); expect(bytes.includes(Buffer.from(context.sessionId))).toBe(false);
        expect(secureStore.loadAuthorization()).toEqual({ kind: "envelope", envelope: envelope() });
    });
    it("returns null for a missing blob and clears a corrupt blob", () => {
        const secureStore = store(); expect(secureStore.loadToken()).toBeNull(); fs.mkdirSync(path.dirname(secureStore.sessionPath), { recursive: true }); fs.writeFileSync(secureStore.sessionPath, "corrupt"); expect(() => secureStore.loadToken()).toThrowError(/SESSION_INVALID/); expect(secureStore.hasSession()).toBe(false);
    });
    it("fails closed when encryption is unavailable", () => {
        const secureStore = new SecureSessionStore(path.join(root(), "session.bin"), { ...cipher(), isEncryptionAvailable: () => false }); expect(() => secureStore.saveToken(token)).toThrowError(/SECURE_STORAGE_UNAVAILABLE/);
    });
});

describe("PlatformAuthClient", () => {
    it("validates Login and Session responses", async () => {
        const payload = { data: { scorer: { id: context.scorerId, username: context.username }, organization: { id: context.organizationId, name: context.organizationName }, session: { id: context.sessionId, deviceId: context.deviceId, expiresAt: context.expiresAt } } };
        const fetcher = vi.fn().mockResolvedValueOnce(response(200, { data: { ...payload.data, token } })).mockResolvedValueOnce(response(200, payload));
        const client = new PlatformAuthClient("http://localhost:3000", 100, fetcher);
        expect(await client.login("test", "synthetic-password", "device-1")).toEqual({ token, ...context }); expect(await client.getSession(token)).toEqual(context);
    });
    it("maps invalid login, malformed success and network failure", async () => {
        const invalid = new PlatformAuthClient("http://localhost:3000", 100, async () => response(401, { ok: false, error: { code: "AUTH_INVALID" } }));
        const malformed = new PlatformAuthClient("http://localhost:3000", 100, async () => response(200, { data: {} }));
        const network = new PlatformAuthClient("http://localhost:3000", 100, async () => { throw new TypeError("offline"); });
        await expect(invalid.login("test", "synthetic", "device")).rejects.toMatchObject({ code: "AUTH_INVALID" });
        await expect(malformed.login("test", "synthetic", "device")).rejects.toMatchObject({ code: "MALFORMED_RESPONSE" });
        await expect(network.getSession(token)).rejects.toMatchObject({ code: "NETWORK_UNAVAILABLE" });
    });
    it("enforces a finite request timeout", async () => {
        const client = new PlatformAuthClient("http://localhost:3000", 5, (_url, init) => new Promise((_resolve, reject) => { init.signal?.addEventListener("abort", () => reject(new Error("aborted"))); }));
        await expect(client.getSession(token)).rejects.toMatchObject({ code: "NETWORK_UNAVAILABLE" });
    });
    it("constructs Authorization only in the backend client", async () => {
        const fetcher = vi.fn(async () => response(200, { ok: true, data: {} })); const client = new PlatformAuthClient("http://localhost:3000", 100, fetcher); await client.logout(token); expect(fetcher.mock.calls[0][1].headers.authorization).toBe(`Bearer ${token}`);
    });
});

describe("AuthCoordinator", () => {
    it("starts unauthenticated without a blob", async () => { const coordinator = new AuthCoordinator(fakeClient(), store(), deviceId); expect(await coordinator.initialize()).toEqual({ kind: "unauthenticated", deviceIdSuffix: "12345678" }); });
    it("logs in, persists securely and returns a token-free DTO", async () => {
        const secureStore = store(); const coordinator = new AuthCoordinator(fakeClient(), secureStore, deviceId); const result = await coordinator.login({ username: "test", password: "synthetic" }); expect(result.ok).toBe(true); expect(secureStore.loadToken()).toBe(token); expect(secureStore.loadAuthorization().kind).toBe("envelope"); expect(JSON.stringify(result)).not.toContain(token); expect(JSON.stringify(result)).not.toContain(context.sessionId);
    });
    it("restores without calling Login", async () => {
        const secureStore = store(); secureStore.saveToken(token); const client = fakeClient(); const coordinator = new AuthCoordinator(client, secureStore, deviceId); expect((await coordinator.initialize()).kind).toBe("authenticated"); expect(client.login).not.toHaveBeenCalled(); expect(client.getSession).toHaveBeenCalledOnce(); expect(secureStore.loadAuthorization().kind).toBe("envelope");
    });
    it("clears an invalid session", async () => {
        const secureStore = store(); secureStore.saveToken(token); const coordinator = new AuthCoordinator(fakeClient({ getSession: vi.fn(async () => { throw new AuthFlowError("SESSION_INVALID"); }) }), secureStore, "device"); expect((await coordinator.initialize()).kind).toBe("unauthenticated"); expect(secureStore.hasSession()).toBe(false);
    });
    it("preserves a blob offline and restores on explicit retry", async () => {
        const secureStore = store(); secureStore.saveToken(token); const getSession = vi.fn().mockRejectedValueOnce(new AuthFlowError("NETWORK_UNAVAILABLE")).mockResolvedValueOnce(context); const coordinator = new AuthCoordinator(fakeClient({ getSession }), secureStore, deviceId); expect((await coordinator.initialize()).kind).toBe("validation-unavailable"); expect(secureStore.hasSession()).toBe(true); expect((await coordinator.retrySession()).ok).toBe(true);
    });
    it("falls back offline only from a valid envelope and returns online after reconnect", async () => {
        const secureStore = store(); secureStore.saveAuthorization(envelope()); const getSession = vi.fn().mockRejectedValueOnce(new AuthFlowError("NETWORK_UNAVAILABLE")).mockResolvedValueOnce(context); const coordinator = new AuthCoordinator(fakeClient({ getSession }), secureStore, deviceId);
        expect(await coordinator.initialize()).toMatchObject({ kind: "authenticated", connection: "offline", context: { scorerId: context.scorerId, organizationId: context.organizationId } });
        expect((await coordinator.retrySession()).state).toMatchObject({ kind: "authenticated", connection: "online" });
    });
    it("rejects expired, device-mismatched and clock-rollback envelopes without a network call", async () => {
        for (const value of [envelope({ expiresAtUtc: "2026-02-01T00:00:00.000Z" }), envelope({ deviceId: "other-device" }), envelope({ validatedAtUtc: "2027-01-01T00:00:00.000Z" })]) {
            const secureStore = store(); secureStore.saveAuthorization(value); const client = fakeClient(); const coordinator = new AuthCoordinator(client, secureStore, deviceId, null, null, null, null, null, () => new Date("2026-08-26T12:00:00.000Z"));
            expect((await coordinator.initialize()).kind).toBe("unauthenticated"); expect(client.getSession).not.toHaveBeenCalled(); expect(secureStore.hasSession()).toBe(false);
        }
    });
    it("does not use an otherwise valid envelope after a malformed server response", async () => {
        const secureStore = store(); secureStore.saveAuthorization(envelope()); const coordinator = new AuthCoordinator(fakeClient({ getSession: vi.fn(async () => { throw new AuthFlowError("MALFORMED_RESPONSE"); }) }), secureStore, deviceId);
        expect(await coordinator.initialize()).toMatchObject({ kind: "validation-unavailable", errorCode: "MALFORMED_RESPONSE" }); expect(secureStore.hasSession()).toBe(true);
    });
    it("denies online-only operations while offline without renewing the envelope", async () => {
        const secureStore = store(); const stored = envelope(); secureStore.saveAuthorization(stored); const client = fakeClient({ getSession: vi.fn(async () => { throw new AuthFlowError("NETWORK_UNAVAILABLE"); }) }); const coordinator = new AuthCoordinator(client, secureStore, deviceId);
        expect((await coordinator.initialize()).connection).toBe("offline"); expect(await coordinator.listGames()).toMatchObject({ ok: false, errorCode: "OFFLINE_OPERATION_DENIED" }); expect(secureStore.loadAuthorization()).toEqual({ kind: "envelope", envelope: stored }); expect(client.listGames).not.toHaveBeenCalled();
    });
    it("enumerates only safe owner-bound local Runs while offline", async () => {
        const secureStore = store(); secureStore.saveAuthorization(envelope()); const safeRun = { runId: "run-1", gameId: "game-1", packageId: "package-1", packageVersion: 2, gameplayStarted: false, lastAcceptedSequence: 0, createdAtUtc: "2026-08-25T12:00:00.000Z", homeTeam: { id: "home", name: "Home" }, awayTeam: { id: "away", name: "Away" }, competitionName: "League", seasonName: "2026", phaseName: null, roundLabel: null, scheduledDate: null, scheduledTime: null, venue: null }; const manager = { listRecoverable: vi.fn(() => [safeRun]), createOrOpen: vi.fn() };
        const coordinator = new AuthCoordinator(fakeClient({ getSession: vi.fn(async () => { throw new AuthFlowError("NETWORK_UNAVAILABLE"); }) }), secureStore, deviceId, null, null, manager);
        expect((await coordinator.initialize()).connection).toBe("offline"); const result = await coordinator.listLocalRuns(); expect(result).toMatchObject({ ok: true, runs: [safeRun] }); expect(manager.listRecoverable).toHaveBeenCalledWith({ scorerId: context.scorerId, organizationId: context.organizationId }); expect(JSON.stringify(result.runs)).not.toMatch(/opaqueToken|sessionId|deviceId|payload|hash/i); expect(await coordinator.createOrOpenGameRun("game-1")).toMatchObject({ ok: false, errorCode: "OFFLINE_OPERATION_DENIED" }); expect(manager.createOrOpen).not.toHaveBeenCalled();
    });
    it("recovers an existing pre-game configuration read-only while offline", async () => {
        const secureStore = store(); secureStore.saveAuthorization(envelope()); const configuration = { runId: "run-1", gameId: "game-1", revision: 3 }; const manager = { recover: vi.fn(() => ({ outcome: "existing", configuration })), getOrCreate: vi.fn(), saveDraft: vi.fn() }; const coordinator = new AuthCoordinator(fakeClient({ getSession: vi.fn(async () => { throw new AuthFlowError("NETWORK_UNAVAILABLE"); }) }), secureStore, deviceId, null, null, null, manager);
        expect((await coordinator.initialize()).connection).toBe("offline"); expect(await coordinator.getOrCreatePreGameConfiguration("game-1")).toMatchObject({ ok: true, outcome: "existing", configuration }); expect(manager.getOrCreate).not.toHaveBeenCalled(); expect(await coordinator.savePreGameConfigurationDraft({ gameId: "game-1" })).toMatchObject({ ok: false, errorCode: "OFFLINE_OPERATION_DENIED" }); expect(manager.saveDraft).not.toHaveBeenCalled();
    });
    it("recovers existing durable gameplay through the owner-bound backend while offline", async () => {
        const secureStore = store(); secureStore.saveAuthorization(envelope()); const recovery = { runId: "run-1", eventHistoryRevision: 2, lastAcceptedSequence: 1, state: { id: "run-1" }, eventIds: ["event-1"] }; const manager = { recover: vi.fn(async () => recovery) }; const coordinator = new AuthCoordinator(fakeClient({ getSession: vi.fn(async () => { throw new AuthFlowError("NETWORK_UNAVAILABLE"); }) }), secureStore, deviceId, null, null, null, null, manager);
        expect((await coordinator.initialize()).connection).toBe("offline"); expect(await coordinator.recoverMatchGameplay("run-1")).toMatchObject({ ok: true, recovery }); expect(manager.recover).toHaveBeenCalledWith("run-1", { scorerId: context.scorerId, organizationId: context.organizationId });
    });
    it("revokes remotely and clears locally on Logout", async () => {
        const secureStore = store(); const client = fakeClient(); const coordinator = new AuthCoordinator(client, secureStore, deviceId); await coordinator.login({ username: "test", password: "synthetic" }); expect((await coordinator.logout()).ok).toBe(true); expect(client.logout).toHaveBeenCalledWith(token); expect(secureStore.hasSession()).toBe(false);
    });
    it("clears locally on offline Logout without a hidden retry", async () => {
        const secureStore = store(); secureStore.saveToken(token); const logout = vi.fn(async () => { throw new AuthFlowError("NETWORK_UNAVAILABLE"); }); const coordinator = new AuthCoordinator(fakeClient({ logout }), secureStore, deviceId); expect((await coordinator.logout()).ok).toBe(true); expect(logout).toHaveBeenCalledOnce(); expect(secureStore.hasSession()).toBe(false);
    });
    it("clears an offline envelope immediately without attempting remote revocation", async () => {
        const secureStore = store(); secureStore.saveAuthorization(envelope()); const logout = vi.fn(async () => undefined); const coordinator = new AuthCoordinator(fakeClient({ getSession: vi.fn(async () => { throw new AuthFlowError("NETWORK_UNAVAILABLE"); }), logout }), secureStore, deviceId);
        expect((await coordinator.initialize()).connection).toBe("offline"); expect((await coordinator.logout()).ok).toBe(true); expect(logout).not.toHaveBeenCalled(); expect(secureStore.hasSession()).toBe(false);
    });
});
