import { randomUUID } from "node:crypto";
import type { MatchSetupManager } from "../games/match-setup.cjs";
import {
    LocalDatabase,
    type LocalMatchEventWrite,
    type StoredLocalGameplaySyncState,
    type StoredLocalGameRun,
    type StoredLocalMatchEngineSnapshot,
} from "../persistence/local-database.cjs";
import { parseStoredPreGameConfiguration, type PreGameConfigurationV1 } from "./pre-game-configuration.cjs";
import {
    buildMatchEngineInitialSnapshot,
    deterministicJson,
    parseDeterministicJson,
    sha256JsonBytes,
    validateMatchStartReadiness,
    type JsonObject,
    type JsonValue,
    type MatchStartReadinessIssue,
} from "./match-engine-bootstrap.cjs";

export interface MatchGameplayOwner { scorerId: string; organizationId: string; }
export interface MatchEventFacts { type: string; [key: string]: JsonValue; }
export interface MatchGameplayRecovery {
    runId: string;
    lifecycle: "live" | "finalized";
    eventHistoryRevision: number;
    lastAcceptedSequence: number;
    state: JsonObject;
    eventIds: string[];
    events: MatchGameplayEventSummary[];
    currentConfiguration: PreGameConfigurationV1;
}
export interface MatchGameplayEventSummary {
    eventId: string;
    sequence: number;
    occurredAt: number;
    type: string;
    team?: "HOME" | "AWAY";
    playerId?: string;
}

export interface LiveRunAuthorizationSealDetails {
    runId: string;
    gameId: string;
    packageId: string;
    packageVersion: number;
    packageHash: string;
    configurationRevision: number;
    configurationHash: string;
    initialStateHash: string;
    scorerId: string;
    organizationId: string;
    deviceId: string;
    startedAtUtc: string;
}

export const MATCH_GAMEPLAY_ERROR_CODES = [
    "GAMEPLAY_UNAVAILABLE",
    "GAMEPLAY_INVALID",
    "GAMEPLAY_CONFLICT",
    "GAMEPLAY_OWNERSHIP_CONFLICT",
    "GAMEPLAY_CORRUPTED",
    "GAMEPLAY_EVENT_REJECTED",
] as const;
export type MatchGameplayErrorCode = (typeof MATCH_GAMEPLAY_ERROR_CODES)[number];

export class MatchGameplayFlowError extends Error {
    constructor(readonly code: MatchGameplayErrorCode, readonly dependentEventIds: string[] = []) {
        super(code);
        this.name = "MatchGameplayFlowError";
    }
}

interface RuntimeEventResult {
    accepted: boolean;
    state: unknown;
    reason?: unknown;
    dependentEventIds?: unknown;
}

interface RuntimeMatchEngine {
    getState(): unknown;
    getEvents(): readonly unknown[];
    preview(event: unknown): RuntimeEventResult;
    process(event: unknown): RuntimeEventResult;
    fork(): RuntimeMatchEngine;
    removeEvent(eventId: string, options?: { cascadeDependencies?: boolean }): RuntimeEventResult;
    correctEvent(eventId: string, replacement: unknown, options?: { cascadeDependencies?: boolean }): RuntimeEventResult;
}

interface RuntimeMatchEngineConstructor {
    fromInitialState(initialState: unknown): RuntimeMatchEngine;
}

interface RuntimeMatchSession {
    run: StoredLocalGameRun;
    snapshot: StoredLocalMatchEngineSnapshot;
    engine: RuntimeMatchEngine;
    events: MatchGameplayEventSummary[];
}

const MATCH_ENGINE_MODULE = "../shared/match-engine/engine/match-engine.js";

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function jsonObject(value: unknown): JsonObject {
    const parsed = JSON.parse(deterministicJson(value)) as JsonValue;
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== "object") throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
    return parsed;
}

