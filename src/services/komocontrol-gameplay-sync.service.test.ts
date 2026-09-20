import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: vi.fn() }));
vi.mock("@/services/league-admin.service", () => ({ saveOfficialGameResultAndProgressSeriesWithDb: vi.fn() }));

import { GameplaySyncValidationError } from "./komocontrol-gameplay-sync-core";
import {
  GameplaySyncServiceError,
  assertGameplaySyncClaimIdentity,
  assertGameplaySyncPackageAccepted,
  assertPersistedGameplaySyncConfiguration,
  assertPersistedGameplaySyncHead,
  assertStoredGameplaySyncIdentity,
  gameplaySyncErrorResponse,
  gameplaySyncServiceErrorFrom,
} from "./komocontrol-gameplay-sync.service";

const correlation = { runId: "run-safe-id", gameId: "game-safe-id" };
const identity = {
  ...correlation,
  packageId: "package-1",
  packageVersion: 1,
  packageHash: "a".repeat(64),
  organizationId: "organization-1",
  scorerId: "scorer-1",
  deviceId: "device-1",
};

function captureConflict(action: () => void, reason: string, mismatchedFields: string[]): GameplaySyncServiceError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(GameplaySyncServiceError);
    if (!(error instanceof GameplaySyncServiceError)) throw error;
    expect(error.code).toBe("SYNC_RUN_CONFLICT");
    expect(error.diagnostic).toEqual({ reason, ...correlation, mismatchedFields });
    return error;
  }
  throw new Error(`Expected ${reason}`);
}

describe("KomoControl gameplay sync conflict diagnostics", () => {
  it("keeps superseded Package v1 eligible when its exact version and hash still match", () => {
    expect(() => assertGameplaySyncPackageAccepted(identity, { package_version: 1, package_hash: identity.packageHash, package_status: "superseded" })).not.toThrow();
    expect(() => assertGameplaySyncPackageAccepted(identity, { package_version: 1, package_hash: identity.packageHash, package_status: "published" })).not.toThrow();
    expect(() => assertGameplaySyncPackageAccepted(identity, { package_version: 1, package_hash: identity.packageHash, package_status: "draft" })).toThrowError(/SYNC_INVALID/);
  });

  it("assigns every existing conflict guard a stable safe subreason while preserving the public response", async () => {
    const session = gameplaySyncServiceErrorFrom(new GameplaySyncValidationError("SYNC_RUN_CONFLICT", {
      reason: "SESSION_IDENTITY_MISMATCH",
      mismatchedFields: ["deviceId"],
    }), correlation);
    expect(session.diagnostic).toEqual({ reason: "SESSION_IDENTITY_MISMATCH", ...correlation, mismatchedFields: ["deviceId"] });

    const claim = captureConflict(() => assertGameplaySyncClaimIdentity(identity, {
      game_id: identity.gameId,
      run_id: identity.runId,
      organization_id: identity.organizationId,
      scorer_id: identity.scorerId,
      device_id: "SECRET_DEVICE_VALUE",
    }), "CLAIM_IDENTITY_MISMATCH", ["deviceId"]);

    const snapshot = captureConflict(() => assertStoredGameplaySyncIdentity(identity as never, {
      run_id: identity.runId,
      game_id: identity.gameId,
      package_id: identity.packageId,
      package_version: identity.packageVersion,
      package_hash: "SECRET_PACKAGE_HASH",
      organization_id: identity.organizationId,
      scorer_id: identity.scorerId,
      device_id: identity.deviceId,
    }), "SNAPSHOT_IDENTITY_MISMATCH", ["packageHash"]);

    const head = captureConflict(() => assertPersistedGameplaySyncHead({
      ...correlation,
      eventHistoryRevision: 4,
      historyHash: "expected-history-hash",
      finalizationHash: null,
    }, {
      event_history_revision: 4,
      history_hash: "SECRET_HISTORY_HASH",
      finalization_hash: null,
      official_result_applied_at: null,
    }), "POST_WRITE_HISTORY_MISMATCH", ["historyHash"]);

    const configuration = captureConflict(() => assertPersistedGameplaySyncConfiguration({
      ...correlation,
      currentConfigurationRevision: 3,
      currentConfigurationHash: "expected-configuration-hash",
    }, {
      configuration_revision: 3,
      configuration_hash: "SECRET_CONFIGURATION_HASH",
    }), "POST_WRITE_CONFIGURATION_MISMATCH", ["currentConfigurationHash"]);

    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const errors = [session, claim, snapshot, head, configuration];
    for (const error of errors) {
      const response = gameplaySyncErrorResponse(error);
      expect(response.status).toBe(409);
      expect(await response.json()).toEqual({ error: { code: "SYNC_RUN_CONFLICT" } });
    }
    expect(warning).toHaveBeenCalledTimes(5);
    expect(warning.mock.calls.map((call) => (call[1] as { reason: string }).reason)).toEqual([
      "SESSION_IDENTITY_MISMATCH",
      "CLAIM_IDENTITY_MISMATCH",
      "SNAPSHOT_IDENTITY_MISMATCH",
      "POST_WRITE_HISTORY_MISMATCH",
      "POST_WRITE_CONFIGURATION_MISMATCH",
    ]);
    const logged = JSON.stringify(warning.mock.calls);
    expect(logged).not.toContain("SECRET_DEVICE_VALUE");
    expect(logged).not.toContain("SECRET_PACKAGE_HASH");
    expect(logged).not.toContain("SECRET_HISTORY_HASH");
    expect(logged).not.toContain("SECRET_CONFIGURATION_HASH");
  });
});
