import {
    LocalDatabase,
    type StoredLocalGameRun,
    type StoredLocalMatchEvent,
} from "../persistence/local-database.cjs";
import {
    PlatformAuthClient,
    PlatformGameplaySyncError,
    type GameplaySyncRequest,
    type GameplaySyncResponse,
} from "../auth/platform-auth-client.cjs";
import { deterministicJson, sha256JsonBytes } from "../runs/match-engine-bootstrap.cjs";

export interface GameplaySyncOwner {
    organizationId: string;
    scorerId: string;
}

type Timer = ReturnType<typeof setTimeout>;

function historyHash(events: StoredLocalMatchEvent[]): string {
    return sha256JsonBytes(`[${events.map((event) => event.eventJson).join(",")}]`);
}

function syncErrorCode(error: unknown): string {
    if (error instanceof PlatformGameplaySyncError) return error.code;
    if (error !== null && typeof error === "object" && "code" in error) {
        const code = Reflect.get(error, "code");
        if (code === "NETWORK_UNAVAILABLE") return "SYNC_UNAVAILABLE";
        if (typeof code === "string" && code.length <= 80) return code;
    }
    return "SYNC_UNAVAILABLE";
}
function storedErrorCode(value: string | null): string | null {
    if (!value?.startsWith("SYNC_PENDING_CONFIGURATION")) return value;
    return value === "SYNC_PENDING_CONFIGURATION" ? null : value.slice("SYNC_PENDING_CONFIGURATION_".length);
}
function retryableSyncError(code: string): boolean {
    return code === "SYNC_UNAVAILABLE";
}
function terminalSyncError(code: string | null): boolean {
    return code !== null && !retryableSyncError(code);
}

export class GameplaySyncWorker {
    private readonly inFlight = new Map<string, Promise<GameplaySyncResponse>>();
    private readonly timers = new Map<string, Timer>();
    private token: string | null = null;
    private owner: GameplaySyncOwner | null = null;

    constructor(
        private readonly database: LocalDatabase,
        private readonly client: PlatformAuthClient,
        private readonly now: () => Date = () => new Date(),
    ) {}

    wake(token: string, owner: GameplaySyncOwner, resumeAuthPaused = false): void {
        this.token = token;
        this.owner = owner;
        const runIds = this.database.listPendingGameplaySyncRunIds(owner.organizationId, owner.scorerId);
        for (const runId of runIds) this.resume(runId, token, owner, resumeAuthPaused);
    }

    pause(): void {
        this.token = null;
        this.owner = null;
        for (const timer of this.timers.values()) clearTimeout(timer);
        this.timers.clear();
    }

    async retry(runId: string, token: string, owner: GameplaySyncOwner): Promise<GameplaySyncResponse> {
        const timer = this.timers.get(runId);
        if (timer) clearTimeout(timer);
        this.timers.delete(runId);
        return this.upload(runId, token, owner);
    }

    private upload(runId: string, token: string, owner: GameplaySyncOwner, followLatest = false): Promise<GameplaySyncResponse> {
        const existing = this.inFlight.get(runId);
        if (existing) return existing;
        const operation = this.performUpload(runId, token, owner);
        this.inFlight.set(runId, operation);
        void operation.then(() => {
            this.inFlight.delete(runId);
            if (followLatest && this.token === token && this.owner?.scorerId === owner.scorerId && this.owner.organizationId === owner.organizationId
                && this.database.listPendingGameplaySyncRunIds(owner.organizationId, owner.scorerId).includes(runId)) {
                this.resume(runId, token, owner);
            }
        }, () => {
            this.inFlight.delete(runId);
        });
        return operation;
    }

    private async performUpload(runId: string, token: string, owner: GameplaySyncOwner): Promise<GameplaySyncResponse> {
        const request = this.request(runId, owner);
        const attemptedAtUtc = this.now().toISOString();
        this.database.markGameplaySyncAttempt(runId, request.eventHistoryRevision, attemptedAtUtc);
        try {
            const response = await this.client.syncGameplay(token, request);
            if (response.runId !== request.runId
                || response.acknowledgedHistoryRevision !== request.eventHistoryRevision
                || response.acknowledgedHistoryHash !== request.historyHash
                || response.acknowledgedConfigurationRevision !== request.currentConfigurationRevision
                || response.acknowledgedConfigurationHash !== request.currentConfigurationHash
                || response.acknowledgedFinalizationHash !== (request.finalization?.finalizationHash ?? null)) {
                throw new PlatformGameplaySyncError("SYNC_INTEGRITY_CONFLICT");
            }
            this.database.acknowledgeGameplaySync({
                runId,
                historyRevision: request.eventHistoryRevision,
                historyHash: request.historyHash,
                configurationRevision: request.currentConfigurationRevision,
                configurationHash: request.currentConfigurationHash,
                finalizationHash: request.finalization?.finalizationHash ?? null,
                succeededAtUtc: this.now().toISOString(),
            });
            return response;
        } catch (error) {
            const code = syncErrorCode(error);
            const retryable = retryableSyncError(code);
            const state = this.database.recordGameplaySyncFailure(runId, code, this.now().toISOString(), retryable);
            if (retryable && state.nextRetryAtUtc) this.scheduleAt(runId, state.nextRetryAtUtc);
            throw error;
        }
    }

