import { randomUUID } from "node:crypto";
import type { MatchSetup, MatchSetupManager } from "../games/match-setup.cjs";
import {
    LocalDatabase,
    type LocalMatchEventWrite,
    type StoredLocalGameplaySyncState,
    type StoredLocalGameRun,
    type StoredLocalMatchEngineSnapshot,
    type StoredLocalResumableLiveFlow,
} from "../persistence/local-database.cjs";
import type { ResumableLiveFlowInput, SafeResumableLiveFlow } from "./gameplay-runtime.cjs";
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
export type MatchGameplayScorerEventContext = { technicalStaffSource?: "COACH" | "BENCH" };
export interface MatchEventFacts {
    type: string;
    scorerEventId?: string;
    scorerEventTerminal?: { reason: "NATURAL" | "ENTER_EARLY"; unresolvedStep?: "ASSIST" | "STEALER" | "FT1" | "FT2" | "FT3" | "REBOUNDER" | "CHOOSE_SHOOTER" | "FOULER" | "DRAWN_BY"; decisions?: { assist?: "NONE"; steal?: "NONE" }; resumeContext?: { penaltyShooterPlayerId?: string } };
    scorerEventContext?: MatchGameplayScorerEventContext;
    [key: string]: JsonValue | undefined;
}
export interface MatchGameplayRecovery {
    runId: string;
    lifecycle: "live" | "finalized";
    eventHistoryRevision: number;
    lastAcceptedSequence: number;
    state: JsonObject;
    eventIds: string[];
    events: MatchGameplayEventSummary[];
    currentConfiguration: PreGameConfigurationV1;
    setup: MatchSetup;
}
export interface MatchGameplayEventSummary {
    eventId: string;
    sequence: number;
    occurredAt: number;
    type: string;
    period?: { kind: "REGULATION" | "OVERTIME"; index: number };
    team?: "HOME" | "AWAY";
    playerId?: string;
    made?: boolean;
    scorerEventId?: string;
    scorerEventTerminal?: { reason: "NATURAL" | "ENTER_EARLY"; unresolvedStep?: "ASSIST" | "STEALER" | "FT1" | "FT2" | "FT3" | "REBOUNDER" | "CHOOSE_SHOOTER" | "FOULER" | "DRAWN_BY"; decisions?: { assist?: "NONE"; steal?: "NONE" }; resumeContext?: { penaltyShooterPlayerId?: string } };
    scorerEventContext?: MatchGameplayScorerEventContext;
}

export interface MatchGameplayHistoryQuery {
    limit: number;
    beforeSequence: number | null;
    period: { kind: "REGULATION" | "OVERTIME"; index: number } | null;
}

export type MatchGameplayScorerEventGroupingSource = "EXPLICIT" | "LEGACY_UNAMBIGUOUS" | "LEGACY_ATOMIC";

interface MatchGameplayHistoryFactRecord extends MatchGameplayEventSummary {
    period: { kind: "REGULATION" | "OVERTIME"; index: number };
    clockSeconds: number;
    facts: MatchEventFacts;
}

export interface MatchGameplayHistoryRecord extends MatchGameplayHistoryFactRecord {
    scorerEventGroupId: string;
    scorerEventGroupOrdinal: number;
    scorerEventGroupingSource: MatchGameplayScorerEventGroupingSource;
    scorerEventGroupSafeForReconstruction: boolean;
    isGoalFoul?: boolean;
}

export interface MatchGameplayScorerEventGroup {
    scorerEventGroupId: string;
    groupingSource: MatchGameplayScorerEventGroupingSource;
    groupOrdinal: number;
    canonicalEventIds: string[];
    visibleEventIds: string[];
    firstSequence: number;
    lastSequence: number;
    period: MatchGameplayHistoryRecord["period"];
    clockSeconds: number;
    scorerEventTerminal?: MatchGameplayEventSummary["scorerEventTerminal"];
    terminalConflict: boolean;
    safeForReconstruction: boolean;
    items: MatchGameplayHistoryRecord[];
}

export type MatchGameplayHistoricalEditTargetKind = "SHOOTER" | "TECHNICAL_PLAYER" | "FOULER" | "DRAWN_BY" | "ASSIST" | "BLOCKER" | "FREE_THROW_SHOOTER" | "TURNOVER_BY" | "STEALER" | "REBOUNDER" | "SHOT_RESULT" | "FREE_THROW_RESULT";
export interface MatchGameplayHistoricalPlayerContext { playerId: string; side: "HOME" | "AWAY"; displayName: string; shirtNumber: string; participating: true; onCourt: boolean; eligible: boolean; foulStatus: string; foulStatusReason: string | null; totalFouls: number; directDisqualification: boolean; }
export interface MatchGameplayHistoricalEditTarget { targetId: string; kind: MatchGameplayHistoricalEditTargetKind; eventId: string; currentPlayerId: string | null; canonicalSide: "HOME" | "AWAY" | null; candidatePlayerIds: string[]; sameTeamOnly: boolean; forwardPropagation: boolean; currentValue?: "MADE" | "MISS"; allowedValues?: ["MADE", "MISS"]; editable: boolean; readOnlyReason: "UNSAFE_GROUP" | "FINALIZED_RUN" | "UNSUPPORTED_TARGET" | "NO_HISTORICAL_CANDIDATES" | null; }
export interface MatchGameplayHistoricalPenaltyContext { penaltyId: string; sourceFoulEventId: string; beneficiarySide: "HOME" | "AWAY"; shooterPolicy: "FOULED_PLAYER" | "ANY_OPPONENT"; designatedPlayerId: string | null; totalAttempts: number; completedAttempts: number; remainingAttempts: number; nextAttemptNumber: number | null; restartKind: string; liveBallReboundAfterFinalMiss: boolean; }
export type MatchGameplayHistoricalContinuationPlan =
    | { kind: "ASSIST"; shotEventId: string; side: "HOME" | "AWAY"; candidatePlayerIds: string[]; noAssistAllowed: true }
    | { kind: "STEALER"; turnoverEventId: string; side: "HOME" | "AWAY"; candidatePlayerIds: string[]; noStealAllowed: true }
    | { kind: "CHOOSE_SHOOTER"; penalty: MatchGameplayHistoricalPenaltyContext; candidatePlayerIds: string[] }
    | { kind: "FREE_THROW_RESULT"; penalty: MatchGameplayHistoricalPenaltyContext; shooterPlayerId: string; candidatePlayerIds: string[]; attemptNumber: number; allowedResults: ["MADE", "MISS"]; postResultContinuation: "NEXT_FREE_THROW" | "REBOUNDER_IF_FINAL_MISS" | "END" }
    | { kind: "REBOUNDER"; sourceEventId: string; candidatePlayerIds: string[]; teamReboundAllowed: true; penaltyId: string | null };
export interface MatchGameplayScorerEventEditContext {
    group: MatchGameplayScorerEventGroup;
    lifecycle: "live" | "finalized";
    expectedHistoryRevision: number;
    historicalState: { anchor: "BEFORE_GROUP"; teams: Array<{ side: "HOME" | "AWAY"; players: MatchGameplayHistoricalPlayerContext[] }> };
    editCapabilities: { safeForEdit: boolean; canResume: boolean; canDeleteGroup: boolean; targets: MatchGameplayHistoricalEditTarget[] };
    continuationPlan: MatchGameplayHistoricalContinuationPlan | null;
    timeContext: { period: MatchGameplayHistoryRecord["period"]; clockSeconds: number; stoppageId: string | null };
}

export type MatchGameplayScorerEventEditMode =
    | { mode: "HISTORY" }
    | { mode: "CURRENT_OPEN"; scorerEventId: string };

export type MatchGameplayScorerEventMutation =
    | {
        kind: "REPLACE_GROUP";
        scorerEventGroupId: string;
        expectedHistoryRevision: number;
        mode?: MatchGameplayScorerEventEditMode;
        events: Array<{ eventId?: string; facts: MatchEventFacts }>;
    }
    | {
        kind: "DELETE_GROUP";
        scorerEventGroupId: string;
        expectedHistoryRevision: number;
    };

export interface MatchGameplayScorerEventDraftEvent { draftId: string; eventId?: string; facts: MatchEventFacts; }
export type MatchGameplayScorerEventDraftAction =
    | { kind: "CORRECT_PLAYER"; targetId: string; playerId: string }
    | { kind: "CORRECT_SHOT_RESULT"; targetId: string; made: boolean }
    | { kind: "CORRECT_FREE_THROW_RESULT"; targetId: string; made: boolean }
    | { kind: "ASSIST"; playerId: string | null }
    | { kind: "STEALER"; playerId: string | null }
    | { kind: "CHOOSE_SHOOTER"; playerId: string }
    | { kind: "FREE_THROW_RESULT"; made: boolean }
    | { kind: "REBOUNDER"; team: "HOME" | "AWAY"; playerId?: string; teamRebound: boolean };
export interface MatchGameplayScorerEventMutationPreviewInput { scorerEventGroupId: string; expectedHistoryRevision: number; mode?: MatchGameplayScorerEventEditMode; events: MatchGameplayScorerEventDraftEvent[]; action?: MatchGameplayScorerEventDraftAction; }
export interface MatchGameplayScorerEventMutationPreview { scorerEventGroupId: string; expectedHistoryRevision: number; normalizedGroup: MatchGameplayScorerEventGroup; editContext: MatchGameplayScorerEventEditContext; draftEvents: MatchGameplayScorerEventDraftEvent[]; }

