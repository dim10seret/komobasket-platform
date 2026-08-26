import { AuthFlowError, authErrorCode, type AuthErrorCode, type AuthOperationResult, type DesktopAuthState, type LoginInput, type SafeScorerContext } from "./auth-contracts.cjs";
import type { LoginResponse, ScorerAuthClient, ValidatedSessionContext } from "./platform-auth-client.cjs";
import { SecureSessionStore, type AuthorizationEnvelopeV1, type StoredAuthorization } from "./secure-session-store.cjs";
import type { GameDiscoveryOperationResult } from "../games/game-discovery-contracts.cjs";
import { GamePackageDownloadManager, packageOperationFailure, type GamePackageDownloadResult } from "../games/game-package-download.cjs";
import type { LocalGamePackageStatus } from "../persistence/local-database.cjs";
import { MatchSetupManager, matchSetupErrorCode, type MatchSetupOperationResult } from "../games/match-setup.cjs";
import { MatchRunManager, matchRunErrorCode, type LocalRunCatalogueResult, type MatchRunOperationResult } from "../runs/match-run.cjs";
import { PreGameConfigurationManager, preGameConfigurationErrorCode, type PreGameConfigurationOperationResult, type PreGameConfigurationSaveDraftInput } from "../runs/pre-game-configuration.cjs";
import { MatchGameplayFlowError, type MatchGameplayErrorCode, type MatchGameplayManager, type MatchGameplayRecovery } from "../runs/match-gameplay.cjs";

export class AuthCoordinator {
    private readonly client: ScorerAuthClient | null;
    private readonly store: SecureSessionStore;
    private readonly deviceId: string;
    private readonly deviceIdSuffix: string;
    private currentAuthorization: AuthorizationEnvelopeV1 | null = null;
    private state: DesktopAuthState;
    private initialization: Promise<DesktopAuthState> | null = null;

    constructor(
        client: ScorerAuthClient | null,
        store: SecureSessionStore,
        deviceId: string,
        private readonly packageManager: GamePackageDownloadManager | null = null,
        private readonly matchSetupManager: MatchSetupManager | null = null,
        private readonly matchRunManager: MatchRunManager | null = null,
        private readonly preGameConfigurationManager: PreGameConfigurationManager | null = null,
        private readonly matchGameplayManager: MatchGameplayManager | null = null,
        private readonly now: () => Date = () => new Date(),
    ) {
        this.client = client;
        this.store = store;
        this.deviceId = deviceId;
        this.deviceIdSuffix = deviceId.slice(-8);
        this.state = { kind: "unauthenticated", deviceIdSuffix: this.deviceIdSuffix };
    }

    initialize(): Promise<DesktopAuthState> { if (!this.initialization) this.initialization = this.restore(); return this.initialization; }
    async getState(): Promise<DesktopAuthState> { await this.initialize(); return this.state; }

    async login(input: LoginInput): Promise<AuthOperationResult> {
        await this.initialize();
        try {
            this.requireAvailableFoundation();
            const result = await this.client!.login(input.username, input.password, this.deviceId);
            const envelope = this.envelopeFromValidatedSession(result.token, result);
            try { this.store.saveAuthorization(envelope); }
            catch (error) { try { await this.client!.logout(result.token); } catch { /* best effort */ } throw error; }
            this.currentAuthorization = envelope;
            this.state = this.authenticatedState(this.safeContext(envelope), "online");
            return { ok: true, state: this.state };
        } catch (error) { return this.failure(error); }
    }

    async retrySession(): Promise<AuthOperationResult> {
        try {
            this.state = await this.restore();
            return this.state.kind === "authenticated"
                ? { ok: true, state: this.state }
                : { ok: false, errorCode: this.state.kind === "validation-unavailable" ? this.state.errorCode : "SESSION_INVALID", state: this.state };
        } catch (error) { return this.failure(error); }
    }

    async logout(): Promise<AuthOperationResult> {
        await this.initialize();
        let stored: StoredAuthorization | null = null;
        try { stored = this.store.loadAuthorization(); }
        catch (error) { if (authErrorCode(error) !== "SESSION_INVALID") return this.failure(error); }
        const token = this.currentAuthorization?.opaqueToken ?? (stored?.kind === "legacy" ? stored.token : stored?.envelope.opaqueToken ?? null);
        if (token && this.client && this.state.kind === "authenticated" && this.state.connection === "online") {
            try { await this.client.logout(token); } catch { /* offline logout has no retry queue */ }
        }
        try { this.store.clearSession(); } catch (error) { return this.failure(error); }
        this.currentAuthorization = null;
        this.state = { kind: "unauthenticated", deviceIdSuffix: this.deviceIdSuffix };
        return { ok: true, state: this.state };
    }