    private resume(runId: string, token: string, owner: GameplaySyncOwner, resumeAuthPaused = false): void {
        const state = this.database.readLocalGameplaySyncState(runId);
        const errorCode = storedErrorCode(state?.lastErrorCode ?? null);
        if (!state || (terminalSyncError(errorCode) && !(resumeAuthPaused && errorCode === "SYNC_AUTH"))) return;
        if (state.nextRetryAtUtc && Date.parse(state.nextRetryAtUtc) > this.now().getTime()) {
            this.scheduleAt(runId, state.nextRetryAtUtc);
            return;
        }
        void this.upload(runId, token, owner, true).catch(() => undefined);
    }

    private scheduleAt(runId: string, retryAtUtc: string): void {
        if (!this.token || !this.owner || this.timers.has(runId)) return;
        const delay = Math.max(0, Date.parse(retryAtUtc) - this.now().getTime());
        const timer = setTimeout(() => {
            this.timers.delete(runId);
            if (this.token && this.owner) this.resume(runId, this.token, this.owner);
        }, delay);
        timer.unref?.();
        this.timers.set(runId, timer);
    }

    private request(runId: string, owner: GameplaySyncOwner): GameplaySyncRequest {
        const run = this.database.readLocalGameRun(runId);
        const snapshot = this.database.readLocalMatchEngineSnapshot(runId);
        const events = this.database.readLocalMatchEvents(runId);
        const currentConfiguration = this.database.readLocalGameRunConfiguration(runId);
        const finalization = this.database.readLocalMatchFinalization(runId);
        if (!run || !snapshot || run.organizationId !== owner.organizationId || run.scorerId !== owner.scorerId
            || !currentConfiguration || events.length === 0) throw new PlatformGameplaySyncError("SYNC_INVALID");
        return {
            schemaVersion: 1,
            runId: run.runId,
            gameId: run.gameId,
            packageId: run.packageId,
            packageVersion: run.packageVersion,
            packageHash: run.packageHash,
            organizationId: run.organizationId,
            scorerId: run.scorerId,
            deviceId: run.deviceId,
            startedAtUtc: run.startedAtUtc ?? "",
            configurationRevision: snapshot.configurationRevision,
            configurationHash: snapshot.configurationHash,
            currentConfigurationRevision: currentConfiguration.revision,
            currentConfigurationHash: currentConfiguration.configurationHash,
            currentConfigurationJson: currentConfiguration.configurationJson,
            snapshotSchemaVersion: snapshot.snapshotSchemaVersion,
            matchEventSchemaVersion: snapshot.matchEventSchemaVersion,
            initialStateJson: snapshot.initialStateJson,
            initialStateHash: snapshot.initialStateHash,
            eventHistoryRevision: snapshot.eventHistoryRevision,
            lastAcceptedSequence: run.lastAcceptedSequence,
            historyHash: historyHash(events),
            events: events.map((event) => ({
                eventId: event.eventId,
                sequence: event.sequence,
                eventSchemaVersion: event.eventSchemaVersion,
                eventJson: event.eventJson,
                eventHash: event.eventHash,
            })),
            finalization: finalization ? {
                schemaVersion: finalization.finalizationSchemaVersion,
                finalizedHistoryRevision: finalization.finalizedHistoryRevision,
                finalizedHistoryHash: finalization.finalizedHistoryHash,
                finalStateJson: finalization.finalStateJson,
                finalStateHash: finalization.finalStateHash,
                finalizationJson: finalization.finalizationJson,
                finalizationHash: finalization.finalizationHash,
                finalizedAtUtc: finalization.finalizedAtUtc,
            } : null,
        };
    }
}

export function gameplayHistoryHash(events: StoredLocalMatchEvent[]): string {
    return historyHash(events);
}

export function runSyncIdentity(run: StoredLocalGameRun): string {
    return deterministicJson({ runId: run.runId, gameId: run.gameId, packageId: run.packageId, scorerId: run.scorerId, organizationId: run.organizationId, deviceId: run.deviceId });
}
