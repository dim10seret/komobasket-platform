import { randomUUID } from "node:crypto";
import type { DesktopAuthState } from "../auth/auth-contracts.cjs";
import type { MatchSetup, MatchSetupManager, VerifiedMatchSetupSource } from "../games/match-setup.cjs";
import type { CreateLocalGameRunInput, LocalGameRunStoreResult, StoredLocalGameRun, StoredLocalGameplaySyncState, StoredLocalMatchEngineSnapshot, StoredLocalMatchFinalization } from "../persistence/local-database.cjs";
import { parseDeterministicJson, sha256JsonBytes, type JsonValue } from "./match-engine-bootstrap.cjs";

export const MATCH_RUN_ERROR_CODES = ["RUN_UNAVAILABLE", "RUN_INVALID", "RUN_CONFLICT", "RUN_OWNERSHIP_CONFLICT"] as const;
export type MatchRunErrorCode = (typeof MATCH_RUN_ERROR_CODES)[number];
export interface MatchRunOwner { scorerId: string; organizationId: string; }
export interface SafeMatchRun { runId: string; gameId: string; packageId: string; packageVersion: number; status: "active" | "finalized"; gameplayStarted: boolean; lastAcceptedSequence: number; createdAtUtc: string; }
export interface SafeLocalRunSummary {
    runId: string; gameId: string; packageId: string; packageVersion: number; gameplayStarted: boolean; lastAcceptedSequence: number; createdAtUtc: string;
    homeTeam: { id: string; name: string }; awayTeam: { id: string; name: string }; competitionName: string; seasonName: string;
    phaseName: string | null; roundLabel: string | null; scheduledDate: string | null; scheduledTime: string | null; venue: string | null;
}
export type MatchRunOperationResult = { ok: true; outcome: "created" | "existing" | "recovered"; run: SafeMatchRun | null; state: DesktopAuthState } | { ok: false; errorCode: MatchRunErrorCode | "SESSION_INVALID" | "OFFLINE_OPERATION_DENIED"; state: DesktopAuthState };
export type LocalRunCatalogueResult = { ok: true; runs: SafeLocalRunSummary[]; state: DesktopAuthState } | { ok: false; errorCode: MatchRunErrorCode | "SESSION_INVALID"; state: DesktopAuthState };
export type MyGamesRunSyncStatus = "active" | "pending" | "retry-needed" | "conflict" | "completed";
export interface SafeMyGamesRunState {
    gameId: string; runId: string; lifecycle: "active" | "finalized"; historyRevision: number; acknowledgedHistoryRevision: number;
    finalizationHash: string | null; acknowledgedFinalizationHash: string | null; syncStatus: MyGamesRunSyncStatus;
    homeScore: number | null; awayScore: number | null;
}
export type MyGamesRunStateCatalogueResult = { ok: true; runs: SafeMyGamesRunState[]; state: DesktopAuthState } | { ok: false; errorCode: MatchRunErrorCode | "SESSION_INVALID"; state: DesktopAuthState };

interface MatchRunStore {
    createOrOpenLocalGameRun(input: CreateLocalGameRunInput): LocalGameRunStoreResult;
    getActiveLocalGameRun(gameId: string): StoredLocalGameRun | null;
    listActiveLocalGameRunsForOwner(organizationId: string, scorerId: string, deviceId: string): StoredLocalGameRun[];
    listMyGamesLocalRunsForOwner(organizationId: string, scorerId: string, deviceId: string): StoredLocalGameRun[];
    readLocalMatchEngineSnapshot(runId: string): StoredLocalMatchEngineSnapshot | null;
    readLocalGameplaySyncState(runId: string): StoredLocalGameplaySyncState | null;
    readLocalMatchFinalization(runId: string): StoredLocalMatchFinalization | null;
}

export class MatchRunFlowError extends Error {
    constructor(readonly code: MatchRunErrorCode) { super(code); this.name = "MatchRunFlowError"; }
}

function localGameRunConflictKind(error: unknown): "ownership" | "state" | null {
    if (error === null || typeof error !== "object" || !("name" in error) || error.name !== "LocalGameRunConflictError" || !("kind" in error)) return null;
    return error.kind === "ownership" || error.kind === "state" ? error.kind : null;
}