    async listGames(): Promise<GameDiscoveryOperationResult> {
        await this.initialize();
        const context = this.authorizedContext(true);
        if (!this.client || !context || !this.currentAuthorization) return { ok: false, errorCode: this.accessError(true), state: this.state };
        try { return { ok: true, games: await this.client.listGames(this.currentAuthorization.opaqueToken), state: this.state }; }
        catch (error) { const errorCode = this.handleOnlineFailure(error); return { ok: false, errorCode, state: this.state }; }
    }

    async listLocalRuns(): Promise<LocalRunCatalogueResult> {
        await this.initialize();
        const context = this.authorizedContext(false);
        if (!this.matchRunManager || !context) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try { return { ok: true, runs: this.matchRunManager.listRecoverable(this.owner(context)), state: this.state }; }
        catch (error) { return { ok: false, errorCode: matchRunErrorCode(error), state: this.state }; }
    }

    async recoverMatchGameplay(runId: string): Promise<
        | { ok: true; recovery: MatchGameplayRecovery; state: DesktopAuthState }
        | { ok: false; errorCode: MatchGameplayErrorCode | "SESSION_INVALID"; state: DesktopAuthState }
    > {
        await this.initialize();
        const context = this.authorizedContext(false);
        if (!this.matchGameplayManager || !context) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try { return { ok: true, recovery: await this.matchGameplayManager.recover(runId, this.owner(context)), state: this.state }; }
        catch (error) { return { ok: false, errorCode: error instanceof MatchGameplayFlowError ? error.code : "GAMEPLAY_CORRUPTED", state: this.state }; }
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
            const errorCode = authErrorCode(error);
            if (errorCode === "SESSION_INVALID" || errorCode === "SCORER_DISABLED" || errorCode === "NETWORK_UNAVAILABLE" || errorCode === "MALFORMED_RESPONSE") this.handleOnlineFailure(error);
            return packageOperationFailure(error, this.state);
        }
    }

    getMatchSetup(gameId: string): MatchSetupOperationResult {
        const context = this.authorizedContext(false);
        if (!this.matchSetupManager || !context) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const setup = this.state.kind === "authenticated" && this.state.connection === "offline"
                ? this.matchRunManager?.recoverSetup(gameId, this.owner(context))
                : this.matchSetupManager.getMatchSetup(gameId);
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
        try { const result = this.matchRunManager.createOrOpen(gameId, this.owner(context)); return { ok: true, ...result, state: this.state }; }
        catch (error) { return { ok: false, errorCode: matchRunErrorCode(error), state: this.state }; }
    }

    async getActiveGameRun(gameId: string): Promise<MatchRunOperationResult> {
        await this.initialize();
        const context = this.authorizedContext(false);
        if (!this.matchRunManager || !context) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try { return { ok: true, outcome: "recovered", run: this.matchRunManager.recover(gameId, this.owner(context)), state: this.state }; }
        catch (error) { return { ok: false, errorCode: matchRunErrorCode(error), state: this.state }; }
    }

    async getOrCreatePreGameConfiguration(gameId: string): Promise<PreGameConfigurationOperationResult> {
        await this.initialize();
        const context = this.authorizedContext(false);
        if (!this.preGameConfigurationManager || !context) return { ok: false, errorCode: "SESSION_INVALID", state: this.state };
        try {
            const result = this.state.kind === "authenticated" && this.state.connection === "offline"
                ? this.preGameConfigurationManager.recover(gameId, this.owner(context))
                : this.preGameConfigurationManager.getOrCreate(gameId, this.owner(context));
            return { ok: true, ...result, state: this.state };
        } catch (error) { return { ok: false, errorCode: preGameConfigurationErrorCode(error), state: this.state }; }
    }

    async savePreGameConfigurationDraft(input: PreGameConfigurationSaveDraftInput): Promise<PreGameConfigurationOperationResult> {
        await this.initialize();
        const context = this.authorizedContext(true);
        if (!this.preGameConfigurationManager || !context) return { ok: false, errorCode: this.accessError(true), state: this.state };
        try {
            const configuration = this.preGameConfigurationManager.saveDraft(input, this.owner(context));
            return { ok: true, outcome: "saved", configuration, state: this.state };
        } catch (error) { return { ok: false, errorCode: preGameConfigurationErrorCode(error), state: this.state }; }
    }

    dispose(): void { this.currentAuthorization = null; }

    private async restore(): Promise<DesktopAuthState> {
        this.currentAuthorization = null;
        if (!this.store.isAvailable()) return this.setBlocked("SECURE_STORAGE_UNAVAILABLE");
        if (!this.client) return this.setBlocked("CONFIGURATION_ERROR");
        let stored: StoredAuthorization | null;
        try { stored = this.store.loadAuthorization(); }
        catch (error) { if (authErrorCode(error) === "SESSION_INVALID") return this.setUnauthenticated(); throw error; }
        if (!stored) return this.setUnauthenticated();

        let fallback: AuthorizationEnvelopeV1 | null = null;
        let token: string;
        if (stored.kind === "legacy") token = stored.token;
        else {
            try { this.validateOfflineEnvelope(stored.envelope); }
            catch { this.store.clearSession(); return this.setUnauthenticated(); }
            fallback = stored.envelope;
            token = stored.envelope.opaqueToken;
        }

        try {
            const session = await this.client.getSession(token);
            if (fallback && session.sessionId !== fallback.sessionId) throw new AuthFlowError("SESSION_INVALID");
            const envelope = this.envelopeFromValidatedSession(token, session);
            this.store.saveAuthorization(envelope);
            this.currentAuthorization = envelope;
            this.state = this.authenticatedState(this.safeContext(envelope), "online");
            return this.state;
        } catch (error) {
            const code = authErrorCode(error);
            if (code === "SESSION_INVALID" || code === "SCORER_DISABLED") { this.store.clearSession(); return this.setUnauthenticated(); }
            if (code === "NETWORK_UNAVAILABLE" && fallback) {
                this.currentAuthorization = fallback;
                this.state = this.authenticatedState(this.safeContext(fallback), "offline");
                return this.state;
            }
            if (code === "NETWORK_UNAVAILABLE" || code === "MALFORMED_RESPONSE") {
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
            schemaVersion: 1, opaqueToken: token, sessionId: session.sessionId, scorerId: session.scorerId,
            username: session.username, organizationId: session.organizationId, organizationName: session.organizationName,
            deviceId: session.deviceId, validatedAtUtc, expiresAtUtc: session.expiresAt,
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
        try { this.validateOfflineEnvelope(this.currentAuthorization); }
        catch { try { this.store.clearSession(); } catch { /* fail closed */ } this.currentAuthorization = null; this.setUnauthenticated(); return null; }
        if (onlineOnly && this.state.connection !== "online") return null;
        return this.state.context;
    }

    private handleOnlineFailure(error: unknown): AuthErrorCode {
        const code = authErrorCode(error);
        if (code === "SESSION_INVALID" || code === "SCORER_DISABLED") {
            try { this.store.clearSession(); } catch { /* fail closed below */ }
            this.currentAuthorization = null;
            this.setUnauthenticated();
        } else if (code === "NETWORK_UNAVAILABLE" && this.currentAuthorization) {
            try { this.validateOfflineEnvelope(this.currentAuthorization); this.state = this.authenticatedState(this.safeContext(this.currentAuthorization), "offline"); }
            catch { try { this.store.clearSession(); } catch { /* fail closed */ } this.currentAuthorization = null; this.setUnauthenticated(); }
        } else if (code === "MALFORMED_RESPONSE") {
            this.state = { kind: "validation-unavailable", errorCode: code, deviceIdSuffix: this.deviceIdSuffix };
        }
        return code;
    }

    private requireAvailableFoundation(): void { if (!this.store.isAvailable()) throw new AuthFlowError("SECURE_STORAGE_UNAVAILABLE"); if (!this.client) throw new AuthFlowError("CONFIGURATION_ERROR"); }
    private owner(context: SafeScorerContext): { scorerId: string; organizationId: string } { return { scorerId: context.scorerId, organizationId: context.organizationId }; }
    private safeContext(envelope: AuthorizationEnvelopeV1): SafeScorerContext { return { scorerId: envelope.scorerId, username: envelope.username, organizationId: envelope.organizationId, organizationName: envelope.organizationName, expiresAt: envelope.expiresAtUtc }; }
    private authenticatedState(context: SafeScorerContext, connection: "online" | "offline"): DesktopAuthState { return { kind: "authenticated", connection, deviceIdSuffix: this.deviceIdSuffix, context }; }
    private accessError(onlineOnly: boolean): "OFFLINE_OPERATION_DENIED" | "SESSION_INVALID" { return onlineOnly && this.state.kind === "authenticated" && this.state.connection === "offline" ? "OFFLINE_OPERATION_DENIED" : "SESSION_INVALID"; }
    private setUnauthenticated(): DesktopAuthState { this.state = { kind: "unauthenticated", deviceIdSuffix: this.deviceIdSuffix }; return this.state; }
    private setBlocked(errorCode: "SECURE_STORAGE_UNAVAILABLE" | "CONFIGURATION_ERROR"): DesktopAuthState { this.state = { kind: "blocked", errorCode, deviceIdSuffix: this.deviceIdSuffix }; return this.state; }
    private failure(error: unknown): AuthOperationResult { const errorCode: AuthErrorCode = authErrorCode(error); return { ok: false, errorCode, state: this.state }; }
}
