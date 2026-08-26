import { AuthFlowError, type SafeScorerContext } from "./auth-contracts.cjs";
import type { AvailableGame } from "../games/game-discovery-contracts.cjs";
import { GamePackageFlowError, parseGamePackageEnvelope, type GamePackageEnvelope } from "../games/game-package-download.cjs";
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export interface ValidatedSessionContext extends SafeScorerContext { sessionId: string; deviceId: string; }
export interface LoginResponse extends ValidatedSessionContext { token: string; }
export interface GameplaySyncRequest {
    schemaVersion: 1;
    runId: string;
    gameId: string;
    packageId: string;
    packageVersion: number;
    packageHash: string;
    organizationId: string;
    scorerId: string;
    deviceId: string;
    startedAtUtc: string;
    configurationRevision: number;
    configurationHash: string;
    currentConfigurationRevision: number;
    currentConfigurationHash: string;
    currentConfigurationJson: string;
    snapshotSchemaVersion: 1;
    matchEventSchemaVersion: 2;
    initialStateJson: string;
    initialStateHash: string;
    eventHistoryRevision: number;
    lastAcceptedSequence: number;
    historyHash: string;
    events: Array<{ eventId: string; sequence: number; eventSchemaVersion: 2; eventJson: string; eventHash: string }>;
    finalization: null | {
        schemaVersion: 1;
        finalizedHistoryRevision: number;
        finalizedHistoryHash: string;
        finalStateJson: string;
        finalStateHash: string;
        finalizationJson: string;
        finalizationHash: string;
        finalizedAtUtc: string;
    };
}
export interface GameplaySyncResponse {
    runId: string;
    acknowledgedHistoryRevision: number;
    acknowledgedHistoryHash: string;
    acknowledgedConfigurationRevision: number;
    acknowledgedConfigurationHash: string;
    acknowledgedFinalizationHash: string | null;
    officialResultApplied: boolean;
    status: "accepted" | "idempotent";
}
export type PlatformGameplaySyncErrorCode =
    | "SYNC_INVALID"
    | "SYNC_AUTH"
    | "SYNC_STALE"
    | "SYNC_INTEGRITY_CONFLICT"
    | "SYNC_RUN_CONFLICT"
    | "SYNC_UNAVAILABLE";