function ownerIsValid(owner: MatchGameplayOwner | null): owner is MatchGameplayOwner {
    return owner !== null && Boolean(owner.scorerId.trim()) && Boolean(owner.organizationId.trim());
}

function assertOwner(run: StoredLocalGameRun, owner: MatchGameplayOwner | null, deviceId: string): asserts owner is MatchGameplayOwner {
    if (!ownerIsValid(owner)) throw new MatchGameplayFlowError("GAMEPLAY_UNAVAILABLE");
    if (run.scorerId !== owner.scorerId || run.organizationId !== owner.organizationId || run.deviceId !== deviceId) throw new MatchGameplayFlowError("GAMEPLAY_OWNERSHIP_CONFLICT");
}

function eventMetadata(value: unknown): { id: string; sequence: number; schemaVersion: 2; occurredAt: number; type: string } {
    const event = record(value);
    if (!event || event.schemaVersion !== 2 || typeof event.id !== "string" || !event.id.trim() || !Number.isInteger(event.sequence) || Number(event.sequence) < 1 || typeof event.occurredAt !== "number" || !Number.isFinite(event.occurredAt) || typeof event.type !== "string" || !event.type.trim()) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
    return { id: event.id, sequence: Number(event.sequence), schemaVersion: 2, occurredAt: event.occurredAt, type: event.type };
}

function eventWrite(value: unknown, persistedAtUtc: string): LocalMatchEventWrite {
    const metadata = eventMetadata(value);
    const eventJson = deterministicJson(value);
    return { eventId: metadata.id, sequence: metadata.sequence, eventSchemaVersion: 2, eventJson, eventHash: sha256JsonBytes(eventJson), persistedAtUtc };
}
function eventSummary(value: unknown): MatchGameplayEventSummary {
    const metadata = eventMetadata(value);
    const event = record(value);
    return {
        eventId: metadata.id,
        sequence: metadata.sequence,
        occurredAt: metadata.occurredAt,
        type: metadata.type,
        ...(event?.team === "HOME" || event?.team === "AWAY" ? { team: event.team } : {}),
        ...(typeof event?.playerId === "string" ? { playerId: event.playerId } : {}),
    };
}

function databaseConflict(error: unknown): "ownership" | "state" | "revision" | null {
    const value = record(error);
    if (value?.name !== "LocalMatchGameplayConflictError") return null;
    return value.kind === "ownership" || value.kind === "state" || value.kind === "revision" ? value.kind : null;
}

async function loadEngine(initialState: JsonObject): Promise<RuntimeMatchEngine> {
    const loaded = record(await import(MATCH_ENGINE_MODULE));
    const constructor = loaded?.MatchEngine as RuntimeMatchEngineConstructor | undefined;
    if (!constructor || typeof constructor.fromInitialState !== "function") throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
    return constructor.fromInitialState(initialState);
}

function accepted(result: RuntimeEventResult): void {
    if (result.accepted) return;
    const dependentEventIds = Array.isArray(result.dependentEventIds) && result.dependentEventIds.every((id) => typeof id === "string") ? result.dependentEventIds as string[] : [];
    throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED", dependentEventIds);
}

export class MatchGameplayManager {
    private readonly sessions = new Map<string, RuntimeMatchSession>();
    private readonly mutationQueues = new Map<string, Promise<void>>();
    private readonly pendingSessionEvictions = new Set<string>();
    private readonly maxCachedSessions: number;

    constructor(
        private readonly setup: MatchSetupManager,
        private readonly database: LocalDatabase,
        private readonly deviceId: string,
        private readonly now: () => Date = () => new Date(),
        private readonly id: () => string = () => randomUUID(),
        private readonly sealLiveAuthorization: ((details: LiveRunAuthorizationSealDetails) => string) | null = null,
        maxCachedSessions = 8,
    ) {
        this.maxCachedSessions = Number.isSafeInteger(maxCachedSessions) && maxCachedSessions > 0 ? maxCachedSessions : 8;
    }

