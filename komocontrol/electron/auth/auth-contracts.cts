export const AUTH_ERROR_CODES = [
    "AUTH_INVALID", "SCORER_DISABLED", "SESSION_INVALID", "NETWORK_UNAVAILABLE",
    "MALFORMED_RESPONSE", "SECURE_STORAGE_UNAVAILABLE", "LOCAL_SESSION_ERROR", "CONFIGURATION_ERROR",
    "OFFLINE_OPERATION_DENIED",
] as const;
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];
export interface SafeScorerContext { scorerId: string; username: string; organizationId: string; organizationName: string; expiresAt: string; }
export type DesktopAuthState =
    | { kind: "unauthenticated"; deviceIdSuffix: string }
    | { kind: "authenticated"; connection: "online" | "offline"; deviceIdSuffix: string; context: SafeScorerContext }
    | { kind: "validation-unavailable"; errorCode: "NETWORK_UNAVAILABLE" | "MALFORMED_RESPONSE"; deviceIdSuffix: string }
    | { kind: "blocked"; errorCode: "SECURE_STORAGE_UNAVAILABLE" | "CONFIGURATION_ERROR"; deviceIdSuffix: string };
export interface LoginInput { username: string; password: string; }
export type AuthOperationResult = { ok: true; state: DesktopAuthState } | { ok: false; errorCode: AuthErrorCode; state: DesktopAuthState };
export class AuthFlowError extends Error {
    readonly code: AuthErrorCode;
    constructor(code: AuthErrorCode) { super(code); this.name = "AuthFlowError"; this.code = code; }
}

function isAuthErrorCode(value: unknown): value is AuthErrorCode {
    return typeof value === "string" && AUTH_ERROR_CODES.some((code) => code === value);
}

export function authErrorCode(error: unknown): AuthErrorCode {
    if (error instanceof AuthFlowError) {
        return error.code;
    }
    if (error !== null && typeof error === "object" && "code" in error) {
        const code = Reflect.get(error, "code");
        if (isAuthErrorCode(code)) {
            return code;
        }
    }
    return "LOCAL_SESSION_ERROR";
}
