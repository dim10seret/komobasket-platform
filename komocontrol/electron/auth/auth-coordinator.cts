import { AuthFlowError, authErrorCode, type AuthErrorCode, type AuthOperationResult, type DesktopAuthState, type LoginInput, type SafeScorerContext } from "./auth-contracts.cjs";
import type { ScorerAuthClient } from "./platform-auth-client.cjs";
import { SecureSessionStore } from "./secure-session-store.cjs";
export class AuthCoordinator {
    private readonly client: ScorerAuthClient | null; private readonly store: SecureSessionStore; private readonly deviceId: string; private readonly deviceIdSuffix: string;
    private currentToken: string | null = null; private state: DesktopAuthState; private initialization: Promise<DesktopAuthState> | null = null;
    constructor(client: ScorerAuthClient | null, store: SecureSessionStore, deviceId: string) { this.client = client; this.store = store; this.deviceId = deviceId; this.deviceIdSuffix = deviceId.slice(-8); this.state = { kind: "unauthenticated", deviceIdSuffix: this.deviceIdSuffix }; }
    initialize(): Promise<DesktopAuthState> { if (!this.initialization) this.initialization = this.restore(); return this.initialization; }
    async getState(): Promise<DesktopAuthState> { await this.initialize(); return this.state; }
    async login(input: LoginInput): Promise<AuthOperationResult> {
        await this.initialize();
        try { this.requireAvailableFoundation(); const result = await this.client!.login(input.username, input.password, this.deviceId);
            try { this.store.saveToken(result.token); } catch (error) { try { await this.client!.logout(result.token); } catch { /* best effort */ } throw error; }
            const safeContext: SafeScorerContext = {
                scorerId: result.scorerId,
                username: result.username,
                organizationId: result.organizationId,
                organizationName: result.organizationName,
                expiresAt: result.expiresAt,
            };
            this.currentToken = result.token; this.state = this.authenticatedState(safeContext); return { ok: true, state: this.state };
        } catch (error) { return this.failure(error); }
    }
    async retrySession(): Promise<AuthOperationResult> {
        try { this.state = await this.restore(); return this.state.kind === "authenticated" ? { ok: true, state: this.state } : { ok: false, errorCode: this.state.kind === "validation-unavailable" ? this.state.errorCode : "SESSION_INVALID", state: this.state }; }
        catch (error) { return this.failure(error); }
    }
    async logout(): Promise<AuthOperationResult> {
        await this.initialize(); let token = this.currentToken;
        if (!token) { try { token = this.store.loadToken(); } catch (error) { if (authErrorCode(error) !== "SESSION_INVALID") return this.failure(error); } }
        if (token && this.client) { try { await this.client.logout(token); } catch { /* offline logout has no retry queue */ } }
        try { this.store.clearSession(); } catch (error) { return this.failure(error); }
        this.currentToken = null; this.state = { kind: "unauthenticated", deviceIdSuffix: this.deviceIdSuffix }; return { ok: true, state: this.state };
    }
    dispose(): void { this.currentToken = null; }
    private async restore(): Promise<DesktopAuthState> {
        this.currentToken = null; if (!this.store.isAvailable()) return this.setBlocked("SECURE_STORAGE_UNAVAILABLE"); if (!this.client) return this.setBlocked("CONFIGURATION_ERROR");
        let token: string | null;
        try { token = this.store.loadToken(); } catch (error) { if (authErrorCode(error) === "SESSION_INVALID") return this.setUnauthenticated(); throw error; }
        if (!token) return this.setUnauthenticated();
        try { const context = await this.client.getSession(token); this.currentToken = token; this.state = this.authenticatedState(context); return this.state; }
        catch (error) { const code = authErrorCode(error); if (code === "SESSION_INVALID" || code === "SCORER_DISABLED") { this.store.clearSession(); return this.setUnauthenticated(); } if (code === "NETWORK_UNAVAILABLE" || code === "MALFORMED_RESPONSE") { this.state = { kind: "validation-unavailable", errorCode: code, deviceIdSuffix: this.deviceIdSuffix }; return this.state; } throw error; }
    }
    private requireAvailableFoundation(): void { if (!this.store.isAvailable()) throw new AuthFlowError("SECURE_STORAGE_UNAVAILABLE"); if (!this.client) throw new AuthFlowError("CONFIGURATION_ERROR"); }
    private authenticatedState(context: SafeScorerContext): DesktopAuthState { return { kind: "authenticated", connection: "online", deviceIdSuffix: this.deviceIdSuffix, context }; }
    private setUnauthenticated(): DesktopAuthState { this.state = { kind: "unauthenticated", deviceIdSuffix: this.deviceIdSuffix }; return this.state; }
    private setBlocked(errorCode: "SECURE_STORAGE_UNAVAILABLE" | "CONFIGURATION_ERROR"): DesktopAuthState { this.state = { kind: "blocked", errorCode, deviceIdSuffix: this.deviceIdSuffix }; return this.state; }
    private failure(error: unknown): AuthOperationResult { const errorCode: AuthErrorCode = authErrorCode(error); return { ok: false, errorCode, state: this.state }; }
}