    clearRuntimeSessions(): void {
        for (const runId of this.mutationQueues.keys()) this.pendingSessionEvictions.add(runId);
        for (const runId of this.sessions.keys()) {
            if (this.mutationQueues.has(runId)) this.pendingSessionEvictions.add(runId);
            else this.sessions.delete(runId);
        }
    }

    validateStartReadiness(runId: string, owner: MatchGameplayOwner | null): MatchStartReadinessIssue | null {
        const run = this.requireRun(runId);
        assertOwner(run, owner, this.deviceId);
        if (run.status !== "active" || run.startedAtUtc !== null || run.lastAcceptedSequence !== 0 || this.database.readLocalMatchEngineSnapshot(run.runId) !== null) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
        const configuration = this.database.readLocalGameRunConfiguration(run.runId);
        if (!configuration) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const source = this.setup.getVerifiedPackageMatchSetup(run.packageId);
        if (source.setup.gameId !== run.gameId || source.setup.packageId !== run.packageId || source.setup.packageVersion !== run.packageVersion || source.packageSchemaVersion !== run.packageSchemaVersion || source.packageHash !== run.packageHash) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        return validateMatchStartReadiness(run, configuration, source.setup);
    }

    async initialize(runId: string, owner: MatchGameplayOwner | null): Promise<MatchGameplayRecovery> {
        return this.withRunLock(runId, () => this.initializeUnlocked(runId, owner));
    }

    private async initializeUnlocked(runId: string, owner: MatchGameplayOwner | null): Promise<MatchGameplayRecovery> {
        const run = this.requireRun(runId);
        assertOwner(run, owner, this.deviceId);
        if (run.status !== "active" || run.startedAtUtc !== null || run.lastAcceptedSequence !== 0 || this.database.readLocalMatchEngineSnapshot(run.runId) !== null) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
        const configuration = this.database.readLocalGameRunConfiguration(run.runId);
        if (!configuration) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const source = this.setup.getVerifiedPackageMatchSetup(run.packageId);
        if (source.setup.gameId !== run.gameId || source.setup.packageId !== run.packageId || source.setup.packageVersion !== run.packageVersion || source.packageSchemaVersion !== run.packageSchemaVersion || source.packageHash !== run.packageHash) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const snapshot = await buildMatchEngineInitialSnapshot(run, configuration, source.setup);
        const occurredAt = this.now().getTime();
        const initialEvent = { schemaVersion: 2, id: this.id(), occurredAt, sequence: 1, type: "MATCH_START" };
        const engine = await loadEngine(snapshot.initialState);
        accepted(engine.process(initialEvent));
        const timestamp = new Date(occurredAt).toISOString();
        if (!this.sealLiveAuthorization) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const encryptedLiveAuthorization = this.sealLiveAuthorization({
            runId: run.runId,
            gameId: run.gameId,
            packageId: run.packageId,
            packageVersion: run.packageVersion,
            packageHash: run.packageHash,
            configurationRevision: configuration.revision,
            configurationHash: configuration.configurationHash,
            initialStateHash: snapshot.initialStateHash,
            scorerId: owner.scorerId,
            organizationId: owner.organizationId,
            deviceId: this.deviceId,
            startedAtUtc: timestamp,
        });
        try {
            const storedSnapshot = this.database.initializeLocalMatchGameplay({
                runId: run.runId,
                organizationId: owner.organizationId,
                scorerId: owner.scorerId,
                deviceId: this.deviceId,
                configurationRevision: configuration.revision,
                configurationHash: configuration.configurationHash,
                snapshotSchemaVersion: 1,
                matchEventSchemaVersion: 2,
                initialStateJson: snapshot.initialStateJson,
                initialStateHash: snapshot.initialStateHash,
                initialEvent: eventWrite(initialEvent, timestamp),
                encryptedLiveAuthorization,
                startedAtUtc: timestamp,
            });
            const startedRun: StoredLocalGameRun = { ...run, startedAtUtc: timestamp, lastAcceptedSequence: 1, updatedAtUtc: timestamp };
            return this.cacheRecovery(startedRun, "live", storedSnapshot, engine);
        } catch (error) {
            const conflict = databaseConflict(error);
            if (conflict === "ownership") throw new MatchGameplayFlowError("GAMEPLAY_OWNERSHIP_CONFLICT");
            if (conflict) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
            throw error;
        }
    }

