import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { myGamesPresentation, runMatchStartOnce, sortMyGamesByRunState, subscribeToMyGamesSyncState } from "./App";

type TestStartResult = { ok: true; gameplay: string } | { ok: false; errorCode: string };

describe("Start Game single-flight and recovery", () => {
    it("submits the first request once and ignores a rapid second request while pending", async () => {
        let release!: (result: TestStartResult) => void;
        const pendingResult = new Promise<TestStartResult>((resolve) => { release = resolve; });
        const calls: string[] = [];
        const bridge = { startMatch: async (runId: string) => { calls.push(runId); return pendingResult; }, recoverMatchGameplay: async (): Promise<TestStartResult> => ({ ok: false, errorCode: "unused" }) };
        const guard = { current: false };
        const first = runMatchStartOnce(bridge, "run-1", guard);
        const second = await runMatchStartOnce(bridge, "run-1", guard);
        expect(second).toBeNull(); expect(guard.current).toBe(true); expect(calls).toEqual(["run-1"]);
        release({ ok: true, gameplay: "live" });
        await expect(first).resolves.toEqual({ result: { ok: true, gameplay: "live" }, recovered: false });
        expect(guard.current).toBe(false);
    });

    it("recovers only the same requested Run when Start reports GAMEPLAY_CONFLICT", async () => {
        const startIds: string[] = []; const recoveryIds: string[] = [];
        const bridge = { startMatch: async (runId: string): Promise<TestStartResult> => { startIds.push(runId); return { ok: false, errorCode: "GAMEPLAY_CONFLICT" }; }, recoverMatchGameplay: async (runId: string): Promise<TestStartResult> => { recoveryIds.push(runId); return { ok: true, gameplay: "recovered-live" }; } };
        await expect(runMatchStartOnce(bridge, "run-same", { current: false })).resolves.toEqual({ result: { ok: true, gameplay: "recovered-live" }, recovered: true });
        expect(startIds).toEqual(["run-same"]); expect(recoveryIds).toEqual(["run-same"]);
    });

    it("keeps a real conflict as failure when authoritative same-Run recovery fails", async () => {
        const bridge = { startMatch: async (): Promise<TestStartResult> => ({ ok: false, errorCode: "GAMEPLAY_CONFLICT" }), recoverMatchGameplay: async (): Promise<TestStartResult> => ({ ok: false, errorCode: "GAMEPLAY_UNAVAILABLE" }) };
        await expect(runMatchStartOnce(bridge, "run-1", { current: false })).resolves.toEqual({ result: { ok: false, errorCode: "GAMEPLAY_CONFLICT" }, recovered: false });
    });

    it("commits successful gameplay and clears the pre-game view so LiveControl wins render precedence", () => {
        const source = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
        expect(source).toMatch(/if \(result\.ok\) \{ setMatchGameplay\(result\.gameplay\); setPreGameConfiguration\(null\);/);
        expect(source).toContain("startPending={gameplayBusy}");
    });
});

const state = (syncStatus: KomoControlMyGamesRunSyncStatus, overrides: Partial<KomoControlMyGamesRunState> = {}): KomoControlMyGamesRunState => ({
    gameId: "game-1", runId: "run-1", lifecycle: syncStatus === "active" ? "active" : "finalized", historyRevision: 926,
    acknowledgedHistoryRevision: syncStatus === "completed" ? 926 : 925, finalizationHash: "f".repeat(64),
    acknowledgedFinalizationHash: syncStatus === "completed" ? "f".repeat(64) : null, syncStatus, homeScore: syncStatus === "completed" ? 105 : null,
    awayScore: syncStatus === "completed" ? 103 : null, ...overrides,
});

describe("My Games background sync notifications", () => {
    const catalogue = (syncStatus: KomoControlMyGamesRunSyncStatus): KomoControlMyGamesRunStateCatalogueResult => ({
        ok: true, runs: [state(syncStatus)], state: {} as KomoControlAuthState,
    });
    function fixture() {
        const listeners = new Set<(runId: string) => void>();
        const unsubscribe = vi.fn(() => listeners.clear());
        const bridge = {
            onGameplaySyncStateChanged: vi.fn((listener: (runId: string) => void) => { listeners.add(listener); return unsubscribe; }),
            listMyGamesRunStates: vi.fn(async () => catalogue("completed")),
            createOrOpenGameRun: vi.fn(), retryGameplaySync: vi.fn(), reconnectGameplaySync: vi.fn(), listAvailableGames: vi.fn(),
        };
        return { bridge, listeners, unsubscribe, notify: () => listeners.forEach((listener) => listener("run-1")) };
    }

    it.each(["pending", "retry-needed"] as const)("refreshes a %s card after acknowledgement without creating a Run or initiating Sync", async (initial) => {
        const { bridge, notify, listeners } = fixture();
        let runs: Record<string, KomoControlMyGamesRunState> = { "game-1": state(initial) };
        const onError = vi.fn();
        const cleanup = subscribeToMyGamesSyncState(bridge, (next) => { runs = next; }, onError);
        expect(myGamesPresentation(runs["game-1"])).toBe(initial);
        expect(bridge.listMyGamesRunStates).not.toHaveBeenCalled();
        notify();
        await vi.waitFor(() => expect(myGamesPresentation(runs["game-1"])).toBe("completed"));
        expect(runs["game-1"].homeScore).toBe(105);
        expect(bridge.listMyGamesRunStates).toHaveBeenCalledTimes(1);
        expect(bridge.createOrOpenGameRun).not.toHaveBeenCalled();
        expect(bridge.retryGameplaySync).not.toHaveBeenCalled();
        expect(bridge.reconnectGameplaySync).not.toHaveBeenCalled();
        expect(bridge.listAvailableGames).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(listeners.size).toBe(1);
        cleanup();
    });

    it("keeps one subscription across state updates and removes it on unmount", async () => {
        const { bridge, notify, listeners, unsubscribe } = fixture();
        const onRuns = vi.fn();
        const cleanup = subscribeToMyGamesSyncState(bridge, onRuns, vi.fn());
        notify();
        await vi.waitFor(() => expect(onRuns).toHaveBeenCalledTimes(1));
        notify();
        await vi.waitFor(() => expect(onRuns).toHaveBeenCalledTimes(2));
        expect(bridge.onGameplaySyncStateChanged).toHaveBeenCalledTimes(1);
        cleanup();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
        expect(listeners.size).toBe(0);
        notify();
        expect(bridge.listMyGamesRunStates).toHaveBeenCalledTimes(2);
        const source = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
        expect(source).toMatch(/useEffect\(\(\) => \{\s*if \(!bridge\) return;\s*return subscribeToMyGamesSyncState\(bridge, setMyGamesRuns, setGamesError\);\s*\}, \[bridge\]\);/);
    });

    it("ignores a read that completes after unmount", async () => {
        const { bridge, notify } = fixture();
        let resolve!: (result: KomoControlMyGamesRunStateCatalogueResult) => void;
        const pending = new Promise<KomoControlMyGamesRunStateCatalogueResult>((done) => { resolve = done; });
        bridge.listMyGamesRunStates.mockReturnValueOnce(pending);
        const onRuns = vi.fn(); const onError = vi.fn();
        const cleanup = subscribeToMyGamesSyncState(bridge, onRuns, onError);
        notify(); cleanup(); resolve(catalogue("completed"));
        await pending;
        expect(onRuns).not.toHaveBeenCalled(); expect(onError).not.toHaveBeenCalled();
    });

    it("does not overwrite a newer acknowledgement with an older read", async () => {
        const { bridge, notify } = fixture();
        let resolve!: (result: KomoControlMyGamesRunStateCatalogueResult) => void;
        const older = new Promise<KomoControlMyGamesRunStateCatalogueResult>((done) => { resolve = done; });
        bridge.listMyGamesRunStates.mockReturnValueOnce(older);
        const onRuns = vi.fn();
        const cleanup = subscribeToMyGamesSyncState(bridge, onRuns, vi.fn());
        notify(); notify();
        await vi.waitFor(() => expect(onRuns).toHaveBeenCalledTimes(1));
        resolve(catalogue("retry-needed")); await older;
        expect(onRuns).toHaveBeenCalledTimes(1);
        expect(onRuns.mock.calls[0][0]["game-1"].syncStatus).toBe("completed");
        cleanup();
    });

    it("reports a failed read without inventing completion or retrying Sync", async () => {
        const { bridge, notify } = fixture();
        bridge.listMyGamesRunStates.mockRejectedValueOnce(new Error("read unavailable"));
        const onRuns = vi.fn(); const onError = vi.fn();
        const cleanup = subscribeToMyGamesSyncState(bridge, onRuns, onError);
        notify();
        await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
        expect(onRuns).not.toHaveBeenCalled();
        expect(bridge.retryGameplaySync).not.toHaveBeenCalled();
        cleanup();
    });
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

    it("gives LIVE Run matchups the flexible card width without desktop word wrapping", () => {
        const source = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
        const styles = fs.readFileSync(new URL("./styles/global.css", import.meta.url), "utf8");
        expect(source).toContain('className="game-card live-run-card"');
        expect(styles).toContain(".live-run-card { grid-template-columns: minmax(0, 1fr) auto; }");
        expect(styles).toContain(".live-run-card .game-main h3 { overflow-wrap: normal; white-space: nowrap; }");
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
