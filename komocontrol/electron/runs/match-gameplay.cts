import { randomUUID } from "node:crypto";
import type { MatchSetupManager } from "../games/match-setup.cjs";
import {
    LocalDatabase,
    type LocalMatchEventWrite,
    type StoredLocalGameRun,
    type StoredLocalMatchEngineSnapshot,
} from "../persistence/local-database.cjs";
import {
    buildMatchEngineInitialSnapshot,
    deterministicJson,
    parseDeterministicJson,
    sha256JsonBytes,
    type JsonObject,
    type JsonValue,
} from "./match-engine-bootstrap.cjs";

export interface MatchGameplayOwner { scorerId: string; organizationId: string; }
export interface MatchEventFacts { type: string; [key: string]: JsonValue; }
export interface MatchGameplayRecovery {
    runId: string;
    eventHistoryRevision: number;
    lastAcceptedSequence: number;
    state: JsonObject;
    eventIds: string[];
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
    process(event: unknown): RuntimeEventResult;
    removeEvent(eventId: string, options?: { cascadeDependencies?: boolean }): RuntimeEventResult;
    correctEvent(eventId: string, replacement: unknown, options?: { cascadeDependencies?: boolean }): RuntimeEventResult;
}

interface RuntimeMatchEngineConstructor {
    fromInitialState(initialState: unknown): RuntimeMatchEngine;
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
    constructor(
        private readonly setup: MatchSetupManager,
        private readonly database: LocalDatabase,
        private readonly deviceId: string,
        private readonly now: () => Date = () => new Date(),
        private readonly id: () => string = () => randomUUID(),
    ) {}

    async initialize(runId: string, owner: MatchGameplayOwner | null): Promise<MatchGameplayRecovery> {
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
                startedAtUtc: timestamp,
            });
            return this.recoveryFromEngine(run.runId, storedSnapshot, 1, engine);
        } catch (error) {
            const conflict = databaseConflict(error);
            if (conflict === "ownership") throw new MatchGameplayFlowError("GAMEPLAY_OWNERSHIP_CONFLICT");
            if (conflict) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
            throw error;
        }
    }

    async recover(runId: string, owner: MatchGameplayOwner | null): Promise<MatchGameplayRecovery> {
        const run = this.requireRun(runId);
        assertOwner(run, owner, this.deviceId);
        if (run.status !== "active" || run.startedAtUtc === null || run.lastAcceptedSequence < 1) throw new MatchGameplayFlowError("GAMEPLAY_UNAVAILABLE");
        const snapshot = this.database.readLocalMatchEngineSnapshot(run.runId);
        if (!snapshot) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
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
            return this.recoveryFromEngine(run.runId, snapshot, run.lastAcceptedSequence, engine);
        } catch (error) {
            if (error instanceof MatchGameplayFlowError) throw error;
            throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
        }
    }

    async append(runId: string, owner: MatchGameplayOwner | null, facts: MatchEventFacts): Promise<MatchGameplayRecovery> {
        if (!facts.type.trim()) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const current = await this.loadMutation(runId, owner);
        const occurredAt = this.now().getTime();
        const sequence = current.run.lastAcceptedSequence + 1;
        const event = { ...facts, schemaVersion: 2, id: this.id(), occurredAt, sequence };
        accepted(current.engine.process(event));
        return this.persistMutation(current, owner, sequence, occurredAt);
    }

    async remove(runId: string, owner: MatchGameplayOwner | null, eventId: string, cascadeDependencies = false): Promise<MatchGameplayRecovery> {
        if (!eventId.trim()) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const current = await this.loadMutation(runId, owner);
        const target = current.engine.getEvents().find((event) => record(event)?.id === eventId);
        if (target) {
            const metadata = eventMetadata(target);
            if (metadata.sequence === 1 && metadata.type === "MATCH_START") throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        }
        accepted(current.engine.removeEvent(eventId, { cascadeDependencies }));
        return this.persistMutation(current, owner, current.run.lastAcceptedSequence, this.now().getTime());
    }

    async correct(runId: string, owner: MatchGameplayOwner | null, eventId: string, replacementFacts: MatchEventFacts, cascadeDependencies = false): Promise<MatchGameplayRecovery> {
        if (!eventId.trim() || !replacementFacts.type.trim()) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const current = await this.loadMutation(runId, owner);
        const original = current.engine.getEvents().map(record).find((event) => event?.id === eventId);
        if (!original || typeof original.sequence !== "number" || typeof original.occurredAt !== "number") throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        if (original.sequence === 1 && original.type === "MATCH_START") throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        const replacement = { ...replacementFacts, schemaVersion: 2, id: eventId, occurredAt: original.occurredAt, sequence: original.sequence };
        accepted(current.engine.correctEvent(eventId, replacement, { cascadeDependencies }));
        return this.persistMutation(current, owner, current.run.lastAcceptedSequence, this.now().getTime());
    }

    private requireRun(runId: string): StoredLocalGameRun {
        if (!runId.trim()) throw new MatchGameplayFlowError("GAMEPLAY_UNAVAILABLE");
        const run = this.database.readLocalGameRun(runId);
        if (!run) throw new MatchGameplayFlowError("GAMEPLAY_UNAVAILABLE");
        return run;
    }

    private async loadMutation(runId: string, owner: MatchGameplayOwner | null): Promise<{ run: StoredLocalGameRun; snapshot: StoredLocalMatchEngineSnapshot; engine: RuntimeMatchEngine }> {
        const recovery = await this.recover(runId, owner);
        const run = this.requireRun(runId);
        const snapshot = this.database.readLocalMatchEngineSnapshot(runId);
        if (!snapshot || snapshot.eventHistoryRevision !== recovery.eventHistoryRevision) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
        const initial = jsonObject(parseDeterministicJson(snapshot.initialStateJson));
        const engine = await loadEngine(initial);
        for (const row of this.database.readLocalMatchEvents(runId)) accepted(engine.process(parseDeterministicJson(row.eventJson)));
        return { run, snapshot, engine };
    }

    private persistMutation(current: { run: StoredLocalGameRun; snapshot: StoredLocalMatchEngineSnapshot; engine: RuntimeMatchEngine }, owner: MatchGameplayOwner | null, lastAcceptedSequence: number, occurredAt: number): MatchGameplayRecovery {
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
            return this.recoveryFromEngine(current.run.runId, snapshot, lastAcceptedSequence, current.engine);
        } catch (error) {
            const conflict = databaseConflict(error);
            if (conflict === "ownership") throw new MatchGameplayFlowError("GAMEPLAY_OWNERSHIP_CONFLICT");
            if (conflict) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
            throw error;
        }
    }

    private recoveryFromEngine(runId: string, snapshot: StoredLocalMatchEngineSnapshot, lastAcceptedSequence: number, engine: RuntimeMatchEngine): MatchGameplayRecovery {
        const state = jsonObject(engine.getState());
        const eventIds = engine.getEvents().map((event) => eventMetadata(event).id);
        return { runId, eventHistoryRevision: snapshot.eventHistoryRevision, lastAcceptedSequence, state, eventIds };
    }
}