export interface MatchGameplayHistoryPage {
    runId: string;
    items: MatchGameplayHistoryRecord[];
    nextBeforeSequence: number | null;
    total: number;
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

interface PreparedScorerEventMutation { current: RuntimeMatchSession; candidate: RuntimeMatchEngine; canonicalEvents: JsonObject[]; replacementEventIds: string[]; }

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

function eventMetadata(value: unknown): { id: string; sequence: number; schemaVersion: 2; occurredAt: number; type: string; scorerEventId?: string; scorerEventTerminal?: MatchGameplayEventSummary["scorerEventTerminal"]; scorerEventContext?: MatchGameplayScorerEventContext } {
    const event = record(value);
    if (!event || event.schemaVersion !== 2 || typeof event.id !== "string" || !event.id.trim() || !Number.isInteger(event.sequence) || Number(event.sequence) < 1 || typeof event.occurredAt !== "number" || !Number.isFinite(event.occurredAt) || typeof event.type !== "string" || !event.type.trim()) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
    const scorerEventId = typeof event.scorerEventId === "string" && event.scorerEventId.trim() ? event.scorerEventId : undefined;
    const terminal = record(event.scorerEventTerminal);
    const reason: NonNullable<MatchGameplayEventSummary["scorerEventTerminal"]>["reason"] | undefined = terminal?.reason === "NATURAL" || terminal?.reason === "ENTER_EARLY" ? terminal.reason : undefined;
    const scorerEventTerminal: MatchGameplayEventSummary["scorerEventTerminal"] = terminal && reason
        ? {
            reason,
            ...(typeof terminal.unresolvedStep === "string" ? { unresolvedStep: terminal.unresolvedStep as NonNullable<MatchGameplayEventSummary["scorerEventTerminal"]>["unresolvedStep"] } : {}),
            ...(record(terminal.decisions) ? { decisions: record(terminal.decisions) as NonNullable<MatchGameplayEventSummary["scorerEventTerminal"]>["decisions"] } : {}),
            ...(record(terminal.resumeContext) ? { resumeContext: record(terminal.resumeContext) as NonNullable<MatchGameplayEventSummary["scorerEventTerminal"]>["resumeContext"] } : {}),
        }
        : undefined;
    const context = record(event.scorerEventContext);
    const technicalStaffSource = context?.technicalStaffSource === "COACH" || context?.technicalStaffSource === "BENCH" ? context.technicalStaffSource : undefined;
    const scorerEventContext: MatchGameplayScorerEventContext | undefined = technicalStaffSource ? { technicalStaffSource } : undefined;
    return { id: event.id, sequence: Number(event.sequence), schemaVersion: 2, occurredAt: event.occurredAt, type: event.type, ...(scorerEventId ? { scorerEventId } : {}), ...(scorerEventTerminal ? { scorerEventTerminal } : {}), ...(scorerEventContext ? { scorerEventContext } : {}) };
}

function eventWrite(value: unknown, persistedAtUtc: string): LocalMatchEventWrite {
    const metadata = eventMetadata(value);
    const eventJson = deterministicJson(value);
    return { eventId: metadata.id, sequence: metadata.sequence, eventSchemaVersion: 2, eventJson, eventHash: sha256JsonBytes(eventJson), persistedAtUtc };
}

function safeResumableLiveFlow(value: StoredLocalResumableLiveFlow): SafeResumableLiveFlow {
    return {
        flowSchemaVersion: 1, flowKind: value.flowKind, stage: value.stage,
        rootEventId: value.rootEventId, sourceFoulEventId: value.sourceFoulEventId,
        selectedFreeThrowShooterId: value.selectedFreeThrowShooterId,
        expectedHistoryRevision: value.eventHistoryRevision,
        createdAtUtc: value.createdAtUtc, updatedAtUtc: value.updatedAtUtc,
    };
}
function eventSummary(value: unknown): MatchGameplayEventSummary {
    const metadata = eventMetadata(value);
    const event = record(value);
    const eventPeriod = record(event?.period);
    const summaryPeriod: NonNullable<MatchGameplayEventSummary["period"]> | undefined = eventPeriod
        && (eventPeriod.kind === "REGULATION" || eventPeriod.kind === "OVERTIME")
        && Number.isInteger(eventPeriod.index)
        && Number(eventPeriod.index) > 0
        ? { kind: eventPeriod.kind, index: Number(eventPeriod.index) }
        : undefined;
    return {
        eventId: metadata.id,
        sequence: metadata.sequence,
        occurredAt: metadata.occurredAt,
        type: metadata.type,
        ...(summaryPeriod ? { period: summaryPeriod } : {}),
        ...(event?.team === "HOME" || event?.team === "AWAY" ? { team: event.team } : {}),
        ...(typeof event?.playerId === "string" ? { playerId: event.playerId } : {}),
        ...(typeof event?.made === "boolean" ? { made: event.made } : {}),
        ...(metadata.scorerEventId ? { scorerEventId: metadata.scorerEventId } : {}),
        ...(metadata.scorerEventTerminal ? { scorerEventTerminal: metadata.scorerEventTerminal } : {}),
        ...(metadata.scorerEventContext ? { scorerEventContext: metadata.scorerEventContext } : {}),
    };
}

function scorerEventHistoryProjection(records: MatchGameplayHistoryFactRecord[]): { records: MatchGameplayHistoryRecord[]; groups: MatchGameplayScorerEventGroup[] } {
    const chronological = [...records].sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
    const byId = new Map(chronological.map((item) => [item.eventId, item]));
    const bySequence = new Map(chronological.map((item) => [item.sequence, item]));
    const goalFoulShotEventIds = new Set<string>();
    for (const item of chronological) {
        const foulContext = record(item.facts.context);
        const relatedShotEventId = typeof item.facts.relatedShotEventId === "string" ? item.facts.relatedShotEventId : undefined;
        if (item.type !== "PERSONAL_FOUL" || foulContext?.kind !== "SHOOTING" || !relatedShotEventId) continue;
        const relatedShot = byId.get(relatedShotEventId);
        if (relatedShot?.type === "TWO_POINT" || relatedShot?.type === "THREE_POINT") goalFoulShotEventIds.add(relatedShotEventId);
    }
    const parent = new Map(chronological.filter((item) => !item.scorerEventId).map((item) => [item.eventId, item.eventId]));
    const find = (eventId: string): string => {
        const current = parent.get(eventId);
        if (!current || current === eventId) return eventId;
        const root = find(current);
        parent.set(eventId, root);
        return root;
    };
    const joinLegacy = (leftId: string, rightId: string) => {
        if (!parent.has(leftId) || !parent.has(rightId)) return;
        const leftRoot = find(leftId); const rightRoot = find(rightId);
        if (leftRoot === rightRoot) return;
        const left = byId.get(leftRoot); const right = byId.get(rightRoot);
        if (!left || !right) return;
        const [earlier, later] = left.sequence < right.sequence || (left.sequence === right.sequence && left.eventId.localeCompare(right.eventId) <= 0)
            ? [leftRoot, rightRoot]
            : [rightRoot, leftRoot];
        parent.set(later, earlier);
    };
    const foulTypes = new Set(["PERSONAL_FOUL", "TECHNICAL_FOUL", "DISRUPTIVE_FOUL", "FLAGRANT_FOUL", "DISQUALIFYING_FOUL"]);
    const foulByPenaltyId = new Map(chronological.filter((item) => !item.scorerEventId && foulTypes.has(item.type)).map((item) => [`penalty:${item.eventId}`, item]));
    for (const item of chronological) {
        if (item.scorerEventId) continue;
        const relatedShotEventId = typeof item.facts.relatedShotEventId === "string" ? item.facts.relatedShotEventId : undefined;
        if (foulTypes.has(item.type) && relatedShotEventId) joinLegacy(relatedShotEventId, item.eventId);
        if ((item.type === "FREE_THROW" || item.type === "PENALTY_ADMINISTRATION_ENDED") && typeof item.facts.penaltyId === "string") {
            const sourceFoul = foulByPenaltyId.get(item.facts.penaltyId);
            if (sourceFoul) joinLegacy(sourceFoul.eventId, item.eventId);
        }
        if (item.type === "STEAL") {
            const turnover = bySequence.get(item.sequence - 1);
            if (turnover && !turnover.scorerEventId && turnover.type === "TURNOVER" && turnover.team && item.team && turnover.team !== item.team) joinLegacy(turnover.eventId, item.eventId);
        }
    }
    const buckets = new Map<string, MatchGameplayHistoryFactRecord[]>();
    for (const item of chronological) {
        const key = item.scorerEventId ? `explicit:${item.scorerEventId}` : `legacy:${find(item.eventId)}`;
        const members = buckets.get(key) ?? [];
        members.push(item);
        buckets.set(key, members);
    }
    const definitions = [...buckets.entries()].map(([scorerEventGroupId, members]) => {
        const items = [...members].sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
        const groupingSource: MatchGameplayScorerEventGroupingSource = scorerEventGroupId.startsWith("explicit:") ? "EXPLICIT" : items.length > 1 ? "LEGACY_UNAMBIGUOUS" : "LEGACY_ATOMIC";
        const terminals = items.filter((item) => item.scorerEventTerminal);
        const terminalConflict = terminals.length > 1;
        const scorerEventTerminal = terminals.length === 1 ? terminals[0]?.scorerEventTerminal : undefined;
        const anchor = items.find((item) => item.type !== "PENALTY_ADMINISTRATION_ENDED") ?? items[0]!;
        const missingTechnicalStaffSource = items.some((item) => {
            const offender = record(item.facts.offender);
            return item.type === "TECHNICAL_FOUL" && item.facts.category === "CATEGORY_1" && offender?.kind === "BENCH" && offender.role === "HEAD_COACH" && !item.scorerEventContext?.technicalStaffSource;
        });
        return { scorerEventGroupId, items, groupingSource, terminalConflict, scorerEventTerminal, anchor, safeForReconstruction: groupingSource === "EXPLICIT" && terminals.length === 1 && !missingTechnicalStaffSource };
    }).sort((left, right) => left.items[0]!.sequence - right.items[0]!.sequence || left.scorerEventGroupId.localeCompare(right.scorerEventGroupId));
    const groupByEventId = new Map<string, { scorerEventGroupId: string; scorerEventGroupOrdinal: number; scorerEventGroupingSource: MatchGameplayScorerEventGroupingSource; scorerEventGroupSafeForReconstruction: boolean }>();
    definitions.forEach((definition, scorerEventGroupOrdinal) => definition.items.forEach((item) => groupByEventId.set(item.eventId, { scorerEventGroupId: definition.scorerEventGroupId, scorerEventGroupOrdinal, scorerEventGroupingSource: definition.groupingSource, scorerEventGroupSafeForReconstruction: definition.safeForReconstruction })));
    const projectedRecords = chronological.map((item): MatchGameplayHistoryRecord => ({ ...item, ...groupByEventId.get(item.eventId)!, ...(goalFoulShotEventIds.has(item.eventId) ? { isGoalFoul: true } : {}) }));
    const projectedById = new Map(projectedRecords.map((item) => [item.eventId, item]));
    const groups = definitions.map((definition, groupOrdinal): MatchGameplayScorerEventGroup => ({
        scorerEventGroupId: definition.scorerEventGroupId,
        groupingSource: definition.groupingSource,
        groupOrdinal,
        canonicalEventIds: definition.items.map((item) => item.eventId),
        visibleEventIds: definition.items.filter((item) => item.type !== "PENALTY_ADMINISTRATION_ENDED").map((item) => item.eventId),
        firstSequence: definition.items[0]!.sequence,
        lastSequence: definition.items[definition.items.length - 1]!.sequence,
        period: { ...definition.anchor.period },
        clockSeconds: definition.anchor.clockSeconds,
        ...(definition.scorerEventTerminal ? { scorerEventTerminal: definition.scorerEventTerminal } : {}),
        terminalConflict: definition.terminalConflict,
        safeForReconstruction: definition.safeForReconstruction,
        items: definition.items.map((item) => projectedById.get(item.eventId)!),
    }));
    return { records: projectedRecords, groups };
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

    async appendAndResolveResumableFlow(runId: string, owner: MatchGameplayOwner | null, facts: MatchEventFacts): Promise<MatchGameplayRecovery> {
        return this.withRunLock(runId, () => this.appendUnlocked(runId, owner, facts, true));
    }

    async saveResumableLiveFlow(runId: string, owner: MatchGameplayOwner | null, input: ResumableLiveFlowInput): Promise<SafeResumableLiveFlow> {
        return this.withRunLock(runId, async () => {
            const current = await this.loadMutation(runId, owner);
            if (current.snapshot.eventHistoryRevision !== input.expectedHistoryRevision) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
            const stateJson = deterministicJson({ schemaVersion: 1, flowKind: input.flowKind, stage: input.stage, rootEventId: input.rootEventId, sourceFoulEventId: input.sourceFoulEventId, selectedFreeThrowShooterId: input.selectedFreeThrowShooterId });
            try {
                return safeResumableLiveFlow(this.database.saveLocalResumableLiveFlow({ runId, organizationId: owner!.organizationId, scorerId: owner!.scorerId, deviceId: this.deviceId, ...input, stateJson, stateHash: sha256JsonBytes(stateJson), updatedAtUtc: this.now().toISOString() }));
            } catch (error) {
                const conflict = databaseConflict(error);
                if (conflict === "ownership") throw new MatchGameplayFlowError("GAMEPLAY_OWNERSHIP_CONFLICT");
                if (conflict) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
                throw error;
            }
        });
    }

    getResumableLiveFlow(runId: string, owner: MatchGameplayOwner | null): SafeResumableLiveFlow | null {
        const run = this.requireRun(runId);
        assertOwner(run, owner, this.deviceId);
        const stored = this.database.readLocalResumableLiveFlow(runId);
        return stored ? safeResumableLiveFlow(stored) : null;
    }

    async appendMany(runId: string, owner: MatchGameplayOwner | null, facts: MatchEventFacts[]): Promise<MatchGameplayRecovery> {
        return this.withRunLock(runId, () => this.appendManyUnlocked(runId, owner, facts));
    }

    private async appendUnlocked(runId: string, owner: MatchGameplayOwner | null, facts: MatchEventFacts, clearResumableFlow = false): Promise<MatchGameplayRecovery> {
        if (!facts.type.trim() || facts.type === "MATCH_END" || facts.type === "ROSTER_PLAYER_ADDED") throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const current = await this.loadMutation(runId, owner);
        const occurredAt = this.now().getTime();
        const sequence = current.run.lastAcceptedSequence + 1;
        const event = { ...facts, schemaVersion: 2, id: this.id(), occurredAt, sequence };
        accepted(current.engine.preview(event));
        return this.persistAppend(current, owner, event, occurredAt, clearResumableFlow);
    }

    private async appendManyUnlocked(runId: string, owner: MatchGameplayOwner | null, facts: MatchEventFacts[]): Promise<MatchGameplayRecovery> {
        if (!Array.isArray(facts) || facts.length < 1 || facts.length > 16 || facts.some((item) => !item.type.trim() || item.type === "MATCH_END" || item.type === "ROSTER_PLAYER_ADDED")) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        if (facts.length === 1) return this.appendUnlocked(runId, owner, facts[0]);
        const current = await this.loadMutation(runId, owner);
        const candidate = current.engine.fork();
        const occurredAt = this.now().getTime();
        const events = facts.map((item, index) => ({ ...item, schemaVersion: 2, id: this.id(), occurredAt, sequence: current.run.lastAcceptedSequence + index + 1 }));
        for (const event of events) accepted(candidate.process(event));
        return this.persistAppendMany(current, candidate, owner, events, occurredAt);
    }

    async history(runId: string, owner: MatchGameplayOwner | null, query: MatchGameplayHistoryQuery): Promise<MatchGameplayHistoryPage> {
        const projection = this.projectedHistory(runId, owner);
        const matching = projection.records.filter((item) => (!query.period || (item.period.kind === query.period.kind && item.period.index === query.period.index)) && (query.beforeSequence === null || item.sequence < query.beforeSequence));
        const ordered = matching.sort((left, right) => right.sequence - left.sequence);
        const items = ordered.slice(0, query.limit);
        return { runId, items, nextBeforeSequence: ordered.length > items.length ? items[items.length - 1]?.sequence ?? null : null, total: projection.records.filter((item) => !query.period || (item.period.kind === query.period.kind && item.period.index === query.period.index)).length };
    }

    async scorerEventGroup(runId: string, owner: MatchGameplayOwner | null, scorerEventGroupId: string): Promise<MatchGameplayScorerEventGroup | null> {
        if (!scorerEventGroupId.trim()) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        return this.projectedHistory(runId, owner).groups.find((group) => group.scorerEventGroupId === scorerEventGroupId) ?? null;
    }

    async scorerEventEditContext(runId: string, owner: MatchGameplayOwner | null, scorerEventGroupId: string, mode: MatchGameplayScorerEventEditMode = { mode: "HISTORY" }): Promise<MatchGameplayScorerEventEditContext | null> {
        if (!scorerEventGroupId.trim()) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const run = this.requireRun(runId); assertOwner(run, owner, this.deviceId);
        const group = this.projectedHistory(runId, owner).groups.find((item) => item.scorerEventGroupId === scorerEventGroupId);
        if (!group) return null;
        const snapshot = this.database.readLocalMatchEngineSnapshot(runId);
        if (!snapshot || sha256JsonBytes(snapshot.initialStateJson) !== snapshot.initialStateHash) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
        const initialState = jsonObject(parseDeterministicJson(snapshot.initialStateJson));
        const canonicalEvents = this.database.readLocalMatchEvents(runId).map((row) => {
            if (row.eventSchemaVersion !== 2 || sha256JsonBytes(row.eventJson) !== row.eventHash) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
            const event = jsonObject(parseDeterministicJson(row.eventJson)); const metadata = eventMetadata(event);
            if (metadata.id !== row.eventId || metadata.sequence !== row.sequence) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
            return event;
        });
        const groupIds = new Set(group.canonicalEventIds); const timeline = await loadEngine(initialState);
        let preGroupState: JsonObject | null = null; const stateBefore = new Map<string, JsonObject>(); const stateAfter = new Map<string, JsonObject>();
        for (const event of canonicalEvents) {
            const metadata = eventMetadata(event);
            if (metadata.sequence === group.firstSequence) preGroupState = jsonObject(timeline.getState());
            if (groupIds.has(metadata.id)) stateBefore.set(metadata.id, jsonObject(timeline.getState()));
            accepted(timeline.process(event));
            if (groupIds.has(metadata.id)) stateAfter.set(metadata.id, jsonObject(timeline.getState()));
        }
        const postGroupState = jsonObject(timeline.getState());
        if (!preGroupState || stateBefore.size !== group.canonicalEventIds.length || stateAfter.size !== group.canonicalEventIds.length) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");

        const projectPlayers = (state: JsonObject): MatchGameplayHistoricalPlayerContext[] => {
            const result: MatchGameplayHistoricalPlayerContext[] = [];
            for (const side of ["HOME", "AWAY"] as const) {
                const teamState = record(state[side.toLowerCase()]);
                if (!teamState || !Array.isArray(teamState.players)) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
                for (const value of teamState.players) {
                    const player = record(value); const foulState = record(player?.foulState);
                    if (!player || !foulState || typeof player.playerId !== "string" || typeof player.displayName !== "string" || typeof player.shirtNumber !== "string" || typeof foulState.status !== "string") throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
                    result.push({ playerId: player.playerId, side, displayName: player.displayName, shirtNumber: player.shirtNumber, participating: true, onCourt: player.onCourt === true, eligible: foulState.status === "ELIGIBLE", foulStatus: foulState.status, foulStatusReason: typeof foulState.statusReason === "string" ? foulState.statusReason : null, totalFouls: typeof foulState.total === "number" ? foulState.total : 0, directDisqualification: foulState.directDisqualification === true });
                }
            }
            return result;
        };
        const playerSide = (state: JsonObject, playerId: string): "HOME" | "AWAY" | null => projectPlayers(state).find((player) => player.playerId === playerId)?.side ?? null;
        const candidates = (state: JsonObject, sides: readonly ("HOME" | "AWAY")[], excluded: readonly string[] = [], originalPlayerId?: string): string[] => {
            const excludedIds = new Set(excluded); const players = projectPlayers(state);
            const result = players.filter((player) => sides.includes(player.side) && player.onCourt && player.eligible && !excludedIds.has(player.playerId)).map((player) => player.playerId);
            const original = originalPlayerId ? players.find((player) => player.playerId === originalPlayerId) : undefined;
            if (original && sides.includes(original.side) && original.eligible && !excludedIds.has(original.playerId) && !result.includes(original.playerId)) result.unshift(original.playerId);
            return result;
        };
        const groupScorerEventIds = new Set(group.items.map((item) => item.scorerEventId).filter((id): id is string => Boolean(id)));
        const terminalCount = group.items.filter((item) => item.scorerEventTerminal !== undefined).length;
        const currentOpenCapability = mode.mode === "CURRENT_OPEN"
            && run.status === "active"
            && group.groupingSource === "EXPLICIT"
            && group.scorerEventGroupId === `explicit:${mode.scorerEventId}`
            && groupScorerEventIds.size === 1
            && groupScorerEventIds.has(mode.scorerEventId)
            && group.lastSequence === run.lastAcceptedSequence
            && terminalCount === 0
            && !group.terminalConflict;
        const historicalCapability = run.status === "active" && group.groupingSource === "EXPLICIT" && group.safeForReconstruction && !group.terminalConflict;
        const baseCapability = mode.mode === "CURRENT_OPEN" ? currentOpenCapability : historicalCapability;
        const immutableReason = run.status !== "active" ? "FINALIZED_RUN" as const : !baseCapability ? "UNSAFE_GROUP" as const : null;
        const factsByEventId = new Map(group.items.map((item) => [item.eventId, item.facts])); const targets: MatchGameplayHistoricalEditTarget[] = [];
        const addTarget = (input: Omit<MatchGameplayHistoricalEditTarget, "editable" | "readOnlyReason"> & { supported: boolean }): void => {
            const decisionTarget = input.kind === "SHOT_RESULT" || input.kind === "FREE_THROW_RESULT";
            const reason = immutableReason ?? (!input.supported ? "UNSUPPORTED_TARGET" as const : !decisionTarget && input.candidatePlayerIds.length === 0 ? "NO_HISTORICAL_CANDIDATES" as const : null);
            targets.push({ ...input, editable: reason === null, readOnlyReason: reason });
        };
        for (const item of group.items) {
            const facts = record(item.facts); const before = stateBefore.get(item.eventId);
            if (!facts || !before) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
            const side = facts.team === "HOME" || facts.team === "AWAY" ? facts.team : null;
            if (["TWO_POINT", "TWO_POINT_MISSED", "THREE_POINT", "THREE_POINT_MISSED"].includes(String(facts.type)) && side && typeof facts.playerId === "string") {
                const assistPlayerId = typeof facts.assistPlayerId === "string" ? facts.assistPlayerId : undefined;
                addTarget({ targetId: `${item.eventId}:shooter`, kind: "SHOOTER", eventId: item.eventId, currentPlayerId: facts.playerId, canonicalSide: side, candidatePlayerIds: candidates(before, [side], assistPlayerId ? [assistPlayerId] : [], facts.playerId), sameTeamOnly: true, forwardPropagation: false, supported: true });
                if (assistPlayerId) addTarget({ targetId: `${item.eventId}:assist`, kind: "ASSIST", eventId: item.eventId, currentPlayerId: assistPlayerId, canonicalSide: side, candidatePlayerIds: candidates(before, [side], [facts.playerId], assistPlayerId), sameTeamOnly: true, forwardPropagation: false, supported: true });
                addTarget({ targetId: `${item.eventId}:result`, kind: "SHOT_RESULT", eventId: item.eventId, currentPlayerId: null, canonicalSide: side, candidatePlayerIds: [], sameTeamOnly: false, forwardPropagation: true, currentValue: String(facts.type).endsWith("_MISSED") ? "MISS" : "MADE", allowedValues: ["MADE", "MISS"], supported: true });
            } else if (["PERSONAL_FOUL", "TECHNICAL_FOUL", "DISRUPTIVE_FOUL", "FLAGRANT_FOUL", "DISQUALIFYING_FOUL"].includes(String(facts.type)) && side) {
                const offender = record(facts.offender);
                if (offender?.kind === "PLAYER" && typeof offender.playerId === "string") addTarget({ targetId: `${item.eventId}:offender`, kind: facts.type === "TECHNICAL_FOUL" ? "TECHNICAL_PLAYER" : "FOULER", eventId: item.eventId, currentPlayerId: offender.playerId, canonicalSide: side, candidatePlayerIds: candidates(before, [side], [], offender.playerId), sameTeamOnly: true, forwardPropagation: false, supported: true });
                else if (offender) addTarget({ targetId: `${item.eventId}:offender`, kind: "FOULER", eventId: item.eventId, currentPlayerId: null, canonicalSide: side, candidatePlayerIds: [], sameTeamOnly: true, forwardPropagation: false, supported: false });
                if (typeof facts.fouledPlayerId === "string") {
                    const drawnSide = playerSide(before, facts.fouledPlayerId); const relatedShot = typeof facts.relatedShotEventId === "string" ? record(factsByEventId.get(facts.relatedShotEventId)) : null;
                    const conflictingAssist = typeof relatedShot?.assistPlayerId === "string" ? [relatedShot.assistPlayerId] : [];
                    addTarget({ targetId: `${item.eventId}:drawn-by`, kind: "DRAWN_BY", eventId: item.eventId, currentPlayerId: facts.fouledPlayerId, canonicalSide: drawnSide, candidatePlayerIds: drawnSide ? candidates(before, [drawnSide], conflictingAssist, facts.fouledPlayerId) : [], sameTeamOnly: true, forwardPropagation: true, supported: drawnSide !== null });
                }
            } else if (facts.type === "FREE_THROW" && side && typeof facts.playerId === "string") {
                addTarget({ targetId: `${item.eventId}:free-throw-shooter`, kind: "FREE_THROW_SHOOTER", eventId: item.eventId, currentPlayerId: facts.playerId, canonicalSide: side, candidatePlayerIds: candidates(before, [side], [], facts.playerId), sameTeamOnly: true, forwardPropagation: false, supported: true });
                addTarget({ targetId: `${item.eventId}:result`, kind: "FREE_THROW_RESULT", eventId: item.eventId, currentPlayerId: null, canonicalSide: side, candidatePlayerIds: [], sameTeamOnly: false, forwardPropagation: true, currentValue: facts.made === true ? "MADE" : "MISS", allowedValues: ["MADE", "MISS"], supported: true });
            }
            else if (facts.type === "BLOCK" && side && typeof facts.playerId === "string") addTarget({ targetId: `${item.eventId}:blocker`, kind: "BLOCKER", eventId: item.eventId, currentPlayerId: facts.playerId, canonicalSide: side, candidatePlayerIds: candidates(before, [side], [], facts.playerId), sameTeamOnly: true, forwardPropagation: false, supported: true });
            else if (facts.type === "TURNOVER" && side && typeof facts.playerId === "string") addTarget({ targetId: `${item.eventId}:turnover-by`, kind: "TURNOVER_BY", eventId: item.eventId, currentPlayerId: facts.playerId, canonicalSide: side, candidatePlayerIds: candidates(before, [side], [], facts.playerId), sameTeamOnly: true, forwardPropagation: false, supported: true });
            else if (facts.type === "STEAL" && side && typeof facts.playerId === "string") addTarget({ targetId: `${item.eventId}:stealer`, kind: "STEALER", eventId: item.eventId, currentPlayerId: facts.playerId, canonicalSide: side, candidatePlayerIds: candidates(before, [side], [], facts.playerId), sameTeamOnly: true, forwardPropagation: false, supported: true });
            else if (facts.type === "REBOUND" && side) addTarget({ targetId: `${item.eventId}:rebounder`, kind: "REBOUNDER", eventId: item.eventId, currentPlayerId: typeof facts.playerId === "string" ? facts.playerId : null, canonicalSide: side, candidatePlayerIds: typeof facts.playerId === "string" ? candidates(before, [side], [], facts.playerId) : [], sameTeamOnly: true, forwardPropagation: false, supported: typeof facts.playerId === "string" });
        }
        const penaltyFromState = (state: JsonObject, requestedPenaltyId?: string): MatchGameplayHistoricalPenaltyContext | null => {
            const resolution = record(state.penaltyResolution);
            if (!resolution || !Array.isArray(resolution.entitlements) || !Array.isArray(resolution.freeThrowQueue)) return null;
            const queueIds = resolution.freeThrowQueue.map((entry) => record(entry)?.penaltyId).filter((id): id is string => typeof id === "string"); const penaltyId = requestedPenaltyId ?? queueIds[0];
            const entitlement = record(resolution.entitlements.find((entry) => record(entry)?.penaltyId === penaltyId));
            if (!entitlement || entitlement.kind !== "FREE_THROWS" || typeof entitlement.penaltyId !== "string" || typeof entitlement.sourceFoulEventId !== "string" || (entitlement.beneficiaryTeam !== "HOME" && entitlement.beneficiaryTeam !== "AWAY") || (entitlement.shooterPolicy !== "FOULED_PLAYER" && entitlement.shooterPolicy !== "ANY_OPPONENT") || typeof entitlement.attempts !== "number" || typeof entitlement.completedAttempts !== "number") return null;
            const restart = record(entitlement.restart); const finalRestart = record(resolution.finalRestart); const restartKind = typeof restart?.kind === "string" ? restart.kind : typeof finalRestart?.kind === "string" ? finalRestart.kind : "UNKNOWN"; const remainingAttempts = Math.max(0, entitlement.attempts - entitlement.completedAttempts);
            return { penaltyId: entitlement.penaltyId, sourceFoulEventId: entitlement.sourceFoulEventId, beneficiarySide: entitlement.beneficiaryTeam, shooterPolicy: entitlement.shooterPolicy, designatedPlayerId: typeof entitlement.designatedPlayerId === "string" ? entitlement.designatedPlayerId : null, totalAttempts: entitlement.attempts, completedAttempts: entitlement.completedAttempts, remainingAttempts, nextAttemptNumber: remainingAttempts > 0 ? entitlement.completedAttempts + 1 : null, restartKind, liveBallReboundAfterFinalMiss: restartKind === "LIVE_BALL" };
        };
        const terminalItem = group.items.find((item) => item.scorerEventTerminal !== undefined); let projectedContinuation: MatchGameplayHistoricalContinuationPlan | null = null;
        if (terminalItem?.scorerEventTerminal?.reason === "ENTER_EARLY" && terminalItem.scorerEventTerminal.unresolvedStep) {
            const terminalFacts = record(terminalItem.facts); const beforeTerminal = stateBefore.get(terminalItem.eventId); const afterTerminal = stateAfter.get(terminalItem.eventId);
            if (!terminalFacts || !beforeTerminal || !afterTerminal) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED"); const unresolved = terminalItem.scorerEventTerminal.unresolvedStep;
            if (unresolved === "ASSIST") {
                const shot = [...group.items].reverse().find((item) => ["TWO_POINT", "THREE_POINT"].includes(item.type)); const shotFacts = shot ? record(shot.facts) : null; const shotState = shot ? stateBefore.get(shot.eventId) : null;
                if (shot && shotFacts && shotState && (shotFacts.team === "HOME" || shotFacts.team === "AWAY") && typeof shotFacts.playerId === "string") projectedContinuation = { kind: "ASSIST", shotEventId: shot.eventId, side: shotFacts.team, candidatePlayerIds: candidates(shotState, [shotFacts.team], [shotFacts.playerId]), noAssistAllowed: true };
            } else if (unresolved === "STEALER") {
                const turnover = [...group.items].reverse().find((item) => item.type === "TURNOVER"); const turnoverFacts = turnover ? record(turnover.facts) : null; const turnoverState = turnover ? stateBefore.get(turnover.eventId) : null;
                if (turnover && turnoverFacts && turnoverState && (turnoverFacts.team === "HOME" || turnoverFacts.team === "AWAY")) { const side = turnoverFacts.team === "HOME" ? "AWAY" : "HOME"; projectedContinuation = { kind: "STEALER", turnoverEventId: turnover.eventId, side, candidatePlayerIds: candidates(turnoverState, [side]), noStealAllowed: true }; }
            } else {
                const requestedPenaltyId = typeof terminalFacts.penaltyId === "string" ? terminalFacts.penaltyId : [...group.items].reverse().map((item) => record(item.facts)?.penaltyId).find((id): id is string => typeof id === "string"); const penaltyState = terminalFacts.type === "PENALTY_ADMINISTRATION_ENDED" ? beforeTerminal : afterTerminal; const penalty = penaltyFromState(penaltyState, requestedPenaltyId); const penaltyCandidates = penalty ? candidates(penaltyState, [penalty.beneficiarySide]) : [];
                const lastFreeThrow = [...group.items].reverse().find((item) => item.type === "FREE_THROW" && (!penalty || record(item.facts)?.penaltyId === penalty.penaltyId)); const lastFreeThrowFacts = lastFreeThrow ? record(lastFreeThrow.facts) : null;
                const selectedShooter = terminalItem.scorerEventTerminal.resumeContext?.penaltyShooterPlayerId ?? (typeof lastFreeThrowFacts?.playerId === "string" ? lastFreeThrowFacts.playerId : penalty?.designatedPlayerId ?? null);
                if (penalty && unresolved === "CHOOSE_SHOOTER" && !selectedShooter) projectedContinuation = { kind: "CHOOSE_SHOOTER", penalty, candidatePlayerIds: penaltyCandidates };
                else if (penalty && (unresolved === "FT1" || unresolved === "FT2" || unresolved === "FT3" || unresolved === "CHOOSE_SHOOTER") && selectedShooter && penalty.nextAttemptNumber !== null) { const postResultContinuation = penalty.remainingAttempts > 1 ? "NEXT_FREE_THROW" : penalty.liveBallReboundAfterFinalMiss ? "REBOUNDER_IF_FINAL_MISS" : "END"; projectedContinuation = { kind: "FREE_THROW_RESULT", penalty, shooterPlayerId: selectedShooter, candidatePlayerIds: penaltyCandidates, attemptNumber: penalty.nextAttemptNumber, allowedResults: ["MADE", "MISS"], postResultContinuation }; }
                else if (unresolved === "REBOUNDER") {
                    const factualFinalMiss = lastFreeThrowFacts?.made === false;
                    if (penalty && factualFinalMiss && penalty.remainingAttempts === 0 && penalty.liveBallReboundAfterFinalMiss) projectedContinuation = { kind: "REBOUNDER", sourceEventId: lastFreeThrow!.eventId, candidatePlayerIds: candidates(afterTerminal, ["HOME", "AWAY"]), teamReboundAllowed: true, penaltyId: penalty.penaltyId };
                    else if (!penalty) { const source = [...group.items].reverse().find((item) => item.type === "BLOCK" || item.type === "TWO_POINT_MISSED" || item.type === "THREE_POINT_MISSED"); if (source) projectedContinuation = { kind: "REBOUNDER", sourceEventId: source.eventId, candidatePlayerIds: candidates(afterTerminal, ["HOME", "AWAY"]), teamReboundAllowed: true, penaltyId: null }; }
                }
            }
        }
        if (!projectedContinuation && currentOpenCapability) {
            const shootingFoul = group.items.find((item) => {
                const facts = record(item.facts); const context = record(facts?.context);
                return facts?.type === "PERSONAL_FOUL" && context?.kind === "SHOOTING" && typeof facts.relatedShotEventId === "string";
            });
            const foulFacts = shootingFoul ? record(shootingFoul.facts) : null;
            const shot = typeof foulFacts?.relatedShotEventId === "string" ? group.items.find((item) => item.eventId === foulFacts.relatedShotEventId) : undefined;
            const shotFacts = shot ? record(shot.facts) : null; const shotState = shot ? stateBefore.get(shot.eventId) : null;
            if (shot && shotFacts && shotState && ["TWO_POINT", "THREE_POINT"].includes(String(shotFacts.type)) && (shotFacts.team === "HOME" || shotFacts.team === "AWAY") && typeof shotFacts.playerId === "string" && typeof shotFacts.assistPlayerId !== "string") projectedContinuation = { kind: "ASSIST", shotEventId: shot.eventId, side: shotFacts.team, candidatePlayerIds: candidates(shotState, [shotFacts.team], [shotFacts.playerId]), noAssistAllowed: true };
        }
        if (!projectedContinuation) {
            const openPenalty = penaltyFromState(postGroupState);
            if (openPenalty) {
                const lastFreeThrow = [...group.items].reverse().find((item) => item.type === "FREE_THROW" && record(item.facts)?.penaltyId === openPenalty.penaltyId); const lastFacts = lastFreeThrow ? record(lastFreeThrow.facts) : null;
                const shooter = typeof lastFacts?.playerId === "string" ? lastFacts.playerId : openPenalty.designatedPlayerId;
                const penaltyCandidates = candidates(postGroupState, [openPenalty.beneficiarySide]);
                if (openPenalty.nextAttemptNumber !== null && shooter) projectedContinuation = { kind: "FREE_THROW_RESULT", penalty: openPenalty, shooterPlayerId: shooter, candidatePlayerIds: penaltyCandidates, attemptNumber: openPenalty.nextAttemptNumber, allowedResults: ["MADE", "MISS"], postResultContinuation: openPenalty.remainingAttempts > 1 ? "NEXT_FREE_THROW" : openPenalty.liveBallReboundAfterFinalMiss ? "REBOUNDER_IF_FINAL_MISS" : "END" };
                else if (openPenalty.nextAttemptNumber !== null) projectedContinuation = { kind: "CHOOSE_SHOOTER", penalty: openPenalty, candidatePlayerIds: penaltyCandidates };
                else if (lastFreeThrow && lastFacts?.made === false && openPenalty.liveBallReboundAfterFinalMiss && !group.items.some((item) => item.type === "REBOUND" && item.sequence > lastFreeThrow.sequence)) projectedContinuation = { kind: "REBOUNDER", sourceEventId: lastFreeThrow.eventId, candidatePlayerIds: candidates(postGroupState, ["HOME", "AWAY"]), teamReboundAllowed: true, penaltyId: openPenalty.penaltyId };
            }
        }
        const continuationPlan = baseCapability ? projectedContinuation : null; const canResume = historicalCapability && terminalItem?.scorerEventTerminal?.reason === "ENTER_EARLY" && continuationPlan !== null; const canDeleteGroup = historicalCapability; const safeForEdit = baseCapability && (targets.some((target) => target.editable) || canResume); const historicalPlayers = projectPlayers(preGroupState); const stoppageId = group.items.map((item) => record(item.facts)?.stoppageId).find((value): value is string => typeof value === "string") ?? null;
        return { group, lifecycle: run.status === "finalized" ? "finalized" : "live", expectedHistoryRevision: snapshot.eventHistoryRevision, historicalState: { anchor: "BEFORE_GROUP", teams: (["HOME", "AWAY"] as const).map((side) => ({ side, players: historicalPlayers.filter((player) => player.side === side) })) }, editCapabilities: { safeForEdit, canResume, canDeleteGroup, targets }, continuationPlan, timeContext: { period: group.period, clockSeconds: group.clockSeconds, stoppageId } };
    }

    async mutateScorerEventGroup(runId: string, owner: MatchGameplayOwner | null, mutation: MatchGameplayScorerEventMutation): Promise<MatchGameplayRecovery> {
        return this.withRunLock(runId, () => this.mutateScorerEventGroupUnlocked(runId, owner, mutation, false));
    }

    async previewScorerEventGroupMutation(runId: string, owner: MatchGameplayOwner | null, input: MatchGameplayScorerEventMutationPreviewInput): Promise<MatchGameplayScorerEventMutationPreview> {
        return this.withRunLock(runId, () => this.previewScorerEventGroupMutationUnlocked(runId, owner, input));
    }

    private async previewScorerEventGroupMutationUnlocked(runId: string, owner: MatchGameplayOwner | null, input: MatchGameplayScorerEventMutationPreviewInput): Promise<MatchGameplayScorerEventMutationPreview> {
        if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > 64 || new Set(input.events.map((event) => event.draftId)).size !== input.events.length || input.events.some((event) => !event.draftId.trim())) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const mode = input.mode ?? { mode: "HISTORY" as const };
        const prepare = (events: MatchGameplayScorerEventDraftEvent[]) => this.mutateScorerEventGroupUnlocked(runId, owner, { kind: "REPLACE_GROUP", scorerEventGroupId: input.scorerEventGroupId, expectedHistoryRevision: input.expectedHistoryRevision, mode, events: events.map((event) => ({ ...(event.eventId ? { eventId: event.eventId } : {}), facts: event.facts })) }, true);
        let draftEvents = input.events.map((event) => ({ ...event, facts: { ...event.facts } }));
        let prepared = await prepare(draftEvents);
        let projected = await this.projectPreparedScorerEventMutation(runId, owner, input.scorerEventGroupId, input.expectedHistoryRevision, mode, draftEvents, prepared);
        if (input.action) {
            let correctedFreeThrowDraftId: string | undefined;
            if (input.action.kind === "CORRECT_FREE_THROW_RESULT") {
                const targetId = input.action.targetId;
                correctedFreeThrowDraftId = projected.editContext.editCapabilities.targets.find((target) => target.targetId === targetId)?.eventId;
            }
            draftEvents = this.applyScorerEventDraftAction(projected, input.action, mode);
            prepared = await prepare(draftEvents);
            projected = await this.projectPreparedScorerEventMutation(runId, owner, input.scorerEventGroupId, input.expectedHistoryRevision, mode, draftEvents, prepared);
            if (input.action.kind === "CORRECT_FREE_THROW_RESULT" && !input.action.made && correctedFreeThrowDraftId) {
                const correctedFreeThrow = draftEvents.find((event) => event.draftId === correctedFreeThrowDraftId);
                const continuation = projected.editContext.continuationPlan;
                const authoritativeLiveBallRebound = correctedFreeThrow?.facts.type === "FREE_THROW"
                    && continuation?.kind === "REBOUNDER"
                    && continuation.sourceEventId === correctedFreeThrowDraftId
                    && continuation.penaltyId === correctedFreeThrow.facts.penaltyId;
                if (correctedFreeThrow?.facts.scorerEventTerminal?.unresolvedStep === "REBOUNDER" && !authoritativeLiveBallRebound) {
                    correctedFreeThrow.facts = { ...correctedFreeThrow.facts, scorerEventTerminal: { reason: "NATURAL" } };
                    prepared = await prepare(draftEvents);
                    projected = await this.projectPreparedScorerEventMutation(runId, owner, input.scorerEventGroupId, input.expectedHistoryRevision, mode, draftEvents, prepared);
                }
            }
        }
        return projected;
    }

