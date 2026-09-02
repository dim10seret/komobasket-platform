import {
    AuthFlowError,
    authErrorCode,
    type AuthErrorCode,
    type AuthOperationResult,
    type DesktopAuthState,
    type LoginInput,
    type SafeScorerContext,
} from "./auth-contracts.cjs";
import type { LoginResponse, ScorerAuthClient, ValidatedSessionContext } from "./platform-auth-client.cjs";
import { SecureSessionStore, type AuthorizationEnvelopeV1, type StoredAuthorization } from "./secure-session-store.cjs";
import { LiveRunAuthorizationManager } from "./live-run-authorization.cjs";
import type { GameDiscoveryOperationResult } from "../games/game-discovery-contracts.cjs";
import { GamePackageDownloadManager, packageOperationFailure, type GamePackageDownloadResult } from "../games/game-package-download.cjs";
import type { LocalGamePackageStatus } from "../persistence/local-database.cjs";
import { MatchSetupManager, matchSetupErrorCode, type MatchSetupOperationResult } from "../games/match-setup.cjs";
import { MatchRunManager, matchRunErrorCode, type LocalRunCatalogueResult, type MatchRunOperationResult, type MyGamesRunStateCatalogueResult } from "../runs/match-run.cjs";
import {
    PreGameConfigurationManager,
    preGameConfigurationErrorCode,
    preGameConfigurationValidation,
    type PreGameConfigurationOperationResult,
    type PreGameConfigurationSaveDraftInput,
} from "../runs/pre-game-configuration.cjs";
import {
    MatchGameplayFlowError,
    type MatchGameplayManager,
    type MatchGameplayFinalizationInput,
    type MatchGameplayHistoryQuery,
    type MatchGameplayRecovery,
} from "../runs/match-gameplay.cjs";
import {
    eventFactsFromIntent,
    safeGameplayHistory,
    safeGameplayScorerEventGroup,
    safeGameplayScorerEventEditContext,
    safeGameplayScorerEventMutationPreview,
    safeGameplay,
    type GameplayHistoryOperationResult,
    type GameplayScorerEventGroupOperationResult,
    type GameplayScorerEventEditContextOperationResult,
    type GameplayScorerEventEditModeInput,
    type GameplayScorerEventMutationPreviewInput,
    type GameplayScorerEventMutationPreviewOperationResult,
    type GameplayScorerEventMutationInput,
    type ResumableLiveFlowInput,
    type ResumableLiveFlowOperationResult,
    type GameplayIntent,
    type MatchGameplayOperationResult,
} from "../runs/gameplay-runtime.cjs";
import { GameplaySyncWorker } from "../sync/gameplay-sync.cjs";

export class AuthCoordinator {
    private readonly deviceIdSuffix: string;
    private currentAuthorization: AuthorizationEnvelopeV1 | null = null;
    private state: DesktopAuthState;
    private initialization: Promise<DesktopAuthState> | null = null;

    constructor(
        private readonly client: ScorerAuthClient | null,
        private readonly store: SecureSessionStore,
        private readonly deviceId: string,
        private readonly packageManager: GamePackageDownloadManager | null = null,
        private readonly matchSetupManager: MatchSetupManager | null = null,
        private readonly matchRunManager: MatchRunManager | null = null,
        private readonly preGameConfigurationManager: PreGameConfigurationManager | null = null,
        private readonly matchGameplayManager: MatchGameplayManager | null = null,
        private readonly now: () => Date = () => new Date(),
        private readonly liveAuthorization: LiveRunAuthorizationManager | null = null,
        private readonly syncWorker: GameplaySyncWorker | null = null,
    ) {
        this.deviceIdSuffix = deviceId.slice(-8);
        this.state = { kind: "unauthenticated", deviceIdSuffix: this.deviceIdSuffix };
    }

    initialize(): Promise<DesktopAuthState> {
        if (!this.initialization) this.initialization = this.restore();
        return this.initialization;
    }

    async getState(): Promise<DesktopAuthState> {
        await this.initialize();
        return this.state;
    }

