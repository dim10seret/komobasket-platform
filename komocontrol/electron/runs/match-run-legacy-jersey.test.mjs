import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import setupModule from "../../dist-electron/games/match-setup.cjs";
import runModule from "../../dist-electron/runs/match-run.cjs";
import bootstrapModule from "../../dist-electron/runs/match-engine-bootstrap.cjs";

const { MatchSetupManager } = setupModule;
const { MatchRunManager } = runModule;
const { deterministicJson, sha256JsonBytes } = bootstrapModule;
const owner = { organizationId: "organization-synthetic", scorerId: "scorer-synthetic" };
const deviceId = "11111111-1111-4111-8111-111111111111";
const timestamp = "2026-09-01T12:00:00.000Z";

function packageFor(gameId, homeNumbers) {
    const player = (side, number, index) => ({ id: `${gameId}-${side}-${index}`, displayName: `${side} Player ${index}`, shirtNumber: number, photoUrl: null });
    const payloadJson = JSON.stringify({
        schemaVersion: 1,
        game: { id: gameId, organizationId: owner.organizationId, competitionId: "competition-synthetic", competitionName: "Synthetic Competition", seasonName: "2026-27", phaseName: "Phase", roundLabel: "Round 1", scheduledDate: null, scheduledTime: null, scheduledAt: null, venue: null },
        settings: { game_mode: "FULL", min_players: 1, max_players: 12, starting_players: 1, regulation_periods: 4, regulation_period_seconds: 600, overtime_seconds: 300, tie_allowed: false, winner_required: true },
        teams: [
            { side: "HOME", id: `${gameId}-home-team`, name: "Home", logoUrl: null, players: homeNumbers.map((number, index) => player("home", number, index)), staff: [] },
            { side: "AWAY", id: `${gameId}-away-team`, name: "Away", logoUrl: null, players: [player("away", 12, 0)], staff: [] },
        ],
    });
    return { packageId: `${gameId}-package`, gameId, packageVersion: 1, packageSchemaVersion: 1, payloadJson, payloadHash: createHash("sha256").update(Buffer.from(payloadJson, "utf8")).digest("hex"), publishedAtUtc: timestamp, downloadedAtUtc: timestamp };
}

function recordFor(gameId, homeNumbers, { legacyPlayerIds = [], finalized = false } = {}) {
    const pkg = packageFor(gameId, homeNumbers);
    const setup = new MatchSetupManager({ readGamePackage: () => pkg, readCurrentGamePackage: () => pkg }).getVerifiedPackageMatchSetup(pkg.packageId).setup;
    const snapshot = structuredClone(setup);
    for (const player of snapshot.home.players) {
        if (!legacyPlayerIds.includes(player.playerId)) continue;
        const index = Number(player.playerId.slice(player.playerId.lastIndexOf("-") + 1));
        player.shirtNumber = homeNumbers[index];
    }
    const run = {
        runId: `${gameId}-run`, runSchemaVersion: 1, gameId, packageId: pkg.packageId, packageVersion: pkg.packageVersion,
        packageSchemaVersion: 1, packageHash: pkg.payloadHash, organizationId: owner.organizationId, scorerId: owner.scorerId,
        deviceId, status: finalized ? "finalized" : "active", setupSnapshotJson: JSON.stringify(snapshot),
        lastAcceptedSequence: finalized ? 1 : 0, startedAtUtc: finalized ? timestamp : null, createdAtUtc: timestamp, updatedAtUtc: timestamp,
    };
    return { pkg, run };
}

function finalizedReadModel(run) {
    const historyHash = "a".repeat(64);
    const finalStateJson = deterministicJson({ id: run.runId, finished: true, lastProcessedSequence: run.lastAcceptedSequence, home: { score: 75 }, away: { score: 72 } });
    const finalStateHash = sha256JsonBytes(finalStateJson);
    const finalizationJson = deterministicJson({ schemaVersion: 1, runId: run.runId, finalizedHistoryRevision: 1, finalizedHistoryHash: historyHash, finalStateHash, finalizedAtUtc: timestamp });
    const finalizationHash = sha256JsonBytes(finalizationJson);
    return {
        snapshot: { eventHistoryRevision: 1 },
        finalization: { finalStateJson, finalStateHash, finalizationJson, finalizationHash, finalizedHistoryRevision: 1, finalizedHistoryHash: historyHash, finalizedAtUtc: timestamp },
        sync: { lastErrorCode: null, consecutiveFailures: 0, nextRetryAtUtc: null, lastAcknowledgedHistoryRevision: 1, lastAcknowledgedHistoryHash: historyHash, lastAcknowledgedFinalizationHash: finalizationHash },
    };
}

