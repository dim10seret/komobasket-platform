import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { myGamesPresentation, sortMyGamesByRunState } from "./App";

const state = (syncStatus: KomoControlMyGamesRunSyncStatus, overrides: Partial<KomoControlMyGamesRunState> = {}): KomoControlMyGamesRunState => ({
    gameId: "game-1", runId: "run-1", lifecycle: syncStatus === "active" ? "active" : "finalized", historyRevision: 926,
    acknowledgedHistoryRevision: syncStatus === "completed" ? 926 : 925, finalizationHash: "f".repeat(64),
    acknowledgedFinalizationHash: syncStatus === "completed" ? "f".repeat(64) : null, syncStatus, homeScore: syncStatus === "completed" ? 105 : null,
    awayScore: syncStatus === "completed" ? 103 : null, ...overrides,
});

describe("My Games completion presentation", () => {
    it("uses the standardized visible creator signature in the KomoControl footer", () => {
        const source = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
        expect(source).toContain("Created by: D. Seretidis");
        expect(source).not.toContain("Creator: D. Seretidis");
    });

    it.each([
        [undefined, "upcoming"], [state("active"), "active"], [state("pending"), "pending"], [state("retry-needed"), "retry-needed"],
        [state("conflict"), "conflict"], [state("completed"), "completed"],
    ])("maps the authoritative local read model without inventing completion", (input, expected) => expect(myGamesPresentation(input)).toBe(expected));

    it("renders acknowledged completion, verified score, pending/retry/conflict and active actions", () => {
        const source = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
        expect(source).toContain("ΟΛΟΚΛΗΡΩΜΕΝΟΣ ✓"); expect(source).toContain("run.homeScore"); expect(source).toContain("run.awayScore");
        expect(source).toContain("ΟΛΟΚΛΗΡΩΘΗΚΕ ΤΟΠΙΚΑ"); expect(source).toContain("ΕΚΚΡΕΜΕΙ ΑΠΟΣΤΟΛΗ"); expect(source).toContain("ΝΕΑ ΠΡΟΣΠΑΘΕΙΑ");
        expect(source).toContain("SYNC CONFLICT"); expect(source).toContain("Άνοιγμα LIVE Run");
    });

    it("reloads both available games and local completion state after returning from LiveControl", () => {
        const source = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
        expect(source).toContain("bridge.listMyGamesRunStates()");
        expect(source).toMatch(/async function returnToMyGames\(\).*await loadGames\(\).*await loadLocalRuns\(\)/s);
        expect(source).toContain("onBack={() => void returnToMyGames()}");
    });

    it("sorts active, upcoming, finalized-actionable, and completed while preserving each group's original order", () => {
        const games = ["completed-a", "upcoming-a", "pending-a", "active-a", "completed-b", "upcoming-b", "retry-a", "conflict-a", "active-b"].map((gameId) => ({ gameId }));
        const runs: Record<string, KomoControlMyGamesRunState> = {
            "completed-a": state("completed", { gameId: "completed-a" }), "completed-b": state("completed", { gameId: "completed-b" }),
            "pending-a": state("pending", { gameId: "pending-a" }), "retry-a": state("retry-needed", { gameId: "retry-a" }),
            "conflict-a": state("conflict", { gameId: "conflict-a" }), "active-a": state("active", { gameId: "active-a" }),
            "active-b": state("active", { gameId: "active-b" }),
        };
        expect(sortMyGamesByRunState(games, runs).map((game) => game.gameId)).toEqual([
            "active-a", "active-b", "upcoming-a", "upcoming-b", "pending-a", "retry-a", "conflict-a", "completed-a", "completed-b",
        ]);
    });

    it("moves a completed game below upcoming and finalized-pending cards without mutating the source order", () => {
        const games = [{ gameId: "completed" }, { gameId: "upcoming" }, { gameId: "pending" }];
        const original = [...games];
        expect(sortMyGamesByRunState(games, { completed: state("completed", { gameId: "completed" }), pending: state("pending", { gameId: "pending" }) }).map((game) => game.gameId)).toEqual(["upcoming", "pending", "completed"]);
        expect(games).toEqual(original);
    });
});