    syncState(runId: string): StoredLocalGameplaySyncState | null {
        return this.database.readLocalGameplaySyncState(runId);
    }

    async recover(runId: string, owner: MatchGameplayOwner | null): Promise<MatchGameplayRecovery> {
        const run = this.requireRun(runId);
        assertOwner(run, owner, this.deviceId);
        if ((run.status !== "active" && run.status !== "finalized") || run.startedAtUtc === null || run.lastAcceptedSequence < 1) throw new MatchGameplayFlowError("GAMEPLAY_UNAVAILABLE");
        const snapshot = this.database.readLocalMatchEngineSnapshot(run.runId);
        if (!snapshot) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
        const lifecycle = run.status === "finalized" ? "finalized" : "live";
        try {
            if (snapshot.snapshotSchemaVersion !== 1 || snapshot.matchEventSchemaVersion !== 2 || sha256JsonBytes(snapshot.initialStateJson) !== snapshot.initialStateHash) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
            const initial = parseDeterministicJson(snapshot.initialStateJson);
            const initialObject = jsonObject(initial);
            if (initialObject.id !== run.runId || initialObject.started !== false || initialObject.lastProcessedSequence !== 0) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
            const engine = await loadEngine(initialObject);
            const rows = this.database.readLocalMatchEvents(run.runId);
            let previousSequence = 0;
            for (const row of rows) {
                if (row.eventSchemaVersion !== 2 || row.sequence <= previousSequence || sha256JsonBytes(row.eventJson) !== row.eventHash) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
                const event = parseDeterministicJson(row.eventJson);
                const metadata = eventMetadata(event);
                if (metadata.id !== row.eventId || metadata.sequence !== row.sequence || metadata.schemaVersion !== row.eventSchemaVersion) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
                const result = engine.process(event);
                if (!result.accepted) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
                previousSequence = row.sequence;
            }
            if (rows.length === 0 || rows[0].sequence !== 1 || eventMetadata(JSON.parse(rows[0].eventJson)).type !== "MATCH_START" || previousSequence > run.lastAcceptedSequence) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
            return this.cacheRecovery(run, lifecycle, snapshot, engine);
        } catch (error) {
            if (error instanceof MatchGameplayFlowError) throw error;
            throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
        }
    }

    async append(runId: string, owner: MatchGameplayOwner | null, facts: MatchEventFacts): Promise<MatchGameplayRecovery> {
        return this.withRunLock(runId, () => this.appendUnlocked(runId, owner, facts));
    }

    private async appendUnlocked(runId: string, owner: MatchGameplayOwner | null, facts: MatchEventFacts): Promise<MatchGameplayRecovery> {
        if (!facts.type.trim() || facts.type === "MATCH_END" || facts.type === "ROSTER_PLAYER_ADDED") throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const current = await this.loadMutation(runId, owner);
        const occurredAt = this.now().getTime();
        const sequence = current.run.lastAcceptedSequence + 1;
        const event = { ...facts, schemaVersion: 2, id: this.id(), occurredAt, sequence };
        accepted(current.engine.preview(event));
        return this.persistAppend(current, owner, event, occurredAt);
    }

    async remove(runId: string, owner: MatchGameplayOwner | null, eventId: string, cascadeDependencies = false): Promise<MatchGameplayRecovery> {
        return this.withRunLock(runId, () => this.removeUnlocked(runId, owner, eventId, cascadeDependencies));
    }

