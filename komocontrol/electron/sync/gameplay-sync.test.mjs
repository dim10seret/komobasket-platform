import { describe, expect, it, vi } from "vitest";
import { GameplaySyncWorker, gameplayHistoryHash } from "../../dist-electron/sync/gameplay-sync.cjs";
import { PlatformAuthClient, PlatformGameplaySyncError } from "../../dist-electron/auth/platform-auth-client.cjs";

function event(runId, sequence) {
    const eventJson = JSON.stringify({ id: `${runId}-event-${sequence}`, schemaVersion: 2, sequence, type: sequence === 1 ? "MATCH_START" : "CLOCK_STOP" });
    return { runId, eventId: `${runId}-event-${sequence}`, sequence, eventSchemaVersion: 2, eventJson, eventHash: "a".repeat(64), persistedAtUtc: "2026-08-26T12:00:00.000Z" };
}

function response(input, status = "accepted") {
    return {
        runId: input.runId,
        acknowledgedHistoryRevision: input.eventHistoryRevision,
        acknowledgedHistoryHash: input.historyHash,
        acknowledgedConfigurationRevision: input.currentConfigurationRevision,
        acknowledgedConfigurationHash: input.currentConfigurationHash,
        acknowledgedFinalizationHash: input.finalization?.finalizationHash ?? null,
        officialResultApplied: false,
        status,
    };
}

function databaseFixture(runIds) {
    const runs = new Map(runIds.map((runId) => [runId, { runId, gameId: `game-${runId}`, packageId: `package-${runId}`, packageVersion: 1, packageHash: "b".repeat(64), organizationId: "organization-1", scorerId: "scorer-1", deviceId: "device-1", startedAtUtc: "2026-08-26T12:00:00.000Z", lastAcceptedSequence: 1 }]));
    const snapshots = new Map(runIds.map((runId) => [runId, { runId, configurationRevision: 1, configurationHash: "c".repeat(64), snapshotSchemaVersion: 1, matchEventSchemaVersion: 2, initialStateJson: "{}", initialStateHash: "d".repeat(64), eventHistoryRevision: 1 }]));
    const configurations = new Map(runIds.map((runId) => [runId, { runId, revision: 2, configurationHash: "e".repeat(64), configurationJson: JSON.stringify({ schemaVersion: 1, runId, gameId: `game-${runId}`, teams: [], presentation: { leftSide: "HOME" } }) }]));
    const syncStates = new Map(runIds.map((runId) => [runId, { runId, lastAcknowledgedHistoryRevision: 0, lastErrorCode: null, consecutiveFailures: 0, nextRetryAtUtc: null }]));
    return {
        readLocalGameRun: (runId) => runs.get(runId) ?? null,
        readLocalMatchEngineSnapshot: (runId) => snapshots.get(runId) ?? null,
        readLocalMatchEvents: (runId) => runs.has(runId) ? [event(runId, 1)] : [],
        readLocalGameRunConfiguration: (runId) => configurations.get(runId) ?? null,
        readLocalGameplaySyncState: (runId) => syncStates.get(runId) ?? null,
        readLocalMatchFinalization: () => null,
        listPendingGameplaySyncRunIds: () => [...runIds],
        markGameplaySyncAttempt: vi.fn(),
        acknowledgeGameplaySync: vi.fn((input) => {
            const current = syncStates.get(input.runId);
            if (current) syncStates.set(input.runId, { ...current, lastAcknowledgedHistoryRevision: input.historyRevision, lastErrorCode: null, consecutiveFailures: 0, nextRetryAtUtc: null });
        }),
        recordGameplaySyncFailure: vi.fn((runId, code, failedAtUtc, retryable) => {
            const current = syncStates.get(runId);
            const next = { ...current, lastErrorCode: code, consecutiveFailures: (current?.consecutiveFailures ?? 0) + 1, nextRetryAtUtc: retryable ? new Date(Date.parse(failedAtUtc) + 5_000).toISOString() : null };
            syncStates.set(runId, next);
            return next;
        }),
    };
}

