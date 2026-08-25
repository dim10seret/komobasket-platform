interface KomoControlAppInfo {
    version: string;
    environment: "development" | "production";
}

type KomoControlAuthErrorCode = "AUTH_INVALID" | "SCORER_DISABLED" | "SESSION_INVALID" | "NETWORK_UNAVAILABLE" | "MALFORMED_RESPONSE" | "SECURE_STORAGE_UNAVAILABLE" | "LOCAL_SESSION_ERROR" | "CONFIGURATION_ERROR";
interface KomoControlSafeScorerContext { scorerId: string; username: string; organizationId: string; organizationName: string; expiresAt: string; }
type KomoControlAuthState =
    | { kind: "unauthenticated"; deviceIdSuffix: string }
    | { kind: "authenticated"; connection: "online"; deviceIdSuffix: string; context: KomoControlSafeScorerContext }
    | { kind: "validation-unavailable"; errorCode: "NETWORK_UNAVAILABLE" | "MALFORMED_RESPONSE"; deviceIdSuffix: string }
    | { kind: "blocked"; errorCode: "SECURE_STORAGE_UNAVAILABLE" | "CONFIGURATION_ERROR"; deviceIdSuffix: string };
type KomoControlAuthOperationResult = { ok: true; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlAuthErrorCode; state: KomoControlAuthState };

interface KomoControlDesktopBridge {
    getAppInfo(): Promise<KomoControlAppInfo>;
    getLocalStatus(): Promise<{
        ready: true;
        schemaVersion: string;
        deviceIdSuffix: string;
    }>;
    getAuthState(): Promise<KomoControlAuthState>;
    login(input: { username: string; password: string }): Promise<KomoControlAuthOperationResult>;
    retrySession(): Promise<KomoControlAuthOperationResult>;
    logout(): Promise<KomoControlAuthOperationResult>;
}

interface Window {
    komoControl?: KomoControlDesktopBridge;
}