    private async removeUnlocked(runId: string, owner: MatchGameplayOwner | null, eventId: string, cascadeDependencies: boolean): Promise<MatchGameplayRecovery> {
        if (!eventId.trim()) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const current = await this.loadMutation(runId, owner);
        const candidate = current.engine.fork();
        const target = candidate.getEvents().find((event) => record(event)?.id === eventId);
        if (target) {
            const metadata = eventMetadata(target);
            if (metadata.sequence === 1 && metadata.type === "MATCH_START") throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        }
        accepted(candidate.removeEvent(eventId, { cascadeDependencies }));
        return this.persistMutation({ ...current, engine: candidate }, owner, current.run.lastAcceptedSequence, this.now().getTime());
    }

    async correct(runId: string, owner: MatchGameplayOwner | null, eventId: string, replacementFacts: MatchEventFacts, cascadeDependencies = false): Promise<MatchGameplayRecovery> {
        return this.withRunLock(runId, () => this.correctUnlocked(runId, owner, eventId, replacementFacts, cascadeDependencies));
    }

    private async correctUnlocked(runId: string, owner: MatchGameplayOwner | null, eventId: string, replacementFacts: MatchEventFacts, cascadeDependencies: boolean): Promise<MatchGameplayRecovery> {
        if (!eventId.trim() || !replacementFacts.type.trim() || replacementFacts.type === "MATCH_END") throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const current = await this.loadMutation(runId, owner);
        const candidate = current.engine.fork();
        const original = candidate.getEvents().map(record).find((event) => event?.id === eventId);
        if (!original || typeof original.sequence !== "number" || typeof original.occurredAt !== "number") throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        if (original.sequence === 1 && original.type === "MATCH_START") throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        const replacement = { ...replacementFacts, schemaVersion: 2, id: eventId, occurredAt: original.occurredAt, sequence: original.sequence };
        accepted(candidate.correctEvent(eventId, replacement, { cascadeDependencies }));
        return this.persistMutation({ ...current, engine: candidate }, owner, current.run.lastAcceptedSequence, this.now().getTime());
    }

    async finalize(runId: string, owner: MatchGameplayOwner | null): Promise<MatchGameplayRecovery> {
        return this.withRunLock(runId, () => this.finalizeUnlocked(runId, owner));
    }

    private async finalizeUnlocked(runId: string, owner: MatchGameplayOwner | null): Promise<MatchGameplayRecovery> {
        const current = await this.loadMutation(runId, owner);
        const candidate = current.engine.fork();
        const occurredAt = this.now().getTime();
        const sequence = current.run.lastAcceptedSequence + 1;
        const finalEvent = { schemaVersion: 2, id: this.id(), occurredAt, sequence, type: "MATCH_END" };
        accepted(candidate.process(finalEvent));
        const finalizedAtUtc = new Date(occurredAt).toISOString();
        const events = candidate.getEvents();
        const writes = events.map((event) => eventWrite(event, finalizedAtUtc));
        const historyJson = `[${writes.map((event) => event.eventJson).join(",")}]`;
        const finalizedHistoryHash = sha256JsonBytes(historyJson);
        const finalStateJson = deterministicJson(candidate.getState());
        const finalStateHash = sha256JsonBytes(finalStateJson);
        const finalizationJson = deterministicJson({
            schemaVersion: 1,
            runId,
            finalizedHistoryRevision: current.snapshot.eventHistoryRevision + 1,
            finalizedHistoryHash,
            finalStateHash,
            finalizedAtUtc,
        });
        const finalizationHash = sha256JsonBytes(finalizationJson);
        try {
            const snapshot = this.database.finalizeLocalMatchGameplay({
                runId,
                organizationId: owner!.organizationId,
                scorerId: owner!.scorerId,
                deviceId: this.deviceId,
                expectedHistoryRevision: current.snapshot.eventHistoryRevision,
                lastAcceptedSequence: sequence,
                events: writes,
                updatedAtUtc: finalizedAtUtc,
                finalizedHistoryHash,
                finalStateJson,
                finalStateHash,
                finalizationJson,
                finalizationHash,
                finalizedAtUtc,
            });
            const finalizedRun: StoredLocalGameRun = { ...current.run, status: "finalized", lastAcceptedSequence: sequence, updatedAtUtc: finalizedAtUtc };
            return this.cacheRecovery(finalizedRun, "finalized", snapshot, candidate);
        } catch (error) {
            const conflict = databaseConflict(error);
            if (conflict === "ownership") throw new MatchGameplayFlowError("GAMEPLAY_OWNERSHIP_CONFLICT");
            if (conflict) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
            throw error;
        }
    }