export class PlatformGameplaySyncError extends Error {
    constructor(readonly code: PlatformGameplaySyncErrorCode) {
        super(code);
        this.name = "PlatformGameplaySyncError";
    }
}
export interface ScorerAuthClient {
    login(username: string, password: string, deviceId: string): Promise<LoginResponse>;
    getSession(token: string): Promise<ValidatedSessionContext>;
    logout(token: string): Promise<void>;
    listGames(token: string): Promise<AvailableGame[]>;
    downloadGamePackage(token: string, gameId: string): Promise<GamePackageEnvelope>;
}
type FetchImplementation = (input: string, init: RequestInit) => Promise<Response>;
function record(value: unknown): Record<string, unknown> | null { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function requiredString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function parseContext(value: unknown): ValidatedSessionContext {
    const data = record(value); const scorer = record(data?.scorer); const organization = record(data?.organization) ?? record(scorer?.organization); const session = record(data?.session);
    const scorerId = requiredString(scorer?.id) ?? requiredString(data?.scorerId);
    const username = requiredString(scorer?.username) ?? requiredString(data?.username);
    const organizationId = requiredString(organization?.id) ?? requiredString(scorer?.organizationId) ?? requiredString(data?.organizationId);
    const organizationName = requiredString(organization?.name) ?? requiredString(organization?.slug) ?? organizationId;
    const sessionId = requiredString(session?.id) ?? requiredString(data?.sessionId);
    const deviceId = requiredString(session?.deviceId) ?? requiredString(data?.deviceId);
    const expiresAt = requiredString(session?.expiresAt) ?? requiredString(data?.expiresAt);
    if (!scorerId || !username || !organizationId || !organizationName || !sessionId || !deviceId || !expiresAt) throw new AuthFlowError("MALFORMED_RESPONSE");
    return { scorerId, username, organizationId, organizationName, sessionId, deviceId, expiresAt };
}
function responseData(payload: unknown): unknown { const root = record(payload); if (!root || !("data" in root)) throw new AuthFlowError("MALFORMED_RESPONSE"); return root.data; }
function serverErrorCode(payload: unknown): string | null { return requiredString(record(record(payload)?.error)?.code); }
function optionalString(value: unknown): string | null { return value === null ? null : requiredString(value); }
function parseTeam(value: unknown): AvailableGame["homeTeam"] { const item = record(value); const id = requiredString(item?.id); const name = requiredString(item?.name); if (!id || !name) throw new AuthFlowError("MALFORMED_RESPONSE"); return { id, name }; }
function parseGame(value: unknown): AvailableGame {
    const item = record(value); const competition = record(item?.competition); const gameId = requiredString(item?.gameId); const packageId = requiredString(item?.packageId); const packageVersion = item?.packageVersion; const competitionId = requiredString(competition?.id); const competitionName = requiredString(competition?.name); const seasonName = requiredString(item?.seasonName); const scheduledDate = requiredString(item?.scheduledDate); const scheduledTime = requiredString(item?.scheduledTime); const publishedAt = requiredString(item?.publishedAt);
    if (!gameId || !packageId || !Number.isInteger(packageVersion) || Number(packageVersion) < 1 || !competitionId || !competitionName || !seasonName || !scheduledDate || !/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || !scheduledTime || !/^\d{2}:\d{2}(?::\d{2})?$/.test(scheduledTime) || !publishedAt) throw new AuthFlowError("MALFORMED_RESPONSE");
    return { gameId, packageId, packageVersion: Number(packageVersion), homeTeam: parseTeam(item?.homeTeam), awayTeam: parseTeam(item?.awayTeam), competition: { id: competitionId, name: competitionName }, seasonName, phaseName: optionalString(item?.phaseName), roundLabel: optionalString(item?.roundLabel), scheduledDate, scheduledTime, scheduledAt: optionalString(item?.scheduledAt), venue: optionalString(item?.venue), publishedAt };
}
function parseGames(value: unknown): AvailableGame[] { if (!Array.isArray(value)) throw new AuthFlowError("MALFORMED_RESPONSE"); return value.map(parseGame); }
function parseGameplaySyncResponse(value: unknown): GameplaySyncResponse {
    const data = record(value);
    const runId = requiredString(data?.runId);
    const acknowledgedHistoryRevision = Number(data?.acknowledgedHistoryRevision);
    const acknowledgedHistoryHash = requiredString(data?.acknowledgedHistoryHash);
    const acknowledgedConfigurationRevision = Number(data?.acknowledgedConfigurationRevision);
    const acknowledgedConfigurationHash = requiredString(data?.acknowledgedConfigurationHash);
    const acknowledgedFinalizationHash = data?.acknowledgedFinalizationHash === null ? null : requiredString(data?.acknowledgedFinalizationHash);
    if (!runId || !Number.isInteger(acknowledgedHistoryRevision) || acknowledgedHistoryRevision < 1
        || !acknowledgedHistoryHash || !/^[0-9a-f]{64}$/.test(acknowledgedHistoryHash)
        || !Number.isInteger(acknowledgedConfigurationRevision) || acknowledgedConfigurationRevision < 1
        || !acknowledgedConfigurationHash || !/^[0-9a-f]{64}$/.test(acknowledgedConfigurationHash)
        || !(acknowledgedFinalizationHash === null || /^[0-9a-f]{64}$/.test(acknowledgedFinalizationHash))
        || typeof data?.officialResultApplied !== "boolean"
        || (data.status !== "accepted" && data.status !== "idempotent")) throw new AuthFlowError("MALFORMED_RESPONSE");
    return { runId, acknowledgedHistoryRevision, acknowledgedHistoryHash, acknowledgedConfigurationRevision, acknowledgedConfigurationHash, acknowledgedFinalizationHash, officialResultApplied: data.officialResultApplied, status: data.status };
}
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
    async getSession(token: string): Promise<ValidatedSessionContext> {
        const { response, payload } = await this.request("/api/komocontrol/v1/session", { method: "GET", headers: { authorization: `Bearer ${token}` } });
        if (!response.ok) { if (serverErrorCode(payload) === "SCORER_DISABLED") throw new AuthFlowError("SCORER_DISABLED"); throw new AuthFlowError("SESSION_INVALID"); }
        return parseContext(responseData(payload));
    }
    async logout(token: string): Promise<void> {
        const { response, payload } = await this.request("/api/komocontrol/v1/auth/logout", { method: "POST", headers: { authorization: `Bearer ${token}` } });
        if (!response.ok && response.status !== 401) throw new AuthFlowError(serverErrorCode(payload) === "SCORER_DISABLED" ? "SCORER_DISABLED" : "SESSION_INVALID");
    }
    async listGames(token: string): Promise<AvailableGame[]> {
        const { response, payload } = await this.request("/api/komocontrol/v1/games", { method: "GET", headers: { authorization: `Bearer ${token}` } });
        if (!response.ok) { if (serverErrorCode(payload) === "SCORER_DISABLED") throw new AuthFlowError("SCORER_DISABLED"); if (response.status === 401) throw new AuthFlowError("SESSION_INVALID"); throw new AuthFlowError("NETWORK_UNAVAILABLE"); }
        return parseGames(responseData(payload));
    }
    async downloadGamePackage(token: string, gameId: string): Promise<GamePackageEnvelope> {
        const { response, payload } = await this.request(`/api/komocontrol/v1/games/${encodeURIComponent(gameId)}/package`, { method: "GET", headers: { authorization: `Bearer ${token}` } });
        if (!response.ok) { if (serverErrorCode(payload) === "SCORER_DISABLED") throw new AuthFlowError("SCORER_DISABLED"); if (response.status === 401) throw new AuthFlowError("SESSION_INVALID"); if (response.status === 404) throw new GamePackageFlowError("PACKAGE_UNAVAILABLE"); throw new AuthFlowError("NETWORK_UNAVAILABLE"); }
        return parseGamePackageEnvelope(responseData(payload));
    }
    async syncGameplay(token: string, input: GameplaySyncRequest): Promise<GameplaySyncResponse> {
        const { response, payload } = await this.request(`/api/komocontrol/v1/runs/${encodeURIComponent(input.runId)}/sync`, {
            method: "PUT",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
            body: JSON.stringify(input),
        });
        if (!response.ok) {
            const code = serverErrorCode(payload);
            if (response.status === 401 || code === "SCORER_DISABLED") throw new PlatformGameplaySyncError("SYNC_AUTH");
            if (code === "SYNC_STALE") throw new PlatformGameplaySyncError("SYNC_STALE");
            if (code === "SYNC_INTEGRITY_CONFLICT") throw new PlatformGameplaySyncError("SYNC_INTEGRITY_CONFLICT");
            if (code === "SYNC_RUN_CONFLICT") throw new PlatformGameplaySyncError("SYNC_RUN_CONFLICT");
            if (response.status === 408 || response.status === 425 || response.status === 429) throw new PlatformGameplaySyncError("SYNC_UNAVAILABLE");
            if (response.status >= 400 && response.status < 500) throw new PlatformGameplaySyncError("SYNC_INVALID");
            throw new PlatformGameplaySyncError("SYNC_UNAVAILABLE");
        }
        return parseGameplaySyncResponse(responseData(payload));
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
