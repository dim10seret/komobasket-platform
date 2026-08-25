import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MatchSetupManager } from "../../dist-electron/games/match-setup.cjs";

const gameId = "game-1";
function payload(overrides = {}) { return { schemaVersion: 1, game: { id: gameId, organizationId: "organization-1", competitionId: "competition-1", competitionName: "Competition", seasonName: "2026-27", phaseName: null, roundLabel: "1η Αγωνιστική", scheduledDate: "2026-08-25", scheduledTime: "19:00", scheduledAt: null, venue: "" }, settings: { game_mode: "FULL", min_players: 5, max_players: 12, starting_players: 5, regulation_periods: 4, regulation_period_seconds: 600, overtime_seconds: 300, tie_allowed: false, winner_required: true }, teams: [{ side: "AWAY", id: "away", name: "Away", logoUrl: null, players: [{ id: "a2", displayName: "Zed", photoUrl: null, shirtNumber: null }, { id: "a1", displayName: "Alpha", photoUrl: null, shirtNumber: 4 }], staff: [] }, { side: "HOME", id: "home", name: "Home", logoUrl: null, players: [{ id: "h2", displayName: "Beta", photoUrl: null, shirtNumber: 10 }, { id: "h1", displayName: "Alpha", photoUrl: null, shirtNumber: 7 }], staff: [{ id: "staff-1", displayName: "Coach", role: "COACH", roleLabel: null }] }], ...overrides }; }
function stored(value = payload(), overrides = {}) { const payloadJson = typeof value === "string" ? value : JSON.stringify(value); return { packageId: "package-2", gameId, packageVersion: 2, packageSchemaVersion: 1, payloadJson, payloadHash: createHash("sha256").update(payloadJson, "utf8").digest("hex"), publishedAtUtc: "2026-08-25T10:00:00.000Z", downloadedAtUtc: "2026-08-25T11:00:00.000Z", ...overrides }; }
function manager(row) { return new MatchSetupManager({ readCurrentGamePackage: () => row }); }

describe("MatchSetupManager", () => {
    it("builds a safe setup from the current local package", () => expect(manager(stored()).getMatchSetup(gameId).packageVersion).toBe(2));
    it("resolves HOME and AWAY by side rather than array order", () => expect(manager(stored()).getMatchSetup(gameId).home.teamId).toBe("home"));
    it("sorts numbered players before unnumbered players", () => expect(manager(stored()).getMatchSetup(gameId).away.players.map((player) => player.playerId)).toEqual(["a1", "a2"]));
    it("sorts shirt numbers ascending", () => expect(manager(stored()).getMatchSetup(gameId).home.players.map((player) => player.shirtNumber)).toEqual([7, 10]));
    it("keeps an empty staff snapshot valid", () => expect(manager(stored()).getMatchSetup(gameId).away.staff).toEqual([]));
    it("keeps nullable media values", () => expect(manager(stored()).getMatchSetup(gameId).home.logoUrl).toBeNull());
    it("does not expose payload or hash in the DTO", () => expect(JSON.stringify(manager(stored()).getMatchSetup(gameId))).not.toMatch(/payload|hash/i));
    it("rejects a missing local package", () => expect(() => manager(null).getMatchSetup(gameId)).toThrowError(expect.objectContaining({ code: "PACKAGE_UNAVAILABLE" })));
    it("rejects an unsupported local schema", () => expect(() => manager(stored(payload(), { packageSchemaVersion: 2 })).getMatchSetup(gameId)).toThrowError(expect.objectContaining({ code: "PACKAGE_UNSUPPORTED" })));
    it("rejects a hash mismatch", () => expect(() => manager(stored(payload(), { payloadHash: "0".repeat(64) })).getMatchSetup(gameId)).toThrowError(expect.objectContaining({ code: "PACKAGE_HASH_MISMATCH" })));
    it("rejects malformed JSON after exact-byte hashing", () => expect(() => manager(stored("{")).getMatchSetup(gameId)).toThrowError(expect.objectContaining({ code: "PACKAGE_INVALID" })));
    it("rejects a game identity mismatch", () => { const value = payload(); value.game = { ...value.game, id: "other" }; expect(() => manager(stored(value)).getMatchSetup(gameId)).toThrowError(expect.objectContaining({ code: "PACKAGE_INVALID" })); });
    it("rejects duplicate HOME sides", () => { const value = payload(); value.teams = value.teams.map((team) => ({ ...team, side: "HOME" })); expect(() => manager(stored(value)).getMatchSetup(gameId)).toThrowError(expect.objectContaining({ code: "PACKAGE_INVALID" })); });
    it("does not mutate stored roster order", () => { const value = payload(); const original = value.teams[1].players.map((player) => player.id); manager(stored(value)).getMatchSetup(gameId); expect(value.teams[1].players.map((player) => player.id)).toEqual(original); });
});