    private requireRun(runId: string): StoredLocalGameRun {
        if (!runId.trim()) throw new MatchGameplayFlowError("GAMEPLAY_UNAVAILABLE");
        const run = this.database.readLocalGameRun(runId);
        if (!run) throw new MatchGameplayFlowError("GAMEPLAY_UNAVAILABLE");
        return run;
    }

    private async loadMutation(runId: string, owner: MatchGameplayOwner | null): Promise<RuntimeMatchSession> {
        const run = this.requireRun(runId);
        assertOwner(run, owner, this.deviceId);
        if (run.status !== "active") throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
        const snapshot = this.database.readLocalMatchEngineSnapshot(runId);
        if (!snapshot) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
        const cached = this.sessions.get(runId);
        if (cached && this.sessionMatches(cached, run, snapshot)) {
            cached.run = run;
            cached.snapshot = snapshot;
            this.touchSession(runId, cached);
            return cached;
        }
        if (cached) this.sessions.delete(runId);
        await this.recover(runId, owner);
        const recovered = this.sessions.get(runId);
        if (!recovered || !this.sessionMatches(recovered, this.requireRun(runId), this.database.readLocalMatchEngineSnapshot(runId))) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
        return recovered;
    }

    private persistMutation(current: RuntimeMatchSession, owner: MatchGameplayOwner | null, lastAcceptedSequence: number, occurredAt: number): MatchGameplayRecovery {
        assertOwner(current.run, owner, this.deviceId);
        const persistedAtUtc = new Date(occurredAt).toISOString();
        const writes = current.engine.getEvents().map((event) => eventWrite(event, persistedAtUtc));
        try {
            const snapshot = this.database.rewriteLocalMatchEventHistory({
                runId: current.run.runId,
                organizationId: owner.organizationId,
                scorerId: owner.scorerId,
                deviceId: this.deviceId,
                expectedHistoryRevision: current.snapshot.eventHistoryRevision,
                lastAcceptedSequence,
                events: writes,
                updatedAtUtc: persistedAtUtc,
            });
            const updatedRun: StoredLocalGameRun = { ...current.run, lastAcceptedSequence, updatedAtUtc: persistedAtUtc };
            return this.cacheRecovery(updatedRun, "live", snapshot, current.engine);
        } catch (error) {
            const conflict = databaseConflict(error);
            if (conflict === "ownership") throw new MatchGameplayFlowError("GAMEPLAY_OWNERSHIP_CONFLICT");
            if (conflict) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
            throw error;
        }
    }

    private persistAppend(
        current: RuntimeMatchSession,
        owner: MatchGameplayOwner | null,
        event: unknown,
        occurredAt: number,
    ): MatchGameplayRecovery {
        assertOwner(current.run, owner, this.deviceId);
        const persistedAtUtc = new Date(occurredAt).toISOString();
        const write = eventWrite(event, persistedAtUtc);
        try {
            const snapshot = this.database.appendLocalMatchEvent({
                runId: current.run.runId,
                organizationId: owner.organizationId,
                scorerId: owner.scorerId,
                deviceId: this.deviceId,
                expectedHistoryRevision: current.snapshot.eventHistoryRevision,
                expectedLastAcceptedSequence: current.run.lastAcceptedSequence,
                event: write,
                updatedAtUtc: persistedAtUtc,
            });
            accepted(current.engine.process(event));
            current.run = { ...current.run, lastAcceptedSequence: write.sequence, updatedAtUtc: persistedAtUtc };
            current.snapshot = snapshot;
            current.events.push(eventSummary(event));
            this.cacheSession(current);
            return this.recoveryFromSession(current, "live");
        } catch (error) {
            const conflict = databaseConflict(error);
            if (conflict === "ownership") throw new MatchGameplayFlowError("GAMEPLAY_OWNERSHIP_CONFLICT");
            if (conflict) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
            throw error;
        }
    }