function managerFor(records) {
    const packages = new Map(records.map(({ pkg }) => [pkg.packageId, pkg]));
    const setup = new MatchSetupManager({ readGamePackage: (id) => packages.get(id) ?? null, readCurrentGamePackage: (id) => records.find(({ pkg }) => pkg.gameId === id)?.pkg ?? null });
    const runs = records.map(({ run }) => run);
    const finalized = new Map(runs.filter((run) => run.status === "finalized").map((run) => [run.runId, finalizedReadModel(run)]));
    const store = {
        createOrOpenLocalGameRun: () => { throw new Error("Unexpected write in read-only compatibility test."); },
        getActiveLocalGameRun: (gameId) => runs.find((run) => run.gameId === gameId) ?? null,
        listActiveLocalGameRunsForOwner: () => runs,
        listMyGamesLocalRunsForOwner: () => runs,
        readLocalMatchEngineSnapshot: (runId) => finalized.get(runId)?.snapshot ?? null,
        readLocalGameplaySyncState: (runId) => finalized.get(runId)?.sync ?? null,
        readLocalMatchFinalization: (runId) => finalized.get(runId)?.finalization ?? null,
    };
    return new MatchRunManager(setup, store, deviceId);
}

describe("legacy numeric jersey Run read compatibility", () => {
    it("recovers numeric 23 as textual 23 without modifying the stored package or snapshot", () => {
        const record = recordFor("game-23", [23], { legacyPlayerIds: ["game-23-home-0"] });
        const before = structuredClone(record);
        const manager = managerFor([record]);
        expect(manager.recover("game-23", owner)?.runId).toBe(record.run.runId);
        expect(manager.recoverSetup("game-23", owner)?.home.players[0].shirtNumber).toBe("23");
        expect(manager.listRecoverable(owner)).toHaveLength(1);
        expect(record).toEqual(before);
    });

    it("recovers numeric 0 as textual 0 and preserves null", () => {
        const record = recordFor("game-zero", [0, null], { legacyPlayerIds: ["game-zero-home-0"] });
        const home = managerFor([record]).recoverSetup("game-zero", owner)?.home.players;
        expect(home?.map((player) => player.shirtNumber)).toEqual(["0", null]);
    });

    it("preserves new textual 0, 00, and 23 with separate player identities", () => {
        const record = recordFor("game-text", ["0", "00", "23"]);
        const home = managerFor([record]).recoverSetup("game-text", owner)?.home.players;
        expect(home?.map((player) => [player.playerId, player.shirtNumber])).toEqual([
            ["game-text-home-0", "0"], ["game-text-home-1", "00"], ["game-text-home-2", "23"],
        ]);
        expect(home?.[0].playerId).not.toBe(home?.[1].playerId);
        expect(home?.[0].shirtNumber).not.toBe(home?.[1].shirtNumber);
    });

    it("accepts a mixed legacy numeric 0 and textual 00 without collapsing either identity", () => {
        const record = recordFor("game-mixed", [0, "00"], { legacyPlayerIds: ["game-mixed-home-0"] });
        const home = managerFor([record]).recoverSetup("game-mixed", owner)?.home.players;
        expect(home?.map((player) => [player.playerId, player.shirtNumber])).toEqual([
            ["game-mixed-home-0", "0"], ["game-mixed-home-1", "00"],
        ]);
    });

    it("rejects a whitespace mutation in an otherwise valid legacy snapshot", () => {
        const record = recordFor("game-whitespace", [23], { legacyPlayerIds: ["game-whitespace-home-0"] });
        const original = record.run.setupSnapshotJson;
        record.run.setupSnapshotJson = original.replace('"shirtNumber":23', '"shirtNumber": 23');
        expect(record.run.setupSnapshotJson).not.toBe(original);
        expect(() => managerFor([record]).recover(record.run.gameId, owner)).toThrow("RUN_INVALID");
    });

    it("rejects a duplicate shirtNumber key instead of accepting its last value", () => {
        const record = recordFor("game-duplicate-jersey", [23], { legacyPlayerIds: ["game-duplicate-jersey-home-0"] });
        const original = record.run.setupSnapshotJson;
        record.run.setupSnapshotJson = original.replace('"shirtNumber":23', '"shirtNumber":100,"shirtNumber":23');
        expect(record.run.setupSnapshotJson).not.toBe(original);
        expect(() => managerFor([record]).recover(record.run.gameId, owner)).toThrow("RUN_INVALID");
    });

    it("rejects a duplicate unrelated key instead of accepting its last value", () => {
        const record = recordFor("game-duplicate-team", [23], { legacyPlayerIds: ["game-duplicate-team-home-0"] });
        const original = record.run.setupSnapshotJson;
        record.run.setupSnapshotJson = original.replace('"teamName":"Home"', '"teamName":"Changed","teamName":"Home"');
        expect(record.run.setupSnapshotJson).not.toBe(original);
        expect(() => managerFor([record]).recover(record.run.gameId, owner)).toThrow("RUN_INVALID");
    });

    it.each([-1, 100, 1.5])("rejects malformed numeric %s in a stored Run snapshot", (number) => {
        const record = recordFor("game-bad-snapshot", [23]);
        const snapshot = JSON.parse(record.run.setupSnapshotJson);
        snapshot.home.players[0].shirtNumber = number;
        record.run.setupSnapshotJson = JSON.stringify(snapshot);
        expect(() => managerFor([record]).recover(record.run.gameId, owner)).toThrow("RUN_INVALID");
    });

    it.each([-1, 100, 1.5, "01", "000", "001", "100", "-1", "1.0", "letters", {}, [], true])("rejects malformed package jersey %s", (number) => {
        const pkg = packageFor("game-bad-package", [number]);
        const setup = new MatchSetupManager({ readGamePackage: () => pkg, readCurrentGamePackage: () => pkg });
        expect(() => setup.getVerifiedPackageMatchSetup(pkg.packageId)).toThrow("PACKAGE_INVALID");
    });

    it("verifies the raw legacy package hash before in-memory normalization", () => {
        const record = recordFor("game-hash", [23], { legacyPlayerIds: ["game-hash-home-0"] });
        const rawPayload = record.pkg.payloadJson;
        const originalHash = record.pkg.payloadHash;
        expect(managerFor([record]).recover("game-hash", owner)).not.toBeNull();
        expect(record.pkg.payloadJson).toBe(rawPayload);
        expect(record.pkg.payloadHash).toBe(originalHash);
        expect(JSON.parse(rawPayload).teams[0].players[0].shirtNumber).toBe(23);
        record.pkg.payloadHash = "f".repeat(64);
        expect(() => managerFor([record]).recover("game-hash", owner)).toThrow("PACKAGE_HASH_MISMATCH");
    });

    it("does not accept any unrelated Run snapshot or identity mismatch", () => {
        const record = recordFor("game-tampered", [23], { legacyPlayerIds: ["game-tampered-home-0"] });
        const snapshot = JSON.parse(record.run.setupSnapshotJson);
        snapshot.home.teamName = "Changed";
        record.run.setupSnapshotJson = JSON.stringify(snapshot);
        expect(() => managerFor([record]).recover(record.run.gameId, owner)).toThrow("RUN_INVALID");
        expect(() => managerFor([record]).recover(record.run.gameId, { ...owner, scorerId: "other" })).toThrow("RUN_OWNERSHIP_CONFLICT");
    });

    it("projects two completed legacy games from the existing finalized read models", () => {
        const records = ["game-completed-a", "game-completed-b"].map((gameId) => recordFor(gameId, [0, 23], { legacyPlayerIds: [`${gameId}-home-0`, `${gameId}-home-1`], finalized: true }));
        const before = structuredClone(records);
        const manager = managerFor(records);
        expect(manager.listRecoverable(owner)).toHaveLength(2);
        expect(manager.listMyGamesStates(owner)).toEqual(records.map(({ run }) => expect.objectContaining({ gameId: run.gameId, runId: run.runId, lifecycle: "finalized", syncStatus: "completed", homeScore: 75, awayScore: 72 })));
        expect(records).toEqual(before);
    });
});
