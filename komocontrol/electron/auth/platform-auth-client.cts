import { AuthFlowError, type SafeScorerContext } from "./auth-contracts.cjs";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export interface LoginResponse extends SafeScorerContext { token: string; }
export interface ScorerAuthClient {
    login(username: string, password: string, deviceId: string): Promise<LoginResponse>;
    getSession(token: string): Promise<SafeScorerContext>;
    logout(token: string): Promise<void>;
}
type FetchImplementation = (input: string, init: RequestInit) => Promise<Response>;
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function requiredString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function parseContext(value: unknown): SafeScorerContext {
    const data = record(value); const scorer = record(data?.scorer); const organization = record(data?.organization) ?? record(scorer?.organization); const session = record(data?.session);
    const scorerId = requiredString(scorer?.id) ?? requiredString(data?.scorerId);
    const username = requiredString(scorer?.username) ?? requiredString(data?.username);
    const organizationId = requiredString(organization?.id) ?? requiredString(scorer?.organizationId) ?? requiredString(data?.organizationId);
    const organizationName = requiredString(organization?.name) ?? requiredString(organization?.slug) ?? organizationId;
    const expiresAt = requiredString(session?.expiresAt) ?? requiredString(data?.expiresAt);
    if (!scorerId || !username || !organizationId || !organizationName || !expiresAt) throw new AuthFlowError("MALFORMED_RESPONSE");
    return { scorerId, username, organizationId, organizationName, expiresAt };
}
function responseData(payload: unknown): unknown { const root = record(payload); if (!root || !("data" in root)) throw new AuthFlowError("MALFORMED_RESPONSE"); return root.data; }
function serverErrorCode(payload: unknown): string | null { return requiredString(record(record(payload)?.error)?.code); }
export class PlatformAuthClient implements ScorerAuthClient {
    private readonly baseUrl: string; private readonly timeoutMs: number; private readonly fetchImplementation: FetchImplementation;
    constructor(baseUrl: string, timeoutMs = 10_000, fetchImplementation: FetchImplementation = fetch) { this.baseUrl = baseUrl.replace(/\/+$/, ""); this.timeoutMs = timeoutMs; this.fetchImplementation = fetchImplementation; }
    async login(username: string, password: string, deviceId: string): Promise<LoginResponse> {
        const { response, payload } = await this.request("/api/komocontrol/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password, deviceId }) });
        if (!response.ok) { if (serverErrorCode(payload) === "SCORER_DISABLED") throw new AuthFlowError("SCORER_DISABLED"); throw new AuthFlowError("AUTH_INVALID"); }
        const data = responseData(payload); const token = requiredString(record(data)?.token);
        if (!token || !TOKEN_PATTERN.test(token)) throw new AuthFlowError("MALFORMED_RESPONSE");
        return { token, ...parseContext(data) };
    }
    async getSession(token: string): Promise<SafeScorerContext> {
        const { response, payload } = await this.request("/api/komocontrol/v1/session", { method: "GET", headers: { authorization: `Bearer ${token}` } });
        if (!response.ok) { if (serverErrorCode(payload) === "SCORER_DISABLED") throw new AuthFlowError("SCORER_DISABLED"); throw new AuthFlowError("SESSION_INVALID"); }
        return parseContext(responseData(payload));
    }
    async logout(token: string): Promise<void> {
        const { response, payload } = await this.request("/api/komocontrol/v1/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
        if (!response.ok && response.status !== 401) throw new AuthFlowError(serverErrorCode(payload) === "SCORER_DISABLED" ? "SCORER_DISABLED" : "SESSION_INVALID");
    }
    private async request(pathname: string, init: RequestInit): Promise<{ response: Response; payload: unknown }> {
        const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        try {
            const response = await this.fetchImplementation(`${this.baseUrl}${pathname}`, { ...init, signal: controller.signal, cache: "no-store" });
            let payload: unknown = null;
            try { payload = await response.json(); } catch { if (response.ok) throw new AuthFlowError("MALFORMED_RESPONSE"); }
            return { response, payload };
        } catch (error) { if (error instanceof AuthFlowError) throw error; throw new AuthFlowError("NETWORK_UNAVAILABLE"); }
        finally { clearTimeout(timeout); }
    }
}
