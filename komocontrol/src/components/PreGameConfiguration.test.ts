import { describe, expect, it } from "vitest";
import { displayedTeamSides, oppositeSide, rosterNeedsFilter, rosterView, savedDraftConfirmationVisible, withPlayerParticipation } from "./PreGameConfiguration";

describe("KC-5B9A Save Draft feedback", () => {
    it("shows confirmation only for the clean revision returned by a successful Save", () => {
        expect(savedDraftConfirmationVisible(2, 2, false)).toBe(true);
        expect(savedDraftConfirmationVisible(2, 2, true)).toBe(false);
        expect(savedDraftConfirmationVisible(2, 1, false)).toBe(false);
        expect(savedDraftConfirmationVisible(2, null, false)).toBe(false);
    });
});

describe("KC-5B9B draft interaction helpers", () => {
    const team: KomoControlPreGameConfigurationTeamDraft = {
        side: "HOME",
        players: [{ playerId: "player-1", participating: true, gameShirtNumber: "00" }],
        staff: [],
        extraBench: [],
        captainPlayerId: "player-1",
        starterPlayerIds: ["player-1"],
        gameColor: "#1D4ED8",
    };

    it("clears captain and starter when a participant is removed", () => {
        expect(withPlayerParticipation(team, "player-1", false)).toMatchObject({ captainPlayerId: null, starterPlayerIds: [], players: [{ participating: false }] });
    });

    it("derives RIGHT from LEFT without changing HOME/AWAY identity", () => {
        expect(oppositeSide("HOME")).toBe("AWAY");
        expect(oppositeSide("AWAY")).toBe("HOME");
    });
});

describe("KC-5B9B Gate 1B roster presentation", () => {
    const players = Array.from({ length: 25 }, (_, index) => ({
        playerId: `player-${index + 1}`,
        displayName: index === 23 ? "Μακρινός Παίκτης" : `Player ${index + 1}`,
        packageShirtNumber: index === 22 ? 77 : null,
    }));
    const draftPlayers = players.map((player, index) => ({ playerId: player.playerId, participating: index === 24, gameShirtNumber: index === 24 ? "88" : null }));

    it("shows every player without filter controls for rosters up to 20", () => {
        expect(rosterNeedsFilter(20)).toBe(false);
        expect(rosterView(players.slice(0, 20), draftPlayers.slice(0, 20), { query: "", participantsOnly: false }).players).toHaveLength(20);
    });

    it("defaults large rosters to the first 20 and reports hidden selections", () => {
        const view = rosterView(players, draftPlayers, { query: "", participantsOnly: false });
        expect(rosterNeedsFilter(players.length)).toBe(true);
        expect(view.players.map((player) => player.playerId)).toEqual(players.slice(0, 20).map((player) => player.playerId));
        expect(view.hiddenSelected).toBe(1);
    });

    it("searches the full roster by name, effective number, and Package number", () => {
        expect(rosterView(players, draftPlayers, { query: "μακρινός", participantsOnly: false }).players.map((player) => player.playerId)).toEqual(["player-24"]);
        expect(rosterView(players, draftPlayers, { query: "88", participantsOnly: false }).players.map((player) => player.playerId)).toEqual(["player-25"]);
        expect(rosterView(players, draftPlayers, { query: "77", participantsOnly: false }).players.map((player) => player.playerId)).toEqual(["player-23"]);
    });

    it("shows participants beyond the first 20 without mutating selection and clears back to the default view", () => {
        const selected = rosterView(players, draftPlayers, { query: "", participantsOnly: true });
        expect(selected.players.map((player) => player.playerId)).toEqual(["player-25"]);
        expect(selected.hiddenSelected).toBe(0);
        expect(draftPlayers[24]).toMatchObject({ participating: true, gameShirtNumber: "88" });
        expect(rosterView(players, draftPlayers, { query: "", participantsOnly: false }).players).toEqual(players.slice(0, 20));
    });

    it("keeps HOME/AWAY filter identity when LEFT/RIGHT presentation swaps", () => {
        const filters = { HOME: { query: "home", participantsOnly: false }, AWAY: { query: "away", participantsOnly: true } };
        expect(displayedTeamSides("AWAY").map((side) => filters[side])).toEqual([filters.AWAY, filters.HOME]);
    });
});