function safeRun(run: StoredLocalGameRun): SafeMatchRun {
    if ((run.status !== "active" && run.status !== "finalized")
        || (run.startedAtUtc === null) !== (run.lastAcceptedSequence === 0)
        || (run.status === "finalized" && run.startedAtUtc === null)) throw new MatchRunFlowError("RUN_INVALID");
    return { runId: run.runId, gameId: run.gameId, packageId: run.packageId, packageVersion: run.packageVersion, status: run.status, gameplayStarted: run.startedAtUtc !== null, lastAcceptedSequence: run.lastAcceptedSequence, createdAtUtc: run.createdAtUtc };
}

function jsonRecord(value: JsonValue): Record<string, JsonValue> | null {
    return value !== null && !Array.isArray(value) && typeof value === "object" ? value : null;
}

export function selectAuthoritativeMyGamesRuns(runs: StoredLocalGameRun[]): StoredLocalGameRun[] {
    const ordered = [...runs].sort((left, right) => {
        if (left.gameId !== right.gameId) return left.gameId.localeCompare(right.gameId);
        if (left.status !== right.status) return left.status === "active" ? -1 : right.status === "active" ? 1 : 0;
        return right.updatedAtUtc.localeCompare(left.updatedAtUtc) || right.createdAtUtc.localeCompare(left.createdAtUtc) || right.runId.localeCompare(left.runId);
    });
    const selected = new Map<string, StoredLocalGameRun>();
    for (const run of ordered) if (!selected.has(run.gameId)) selected.set(run.gameId, run);
    return [...selected.values()];
}

export function projectMyGamesRunState(run: StoredLocalGameRun, snapshot: StoredLocalMatchEngineSnapshot | null, sync: StoredLocalGameplaySyncState | null, finalization: StoredLocalMatchFinalization | null): SafeMyGamesRunState {
    const base = {
        gameId: run.gameId, runId: run.runId, lifecycle: run.status === "finalized" ? "finalized" as const : "active" as const,
        historyRevision: snapshot?.eventHistoryRevision ?? 0, acknowledgedHistoryRevision: sync?.lastAcknowledgedHistoryRevision ?? 0,
        finalizationHash: finalization?.finalizationHash ?? null, acknowledgedFinalizationHash: sync?.lastAcknowledgedFinalizationHash ?? null,
    };
    if (run.status === "active") return { ...base, lifecycle: "active", syncStatus: "active", homeScore: null, awayScore: null };
    const conflict = sync?.lastErrorCode === "SYNC_RUN_CONFLICT" || sync?.lastErrorCode === "SYNC_INTEGRITY_CONFLICT";
    try {
        if (!snapshot || !sync || !finalization || sha256JsonBytes(finalization.finalStateJson) !== finalization.finalStateHash || sha256JsonBytes(finalization.finalizationJson) !== finalization.finalizationHash) throw new Error("Invalid finalized Run read model.");
        const state = jsonRecord(parseDeterministicJson(finalization.finalStateJson));
        const manifest = jsonRecord(parseDeterministicJson(finalization.finalizationJson));
        const home = state ? jsonRecord(state.home) : null;
        const away = state ? jsonRecord(state.away) : null;
        if (!state || !manifest || state.id !== run.runId || state.finished !== true || state.lastProcessedSequence !== run.lastAcceptedSequence
            || typeof home?.score !== "number" || !Number.isInteger(home.score) || home.score < 0
            || typeof away?.score !== "number" || !Number.isInteger(away.score) || away.score < 0
            || manifest.schemaVersion !== 1 || manifest.runId !== run.runId
            || manifest.finalizedHistoryRevision !== finalization.finalizedHistoryRevision
            || manifest.finalizedHistoryHash !== finalization.finalizedHistoryHash
            || manifest.finalStateHash !== finalization.finalStateHash
            || manifest.finalizedAtUtc !== finalization.finalizedAtUtc
            || finalization.finalizedHistoryRevision !== snapshot.eventHistoryRevision) throw new Error("Invalid finalized Run read model.");
        const completed = !conflict && sync.lastErrorCode === null && sync.consecutiveFailures === 0 && sync.nextRetryAtUtc === null
            && sync.lastAcknowledgedHistoryRevision === finalization.finalizedHistoryRevision
            && sync.lastAcknowledgedHistoryHash === finalization.finalizedHistoryHash
            && sync.lastAcknowledgedFinalizationHash === finalization.finalizationHash;
        const syncStatus: MyGamesRunSyncStatus = conflict ? "conflict" : completed ? "completed" : sync.lastErrorCode !== null ? "retry-needed" : "pending";
        return { ...base, lifecycle: "finalized", syncStatus, homeScore: completed ? home.score : null, awayScore: completed ? away.score : null };
    } catch {
        return { ...base, lifecycle: "finalized", syncStatus: "conflict", homeScore: null, awayScore: null };
    }
}