    private cacheRecovery(run: StoredLocalGameRun, lifecycle: "live" | "finalized", snapshot: StoredLocalMatchEngineSnapshot, engine: RuntimeMatchEngine): MatchGameplayRecovery {
        const session: RuntimeMatchSession = { run, snapshot, engine, events: engine.getEvents().map(eventSummary) };
        if (lifecycle === "live") this.cacheSession(session);
        else this.sessions.delete(run.runId);
        return this.recoveryFromSession(session, lifecycle);
    }

    private touchSession(runId: string, session: RuntimeMatchSession): void {
        this.sessions.delete(runId);
        this.sessions.set(runId, session);
    }

    private cacheSession(session: RuntimeMatchSession): void {
        this.touchSession(session.run.runId, session);
        this.evictInactiveSessions(session.run.runId);
    }

    private evictInactiveSessions(protectedRunId: string | null = null): void {
        while (this.sessions.size > this.maxCachedSessions) {
            let evicted = false;
            for (const runId of this.sessions.keys()) {
                if (runId === protectedRunId || this.mutationQueues.has(runId)) continue;
                this.sessions.delete(runId);
                evicted = true;
                break;
            }
            if (!evicted) return;
        }
    }

    private recoveryFromSession(session: RuntimeMatchSession, lifecycle: "live" | "finalized"): MatchGameplayRecovery {
        const state = jsonObject(session.engine.getState());
        const storedConfiguration = this.database.readLocalGameRunConfiguration(session.run.runId);
        if (!storedConfiguration) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
        const currentConfiguration = parseStoredPreGameConfiguration(storedConfiguration);
        if (currentConfiguration.runId !== session.run.runId || storedConfiguration.revision < session.snapshot.configurationRevision) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
        return { runId: session.run.runId, lifecycle, eventHistoryRevision: session.snapshot.eventHistoryRevision, lastAcceptedSequence: session.run.lastAcceptedSequence, state, eventIds: session.events.map((event) => event.eventId), events: session.events, currentConfiguration };
    }

    private sessionMatches(session: RuntimeMatchSession, run: StoredLocalGameRun, snapshot: StoredLocalMatchEngineSnapshot | null): snapshot is StoredLocalMatchEngineSnapshot {
        return snapshot !== null
            && session.run.runId === run.runId
            && session.run.status === run.status
            && session.run.lastAcceptedSequence === run.lastAcceptedSequence
            && session.snapshot.eventHistoryRevision === snapshot.eventHistoryRevision
            && session.snapshot.initialStateHash === snapshot.initialStateHash;
    }

    private async withRunLock<T>(runId: string, action: () => Promise<T>): Promise<T> {
        const previous = this.mutationQueues.get(runId) ?? Promise.resolve();
        let release!: () => void;
        const gate = new Promise<void>((resolve) => { release = resolve; });
        const tail = previous.then(() => gate);
        this.mutationQueues.set(runId, tail);
        await previous;
        try { return await action(); }
        finally {
            release();
            if (this.mutationQueues.get(runId) === tail) {
                this.mutationQueues.delete(runId);
                if (this.pendingSessionEvictions.delete(runId)) this.sessions.delete(runId);
            }
            this.evictInactiveSessions();
        }
    }
}
