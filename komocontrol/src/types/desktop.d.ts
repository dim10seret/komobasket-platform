interface KomoControlAppInfo {
    version: string;
    environment: "development" | "production";
}

type KomoControlAuthErrorCode = "AUTH_INVALID" | "SCORER_DISABLED" | "SESSION_INVALID" | "NETWORK_UNAVAILABLE" | "MALFORMED_RESPONSE" | "SECURE_STORAGE_UNAVAILABLE" | "LOCAL_SESSION_ERROR" | "CONFIGURATION_ERROR" | "OFFLINE_OPERATION_DENIED";
interface KomoControlSafeScorerContext { scorerId: string; username: string; organizationId: string; organizationName: string; expiresAt: string; }
type KomoControlAuthState =
    | { kind: "unauthenticated"; deviceIdSuffix: string }
    | { kind: "authenticated"; connection: "online" | "offline"; deviceIdSuffix: string; context: KomoControlSafeScorerContext }
    | { kind: "live-continuity"; deviceIdSuffix: string; context: { scorerId: string; organizationId: string; runIds: string[] } }
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
interface KomoControlSafeMatchRun { runId: string; gameId: string; packageId: string; packageVersion: number; status: "active" | "finalized"; gameplayStarted: boolean; lastAcceptedSequence: number; createdAtUtc: string; }
interface KomoControlSafeLocalRunSummary { runId: string; gameId: string; packageId: string; packageVersion: number; gameplayStarted: boolean; lastAcceptedSequence: number; createdAtUtc: string; homeTeam: { id: string; name: string }; awayTeam: { id: string; name: string }; competitionName: string; seasonName: string; phaseName: string | null; roundLabel: string | null; scheduledDate: string | null; scheduledTime: string | null; venue: string | null; }
type KomoControlMatchRunResult = { ok: true; outcome: "created" | "existing" | "recovered"; run: KomoControlSafeMatchRun | null; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlMatchRunErrorCode | "SESSION_INVALID" | "OFFLINE_OPERATION_DENIED"; state: KomoControlAuthState };
type KomoControlLocalRunCatalogueResult = { ok: true; runs: KomoControlSafeLocalRunSummary[]; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlMatchRunErrorCode | "SESSION_INVALID"; state: KomoControlAuthState };
type KomoControlPreGameConfigurationErrorCode = "CONFIGURATION_UNAVAILABLE" | "CONFIGURATION_INVALID" | "CONFIGURATION_CONFLICT" | "CONFIGURATION_OWNERSHIP_CONFLICT";
type KomoControlTeamSide = "HOME" | "AWAY";
interface KomoControlPreGameConfigurationPlayer { playerId: string; displayName: string; packageShirtNumber: number | null; gameShirtNumber: string | null; participating: boolean; }
interface KomoControlPreGameConfigurationStaff { staffId: string; displayName: string; role: string; roleLabel: string | null; participating: boolean; }
type KomoControlExtraBenchRole = "coach" | "assistant_coach" | "team_manager" | "physiotherapist" | "doctor" | "other";
interface KomoControlExtraBenchEntry { entryId: string; name: string; role: KomoControlExtraBenchRole; }
interface KomoControlPreGameConfigurationTeam { side: KomoControlTeamSide; teamId: string; teamName: string; players: KomoControlPreGameConfigurationPlayer[]; staff: KomoControlPreGameConfigurationStaff[]; captainPlayerId: string | null; starterPlayerIds: string[]; gameColor: string | null; extraBench: KomoControlExtraBenchEntry[]; }
interface KomoControlPreGameConfiguration { runId: string; gameId: string; packageId: string; packageVersion: number; configurationSchemaVersion: 1; revision: number; status: "draft" | "ready"; lifecycle: "pre-start" | "live"; teams: [KomoControlPreGameConfigurationTeam, KomoControlPreGameConfigurationTeam]; presentation: { leftSide: KomoControlTeamSide }; settings: { minPlayers: number; maxPlayers: number; startingPlayers: number }; createdAtUtc: string; updatedAtUtc: string; }
interface KomoControlPreGameConfigurationPlayerDraft { playerId: string; participating: boolean; gameShirtNumber: string | null; }
interface KomoControlPreGameConfigurationStaffDraft { staffId: string; participating: boolean; }
interface KomoControlPreGameConfigurationTeamDraft { side: KomoControlTeamSide; players: KomoControlPreGameConfigurationPlayerDraft[]; staff: KomoControlPreGameConfigurationStaffDraft[]; captainPlayerId: string | null; starterPlayerIds: string[]; gameColor: string | null; extraBench: KomoControlExtraBenchEntry[]; }
interface KomoControlPreGameConfigurationSaveDraftInput { gameId: string; expectedRevision: number; teams: [KomoControlPreGameConfigurationTeamDraft, KomoControlPreGameConfigurationTeamDraft]; presentation: { leftSide: KomoControlTeamSide }; }
type KomoControlLiveConfigurationValidationCode = "LIVE_PARTICIPANT_REMOVAL_NOT_ALLOWED" | "LIVE_SHIRT_NUMBER_REQUIRED" | "LIVE_SHIRT_NUMBER_INVALID" | "LIVE_SHIRT_NUMBER_DUPLICATE" | "LIVE_PARTICIPANT_COUNT_ABOVE_MAXIMUM" | "LIVE_TEAM_COLOR_REQUIRED" | "LIVE_TEAM_COLOR_INVALID" | "LIVE_LOCKED_FIELD_CHANGE";
interface KomoControlLiveConfigurationValidationIssue { code: KomoControlLiveConfigurationValidationCode; message: string; teamSide: KomoControlTeamSide; affectedPlayers: { playerId: string; displayName: string }[]; }
type KomoControlPreGameConfigurationResult = { ok: true; outcome: "created" | "existing" | "saved"; configuration: KomoControlPreGameConfiguration; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlPreGameConfigurationErrorCode | "SESSION_INVALID" | "OFFLINE_OPERATION_DENIED"; validation?: KomoControlLiveConfigurationValidationIssue; state: KomoControlAuthState };
type KomoControlGameplayIntent = { kind: string; [key: string]: unknown };
interface KomoControlSafeGameplayPlayer { playerId: string; displayName: string; shirtNumber: string; participating: true; onCourt: boolean; fouls: { total: number; status: string; statusReason: string | null }; statistics: Record<string, number>; }
interface KomoControlSafeGameplayTeam { side: KomoControlTeamSide; presentationSide: "LEFT" | "RIGHT"; teamId: string; teamName: string; gameColor: string | null; score: number; timeouts: number; teamFouls: number; inBonus: boolean; captainPlayerId: string | null; starterPlayerIds: string[]; players: KomoControlSafeGameplayPlayer[]; statistics: Record<string, number>; }
interface KomoControlSafeGameplayPenalty { stoppageId: string; entitlements: Array<{ kind: "FREE_THROWS" | "RESTART_ONLY"; beneficiaryTeam: KomoControlTeamSide; attempts: number | null; completedAttempts: number | null; restartKind: string }>; cancelledCount: number; administrationStarted: boolean; finalRestart: { kind: string; team: KomoControlTeamSide | null }; }
interface KomoControlSafeMatchGameplay { runId: string; lifecycle: "live" | "finalized"; eventHistoryRevision: number; lastAcceptedSequence: number; score: { home: number; away: number }; period: { kind: "REGULATION" | "OVERTIME"; index: number }; clockSeconds: number; clockRunning: boolean; possession: KomoControlTeamSide | null; alternatingPossession: KomoControlTeamSide; finished: boolean; eventIds: string[]; events: Array<{ eventId: string; sequence: number; occurredAt: number; type: string; team?: KomoControlTeamSide; playerId?: string }>; teams: [KomoControlSafeGameplayTeam, KomoControlSafeGameplayTeam]; penalty: KomoControlSafeGameplayPenalty | null; sync: { status: "synced" | "pending" | "retry-needed" | "conflict"; acknowledgedRevision: number; lastAttemptAtUtc: string | null; lastSuccessAtUtc: string | null; lastErrorCode: string | null; }; }
type KomoControlStartReadinessCode = "START_PARTICIPANT_COUNT_BELOW_MINIMUM" | "START_PARTICIPANT_COUNT_ABOVE_MAXIMUM" | "START_SHIRT_NUMBER_MISSING" | "START_SHIRT_NUMBER_INVALID" | "START_SHIRT_NUMBER_DUPLICATE" | "START_CAPTAIN_MISSING" | "START_CAPTAIN_NOT_PARTICIPATING" | "START_STARTER_COUNT_INVALID" | "START_STARTER_NOT_PARTICIPATING" | "START_TEAM_COLOR_MISSING" | "START_TEAM_COLOR_INVALID";
interface KomoControlStartReadinessIssue { code: KomoControlStartReadinessCode; message: string; teamSide: KomoControlTeamSide; affectedPlayers: { playerId: string; displayName: string }[]; }
type KomoControlMatchGameplayResult = { ok: true; gameplay: KomoControlSafeMatchGameplay; state: KomoControlAuthState } | { ok: false; errorCode: string; dependentEventIds?: string[]; startReadiness?: KomoControlStartReadinessIssue; state: KomoControlAuthState };

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
    listLocalRuns(): Promise<KomoControlLocalRunCatalogueResult>;
    getOrCreatePreGameConfiguration(gameId: string): Promise<KomoControlPreGameConfigurationResult>;
    savePreGameConfigurationDraft(input: KomoControlPreGameConfigurationSaveDraftInput): Promise<KomoControlPreGameConfigurationResult>;
    startMatch(runId: string): Promise<KomoControlMatchGameplayResult>;
    recoverMatchGameplay(runId: string): Promise<KomoControlMatchGameplayResult>;
    appendGameplayIntent(runId: string, intent: KomoControlGameplayIntent): Promise<KomoControlMatchGameplayResult>;
    removeGameplayEvent(runId: string, eventId: string, cascadeDependencies?: boolean): Promise<KomoControlMatchGameplayResult>;
    correctGameplayEvent(runId: string, eventId: string, intent: KomoControlGameplayIntent, cascadeDependencies?: boolean): Promise<KomoControlMatchGameplayResult>;
    finalizeMatch(runId: string): Promise<KomoControlMatchGameplayResult>;
    retryGameplaySync(runId: string): Promise<KomoControlMatchGameplayResult>;
}

interface Window {
    komoControl?: KomoControlDesktopBridge;
}
