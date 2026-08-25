import { describe, expect, it } from "vitest";
import { ScorerSessionAuthority, type ScorerAuthStore, type SessionRecord } from "./komocontrol-scorer-auth-core";
import { GamePackageUnavailableError, projectCurrentPublishedGamePackage, type PublishedGamePackageDownloadRow } from "./komocontrol-game-package-download-core";

const organizationId = "organization-a";
const token = "A".repeat(43);
const payloadJson = "{\"schemaVersion\":1,\"game\":{\"id\":\"game-1\"}}";
const payloadHash = "a".repeat(64);
function row(overrides: Partial<PublishedGamePackageDownloadRow> = {}): PublishedGamePackageDownloadRow {
  return { id: "package-v2", game_id: "game-1", organization_id: organizationId, package_version: 2, status: "published", snapshot_json: payloadJson, snapshot_hash: payloadHash, published_at: "2026-08-25T12:00:00.000Z", ...overrides };
}
function authority(value: SessionRecord | null) {
  const store: ScorerAuthStore = { findScorerByNormalizedUsername: async () => null, createSession: async () => undefined, findSessionByTokenHash: async () => value, revokeSessionByTokenHash: async () => undefined };
  return new ScorerSessionAuthority(store, () => new Date("2026-08-25T12:00:00.000Z"));
}
const scorer = { id: "scorer-1", organizationId, organizationName: "Organization A", username: "test", normalizedUsername: "test", status: "active" as const, credentialVersion: 1 };
const session: SessionRecord = { id: "session-1", scorerId: scorer.id, tokenHash: "hash", credentialVersion: 1, deviceId: "device-1", createdAt: "2026-08-25T10:00:00.000Z", expiresAt: "2026-08-25T14:00:00.000Z", revokedAt: null, scorer };

describe("KomoControl scorer GamePackage download", () => {
  it("rejects unauthenticated requests through the canonical resolver", async () => { await expect(authority(null).resolve(null)).rejects.toMatchObject({ code: "AUTH_REQUIRED" }); });
  it("rejects invalid and revoked sessions through the canonical resolver", async () => { await expect(authority(null).resolve(`Bearer ${token}`)).rejects.toMatchObject({ code: "SESSION_INVALID" }); await expect(authority({ ...session, revokedAt: "2026-08-25T11:00:00.000Z" }).resolve(`Bearer ${token}`)).rejects.toMatchObject({ code: "SESSION_INVALID" }); });
  it("makes cross-Organization Packages inaccessible", () => { expect(() => projectCurrentPublishedGamePackage(row({ organization_id: "organization-b" }), organizationId, "game-1")).toThrow(GamePackageUnavailableError); });
  it("makes a missing published Package unavailable", () => { expect(() => projectCurrentPublishedGamePackage(null, organizationId, "game-1")).toThrow(GamePackageUnavailableError); });
  it("makes superseded-only Packages unavailable", () => { expect(() => projectCurrentPublishedGamePackage(row({ status: "superseded" }), organizationId, "game-1")).toThrow(GamePackageUnavailableError); });
  it("returns the current published Package", () => { expect(projectCurrentPublishedGamePackage(row(), organizationId, "game-1").packageVersion).toBe(2); });
  it("selects v2 when the canonical query supplies current v2", () => { const envelope = projectCurrentPublishedGamePackage(row({ id: "package-v2", package_version: 2 }), organizationId, "game-1"); expect(envelope).toMatchObject({ packageId: "package-v2", packageVersion: 2 }); });
  it("preserves exact canonical payloadJson", () => { expect(projectCurrentPublishedGamePackage(row(), organizationId, "game-1").payloadJson).toBe(payloadJson); });
  it("preserves exact canonical payloadHash", () => { expect(projectCurrentPublishedGamePackage(row(), organizationId, "game-1").payloadHash).toBe(payloadHash); });
  it("projects the complete envelope identity", () => { expect(projectCurrentPublishedGamePackage(row(), organizationId, "game-1")).toEqual({ packageId: "package-v2", gameId: "game-1", packageVersion: 2, packageSchemaVersion: 1, publishedAt: "2026-08-25T12:00:00.000Z", payloadJson, payloadHash }); });
  it("does not expose Admin metadata", () => { const serialized = JSON.stringify(projectCurrentPublishedGamePackage(row(), organizationId, "game-1")); expect(serialized).not.toContain("organization_id"); expect(serialized).not.toContain("status"); expect(serialized).not.toContain("published_by"); });
});
