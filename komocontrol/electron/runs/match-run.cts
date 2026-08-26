import { randomUUID } from "node:crypto";
import type { DesktopAuthState } from "../auth/auth-contracts.cjs";
import type { MatchSetup, MatchSetupManager, VerifiedMatchSetupSource } from "../games/match-setup.cjs";
import type { CreateLocalGameRunInput, LocalGameRunStoreResult, StoredLocalGameRun } from "../persistence/local-database.cjs";

export const MATCH_RUN_ERROR_CODES = ["RUN_UNAVAILABLE", "RUN_INVALID", "RUN_CONFLICT", "RUN_OWNERSHIP_CONFLICT"] as const;
export type MatchRunErrorCode = (typeof MATCH_RUN_ERROR_CODES)[number];
export interface MatchRunOwner { scorerId: string; organizationId: string; }
export interface SafeMatchRun { runId: string; gameId: string; packageId: string; packageVersion: number; status: "active"; gameplayStarted: false; lastAcceptedSequence: 0; createdAtUtc: string; }
export interface SafeLocalRunSummary {
    runId: string; gameId: string; packageId: string; packageVersion: number; gameplayStarted: boolean; lastAcceptedSequence: number; createdAtUtc: string;
    homeTeam: { id: string; name: string }; awayTeam: { id: string; name: string }; competitionName: string; seasonName: string;
    phaseName: string | null; roundLabel: string | null; scheduledDate: string | null; scheduledTime: string | null; venue: string | null;
}
export type MatchRunOperationResult = { ok: true; outcome: "created" | "existing" | "recovered"; run: SafeMatchRun | null; state: DesktopAuthState } | { ok: false; errorCode: MatchRunErrorCode | "SESSION_INVALID" | "OFFLINE_OPERATION_DENIED"; state: DesktopAuthState };
export type LocalRunCatalogueResult = { ok: true; runs: SafeLocalRunSummary[]; state: DesktopAuthState } | { ok: false; errorCode: MatchRunErrorCode | "SESSION_INVALID"; state: DesktopAuthState };

interface MatchRunStore {
    createOrOpenLocalGameRun(input: CreateLocalGameRunInput): LocalGameRunStoreResult;
    getActiveLocalGameRun(gameId: string): StoredLocalGameRun | null;
    listActiveLocalGameRunsForOwner(organizationId: string, scorerId: string, deviceId: string): StoredLocalGameRun[];
}

export class MatchRunFlowError extends Error {
    constructor(readonly code: MatchRunErrorCode) { super(code); this.name = "MatchRunFlowError"; }
}

function localGameRunConflictKind(error: unknown): "ownership" | "state" | null {
    if (error === null || typeof error !== "object" || !("name" in error) || error.name !== "LocalGameRunConflictError" || !("kind" in error)) return null;
    return error.kind === "ownership" || error.kind === "state" ? error.kind : null;
}

function safeRun(run: StoredLocalGameRun): SafeMatchRun {
    if (run.status !== "active" || run.startedAtUtc !== null || run.lastAcceptedSequence !== 0) throw new MatchRunFlowError("RUN_INVALID");
    return { runId: run.runId, gameId: run.gameId, packageId: run.packageId, packageVersion: run.packageVersion, status: "active", gameplayStarted: false, lastAcceptedSequence: 0, createdAtUtc: run.createdAtUtc };
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