export class MatchRunManager {
    constructor(private readonly setup: MatchSetupManager, private readonly store: MatchRunStore, private readonly deviceId: string) {}
    createOrOpen(gameId: string, owner: MatchRunOwner): { outcome: "created" | "existing"; run: SafeMatchRun } {
        const source = this.setup.getVerifiedMatchSetupSource(gameId);
        const input: CreateLocalGameRunInput = {
            runId: `komocontrol_run_${randomUUID()}`, runSchemaVersion: 1, gameId: source.setup.gameId, packageId: source.setup.packageId, packageVersion: source.setup.packageVersion, packageSchemaVersion: source.packageSchemaVersion, packageHash: source.packageHash,
            organizationId: owner.organizationId, scorerId: owner.scorerId, deviceId: this.deviceId, setupSnapshotJson: JSON.stringify(source.setup),
        };
        try { const result = this.store.createOrOpenLocalGameRun(input); return { outcome: result.outcome, run: this.verifyRun(result.run, owner) }; }
        catch (error) { const kind = localGameRunConflictKind(error); if (kind) throw new MatchRunFlowError(kind === "ownership" ? "RUN_OWNERSHIP_CONFLICT" : "RUN_CONFLICT"); throw error; }
    }
    recover(gameId: string, owner: MatchRunOwner): SafeMatchRun | null {
        const run = this.store.getActiveLocalGameRun(gameId);
        return run ? this.verifyRun(run, owner) : null;
    }
    recoverSetup(gameId: string, owner: MatchRunOwner): MatchSetup | null {
        const run = this.store.getActiveLocalGameRun(gameId);
        return run ? this.verifiedSource(run, owner).setup : null;
    }
    listRecoverable(owner: MatchRunOwner): SafeLocalRunSummary[] {
        return this.store.listActiveLocalGameRunsForOwner(owner.organizationId, owner.scorerId, this.deviceId).map((run) => {
            const setup = this.verifiedSource(run, owner).setup;
            return {
                runId: run.runId, gameId: run.gameId, packageId: run.packageId, packageVersion: run.packageVersion,
                gameplayStarted: run.startedAtUtc !== null, lastAcceptedSequence: run.lastAcceptedSequence, createdAtUtc: run.createdAtUtc,
                homeTeam: { id: setup.home.teamId, name: setup.home.teamName }, awayTeam: { id: setup.away.teamId, name: setup.away.teamName },
                competitionName: setup.competitionName, seasonName: setup.seasonName, phaseName: setup.phaseName,
                roundLabel: setup.roundLabel, scheduledDate: setup.scheduledDate, scheduledTime: setup.scheduledTime, venue: setup.venue,
            };
        });
    }
    listMyGamesStates(owner: MatchRunOwner): SafeMyGamesRunState[] {
        const runs = selectAuthoritativeMyGamesRuns(this.store.listMyGamesLocalRunsForOwner(owner.organizationId, owner.scorerId, this.deviceId));
        return runs.map((run) => {
            this.verifiedSource(run, owner);
            return projectMyGamesRunState(run, this.store.readLocalMatchEngineSnapshot(run.runId), this.store.readLocalGameplaySyncState(run.runId), this.store.readLocalMatchFinalization(run.runId));
        });
    }
    private verifyRun(run: StoredLocalGameRun, owner: MatchRunOwner): SafeMatchRun {
        this.verifiedSource(run, owner);
        return safeRun(run);
    }
    private verifiedSource(run: StoredLocalGameRun, owner: MatchRunOwner): VerifiedMatchSetupSource {
        if (run.organizationId !== owner.organizationId || run.scorerId !== owner.scorerId || run.deviceId !== this.deviceId) throw new MatchRunFlowError("RUN_OWNERSHIP_CONFLICT");
        const source = this.setup.getVerifiedPackageMatchSetup(run.packageId);
        if (source.setup.gameId !== run.gameId || source.setup.packageVersion !== run.packageVersion || source.packageSchemaVersion !== run.packageSchemaVersion || source.packageHash !== run.packageHash || JSON.stringify(source.setup) !== run.setupSnapshotJson) throw new MatchRunFlowError("RUN_INVALID");
        return source;
    }
}

export function matchRunErrorCode(error: unknown): MatchRunErrorCode { return error instanceof MatchRunFlowError ? error.code : "RUN_INVALID"; }
