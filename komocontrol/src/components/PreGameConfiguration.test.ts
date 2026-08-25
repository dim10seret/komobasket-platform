import { describe, expect, it } from "vitest";
import { authoritativeTeamIndex, compactRosterView, configurationDisplayStatus, customColorLabel, displayedTeamSides, oppositeSide, playerTableColumns, rosterNeedsFilter, rosterView, savedDraftConfirmationVisible, teamAccentStyle, teamColorLabel, teamColorPresets, withPlayerParticipation } from "./PreGameConfiguration";

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

describe("KC-5B9B Gate 1C presentation helpers", () => {
    const players = Array.from({ length: 13 }, (_, index) => ({ playerId: `compact-${index + 1}`, displayName: `Compact Player ${index + 1}`, packageShirtNumber: index + 1 }));
    const draftPlayers = players.map((player, index) => ({ playerId: player.playerId, participating: index === 10, gameShirtNumber: String(index + 1) }));
    const emptyFilter = { query: "", participantsOnly: false };

    it("shows every roster row when the team has no more than eight players", () => {
        const view = compactRosterView(players.slice(0, 8), draftPlayers.slice(0, 8), emptyFilter, false);
        expect(view.players).toHaveLength(8); expect(view.collapsible).toBe(false);
    });

    it("collapses ordinary rosters to eight and reports selected players hidden by presentation", () => {
        const view = compactRosterView(players, draftPlayers, emptyFilter, false);
        expect(view.players).toEqual(players.slice(0, 8)); expect(view.hiddenSelected).toBe(1); expect(view.collapsible).toBe(true);
    });

    it("expands without changing participant, number, captain, or starter source state", () => {
        const before = JSON.stringify(draftPlayers); const view = compactRosterView(players, draftPlayers, emptyFilter, true);
        expect(view.players).toEqual(players); expect(view.hiddenSelected).toBe(0); expect(JSON.stringify(draftPlayers)).toBe(before);
    });

    it("keeps the compact player columns free of a redundant Player role", () => {
        expect(playerTableColumns).toEqual(["#", "ΠΑΙΚΤΗΣ", "ΚΑΤΑΣΤΑΣΗ", "ΑΡ.", "C", "STARTER"]); expect(playerTableColumns).not.toContain("ΚΑΠ."); expect(playerTableColumns).not.toContain("ΡΟΛΟΣ");
    });

    it("uses the scorer-facing team-color terminology and a balanced 12-color palette while preserving Custom", () => {
        expect(teamColorLabel).toBe("Χρώμα ομάδας"); expect(teamColorLabel).not.toBe("Χρώμα αγώνα"); expect(teamColorPresets).toHaveLength(12); expect(new Set(teamColorPresets).size).toBe(12); expect(teamColorPresets).toContain("#F8FAFC"); expect(customColorLabel).toBe("Custom");
    });

    it("moves each authoritative team's own accent when presentation sides swap", () => {
        const accents = { HOME: teamAccentStyle("#DC2626"), AWAY: teamAccentStyle("#15803D") }; const order = displayedTeamSides("AWAY");
        expect(order.map((side) => accents[side]["--team-accent"])).toEqual(["#15803D", "#DC2626"]); expect(authoritativeTeamIndex(order[0])).toBe(1); expect(authoritativeTeamIndex(order[1])).toBe(0);
    });

    it("derives revision and saved state from the current configuration state", () => {
        expect(configurationDisplayStatus(9, false)).toEqual({ revision: 9, phase: "DRAFT", savedLabel: "Αποθηκευμένο" }); expect(configurationDisplayStatus(10, true).savedLabel).toBe("Μη αποθηκευμένο");
    });
});