    private applyScorerEventDraftAction(preview: MatchGameplayScorerEventMutationPreview, action: MatchGameplayScorerEventDraftAction, mode: MatchGameplayScorerEventEditMode): MatchGameplayScorerEventDraftEvent[] {
        const events = preview.draftEvents.map((event) => ({ ...event, facts: { ...event.facts } }));
        const byDraftId = new Map(events.map((event) => [event.draftId, event]));
        const clearTerminals = (): void => { for (const event of events) { const { scorerEventTerminal: _terminal, ...facts } = event.facts; event.facts = facts; } };
        const terminalEvent = (): MatchGameplayScorerEventDraftEvent => events.find((event) => event.facts.scorerEventTerminal !== undefined) ?? (() => { throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED"); })();
        const newDraft = (facts: MatchEventFacts): MatchGameplayScorerEventDraftEvent => ({ draftId: `draft:${this.id()}`, facts });
        if (action.kind === "CORRECT_PLAYER") {
            const target = preview.editContext.editCapabilities.targets.find((item) => item.targetId === action.targetId);
            if (!target?.editable || !target.candidatePlayerIds.includes(action.playerId)) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
            const event = byDraftId.get(target.eventId); if (!event) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
            if (target.kind === "FOULER" || target.kind === "TECHNICAL_PLAYER") event.facts = { ...event.facts, offender: { kind: "PLAYER", playerId: action.playerId } };
            else if (target.kind === "DRAWN_BY") event.facts = { ...event.facts, fouledPlayerId: action.playerId };
            else if (target.kind === "ASSIST") event.facts = { ...event.facts, assistPlayerId: action.playerId };
            else event.facts = { ...event.facts, playerId: action.playerId };
            return events;
        }
        if (action.kind === "CORRECT_SHOT_RESULT") {
            const target = preview.editContext.editCapabilities.targets.find((item) => item.targetId === action.targetId);
            if (!target?.editable || target.kind !== "SHOT_RESULT" || !target.allowedValues?.includes(action.made ? "MADE" : "MISS")) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
            const shot = byDraftId.get(target.eventId); if (!shot || !["TWO_POINT", "TWO_POINT_MISSED", "THREE_POINT", "THREE_POINT_MISSED"].includes(String(shot.facts.type))) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
            const points = String(shot.facts.type).startsWith("THREE") ? 3 : 2; const relatedFoul = events.find((event) => event.facts.relatedShotEventId === target.eventId);
            const removeTypes = new Set(relatedFoul ? ["FREE_THROW", "PENALTY_ADMINISTRATION_ENDED", "REBOUND", "BLOCK"] : ["REBOUND", "BLOCK"]);
            for (let index = events.length - 1; index >= 0; index -= 1) if (removeTypes.has(String(events[index]!.facts.type))) events.splice(index, 1);
            clearTerminals(); const { assistPlayerId: _assist, ...baseShot } = shot.facts;
            shot.facts = { ...baseShot, type: action.made ? (points === 3 ? "THREE_POINT" : "TWO_POINT") : points === 3 ? "THREE_POINT_MISSED" : "TWO_POINT_MISSED" } as MatchEventFacts;
            if (mode.mode === "CURRENT_OPEN") return events;
            if (action.made) {
                const carrier = relatedFoul ?? shot;
                carrier.facts = { ...carrier.facts, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "ASSIST" } };
            } else if (relatedFoul) {
                const sourceFoulEventId = relatedFoul.eventId ?? relatedFoul.draftId;
                events.push(newDraft({
                    type: "PENALTY_ADMINISTRATION_ENDED",
                    penaltyId: `penalty:${sourceFoulEventId}`,
                    scorerEventTerminal: {
                        reason: "ENTER_EARLY",
                        unresolvedStep: "FT1",
                        ...(typeof relatedFoul.facts.fouledPlayerId === "string" ? { resumeContext: { penaltyShooterPlayerId: relatedFoul.facts.fouledPlayerId } } : {}),
                    },
                }));
            } else {
                shot.facts = { ...shot.facts, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "REBOUNDER" } };
            }
            return events;
        }
        if (action.kind === "CORRECT_FREE_THROW_RESULT") {
            const target = preview.editContext.editCapabilities.targets.find((item) => item.targetId === action.targetId);
            if (!target?.editable || target.kind !== "FREE_THROW_RESULT" || !target.allowedValues?.includes(action.made ? "MADE" : "MISS")) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
            const freeThrow = byDraftId.get(target.eventId); if (!freeThrow || freeThrow.facts.type !== "FREE_THROW" || typeof freeThrow.facts.penaltyId !== "string" || typeof freeThrow.facts.attemptIndex !== "number") throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
            const laterAttempt = events.some((event) => event.facts.type === "FREE_THROW" && event.facts.penaltyId === freeThrow.facts.penaltyId && Number(event.facts.attemptIndex) > Number(freeThrow.facts.attemptIndex));
            const unresolvedAttempt = events.some((event) => event.facts.type === "PENALTY_ADMINISTRATION_ENDED" && event.facts.penaltyId === freeThrow.facts.penaltyId && /^FT[1-3]$/.test(String(event.facts.scorerEventTerminal?.unresolvedStep)) && Number(String(event.facts.scorerEventTerminal?.unresolvedStep).slice(2)) > Number(freeThrow.facts.attemptIndex));
            freeThrow.facts = { ...freeThrow.facts, made: action.made };
            const openNextAttempt = mode.mode === "CURRENT_OPEN" && preview.editContext.continuationPlan?.kind === "FREE_THROW_RESULT" && preview.editContext.continuationPlan.penalty.penaltyId === freeThrow.facts.penaltyId && preview.editContext.continuationPlan.attemptNumber > Number(freeThrow.facts.attemptIndex);
            if (openNextAttempt) { const { scorerEventTerminal: _terminal, ...facts } = freeThrow.facts; freeThrow.facts = facts; return events; }
            if (!laterAttempt && !unresolvedAttempt) {
                for (let index = events.length - 1; index >= 0; index -= 1) if (events[index]!.facts.type === "REBOUND") events.splice(index, 1);
                const { scorerEventTerminal: _terminal, ...facts } = freeThrow.facts;
                freeThrow.facts = {
                    ...facts,
                    scorerEventTerminal: action.made
                        ? { reason: "NATURAL" }
                        : { reason: "ENTER_EARLY", unresolvedStep: "REBOUNDER" },
                };
            }
            return events;
        }
        const plan = preview.editContext.continuationPlan;
        if (!plan) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        if (action.kind === "ASSIST") {
            if (plan.kind !== "ASSIST" || (action.playerId !== null && !plan.candidatePlayerIds.includes(action.playerId))) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
            const shot = byDraftId.get(plan.shotEventId); if (!shot) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED"); clearTerminals();
            shot.facts = action.playerId === null ? { ...shot.facts, scorerEventTerminal: { reason: "NATURAL", decisions: { assist: "NONE" } } } : { ...shot.facts, assistPlayerId: action.playerId, scorerEventTerminal: { reason: "NATURAL" } };
            return events;
        }
        if (action.kind === "STEALER") {
            if (plan.kind !== "STEALER" || (action.playerId !== null && !plan.candidatePlayerIds.includes(action.playerId))) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
            const turnover = byDraftId.get(plan.turnoverEventId); if (!turnover) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED"); clearTerminals();
            if (action.playerId === null) turnover.facts = { ...turnover.facts, scorerEventTerminal: { reason: "NATURAL", decisions: { steal: "NONE" } } };
            else events.push(newDraft({ type: "STEAL", team: plan.side, playerId: action.playerId, scorerEventTerminal: { reason: "NATURAL" } }));
            return events;
        }
        if (action.kind === "CHOOSE_SHOOTER") {
            if (plan.kind !== "CHOOSE_SHOOTER" || !plan.candidatePlayerIds.includes(action.playerId) || plan.penalty.nextAttemptNumber === null || plan.penalty.nextAttemptNumber > 3) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
            const carrier = terminalEvent(); carrier.facts = { ...carrier.facts, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: `FT${plan.penalty.nextAttemptNumber}` as "FT1" | "FT2" | "FT3", resumeContext: { penaltyShooterPlayerId: action.playerId } } };
            return events;
        }
        if (action.kind === "FREE_THROW_RESULT") {
            if (plan.kind !== "FREE_THROW_RESULT") throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED"); clearTerminals();
            const paeIndex = events.findIndex((event) => event.facts.type === "PENALTY_ADMINISTRATION_ENDED" && event.facts.penaltyId === plan.penalty.penaltyId); const pae = paeIndex >= 0 ? events.splice(paeIndex, 1)[0] : undefined;
            const freeThrow = newDraft({ type: "FREE_THROW", team: plan.penalty.beneficiarySide, playerId: plan.shooterPlayerId, penaltyId: plan.penalty.penaltyId, attemptIndex: plan.attemptNumber, made: action.made });
            if (plan.penalty.remainingAttempts > 1) {
                const nextAttempt = plan.attemptNumber + 1; if (nextAttempt > 3) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
                if (mode.mode === "CURRENT_OPEN") events.push(freeThrow);
                else {
                    if (!pae) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
                    freeThrow.facts = { ...freeThrow.facts }; pae.facts = { ...pae.facts, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: `FT${nextAttempt}` as "FT1" | "FT2" | "FT3", resumeContext: { penaltyShooterPlayerId: plan.shooterPlayerId } } }; events.push(freeThrow, pae);
                }
            } else {
                freeThrow.facts = { ...freeThrow.facts, scorerEventTerminal: !action.made && plan.postResultContinuation === "REBOUNDER_IF_FINAL_MISS" ? { reason: "ENTER_EARLY", unresolvedStep: "REBOUNDER" } : { reason: "NATURAL" } }; events.push(freeThrow);
            }
            return events;
        }
        if (action.kind === "REBOUNDER") {
            if (plan.kind !== "REBOUNDER" || (!action.teamRebound && (!action.playerId || !plan.candidatePlayerIds.includes(action.playerId))) || (action.teamRebound && !plan.teamReboundAllowed)) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
            const source = byDraftId.get(plan.sourceEventId); if (!source || (source.facts.team !== "HOME" && source.facts.team !== "AWAY")) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED"); clearTerminals();
            events.push(newDraft({ type: "REBOUND", team: action.team, ...(action.playerId ? { playerId: action.playerId } : {}), offensive: action.team === source.facts.team, ...(action.teamRebound ? { teamRebound: true } : {}), scorerEventTerminal: { reason: "NATURAL" } })); return events;
        }
        throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
    }

    private async projectPreparedScorerEventMutation(runId: string, owner: MatchGameplayOwner | null, scorerEventGroupId: string, expectedHistoryRevision: number, mode: MatchGameplayScorerEventEditMode, inputEvents: MatchGameplayScorerEventDraftEvent[], prepared: PreparedScorerEventMutation): Promise<MatchGameplayScorerEventMutationPreview> {
        const persistedAtUtc = this.now().toISOString(); const virtualRows = prepared.canonicalEvents.map((event) => ({ runId, ...eventWrite(event, persistedAtUtc) })); const virtualRun = { ...prepared.current.run, lastAcceptedSequence: prepared.canonicalEvents.length };
        const virtualDatabase = Object.create(this.database) as LocalDatabase;
        virtualDatabase.readLocalGameRun = (requestedRunId: string) => requestedRunId === runId ? virtualRun : null;
        virtualDatabase.readLocalMatchEngineSnapshot = (requestedRunId: string) => requestedRunId === runId ? prepared.current.snapshot : null;
        virtualDatabase.readLocalMatchEvents = (requestedRunId: string) => requestedRunId === runId ? virtualRows : [];
        const virtualManager = new MatchGameplayManager(this.setup, virtualDatabase, this.deviceId, this.now, this.id, this.sealLiveAuthorization, this.maxCachedSessions);
        const projectedMode = mode.mode === "CURRENT_OPEN" && inputEvents.every((event) => event.facts.scorerEventTerminal === undefined) ? mode : { mode: "HISTORY" as const };
        const context = await virtualManager.scorerEventEditContext(runId, owner, scorerEventGroupId, projectedMode); if (!context || context.group.canonicalEventIds.length !== inputEvents.length || prepared.replacementEventIds.length !== inputEvents.length) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        const actualToDraft = new Map(prepared.replacementEventIds.map((eventId, index) => [eventId, inputEvents[index]!.draftId])); const remap = (eventId: string): string => actualToDraft.get(eventId) ?? eventId;
        const group: MatchGameplayScorerEventGroup = { ...context.group, canonicalEventIds: context.group.canonicalEventIds.map(remap), visibleEventIds: context.group.visibleEventIds.map(remap), items: context.group.items.map((item) => ({ ...item, eventId: remap(item.eventId) })) };
        const remapPlan = (plan: MatchGameplayHistoricalContinuationPlan | null): MatchGameplayHistoricalContinuationPlan | null => {
            if (!plan) return null; if (plan.kind === "ASSIST") return { ...plan, shotEventId: remap(plan.shotEventId) }; if (plan.kind === "STEALER") return { ...plan, turnoverEventId: remap(plan.turnoverEventId) }; if (plan.kind === "REBOUNDER") return { ...plan, sourceEventId: remap(plan.sourceEventId) }; return plan;
        };
        const editContext: MatchGameplayScorerEventEditContext = { ...context, group, editCapabilities: { ...context.editCapabilities, targets: context.editCapabilities.targets.map((target) => ({ ...target, eventId: remap(target.eventId), targetId: `${remap(target.eventId)}:${target.targetId.slice(target.targetId.indexOf(":") + 1)}` })) }, continuationPlan: remapPlan(context.continuationPlan) };
        const inputByDraft = new Map(inputEvents.map((event) => [event.draftId, event])); const draftEvents = context.group.items.map((item) => { const draftId = remap(item.eventId); const input = inputByDraft.get(draftId); return { draftId, ...(input?.eventId ? { eventId: input.eventId } : {}), facts: item.facts }; });
        return { scorerEventGroupId, expectedHistoryRevision, normalizedGroup: group, editContext, draftEvents };
    }

    private async mutateScorerEventGroupUnlocked(runId: string, owner: MatchGameplayOwner | null, mutation: MatchGameplayScorerEventMutation, previewOnly: true): Promise<PreparedScorerEventMutation>;
    private async mutateScorerEventGroupUnlocked(runId: string, owner: MatchGameplayOwner | null, mutation: MatchGameplayScorerEventMutation, previewOnly?: false): Promise<MatchGameplayRecovery>;
    private async mutateScorerEventGroupUnlocked(runId: string, owner: MatchGameplayOwner | null, mutation: MatchGameplayScorerEventMutation, previewOnly = false): Promise<MatchGameplayRecovery | PreparedScorerEventMutation> {
        if (!mutation.scorerEventGroupId.trim() || !Number.isInteger(mutation.expectedHistoryRevision) || mutation.expectedHistoryRevision < 1) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
        const current = await this.loadMutation(runId, owner);
        if (current.snapshot.eventHistoryRevision !== mutation.expectedHistoryRevision) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
        const group = this.projectedHistory(runId, owner).groups.find((item) => item.scorerEventGroupId === mutation.scorerEventGroupId);
        if (!group) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        const mode = mutation.kind === "REPLACE_GROUP" ? mutation.mode ?? { mode: "HISTORY" as const } : { mode: "HISTORY" as const };
        const groupScorerEventIds = new Set(group.items.map((item) => item.scorerEventId).filter((id): id is string => Boolean(id)));
        const terminalCount = group.items.filter((item) => item.scorerEventTerminal !== undefined).length;
        const currentOpenCapability = mode.mode === "CURRENT_OPEN" && current.run.status === "active" && group.groupingSource === "EXPLICIT" && group.scorerEventGroupId === `explicit:${mode.scorerEventId}` && groupScorerEventIds.size === 1 && groupScorerEventIds.has(mode.scorerEventId) && group.lastSequence === current.run.lastAcceptedSequence && terminalCount === 0 && !group.terminalConflict;
        const historicalCapability = group.safeForReconstruction && group.groupingSource === "EXPLICIT" && !group.terminalConflict;
        if (mode.mode === "CURRENT_OPEN" ? !currentOpenCapability : !historicalCapability) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        const scorerEventIds = new Set(group.items.map((item) => item.scorerEventId).filter((id): id is string => Boolean(id)));
        if (scorerEventIds.size !== 1) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        const scorerEventId = [...scorerEventIds][0]!;
        const rows = this.database.readLocalMatchEvents(runId);
        const originalEvents = rows.map((row) => {
            if (row.eventSchemaVersion !== 2 || sha256JsonBytes(row.eventJson) !== row.eventHash) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
            const parsed = jsonObject(parseDeterministicJson(row.eventJson));
            const metadata = eventMetadata(parsed);
            if (metadata.id !== row.eventId || metadata.sequence !== row.sequence) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
            return parsed;
        });
        const groupIds = new Set(group.canonicalEventIds);
        if (groupIds.has(eventMetadata(originalEvents[0]).id)) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        const originalById = new Map(originalEvents.map((event) => [eventMetadata(event).id, event]));
        const originalIndexById = new Map(originalEvents.map((event, index) => [eventMetadata(event).id, index]));
        const targetIndexes = group.canonicalEventIds.map((eventId) => originalIndexById.get(eventId)).filter((index): index is number => index !== undefined).sort((left, right) => left - right);
        if (targetIndexes.length !== group.canonicalEventIds.length) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");

        type MutationSeed = { id: string; occurredAt: number; facts: MatchEventFacts; retainedEventId?: string };
        const replacementSeeds: MutationSeed[] = [];
        if (mutation.kind === "REPLACE_GROUP") {
            if (!Array.isArray(mutation.events) || mutation.events.length < 1 || mutation.events.length > 64) throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
            const usedIds = new Set<string>();
            let lastRetainedIndex = -1;
            for (const replacement of mutation.events) {
                if (!replacement.facts.type.trim() || replacement.facts.type === "MATCH_START" || replacement.facts.type === "MATCH_END" || replacement.facts.type === "ROSTER_PLAYER_ADDED") throw new MatchGameplayFlowError("GAMEPLAY_INVALID");
                const retained = replacement.eventId ? originalById.get(replacement.eventId) : undefined;
                if (replacement.eventId && (!retained || !groupIds.has(replacement.eventId) || usedIds.has(replacement.eventId))) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
                if (replacement.eventId) {
                    const retainedIndex = originalIndexById.get(replacement.eventId)!;
                    if (retainedIndex <= lastRetainedIndex) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
                    lastRetainedIndex = retainedIndex;
                }
                const retainedMetadata = retained ? eventMetadata(retained) : undefined;
                const id = replacement.eventId ?? this.id();
                if (usedIds.has(id) || (!replacement.eventId && originalById.has(id))) throw new MatchGameplayFlowError("GAMEPLAY_CONFLICT");
                usedIds.add(id);
                replacementSeeds.push({
                    id,
                    occurredAt: retainedMetadata?.occurredAt ?? group.items[group.items.length - 1]!.occurredAt,
                    facts: {
                        ...(replacement.facts.scorerEventContext === undefined && retainedMetadata?.scorerEventContext ? { scorerEventContext: retainedMetadata.scorerEventContext } : {}),
                        ...replacement.facts,
                        scorerEventId,
                    },
                    ...(replacement.eventId ? { retainedEventId: replacement.eventId } : {}),
                });
            }
            const replacementTerminalCount = replacementSeeds.filter((seed) => seed.facts.scorerEventTerminal !== undefined).length;
            if (mode.mode === "CURRENT_OPEN" ? replacementTerminalCount > 1 : replacementTerminalCount !== 1) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
        }

        const replacementByRetainedId = new Map(replacementSeeds.filter((seed) => seed.retainedEventId).map((seed) => [seed.retainedEventId!, seed]));
        const insertions = new Map<number, MutationSeed[]>();
        replacementSeeds.forEach((seed, replacementIndex) => {
            if (seed.retainedEventId) return;
            const nextRetained = replacementSeeds.slice(replacementIndex + 1).find((item) => item.retainedEventId);
            const previousRetained = [...replacementSeeds.slice(0, replacementIndex)].reverse().find((item) => item.retainedEventId);
            let insertionIndex: number;
            if (nextRetained) insertionIndex = originalIndexById.get(nextRetained.retainedEventId!)!;
            else if (previousRetained) {
                const previousIndex = originalIndexById.get(previousRetained.retainedEventId!)!;
                insertionIndex = targetIndexes.find((index) => index > previousIndex) ?? targetIndexes[targetIndexes.length - 1]! + 1;
            } else insertionIndex = targetIndexes[0]!;
            const bucket = insertions.get(insertionIndex) ?? [];
            bucket.push(seed);
            insertions.set(insertionIndex, bucket);
        });

        const transformed: MutationSeed[] = [];
        for (let index = 0; index <= originalEvents.length; index += 1) {
            transformed.push(...(insertions.get(index) ?? []));
            if (index === originalEvents.length) continue;
            const original = originalEvents[index]!;
            const metadata = eventMetadata(original);
            if (groupIds.has(metadata.id)) {
                const retained = replacementByRetainedId.get(metadata.id);
                if (retained) transformed.push(retained);
                continue;
            }
            const { schemaVersion: _schemaVersion, id: _id, sequence: _sequence, occurredAt: _occurredAt, ...facts } = original;
            transformed.push({ id: metadata.id, occurredAt: metadata.occurredAt, facts: facts as MatchEventFacts, retainedEventId: metadata.id });
        }

        if (mutation.kind === "REPLACE_GROUP") {
            for (const seed of replacementSeeds.filter((item) => item.retainedEventId)) {
                const original = record(originalById.get(seed.retainedEventId!));
                if (!original || typeof original.fouledPlayerId !== "string" || typeof seed.facts.fouledPlayerId !== "string" || original.fouledPlayerId === seed.facts.fouledPlayerId) continue;
                const oldFouledPlayerId = original.fouledPlayerId;
                const newFouledPlayerId = seed.facts.fouledPlayerId;
                const relatedShotEventId = typeof seed.facts.relatedShotEventId === "string" ? seed.facts.relatedShotEventId : typeof original.relatedShotEventId === "string" ? original.relatedShotEventId : undefined;
                if (relatedShotEventId) {
                    const shot = transformed.find((item) => item.id === relatedShotEventId);
                    if (!shot || !groupIds.has(relatedShotEventId)) throw new MatchGameplayFlowError("GAMEPLAY_EVENT_REJECTED");
                    shot.facts = { ...shot.facts, playerId: newFouledPlayerId };
                }
                const penaltyId = `penalty:${seed.id}`;
                for (const downstream of transformed) {
                    if (groupIds.has(downstream.id) && downstream.facts.type === "FREE_THROW" && downstream.facts.penaltyId === penaltyId && downstream.facts.playerId === oldFouledPlayerId) downstream.facts = { ...downstream.facts, playerId: newFouledPlayerId };
                }
            }
        }

        const canonicalEvents = transformed.map((seed, index) => ({ ...seed.facts, schemaVersion: 2, id: seed.id, occurredAt: seed.occurredAt, sequence: index + 1 }));
        if (sha256JsonBytes(current.snapshot.initialStateJson) !== current.snapshot.initialStateHash) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
        const candidate = await loadEngine(jsonObject(parseDeterministicJson(current.snapshot.initialStateJson)));
        for (const event of canonicalEvents) accepted(candidate.process(event));
        if (previewOnly) return { current, candidate, canonicalEvents, replacementEventIds: replacementSeeds.map((seed) => seed.id) };
        return this.persistMutation({ ...current, engine: candidate }, owner, canonicalEvents.length, this.now().getTime(), true, "DENSE_RENUMBERED");
    }

    private projectedHistory(runId: string, owner: MatchGameplayOwner | null): { records: MatchGameplayHistoryRecord[]; groups: MatchGameplayScorerEventGroup[] } {
        const run = this.requireRun(runId);
        assertOwner(run, owner, this.deviceId);
        if (run.startedAtUtc === null) throw new MatchGameplayFlowError("GAMEPLAY_UNAVAILABLE");
        const snapshot = this.database.readLocalMatchEngineSnapshot(runId);
        if (!snapshot || sha256JsonBytes(snapshot.initialStateJson) !== snapshot.initialStateHash) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
        const initial = jsonObject(parseDeterministicJson(snapshot.initialStateJson));
        const initialPeriod = record(initial.period);
        if (!initialPeriod || (initialPeriod.kind !== "REGULATION" && initialPeriod.kind !== "OVERTIME") || !Number.isInteger(initialPeriod.index)) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
        let period = { kind: initialPeriod.kind, index: Number(initialPeriod.index) } as MatchGameplayHistoryRecord["period"];
        let clockSeconds = typeof initial.clock === "number" ? initial.clock : 0;
        let clockRunning = false;
        let clockAnchor = 0;
        const records: MatchGameplayHistoryFactRecord[] = [];
        for (const row of this.database.readLocalMatchEvents(runId)) {
            if (row.eventSchemaVersion !== 2 || sha256JsonBytes(row.eventJson) !== row.eventHash) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
            const parsed = jsonObject(parseDeterministicJson(row.eventJson));
            const metadata = eventMetadata(parsed);
            if (metadata.id !== row.eventId || metadata.sequence !== row.sequence) throw new MatchGameplayFlowError("GAMEPLAY_CORRUPTED");
            const parsedPeriod = record(parsed.period);
            if (parsed.type === "PERIOD_START" && parsedPeriod && (parsedPeriod.kind === "REGULATION" || parsedPeriod.kind === "OVERTIME") && Number.isInteger(parsedPeriod.index)) {
                period = { kind: parsedPeriod.kind, index: Number(parsedPeriod.index) };
                const rules = record(initial.rules);
                clockSeconds = period.kind === "REGULATION" ? Number(rules?.regulationPeriodSeconds ?? clockSeconds) : Number(rules?.overtimeSeconds ?? clockSeconds);
                clockRunning = false;
            }
            const eventClock = clockRunning ? Math.max(0, clockSeconds - Math.floor((metadata.occurredAt - clockAnchor) / 1000)) : clockSeconds;
            const { schemaVersion: _schemaVersion, id: _id, occurredAt: _occurredAt, sequence: _sequence, ...factsValue } = parsed;
            records.push({ ...eventSummary(parsed), period: { ...period }, clockSeconds: eventClock, facts: factsValue as MatchEventFacts });
            if (parsed.type === "CLOCK_SET" && typeof parsed.remainingSeconds === "number") clockSeconds = parsed.remainingSeconds;
            if (parsed.type === "CLOCK_START") { clockRunning = true; clockAnchor = metadata.occurredAt; }
            if (parsed.type === "CLOCK_STOP") { clockSeconds = eventClock; clockRunning = false; }
            if (parsed.type === "PERIOD_END") { clockSeconds = 0; clockRunning = false; }
        }
        return scorerEventHistoryProjection(records);
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
        return this.persistMutation({ ...current, engine: candidate }, owner, current.run.lastAcceptedSequence, this.now().getTime(), true);
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
        const originalMetadata = eventMetadata(original);
        const replacement = {
            ...(replacementFacts.scorerEventId === undefined && originalMetadata.scorerEventId ? { scorerEventId: originalMetadata.scorerEventId } : {}),
            ...(replacementFacts.scorerEventTerminal === undefined && originalMetadata.scorerEventTerminal ? { scorerEventTerminal: originalMetadata.scorerEventTerminal } : {}),
            ...(replacementFacts.scorerEventContext === undefined && originalMetadata.scorerEventContext ? { scorerEventContext: originalMetadata.scorerEventContext } : {}),
            ...replacementFacts,
            schemaVersion: 2,
            id: eventId,
            occurredAt: original.occurredAt,
            sequence: original.sequence,
        };
        accepted(candidate.correctEvent(eventId, replacement, { cascadeDependencies }));
        return this.persistMutation({ ...current, engine: candidate }, owner, current.run.lastAcceptedSequence, this.now().getTime(), true);
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

    private persistMutation(current: RuntimeMatchSession, owner: MatchGameplayOwner | null, lastAcceptedSequence: number, occurredAt: number, clearResumableFlow = false, sequencePolicy: "PRESERVE_HIGH_WATER" | "DENSE_RENUMBERED" = "PRESERVE_HIGH_WATER"): MatchGameplayRecovery {
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
                clearResumableFlow,
                sequencePolicy,
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
        clearResumableFlow = false,
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
                clearResumableFlow,
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

    private persistAppendMany(current: RuntimeMatchSession, candidate: RuntimeMatchEngine, owner: MatchGameplayOwner | null, events: unknown[], occurredAt: number): MatchGameplayRecovery {
        assertOwner(current.run, owner, this.deviceId);
        const persistedAtUtc = new Date(occurredAt).toISOString();
        const writes = events.map((event) => eventWrite(event, persistedAtUtc));
        try {
            const snapshot = this.database.appendLocalMatchEvents({
                runId: current.run.runId,
                organizationId: owner.organizationId,
                scorerId: owner.scorerId,
                deviceId: this.deviceId,
                expectedHistoryRevision: current.snapshot.eventHistoryRevision,
                expectedLastAcceptedSequence: current.run.lastAcceptedSequence,
                events: writes,
                updatedAtUtc: persistedAtUtc,
            });
            current.engine = candidate;
            current.run = { ...current.run, lastAcceptedSequence: writes[writes.length - 1].sequence, updatedAtUtc: persistedAtUtc };
            current.snapshot = snapshot;
            current.events.push(...events.map(eventSummary));
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
        return { runId: session.run.runId, lifecycle, eventHistoryRevision: session.snapshot.eventHistoryRevision, lastAcceptedSequence: session.run.lastAcceptedSequence, state, eventIds: session.events.map((event) => event.eventId), events: session.events, currentConfiguration, setup: this.setup.getMatchSetup(session.run.gameId) };
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