    async login(input: LoginInput): Promise<AuthOperationResult> {
        await this.initialize();
        try {
            this.requireAvailableFoundation();
            const result = await this.client!.login(input.username, input.password, this.deviceId);
            const envelope = this.envelopeFromValidatedSession(result.token, result);
            try {
                this.store.saveAuthorization(envelope);
            } catch (error) {
                try { await this.client!.logout(result.token); } catch { /* best effort */ }
                throw error;
            }
            this.liveAuthorization?.reactivateOwner(envelope.organizationId, envelope.scorerId);
            this.currentAuthorization = envelope;
            this.state = this.authenticatedState(this.safeContext(envelope), "online");
            this.wakeSync(true);
            return { ok: true, state: this.state };
        } catch (error) {
            return this.failure(error);
        }
    }

    async retrySession(): Promise<AuthOperationResult> {
        try {
            this.state = await this.restore();
            if (this.state.kind === "authenticated") this.wakeSync();
            return this.state.kind === "authenticated" || this.state.kind === "live-continuity"
                ? { ok: true, state: this.state }
                : { ok: false, errorCode: this.state.kind === "validation-unavailable" ? this.state.errorCode : "SESSION_INVALID", state: this.state };
        } catch (error) {
            return this.failure(error);
        }
    }

    async logout(): Promise<AuthOperationResult> {
        await this.initialize();
        const owner = this.currentOwner();
        let stored: StoredAuthorization | null = null;
        try { stored = this.store.loadAuthorization(); }
        catch (error) { if (authErrorCode(error) !== "SESSION_INVALID") return this.failure(error); }
        const token = this.currentAuthorization?.opaqueToken ?? (stored?.kind === "legacy" ? stored.token : stored?.envelope.opaqueToken ?? null);
        if (token && this.client && this.state.kind === "authenticated" && this.state.connection === "online") {
            try { await this.client.logout(token); } catch { /* local logout remains authoritative */ }
        }
        try {
            if (owner) this.liveAuthorization?.suspendOwner(owner.organizationId, owner.scorerId);
            this.store.clearSession();
        } catch (error) {
            return this.failure(error);
        }
        this.syncWorker?.pause();
        this.matchGameplayManager?.clearRuntimeSessions();
        this.currentAuthorization = null;
        this.state = { kind: "unauthenticated", deviceIdSuffix: this.deviceIdSuffix };
        return { ok: true, state: this.state };
    }

    async listGames(): Promise<GameDiscoveryOperationResult> {
        await this.initialize();
        const context = this.authorizedContext(true);
        if (!this.client || !context || !this.currentAuthorization) return { ok: false, errorCode: this.accessError(true), state: this.state };
        try {
            return { ok: true, games: await this.client.listGames(this.currentAuthorization.opaqueToken), state: this.state };
        } catch (error) {
            return { ok: false, errorCode: this.handleOnlineFailure(error), state: this.state };
        }
    }

    async listLocalRuns(): Promise<LocalRunCatalogueResult> {
        await this.initialize();
        if (!this.matchRunManager) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        const regular = this.authorizedContext(false);
        try {
            if (regular) return { ok: true, runs: this.matchRunManager.listRecoverable(this.owner(regular)), state: this.state };
            if (this.state.kind !== "live-continuity") return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
            const owner = { scorerId: this.state.context.scorerId, organizationId: this.state.context.organizationId };
            const permitted = new Set(this.state.context.runIds);
            return { ok: true, runs: this.matchRunManager.listRecoverable(owner).filter((run) => permitted.has(run.runId)), state: this.state };
        } catch (error) {
            return { ok: false, errorCode: matchRunErrorCode(error), state: this.state };
        }
    }

    async listMyGamesRunStates(): Promise<MyGamesRunStateCatalogueResult> {
        await this.initialize();
        if (!this.matchRunManager) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        const regular = this.authorizedContext(false);
        try {
            if (regular) return { ok: true, runs: this.matchRunManager.listMyGamesStates(this.owner(regular)), state: this.state };
            if (this.state.kind !== "live-continuity") return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
            const owner = { scorerId: this.state.context.scorerId, organizationId: this.state.context.organizationId };
            const permitted = new Set(this.state.context.runIds);
            return { ok: true, runs: this.matchRunManager.listMyGamesStates(owner).filter((run) => permitted.has(run.runId)), state: this.state };
        } catch (error) {
            return { ok: false, errorCode: matchRunErrorCode(error), state: this.state };
        }
    }

