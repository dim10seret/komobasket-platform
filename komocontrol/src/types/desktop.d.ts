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
interface KomoControlAvailableGame { gameId: string; packageId: string; packageVersion: number; homeTeam: { id: string; name: string }; awayTeam: { id: string; name: string }; competition: { id: string; name: string }; seasonName: string; phaseName: string | null; roundLabel: string | null; scheduledDate: string; scheduledTime: string; scheduledAt: string | null; venue: string | null; publishedAt: string; }
type KomoControlGameDiscoveryResult = { ok: true; games: KomoControlAvailableGame[]; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlAuthErrorCode; state: KomoControlAuthState };
type KomoControlGamePackageErrorCode = KomoControlAuthErrorCode | "PACKAGE_UNAVAILABLE" | "PACKAGE_INVALID" | "PACKAGE_HASH_MISMATCH" | "PACKAGE_CONFLICT" | "PACKAGE_UNSUPPORTED";
interface KomoControlOfflineGameStatus { gameId: string; availableOffline: boolean; currentVersion: number | null; downloadedAt: string | null; }
type KomoControlGamePackageDownloadResult = { ok: true; status: KomoControlOfflineGameStatus; outcome: "stored" | "unchanged"; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlGamePackageErrorCode; state: KomoControlAuthState };
interface KomoControlMatchSetupPlayer { playerId: string; displayName: string; photoUrl: string | null; shirtNumber: number | null; }
interface KomoControlMatchSetupStaffMember { staffId: string; displayName: string; role: string; roleLabel: string | null; }
interface KomoControlMatchSetupTeam { side: "HOME" | "AWAY"; teamId: string; teamName: string; logoUrl: string | null; players: KomoControlMatchSetupPlayer[]; staff: KomoControlMatchSetupStaffMember[]; }
interface KomoControlMatchSetup { gameId: string; packageId: string; packageVersion: number; competitionName: string; seasonName: string; phaseName: string | null; roundLabel: string | null; scheduledDate: string | null; scheduledTime: string | null; venue: string | null; settings: { gameMode: "SIMPLE" | "FULL"; minPlayers: number; maxPlayers: number; startingPlayers: number; regulationPeriods: number; regulationPeriodSeconds: number; overtimeSeconds: number; tieAllowed: boolean; winnerRequired: boolean; }; home: KomoControlMatchSetupTeam; away: KomoControlMatchSetupTeam; }
type KomoControlMatchSetupResult = { ok: true; setup: KomoControlMatchSetup; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlGamePackageErrorCode; state: KomoControlAuthState };

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
    listAvailableGames(): Promise<KomoControlGameDiscoveryResult>;
    getOfflineGameStatus(gameId: string): Promise<KomoControlOfflineGameStatus>;
    downloadGamePackage(gameId: string): Promise<KomoControlGamePackageDownloadResult>;
    getMatchSetup(gameId: string): Promise<KomoControlMatchSetupResult>;
}

interface Window {
    komoControl?: KomoControlDesktopBridge;
}
