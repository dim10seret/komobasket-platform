import { createHash, randomUUID } from "node:crypto";
import type { MatchSetup, VerifiedMatchSetupSource } from "../games/match-setup.cjs";
import type { StoredLocalGameRun } from "../persistence/local-database.cjs";

export type DemoMode = "FULL" | "SIMPLE";
export const DEMO_GAMES = Object.freeze([
    { mode: "FULL" as const, title: "DEMO FULL STATS" },
    { mode: "SIMPLE" as const, title: "DEMO SIMPLE" },
]);
export const DEMO_OWNER = Object.freeze({ organizationId: "demo:organization", scorerId: "demo:training" });
// A RAM namespace, never a registered device or a real authorization.
export const DEMO_DEVICE = "demo:no-device-registration";

export function createDemoFixture(mode: DemoMode, now = new Date()): { source: VerifiedMatchSetupSource; run: StoredLocalGameRun } {
    if (mode !== "FULL" && mode !== "SIMPLE") throw new Error("DEMO_INVALID_MODE");
    const gameId = "demo:game:" + mode.toLowerCase();
    const packageId = "demo:builtin:" + mode.toLowerCase();
    const team = (side: "HOME" | "AWAY", letter: "A" | "B") => ({
        side, teamId: "demo:team:" + letter, teamName: "DEMO TEAM " + letter, logoUrl: null,
        players: Array.from({ length: 12 }, (_, index) => ({
            playerId: "demo:" + letter.toLowerCase() + ":" + String(index + 1).padStart(2, "0"),
            displayName: "DEMO " + letter + " PLAYER " + String(index + 1).padStart(2, "0"),
            photoUrl: null, shirtNumber: String(index + 1),
        })),
        staff: [{ staffId: "demo:coach:" + letter, displayName: "DEMO COACH " + letter, role: "HEAD_COACH", roleLabel: "Coach" }],
    });
    const setup: MatchSetup = {
        gameId, packageId, packageVersion: 1, competitionName: "DEMO TRAINING", seasonName: "DEMO",
        phaseName: null, roundLabel: null, scheduledDate: null, scheduledTime: null, venue: null,
        settings: { gameMode: mode, minPlayers: 5, maxPlayers: 12, startingPlayers: 5, regulationPeriods: 4, regulationPeriodSeconds: 600, overtimeSeconds: 300, tieAllowed: false, winnerRequired: true },
        officials: { referees: { a: null, b: null, c: null }, table: { timer: null, shotClock: null, scoresheet: null, commissioner: null } },
        home: team("HOME", "A"), away: team("AWAY", "B"),
    };
    const setupSnapshotJson = JSON.stringify(setup);
    const packageHash = createHash("sha256").update(setupSnapshotJson).digest("hex");
    const timestamp = now.toISOString();
    return {
        source: { setup, packageHash, packageSchemaVersion: 1 },
        run: {
            runId: "demo:session:" + randomUUID(), runSchemaVersion: 1, gameId, packageId,
            packageVersion: 1, packageSchemaVersion: 1, packageHash, ...DEMO_OWNER, deviceId: DEMO_DEVICE,
            setupSnapshotJson, status: "active", lastAcceptedSequence: 0, startedAtUtc: null,
            createdAtUtc: timestamp, updatedAtUtc: timestamp,
        },
    };
}