    async recoverMatchGameplay(runId: string): Promise<MatchGameplayOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            return this.gameplaySuccess(await this.matchGameplayManager.recover(runId, owner));
        } catch (error) {
            return this.gameplayFailure(error);
        }
    }

    async startMatch(runId: string): Promise<MatchGameplayOperationResult> {
        await this.initialize();
        const context = this.authorizedContext(false);
        if (!this.matchGameplayManager || !context) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const owner = this.owner(context);
            const startReadiness = this.matchGameplayManager.validateStartReadiness(runId, owner);
            if (startReadiness) return { ok: false, errorCode: "START_NOT_READY", startReadiness, state: this.state };
            const result = this.gameplaySuccess(await this.matchGameplayManager.initialize(runId, owner));
            this.wakeSync();
            return result;
        } catch (error) {
            return this.gameplayFailure(error);
        }
    }

    async appendGameplayIntent(runId: string, intent: GameplayIntent): Promise<MatchGameplayOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const result = this.gameplaySuccess(await this.matchGameplayManager.append(runId, owner, eventFactsFromIntent(intent)));
            this.queueSync(runId);
            return result;
        } catch (error) {
            return this.gameplayFailure(error);
        }
    }

    async appendAndResolveResumableGameplayFlow(runId: string, intent: GameplayIntent): Promise<MatchGameplayOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const result = this.gameplaySuccess(await this.matchGameplayManager.appendAndResolveResumableFlow(runId, owner, eventFactsFromIntent(intent)));
            this.queueSync(runId);
            return result;
        } catch (error) { return this.gameplayFailure(error); }
    }

    async saveResumableLiveFlow(runId: string, input: ResumableLiveFlowInput): Promise<ResumableLiveFlowOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try { return { ok: true, flow: await this.matchGameplayManager.saveResumableLiveFlow(runId, owner, input), state: this.state }; }
        catch (error) { return { ok: false, errorCode: error instanceof MatchGameplayFlowError ? error.code : "GAMEPLAY_CORRUPTED", state: this.state }; }
    }

    async getResumableLiveFlow(runId: string): Promise<ResumableLiveFlowOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try { return { ok: true, flow: this.matchGameplayManager.getResumableLiveFlow(runId, owner), state: this.state }; }
        catch (error) { return { ok: false, errorCode: error instanceof MatchGameplayFlowError ? error.code : "GAMEPLAY_CORRUPTED", state: this.state }; }
    }

    async appendGameplayIntents(runId: string, intents: GameplayIntent[]): Promise<MatchGameplayOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const result = this.gameplaySuccess(await this.matchGameplayManager.appendMany(runId, owner, intents.map(eventFactsFromIntent)));
            this.queueSync(runId);
            return result;
        } catch (error) { return this.gameplayFailure(error); }
    }

    async getGameplayHistory(runId: string, query: MatchGameplayHistoryQuery): Promise<GameplayHistoryOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try { return { ok: true, history: safeGameplayHistory(await this.matchGameplayManager.history(runId, owner, query)), state: this.state }; }
        catch (error) { return { ok: false, errorCode: error instanceof MatchGameplayFlowError ? error.code : "GAMEPLAY_CORRUPTED", state: this.state }; }
    }

    async getScorerEventGroup(runId: string, scorerEventGroupId: string): Promise<GameplayScorerEventGroupOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const group = await this.matchGameplayManager.scorerEventGroup(runId, owner, scorerEventGroupId);
            return { ok: true, group: group ? safeGameplayScorerEventGroup(group) : null, state: this.state };
        } catch (error) { return { ok: false, errorCode: error instanceof MatchGameplayFlowError ? error.code : "GAMEPLAY_CORRUPTED", state: this.state }; }
    }

    async getScorerEventEditContext(runId: string, scorerEventGroupId: string, mode?: GameplayScorerEventEditModeInput): Promise<GameplayScorerEventEditContextOperationResult> {
        await this.initialize(); const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try { const context = await this.matchGameplayManager.scorerEventEditContext(runId, owner, scorerEventGroupId, mode); return { ok: true, context: context ? safeGameplayScorerEventEditContext(context) : null, state: this.state }; }
        catch (error) { return { ok: false, errorCode: error instanceof MatchGameplayFlowError ? error.code : "GAMEPLAY_CORRUPTED", state: this.state }; }
    }

    async previewGameplayScorerEventMutation(runId: string, input: GameplayScorerEventMutationPreviewInput): Promise<GameplayScorerEventMutationPreviewOperationResult> {
        await this.initialize(); const owner = this.gameplayOwner(runId); if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try { const preview = await this.matchGameplayManager.previewScorerEventGroupMutation(runId, owner, { ...input, events: input.events.map((event) => ({ draftId: event.draftId, ...(event.eventId ? { eventId: event.eventId } : {}), facts: eventFactsFromIntent(event.intent) })) }); return { ok: true, preview: safeGameplayScorerEventMutationPreview(preview), state: this.state }; }
        catch (error) { return { ok: false, errorCode: error instanceof MatchGameplayFlowError ? error.code : "GAMEPLAY_CORRUPTED", ...(error instanceof MatchGameplayFlowError && error.dependentEventIds.length ? { dependentEventIds: error.dependentEventIds } : {}), state: this.state }; }
    }

    async mutateGameplayScorerEventGroup(runId: string, mutation: GameplayScorerEventMutationInput): Promise<MatchGameplayOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const managerMutation = mutation.kind === "DELETE_GROUP"
                ? mutation
                : { ...mutation, events: mutation.events.map((event) => ({ ...(event.eventId ? { eventId: event.eventId } : {}), facts: eventFactsFromIntent(event.intent) })) };
            const result = this.gameplaySuccess(await this.matchGameplayManager.mutateScorerEventGroup(runId, owner, managerMutation));
            this.queueSync(runId);
            return result;
        } catch (error) { return this.gameplayFailure(error); }
    }

    async removeGameplayEvent(runId: string, eventId: string, cascadeDependencies: boolean): Promise<MatchGameplayOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const result = this.gameplaySuccess(await this.matchGameplayManager.remove(runId, owner, eventId, cascadeDependencies));
            this.queueSync(runId);
            return result;
        } catch (error) {
            return this.gameplayFailure(error);
        }
    }

    async correctGameplayEvent(runId: string, eventId: string, intent: GameplayIntent, cascadeDependencies: boolean): Promise<MatchGameplayOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const result = this.gameplaySuccess(await this.matchGameplayManager.correct(runId, owner, eventId, eventFactsFromIntent(intent), cascadeDependencies));
            this.queueSync(runId);
            return result;
        } catch (error) {
            return this.gameplayFailure(error);
        }
    }

    async finalizeMatch(runId: string, input: MatchGameplayFinalizationInput = { incidentReport: null }): Promise<MatchGameplayOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!this.matchGameplayManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const result = this.gameplaySuccess(await this.matchGameplayManager.finalize(runId, owner, input));
            this.wakeSync();
            return result;
        } catch (error) {
            return this.gameplayFailure(error);
        }
    }

    async reconnectGameplaySync(runId: string, input: LoginInput): Promise<MatchGameplayOperationResult> {
        await this.initialize();
        const owner = this.gameplayOwner(runId);
        if (!owner || !this.matchGameplayManager || !this.syncWorker || !this.client) {
            return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        }
        let current: MatchGameplayRecovery;
        try {
            current = await this.matchGameplayManager.recover(runId, owner);
        } catch (error) {
            return this.gameplayFailure(error);
        }
        try {
            this.requireAvailableFoundation();
            const result = await this.client.login(input.username, input.password, this.deviceId);
            if (result.scorerId !== owner.scorerId || result.organizationId !== owner.organizationId || result.deviceId !== this.deviceId) {
                try { await this.client.logout(result.token); } catch { /* best effort */ }
                return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
            }
            const envelope = this.envelopeFromValidatedSession(result.token, result);
            try {
                this.store.saveAuthorization(envelope);
            } catch (error) {
                try { await this.client.logout(result.token); } catch { /* best effort */ }
                throw error;
            }
            this.liveAuthorization?.reactivateOwner(envelope.organizationId, envelope.scorerId);
            this.currentAuthorization = envelope;
            this.state = this.authenticatedState(this.safeContext(envelope), "online");
            this.wakeSync(true);
            return this.gameplaySuccess(current);
        } catch (error) {
            return { ok: false, errorCode: authErrorCode(error), state: this.state };
        }
    }

    async retryGameplaySync(runId: string): Promise<MatchGameplayOperationResult> {
        await this.initialize();
        const context = this.authorizedContext(true);
        if (!context || !this.currentAuthorization || !this.syncWorker || !this.matchGameplayManager) {
            return { ok: false, errorCode: this.accessError(true), state: this.state };
        }
        try {
            const owner = this.owner(context);
            const current = await this.matchGameplayManager.recover(runId, owner);
            const sync = this.matchGameplayManager.syncState(runId);
            if (current.lifecycle !== "finalized" || !sync || safeGameplay(current, sync).sync.status === "synced") {
                return { ok: false, errorCode: "SYNC_INVALID", state: this.state };
            }
            await this.syncWorker.retry(runId, this.currentAuthorization.opaqueToken, owner);
            return this.gameplaySuccess(await this.matchGameplayManager.recover(runId, owner));
        } catch (error) {
            const code = error !== null && typeof error === "object" && "code" in error ? Reflect.get(error, "code") : null;
            return { ok: false, errorCode: typeof code === "string" ? code : "SYNC_UNAVAILABLE", state: this.state };
        }
    }

    getGamePackageStatus(gameId: string): LocalGamePackageStatus {
        if (!this.packageManager || !this.authorizedContext(false)) throw new AuthFlowError("SESSION_INVALID");
        return this.packageManager.getStatus(gameId);
    }

    async downloadGamePackage(gameId: string): Promise<GamePackageDownloadResult> {
        await this.initialize();
        const context = this.authorizedContext(true);
        if (!this.packageManager || !context || !this.currentAuthorization) return { ok: false, errorCode: this.accessError(true), state: this.state };
        try {
            const result = await this.packageManager.download(this.currentAuthorization.opaqueToken, gameId);
            return { ok: true, outcome: result.outcome, status: result.status, state: this.state };
        } catch (error) {
            const code = authErrorCode(error);
            if (code === "SESSION_INVALID" || code === "SCORER_DISABLED" || code === "NETWORK_UNAVAILABLE" || code === "MALFORMED_RESPONSE") this.handleOnlineFailure(error);
            return packageOperationFailure(error, this.state);
        }
    }

    getMatchSetup(gameId: string): MatchSetupOperationResult {
        const regular = this.authorizedContext(false);
        const continuity = regular ? null : this.liveAuthorization?.resolveForGame(gameId) ?? null;
        const owner = regular ? this.owner(regular) : continuity ? { scorerId: continuity.scorerId, organizationId: continuity.organizationId } : null;
        if (!this.matchSetupManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const setup = this.state.kind === "authenticated" && this.state.connection === "online"
                ? this.matchSetupManager.getMatchSetup(gameId)
                : this.matchRunManager?.recoverSetup(gameId, owner);
            if (!setup) return { ok: false, errorCode: "RUN_UNAVAILABLE", state: this.state };
            return { ok: true, setup, state: this.state };
        } catch (error) {
            const runCode = matchRunErrorCode(error);
            return { ok: false, errorCode: runCode === "RUN_INVALID" ? matchSetupErrorCode(error) : runCode, state: this.state };
        }
    }

    async createOrOpenGameRun(gameId: string): Promise<MatchRunOperationResult> {
        await this.initialize();
        const context = this.authorizedContext(true);
        if (!this.matchRunManager || !context) return { ok: false, errorCode: this.accessError(true), state: this.state };
        try {
            const result = this.matchRunManager.createOrOpen(gameId, this.owner(context));
            return { ok: true, ...result, state: this.state };
        } catch (error) {
            return { ok: false, errorCode: matchRunErrorCode(error), state: this.state };
        }
    }

    async getActiveGameRun(gameId: string): Promise<MatchRunOperationResult> {
        await this.initialize();
        const regular = this.authorizedContext(false);
        const continuity = regular ? null : this.liveAuthorization?.resolveForGame(gameId) ?? null;
        const owner = regular ? this.owner(regular) : continuity ? { scorerId: continuity.scorerId, organizationId: continuity.organizationId } : null;
        if (!this.matchRunManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            return { ok: true, outcome: "recovered", run: this.matchRunManager.recover(gameId, owner), state: this.state };
        } catch (error) {
            return { ok: false, errorCode: matchRunErrorCode(error), state: this.state };
        }
    }

    async getOrCreatePreGameConfiguration(gameId: string): Promise<PreGameConfigurationOperationResult> {
        await this.initialize();
        const owner = this.preGameConfigurationOwner(gameId);
        if (!this.preGameConfigurationManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const result = this.preGameConfigurationManager.getOrCreate(gameId, owner);
            return { ok: true, ...result, state: this.state };
        } catch (error) {
            return { ok: false, errorCode: preGameConfigurationErrorCode(error), validation: preGameConfigurationValidation(error), state: this.state };
        }
    }

    async savePreGameConfigurationDraft(input: PreGameConfigurationSaveDraftInput): Promise<PreGameConfigurationOperationResult> {
        await this.initialize();
        const owner = this.preGameConfigurationOwner(input.gameId);
        if (!this.preGameConfigurationManager || !owner) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const configuration = this.preGameConfigurationManager.saveDraft(input, owner);
            this.wakeSync();
            return { ok: true, outcome: "saved", configuration, state: this.state };
        } catch (error) {
            return { ok: false, errorCode: preGameConfigurationErrorCode(error), validation: preGameConfigurationValidation(error), state: this.state };
        }
    }

    dispose(): void {
        this.currentAuthorization = null;
        this.syncWorker?.pause();
        this.matchGameplayManager?.clearRuntimeSessions();
    }

    private async restore(): Promise<DesktopAuthState> {
        this.currentAuthorization = null;
        this.syncWorker?.pause();
        if (!this.store.isAvailable() || (this.matchGameplayManager !== null && !this.liveAuthorization?.isAvailable())) return this.setBlocked("SECURE_STORAGE_UNAVAILABLE");
        if (!this.client) return this.setBlocked("CONFIGURATION_ERROR");
        let stored: StoredAuthorization | null;
        try { stored = this.store.loadAuthorization(); }
        catch (error) {
            if (authErrorCode(error) === "SESSION_INVALID") return this.setContinuityOrUnauthenticated();
            throw error;
        }
        if (!stored) return this.setContinuityOrUnauthenticated();

        let fallback: AuthorizationEnvelopeV1 | null = null;
        let token: string;
        if (stored.kind === "legacy") {
            token = stored.token;
        } else {
            try {
                this.validateOfflineEnvelope(stored.envelope);
                fallback = stored.envelope;
                token = stored.envelope.opaqueToken;
            } catch {
                this.store.clearSession();
                return this.setContinuityOrUnauthenticated();
            }
        }

        try {
            const session = await this.client.getSession(token);
            if (fallback && session.sessionId !== fallback.sessionId) throw new AuthFlowError("SESSION_INVALID");
            const envelope = this.envelopeFromValidatedSession(token, session);
            this.store.saveAuthorization(envelope);
            this.liveAuthorization?.reactivateOwner(envelope.organizationId, envelope.scorerId);
            this.currentAuthorization = envelope;
            this.state = this.authenticatedState(this.safeContext(envelope), "online");
            this.wakeSync(true);
            return this.state;
        } catch (error) {
            const code = authErrorCode(error);
            if (code === "SESSION_INVALID" || code === "SCORER_DISABLED") {
                this.store.clearSession();
                return this.setContinuityOrUnauthenticated();
            }
            if (code === "NETWORK_UNAVAILABLE" && fallback) {
                this.currentAuthorization = fallback;
                this.state = this.authenticatedState(this.safeContext(fallback), "offline");
                return this.state;
            }
            if (code === "NETWORK_UNAVAILABLE" || code === "MALFORMED_RESPONSE") {
                const continuity = this.continuityState();
                if (continuity) return continuity;
                this.state = { kind: "validation-unavailable", errorCode: code, deviceIdSuffix: this.deviceIdSuffix };
                return this.state;
            }
            throw error;
        }
    }

    private envelopeFromValidatedSession(token: string, session: ValidatedSessionContext | LoginResponse): AuthorizationEnvelopeV1 {
        if (session.deviceId !== this.deviceId) throw new AuthFlowError("SESSION_INVALID");
        const validatedAtUtc = this.now().toISOString();
        const envelope: AuthorizationEnvelopeV1 = {
            schemaVersion: 1,
            opaqueToken: token,
            sessionId: session.sessionId,
            scorerId: session.scorerId,
            username: session.username,
            organizationId: session.organizationId,
            organizationName: session.organizationName,
            deviceId: session.deviceId,
            validatedAtUtc,
            expiresAtUtc: session.expiresAt,
        };
        this.validateOfflineEnvelope(envelope);
        return envelope;
    }

    private validateOfflineEnvelope(envelope: AuthorizationEnvelopeV1): void {
        const now = this.now().getTime();
        const validatedAt = Date.parse(envelope.validatedAtUtc);
        const expiresAt = Date.parse(envelope.expiresAtUtc);
        if (envelope.deviceId !== this.deviceId || !Number.isFinite(validatedAt) || !Number.isFinite(expiresAt)
            || validatedAt >= expiresAt || now < validatedAt || now >= expiresAt) throw new AuthFlowError("SESSION_INVALID");
    }

    private authorizedContext(onlineOnly: boolean): SafeScorerContext | null {
        if (this.state.kind !== "authenticated" || !this.currentAuthorization) return null;
        try {
            this.validateOfflineEnvelope(this.currentAuthorization);
        } catch {
            try { this.store.clearSession(); } catch { /* fail closed */ }
            this.currentAuthorization = null;
            this.setContinuityOrUnauthenticated();
            return null;
        }
        if (onlineOnly && this.state.connection !== "online") return null;
        return this.state.context;
    }

    private gameplayOwner(runId: string): { scorerId: string; organizationId: string } | null {
        const context = this.authorizedContext(false);
        if (context) return this.owner(context);
        try {
            const grant = this.liveAuthorization?.resolve(runId) ?? null;
            return grant ? { scorerId: grant.scorerId, organizationId: grant.organizationId } : null;
        } catch {
            return null;
        }
    }

    private preGameConfigurationOwner(gameId: string): { scorerId: string; organizationId: string } | null {
        const context = this.authorizedContext(false);
        if (context) return this.owner(context);
        try {
            const grant = this.liveAuthorization?.resolveForGame(gameId) ?? null;
            return grant ? { scorerId: grant.scorerId, organizationId: grant.organizationId } : null;
        } catch {
            return null;
        }
    }

    private gameplaySuccess(recovery: MatchGameplayRecovery): MatchGameplayOperationResult {
        const sync = this.matchGameplayManager?.syncState(recovery.runId) ?? null;
        if (!sync) return { ok: false, errorCode: "GAMEPLAY_CORRUPTED", state: this.state };
        return { ok: true, gameplay: safeGameplay(recovery, sync), state: this.state };
    }

    private gameplayFailure(error: unknown): MatchGameplayOperationResult {
        if (error instanceof MatchGameplayFlowError) {
            return { ok: false, errorCode: error.code, dependentEventIds: error.dependentEventIds, state: this.state };
        }
        return { ok: false, errorCode: "GAMEPLAY_CORRUPTED", state: this.state };
    }

    private handleOnlineFailure(error: unknown): AuthErrorCode {
        const code = authErrorCode(error);
        if (code === "SESSION_INVALID" || code === "SCORER_DISABLED") {
            try { this.store.clearSession(); } catch { /* fail closed */ }
            this.currentAuthorization = null;
            this.syncWorker?.pause();
            this.setContinuityOrUnauthenticated();
        } else if (code === "NETWORK_UNAVAILABLE" && this.currentAuthorization) {
            try {
                this.validateOfflineEnvelope(this.currentAuthorization);
                this.state = this.authenticatedState(this.safeContext(this.currentAuthorization), "offline");
                this.syncWorker?.pause();
            } catch {
                try { this.store.clearSession(); } catch { /* fail closed */ }
                this.currentAuthorization = null;
                this.syncWorker?.pause();
                this.setContinuityOrUnauthenticated();
            }
        } else if (code === "MALFORMED_RESPONSE") {
            this.syncWorker?.pause();
            this.state = this.continuityState() ?? { kind: "validation-unavailable", errorCode: code, deviceIdSuffix: this.deviceIdSuffix };
        }
        return code;
    }

    private wakeSync(resumeAuthPaused = false): void {
        if (this.state.kind !== "authenticated" || this.state.connection !== "online" || !this.currentAuthorization || !this.syncWorker) return;
        this.syncWorker.wake(this.currentAuthorization.opaqueToken, this.owner(this.state.context), resumeAuthPaused);
    }

    private queueSync(runId: string): void {
        if (this.state.kind !== "authenticated" || this.state.connection !== "online" || !this.currentAuthorization || !this.syncWorker) return;
        this.syncWorker.queue?.(runId, this.currentAuthorization.opaqueToken, this.owner(this.state.context));
    }

    private continuityState(): DesktopAuthState | null {
        try {
            const grants = this.liveAuthorization?.listAvailable() ?? [];
            if (grants.length === 0) return null;
            const first = grants[0];
            const ownerGrants = grants.filter((grant) => grant.scorerId === first.scorerId && grant.organizationId === first.organizationId);
            return {
                kind: "live-continuity",
                deviceIdSuffix: this.deviceIdSuffix,
                context: {
                    scorerId: first.scorerId,
                    organizationId: first.organizationId,
                    runIds: ownerGrants.map((grant) => grant.runId),
                },
            };
        } catch {
            return null;
        }
    }

    private setContinuityOrUnauthenticated(): DesktopAuthState {
        const continuity = this.continuityState();
        if (continuity) {
            this.state = continuity;
            return this.state;
        }
        return this.setUnauthenticated();
    }

    private currentOwner(): { scorerId: string; organizationId: string } | null {
        if (this.state.kind === "authenticated") return this.owner(this.state.context);
        if (this.state.kind === "live-continuity") return { scorerId: this.state.context.scorerId, organizationId: this.state.context.organizationId };
        return null;
    }

    private requireAvailableFoundation(): void {
        if (!this.store.isAvailable() || (this.matchGameplayManager !== null && !this.liveAuthorization?.isAvailable())) throw new AuthFlowError("SECURE_STORAGE_UNAVAILABLE");
        if (!this.client) throw new AuthFlowError("CONFIGURATION_ERROR");
    }

    private owner(context: SafeScorerContext): { scorerId: string; organizationId: string } {
        return { scorerId: context.scorerId, organizationId: context.organizationId };
    }

    private safeContext(envelope: AuthorizationEnvelopeV1): SafeScorerContext {
        return {
            scorerId: envelope.scorerId,
            username: envelope.username,
            organizationId: envelope.organizationId,
            organizationName: envelope.organizationName,
            expiresAt: envelope.expiresAtUtc,
        };
    }

    private authenticatedState(context: SafeScorerContext, connection: "online" | "offline"): DesktopAuthState {
        return { kind: "authenticated", connection, deviceIdSuffix: this.deviceIdSuffix, context };
    }

    private accessError(onlineOnly: boolean): "OFFLINE_OPERATION_DENIED" | "SESSION_INVALID" {
        return onlineOnly && this.state.kind === "authenticated" && this.state.connection === "offline"
            ? "OFFLINE_OPERATION_DENIED"
            : "SESSION_INVALID";
    }

    private setUnauthenticated(): DesktopAuthState {
        this.state = { kind: "unauthenticated", deviceIdSuffix: this.deviceIdSuffix };
        return this.state;
    }

    private setBlocked(errorCode: "SECURE_STORAGE_UNAVAILABLE" | "CONFIGURATION_ERROR"): DesktopAuthState {
        this.state = { kind: "blocked", errorCode, deviceIdSuffix: this.deviceIdSuffix };
        return this.state;
    }

    private failure(error: unknown): AuthOperationResult {
        return { ok: false, errorCode: authErrorCode(error), state: this.state };
    }
}
