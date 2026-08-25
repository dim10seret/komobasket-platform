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
type KomoControlMatchRunErrorCode = "RUN_UNAVAILABLE" | "RUN_INVALID" | "RUN_CONFLICT" | "RUN_OWNERSHIP_CONFLICT";
interface KomoControlSafeMatchRun { runId: string; gameId: string; packageId: string; packageVersion: number; status: "active"; gameplayStarted: false; lastAcceptedSequence: 0; createdAtUtc: string; }
type KomoControlMatchRunResult = { ok: true; outcome: "created" | "existing" | "recovered"; run: KomoControlSafeMatchRun | null; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlMatchRunErrorCode | "SESSION_INVALID"; state: KomoControlAuthState };
type KomoControlPreGameConfigurationErrorCode = "CONFIGURATION_UNAVAILABLE" | "CONFIGURATION_INVALID" | "CONFIGURATION_CONFLICT" | "CONFIGURATION_OWNERSHIP_CONFLICT";
type KomoControlTeamSide = "HOME" | "AWAY";
interface KomoControlPreGameConfigurationPlayer { playerId: string; displayName: string; packageShirtNumber: number | null; gameShirtNumber: string | null; participating: boolean; }
interface KomoControlPreGameConfigurationStaff { staffId: string; displayName: string; role: string; roleLabel: string | null; participating: boolean; }
type KomoControlExtraBenchRole = "coach" | "assistant_coach" | "team_manager" | "physiotherapist" | "doctor" | "other";
interface KomoControlExtraBenchEntry { entryId: string; name: string; role: KomoControlExtraBenchRole; }
interface KomoControlPreGameConfigurationTeam { side: KomoControlTeamSide; teamId: string; teamName: string; players: KomoControlPreGameConfigurationPlayer[]; staff: KomoControlPreGameConfigurationStaff[]; captainPlayerId: string | null; starterPlayerIds: string[]; gameColor: string | null; extraBench: KomoControlExtraBenchEntry[]; }
interface KomoControlPreGameConfiguration { runId: string; gameId: string; packageId: string; packageVersion: number; configurationSchemaVersion: 1; revision: number; status: "draft" | "ready"; teams: [KomoControlPreGameConfigurationTeam, KomoControlPreGameConfigurationTeam]; presentation: { leftSide: KomoControlTeamSide }; settings: { minPlayers: number; maxPlayers: number; startingPlayers: number }; createdAtUtc: string; updatedAtUtc: string; }
interface KomoControlPreGameConfigurationPlayerDraft { playerId: string; participating: boolean; gameShirtNumber: string | null; }
interface KomoControlPreGameConfigurationStaffDraft { staffId: string; participating: boolean; }
interface KomoControlPreGameConfigurationTeamDraft { side: KomoControlTeamSide; players: KomoControlPreGameConfigurationPlayerDraft[]; staff: KomoControlPreGameConfigurationStaffDraft[]; captainPlayerId: string | null; starterPlayerIds: string[]; gameColor: string | null; extraBench: KomoControlExtraBenchEntry[]; }
interface KomoControlPreGameConfigurationSaveDraftInput { gameId: string; expectedRevision: number; teams: [KomoControlPreGameConfigurationTeamDraft, KomoControlPreGameConfigurationTeamDraft]; presentation: { leftSide: KomoControlTeamSide }; }
type KomoControlPreGameConfigurationResult = { ok: true; outcome: "created" | "existing" | "saved"; configuration: KomoControlPreGameConfiguration; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlPreGameConfigurationErrorCode | "SESSION_INVALID"; state: KomoControlAuthState };

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
    createOrOpenGameRun(gameId: string): Promise<KomoControlMatchRunResult>;
    getActiveGameRun(gameId: string): Promise<KomoControlMatchRunResult>;
    getOrCreatePreGameConfiguration(gameId: string): Promise<KomoControlPreGameConfigurationResult>;
    savePreGameConfigurationDraft(input: KomoControlPreGameConfigurationSaveDraftInput): Promise<KomoControlPreGameConfigurationResult>;
}

interface Window {
    komoControl?: KomoControlDesktopBridge;
}