describe("Run-scoped gameplay synchronization", () => {
    it("coalesces duplicate upload for one Run while allowing three Runs independently", async () => {
        const database = databaseFixture(["run-a", "run-b", "run-c"]);
        const resolvers = new Map();
        const client = { syncGameplay: vi.fn((_token, input) => new Promise((resolve) => resolvers.set(input.runId, () => resolve(response(input))))) };
        const worker = new GameplaySyncWorker(database, client);
        const owner = { scorerId: "scorer-1", organizationId: "organization-1" };
        const first = worker.retry("run-a", "token", owner); const duplicate = worker.retry("run-a", "token", owner); const independentB = worker.retry("run-b", "token", owner); const independentC = worker.retry("run-c", "token", owner);
        expect(client.syncGameplay).toHaveBeenCalledTimes(3);
        resolvers.get("run-a")(); resolvers.get("run-b")(); resolvers.get("run-c")();
        await expect(first).resolves.toMatchObject({ runId: "run-a" }); await expect(duplicate).resolves.toMatchObject({ runId: "run-a" }); await expect(independentB).resolves.toMatchObject({ runId: "run-b" }); await expect(independentC).resolves.toMatchObject({ runId: "run-c" });
        expect(database.acknowledgeGameplaySync).toHaveBeenCalledTimes(3);
    });
    it("keeps SYNC_RUN_CONFLICT terminal while allowing one deduplicated explicit attempt at a time", async () => {
        vi.useFakeTimers();
        try {
            const database = databaseFixture(["run-a"]);
            const eventsBefore = database.readLocalMatchEvents("run-a");
            let rejectFirst;
            const firstConflict = new Promise((_resolve, reject) => { rejectFirst = reject; });
            const client = { syncGameplay: vi.fn()
                .mockImplementationOnce(() => firstConflict)
                .mockRejectedValueOnce(new PlatformGameplaySyncError("SYNC_RUN_CONFLICT"))
                .mockImplementationOnce(async (_token, input) => response(input)) };
            const worker = new GameplaySyncWorker(database, client);
            const owner = { scorerId: "scorer-1", organizationId: "organization-1" };

            const first = worker.retry("run-a", "token", owner);
            const duplicate = worker.retry("run-a", "token", owner);
            expect(client.syncGameplay).toHaveBeenCalledTimes(1);
            rejectFirst(new PlatformGameplaySyncError("SYNC_RUN_CONFLICT"));
            expect((await Promise.allSettled([first, duplicate])).map((item) => item.status)).toEqual(["rejected", "rejected"]);
            expect(database.recordGameplaySyncFailure).toHaveBeenCalledTimes(1);
            expect(database.readLocalGameplaySyncState("run-a")).toMatchObject({
                lastAcknowledgedHistoryRevision: 0,
                lastErrorCode: "SYNC_RUN_CONFLICT",
                consecutiveFailures: 1,
                nextRetryAtUtc: null,
            });
            expect(database.readLocalMatchEvents("run-a")).toEqual(eventsBefore);

            worker.wake("token", owner);
            await vi.advanceTimersByTimeAsync(600_000);
            expect(client.syncGameplay).toHaveBeenCalledTimes(1);

            await expect(worker.retry("run-a", "token", owner)).rejects.toMatchObject({ code: "SYNC_RUN_CONFLICT" });
            expect(client.syncGameplay).toHaveBeenCalledTimes(2);
            expect(database.readLocalGameplaySyncState("run-a")).toMatchObject({ lastErrorCode: "SYNC_RUN_CONFLICT", consecutiveFailures: 2, nextRetryAtUtc: null });

            await expect(worker.retry("run-a", "token", owner)).resolves.toMatchObject({ runId: "run-a", status: "accepted" });
            expect(client.syncGameplay).toHaveBeenCalledTimes(3);
            expect(database.acknowledgeGameplaySync).toHaveBeenCalledOnce();
            expect(database.readLocalGameplaySyncState("run-a")).toMatchObject({ lastAcknowledgedHistoryRevision: 1, lastErrorCode: null, consecutiveFailures: 0, nextRetryAtUtc: null });
            expect(database.readLocalMatchEvents("run-a")).toEqual(eventsBefore);
        } finally {
            vi.useRealTimers();
        }
    });
    it("notifies the renderer after attempt and exact acknowledgement without entering the append path", async () => {
        const database = databaseFixture(["run-a"]); const onStateChange = vi.fn(); const client = { syncGameplay: vi.fn(async (_token, input) => response(input)) };
        const worker = new GameplaySyncWorker(database, client, undefined, onStateChange); await worker.retry("run-a", "token", { scorerId: "scorer-1", organizationId: "organization-1" });
        expect(onStateChange).toHaveBeenNthCalledWith(1, "run-a"); expect(onStateChange).toHaveBeenLastCalledWith("run-a"); expect(database.acknowledgeGameplaySync).toHaveBeenCalledOnce();
    });

    it("hashes exact deterministic event bytes in sequence order", () => {
        const events = [event("run-a", 1), event("run-a", 2)];
        expect(gameplayHistoryHash(events)).toMatch(/^[a-f0-9]{64}$/);
        expect(gameplayHistoryHash(events)).not.toBe(gameplayHistoryHash([...events].reverse()));
    });

    it("uploads the latest pending revision after an in-flight same-Run upload", async () => {
        const database = databaseFixture(["run-a"]);
        let currentRevision = 1;
        let acknowledgedRevision = 0;
        const baseSnapshot = database.readLocalMatchEngineSnapshot("run-a");
        database.readLocalMatchEngineSnapshot = () => ({ ...baseSnapshot, eventHistoryRevision: currentRevision });
        database.listPendingGameplaySyncRunIds = () => acknowledgedRevision < currentRevision ? ["run-a"] : [];
        database.acknowledgeGameplaySync = vi.fn((input) => {
            acknowledgedRevision = input.historyRevision;
        });

        let releaseFirst;
        const client = {
            syncGameplay: vi.fn((_token, input) => {
                const result = response(input);
                if (input.eventHistoryRevision === 1) {
                    return new Promise((resolve) => { releaseFirst = () => resolve(result); });
                }
                return Promise.resolve(result);
            }),
        };
        const worker = new GameplaySyncWorker(database, client);
        const owner = { scorerId: "scorer-1", organizationId: "organization-1" };

        worker.wake("token", owner);
        await vi.waitFor(() => expect(client.syncGameplay).toHaveBeenCalledTimes(1));
        currentRevision = 2;
        worker.wake("token", owner);
        releaseFirst();

        await vi.waitFor(() => expect(client.syncGameplay).toHaveBeenCalledTimes(2));
        expect(client.syncGameplay.mock.calls.map(([, input]) => input.eventHistoryRevision)).toEqual([1, 2]);
        expect(acknowledgedRevision).toBe(2);
    });

    it("isolates one Run failure and allows an independent Run to sync and retry", async () => {
        const database = databaseFixture(["run-a", "run-b"]);
        const client = { syncGameplay: vi.fn()
            .mockImplementationOnce(async () => { throw Object.assign(new Error("offline"), { code: "NETWORK_UNAVAILABLE" }); })
            .mockImplementationOnce(async (_token, input) => response(input))
            .mockImplementationOnce(async (_token, input) => response(input, "idempotent")) };
        const worker = new GameplaySyncWorker(database, client);
        const owner = { scorerId: "scorer-1", organizationId: "organization-1" };

        const [failed, independent] = await Promise.allSettled([worker.retry("run-a", "token", owner), worker.retry("run-b", "token", owner)]);
        expect(failed.status).toBe("rejected"); expect(independent.status).toBe("fulfilled"); expect(database.recordGameplaySyncFailure).toHaveBeenCalledTimes(1); expect(database.acknowledgeGameplaySync).toHaveBeenCalledTimes(1);
        await expect(worker.retry("run-a", "token", owner)).resolves.toMatchObject({ runId: "run-a", status: "idempotent" });
        expect(database.acknowledgeGameplaySync).toHaveBeenCalledTimes(2);
    });

    it("rejects a non-exact ACK without acknowledging or recursively retrying", async () => {
        vi.useFakeTimers();
        try {
            const database = databaseFixture(["run-a"]);
            const client = { syncGameplay: vi.fn(async (_token, input) => ({ ...response(input), acknowledgedConfigurationHash: "f".repeat(64) })) };
            const worker = new GameplaySyncWorker(database, client);
            await expect(worker.retry("run-a", "token", { scorerId: "scorer-1", organizationId: "organization-1" })).rejects.toMatchObject({ code: "SYNC_INTEGRITY_CONFLICT" });
            expect(database.acknowledgeGameplaySync).not.toHaveBeenCalled();
            expect(database.recordGameplaySyncFailure).toHaveBeenCalledWith("run-a", "SYNC_INTEGRITY_CONFLICT", expect.any(String), false);
            await vi.advanceTimersByTimeAsync(600_000);
            expect(client.syncGameplay).toHaveBeenCalledTimes(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it("honors the persisted retry deadline and performs no immediate failure recursion", async () => {
        vi.useFakeTimers();
        try {
            const database = databaseFixture(["run-a"]);
            const client = { syncGameplay: vi.fn(async () => { throw Object.assign(new Error("offline"), { code: "NETWORK_UNAVAILABLE" }); }) };
            const worker = new GameplaySyncWorker(database, client, () => new Date(Date.now()));
            worker.wake("token", { scorerId: "scorer-1", organizationId: "organization-1" });
            await vi.waitFor(() => expect(client.syncGameplay).toHaveBeenCalledTimes(1));
            worker.wake("token", { scorerId: "scorer-1", organizationId: "organization-1" });
            await vi.advanceTimersByTimeAsync(4_999);
            expect(client.syncGameplay).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            await vi.waitFor(() => expect(client.syncGameplay).toHaveBeenCalledTimes(2));
        } finally {
            vi.useRealTimers();
        }
    });

    it.each(["live", "finalized"])("resumes an auth-paused %s Run only after owner-bound re-authentication", async (lifecycle) => {
        const database = databaseFixture(["run-a"]);
        const originalRun = database.readLocalGameRun("run-a");
        database.readLocalGameRun = () => ({ ...originalRun, status: lifecycle === "finalized" ? "finalized" : "active" });
        if (lifecycle === "finalized") {
            database.readLocalMatchFinalization = () => ({ runId: "run-a", finalizationSchemaVersion: 1, finalizedHistoryRevision: 1, finalizedHistoryHash: "f".repeat(64), finalStateJson: "{}", finalStateHash: "a".repeat(64), finalizationJson: '{"incidentReport":"Ελληνική αναφορά\\nδεύτερη γραμμή"}', finalizationHash: "9".repeat(64), finalizedAtUtc: "2026-08-26T12:10:00.000Z" });
        }
        database.listPendingGameplaySyncRunIds = () => database.readLocalGameplaySyncState("run-a").lastAcknowledgedHistoryRevision < 1 ? ["run-a"] : [];
        const localEventsBefore = database.readLocalMatchEvents("run-a");
        let attempts = 0;
        const client = { syncGameplay: vi.fn(async (_token, input) => {
            attempts += 1;
            if (attempts === 1) throw new PlatformGameplaySyncError("SYNC_AUTH");
            return response(input);
        }) };
        const worker = new GameplaySyncWorker(database, client);
        const owner = { scorerId: "scorer-1", organizationId: "organization-1" };

        worker.wake("expired-token", owner);
        await vi.waitFor(() => expect(database.recordGameplaySyncFailure).toHaveBeenCalledWith("run-a", "SYNC_AUTH", expect.any(String), false));
        expect(database.readLocalMatchEvents("run-a")).toEqual(localEventsBefore);
        worker.wake("expired-token", owner);
        await Promise.resolve();
        expect(client.syncGameplay).toHaveBeenCalledTimes(1);

        worker.wake("fresh-token", owner, true);
        await vi.waitFor(() => expect(database.acknowledgeGameplaySync).toHaveBeenCalledOnce());
        expect(client.syncGameplay).toHaveBeenCalledTimes(2);
        if (lifecycle === "finalized") {
            expect(client.syncGameplay.mock.calls[1][1].finalization).toEqual(client.syncGameplay.mock.calls[0][1].finalization);
            expect(client.syncGameplay.mock.calls[1][1].finalization.finalizationJson).toBe('{"incidentReport":"Ελληνική αναφορά\\nδεύτερη γραμμή"}');
        }
        expect(database.readLocalGameplaySyncState("run-a")).toMatchObject({ lastAcknowledgedHistoryRevision: 1, lastErrorCode: null, consecutiveFailures: 0, nextRetryAtUtc: null });
        expect(database.readLocalMatchEvents("run-a")).toEqual(localEventsBefore);
    });

    it.each([408, 425, 429])("retries transient HTTP %i through bounded Run-scoped scheduling", async (status) => {
        vi.useFakeTimers();
        try {
            const database = databaseFixture(["run-a"]);
            database.listPendingGameplaySyncRunIds = () => database.readLocalGameplaySyncState("run-a").lastAcknowledgedHistoryRevision < 1 ? ["run-a"] : [];
            let resolveFailure; const failureRecorded = new Promise((resolve) => { resolveFailure = resolve; }); const recordFailure = database.recordGameplaySyncFailure; database.recordGameplaySyncFailure = vi.fn((...args) => { const state = recordFailure(...args); resolveFailure(); return state; });
            let calls = 0;
            const fetcher = vi.fn(async (_url, init) => {
                calls += 1;
                const input = JSON.parse(String(init.body));
                if (calls === 1) return new Response(JSON.stringify({ error: { code: "TRANSIENT" } }), { status, headers: { "content-type": "application/json" } });
                return new Response(JSON.stringify({ data: response(input) }), { status: 200, headers: { "content-type": "application/json" } });
            });
            const worker = new GameplaySyncWorker(database, new PlatformAuthClient("https://platform.test", 10_000, fetcher), () => new Date(Date.now()));
            worker.wake("token", { scorerId: "scorer-1", organizationId: "organization-1" });
            await failureRecorded; expect(database.recordGameplaySyncFailure).toHaveBeenCalledWith("run-a", "SYNC_UNAVAILABLE", expect.any(String), true);
            expect(fetcher).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(4_999);
            expect(fetcher).toHaveBeenCalledTimes(1);
            await vi.advanceTimersByTimeAsync(1);
            await vi.waitFor(() => expect(database.acknowledgeGameplaySync).toHaveBeenCalledOnce());
            expect(fetcher).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it("coalesces rapid same-Run queue requests without blocking another Run", async () => {
        vi.useFakeTimers();
        try {
            const database = databaseFixture(["run-a", "run-b"]);
            database.listPendingGameplaySyncRunIds = () => ["run-a", "run-b"].filter((runId) => database.readLocalGameplaySyncState(runId).lastAcknowledgedHistoryRevision < 1);
            const client = { syncGameplay: vi.fn(async (_token, input) => response(input)) };
            const worker = new GameplaySyncWorker(database, client);
            const owner = { scorerId: "scorer-1", organizationId: "organization-1" };
            worker.queue("run-a", "token", owner);
            worker.queue("run-a", "token", owner);
            worker.queue("run-a", "token", owner);
            worker.queue("run-b", "token", owner);
            expect(client.syncGameplay).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(299);
            expect(client.syncGameplay).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            await Promise.resolve();
            await Promise.resolve();
            expect(client.syncGameplay).toHaveBeenCalledTimes(2);
            expect(client.syncGameplay.mock.calls.map((call) => call[1].runId).sort()).toEqual(["run-a", "run-b"]);
        } finally {
            vi.useRealTimers();
        }
    });
});
