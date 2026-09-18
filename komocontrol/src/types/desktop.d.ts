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
interface KomoControlOfficials { referees: { a: string | null; b: string | null; c: string | null }; table: { timer: string | null; shotClock: string | null; scoresheet: string | null; commissioner: string | null }; }
interface KomoControlMatchSetupOfficials { referees: { a: { id: string; displayName: string } | null; b: { id: string; displayName: string } | null; c: { id: string; displayName: string } | null }; table: { timer: { id: string; displayName: string } | null; shotClock: { id: string; displayName: string } | null; scoresheet: { id: string; displayName: string } | null; commissioner: { id: string; displayName: string } | null }; }
interface KomoControlMatchSetup { gameId: string; packageId: string; packageVersion: number; competitionName: string; seasonName: string; phaseName: string | null; roundLabel: string | null; scheduledDate: string | null; scheduledTime: string | null; venue: string | null; settings: { gameMode: "SIMPLE" | "FULL"; minPlayers: number; maxPlayers: number; startingPlayers: number; regulationPeriods: number; regulationPeriodSeconds: number; overtimeSeconds: number; tieAllowed: boolean; winnerRequired: boolean; }; officials: KomoControlMatchSetupOfficials; home: KomoControlMatchSetupTeam; away: KomoControlMatchSetupTeam; }
type KomoControlMatchSetupResult = { ok: true; setup: KomoControlMatchSetup; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlGamePackageErrorCode; state: KomoControlAuthState };
type KomoControlMatchRunErrorCode = "RUN_UNAVAILABLE" | "RUN_INVALID" | "RUN_CONFLICT" | "RUN_OWNERSHIP_CONFLICT";
interface KomoControlSafeMatchRun { runId: string; gameId: string; packageId: string; packageVersion: number; status: "active" | "finalized"; gameplayStarted: boolean; lastAcceptedSequence: number; createdAtUtc: string; }
interface KomoControlSafeLocalRunSummary { runId: string; gameId: string; packageId: string; packageVersion: number; gameplayStarted: boolean; lastAcceptedSequence: number; createdAtUtc: string; homeTeam: { id: string; name: string }; awayTeam: { id: string; name: string }; competitionName: string; seasonName: string; phaseName: string | null; roundLabel: string | null; scheduledDate: string | null; scheduledTime: string | null; venue: string | null; }
type KomoControlMatchRunResult = { ok: true; outcome: "created" | "existing" | "recovered"; run: KomoControlSafeMatchRun | null; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlMatchRunErrorCode | "SESSION_INVALID" | "OFFLINE_OPERATION_DENIED"; state: KomoControlAuthState };
type KomoControlLocalRunCatalogueResult = { ok: true; runs: KomoControlSafeLocalRunSummary[]; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlMatchRunErrorCode | "SESSION_INVALID"; state: KomoControlAuthState };
type KomoControlMyGamesRunSyncStatus = "active" | "pending" | "retry-needed" | "conflict" | "completed";
interface KomoControlMyGamesRunState { gameId: string; runId: string; lifecycle: "active" | "finalized"; historyRevision: number; acknowledgedHistoryRevision: number; finalizationHash: string | null; acknowledgedFinalizationHash: string | null; syncStatus: KomoControlMyGamesRunSyncStatus; homeScore: number | null; awayScore: number | null; }
interface KomoControlMatchFinalizationInput { incidentReport: string | null; }
type KomoControlMyGamesRunStateCatalogueResult = { ok: true; runs: KomoControlMyGamesRunState[]; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlMatchRunErrorCode | "SESSION_INVALID"; state: KomoControlAuthState };
type KomoControlPreGameConfigurationErrorCode = "CONFIGURATION_UNAVAILABLE" | "CONFIGURATION_INVALID" | "CONFIGURATION_CONFLICT" | "CONFIGURATION_OWNERSHIP_CONFLICT";
type KomoControlTeamSide = "HOME" | "AWAY";
interface KomoControlPreGameConfigurationPlayer { playerId: string; displayName: string; packageShirtNumber: number | null; gameShirtNumber: string | null; participating: boolean; }
interface KomoControlPreGameConfigurationStaff { staffId: string; displayName: string; role: string; roleLabel: string | null; participating: boolean; }
type KomoControlExtraBenchRole = "coach" | "assistant_coach" | "team_manager" | "physiotherapist" | "doctor" | "other";
interface KomoControlExtraBenchEntry { entryId: string; name: string; role: KomoControlExtraBenchRole; }
interface KomoControlPreGameConfigurationTeam { side: KomoControlTeamSide; teamId: string; teamName: string; players: KomoControlPreGameConfigurationPlayer[]; staff: KomoControlPreGameConfigurationStaff[]; captainPlayerId: string | null; starterPlayerIds: string[]; gameColor: string | null; extraBench: KomoControlExtraBenchEntry[]; }
interface KomoControlPreGameConfiguration { runId: string; gameId: string; packageId: string; packageVersion: number; configurationSchemaVersion: 1; revision: number; status: "draft" | "ready"; lifecycle: "pre-start" | "live"; teams: [KomoControlPreGameConfigurationTeam, KomoControlPreGameConfigurationTeam]; presentation: { leftSide: KomoControlTeamSide }; officials: KomoControlOfficials; settings: { minPlayers: number; maxPlayers: number; startingPlayers: number }; createdAtUtc: string; updatedAtUtc: string; }
interface KomoControlPreGameConfigurationPlayerDraft { playerId: string; participating: boolean; gameShirtNumber: string | null; }
interface KomoControlPreGameConfigurationStaffDraft { staffId: string; participating: boolean; }
interface KomoControlPreGameConfigurationTeamDraft { side: KomoControlTeamSide; players: KomoControlPreGameConfigurationPlayerDraft[]; staff: KomoControlPreGameConfigurationStaffDraft[]; captainPlayerId: string | null; starterPlayerIds: string[]; gameColor: string | null; extraBench: KomoControlExtraBenchEntry[]; }
interface KomoControlPreGameConfigurationSaveDraftInput { gameId: string; expectedRevision: number; teams: [KomoControlPreGameConfigurationTeamDraft, KomoControlPreGameConfigurationTeamDraft]; presentation: { leftSide: KomoControlTeamSide }; officials?: KomoControlOfficials; }
type KomoControlLiveConfigurationValidationCode = "LIVE_PARTICIPANT_REMOVAL_NOT_ALLOWED" | "LIVE_SHIRT_NUMBER_REQUIRED" | "LIVE_SHIRT_NUMBER_INVALID" | "LIVE_SHIRT_NUMBER_DUPLICATE" | "LIVE_PARTICIPANT_COUNT_ABOVE_MAXIMUM" | "LIVE_TEAM_COLOR_REQUIRED" | "LIVE_TEAM_COLOR_INVALID" | "LIVE_LOCKED_FIELD_CHANGE";
interface KomoControlLiveConfigurationValidationIssue { code: KomoControlLiveConfigurationValidationCode; message: string; teamSide: KomoControlTeamSide; affectedPlayers: { playerId: string; displayName: string }[]; }
type KomoControlPreGameConfigurationResult = { ok: true; outcome: "created" | "existing" | "saved"; configuration: KomoControlPreGameConfiguration; state: KomoControlAuthState } | { ok: false; errorCode: KomoControlPreGameConfigurationErrorCode | "SESSION_INVALID" | "OFFLINE_OPERATION_DENIED"; validation?: KomoControlLiveConfigurationValidationIssue; state: KomoControlAuthState };
interface KomoControlScorerEventTerminal { reason: "NATURAL" | "ENTER_EARLY"; unresolvedStep?: "ASSIST" | "STEALER" | "FT1" | "FT2" | "FT3" | "REBOUNDER" | "CHOOSE_SHOOTER" | "FOULER" | "DRAWN_BY"; decisions?: { assist?: "NONE"; steal?: "NONE" }; resumeContext?: { penaltyShooterPlayerId?: string }; }
interface KomoControlScorerEventContext { technicalStaffSource?: "COACH" | "BENCH"; }
type KomoControlGameplayIntent = { kind: string; scorerEventId?: string; scorerEventTerminal?: KomoControlScorerEventTerminal; scorerEventContext?: KomoControlScorerEventContext; [key: string]: unknown };
type KomoControlScorerEventMutationInput =
    | { kind: "REPLACE_GROUP"; scorerEventGroupId: string; expectedHistoryRevision: number; mode?: KomoControlScorerEventEditMode; events: Array<{ eventId?: string; intent: KomoControlGameplayIntent }> }
    | { kind: "DELETE_GROUP"; scorerEventGroupId: string; expectedHistoryRevision: number };
type KomoControlScorerEventEditMode = { mode: "HISTORY" } | { mode: "CURRENT_OPEN"; scorerEventId: string };
interface KomoControlSafeGameplayPlayer { playerId: string; displayName: string; shirtNumber: string; participating: true; onCourt: boolean; fouls: { total: number; category1TechnicalCount: number; category2TechnicalCount: number; disruptiveCount: number; flagrantCount: number; directDisqualification: boolean; status: string; statusReason: string | null }; statistics: Record<string, number>; }
interface KomoControlSafeGameplayBenchPerson { personId: string; displayName: string; role: "HEAD_COACH" | "FIRST_ASSISTANT_COACH" | "SUBSTITUTE" | "EXCLUDED_PLAYER" | "ACCOMPANYING_DELEGATION"; roleLabel: string; source: "PACKAGE" | "RUN" | "TEAM"; }
interface KomoControlSafeGameplayTeam { side: KomoControlTeamSide; presentationSide: "LEFT" | "RIGHT"; teamId: string; teamName: string; gameColor: string | null; score: number; timeouts: number; timeoutAllowance: number; teamFouls: number; inBonus: boolean; nextDefensivePersonalFoulCreatesPenalty: boolean; discipline: { headCoachCategory1TechnicalCount: number; benchCategory1TechnicalCount: number; headCoachDisqualified: boolean; disqualifiedBenchCount: number }; captainPlayerId: string | null; starterPlayerIds: string[]; players: KomoControlSafeGameplayPlayer[]; bench: KomoControlSafeGameplayBenchPerson[]; statistics: Record<string, number>; }
interface KomoControlSafeGameplayPenalty { stoppageId: string; activePenaltyIds: string[]; entitlements: Array<{ penaltyId: string; sourceFoulEventId: string; kind: "FREE_THROWS" | "RESTART_ONLY"; beneficiaryTeam: KomoControlTeamSide; shootingTeam: KomoControlTeamSide | null; attempts: number | null; completedAttempts: number | null; shooterPolicy: "FOULED_PLAYER" | "ANY_OPPONENT" | null; designatedPlayerId: string | null; restartKind: string; cancelled: boolean }>; cancelledCount: number; administrationStarted: boolean; finalRestart: { kind: string; team: KomoControlTeamSide | null }; }
interface KomoControlGameplayEventSummary { eventId: string; sequence: number; occurredAt: number; type: string; period?: { kind: "REGULATION" | "OVERTIME"; index: number }; team?: KomoControlTeamSide; playerId?: string; made?: boolean; scorerEventId?: string; scorerEventTerminal?: KomoControlScorerEventTerminal; scorerEventContext?: KomoControlScorerEventContext; }
interface KomoControlGameplayPeriodScore { period: { kind: "REGULATION" | "OVERTIME"; index: number }; home: number; away: number; }
interface KomoControlSafeMatchGameplay { runId: string; gameMode: "SIMPLE" | "FULL"; lifecycle: "live" | "finalized"; eventHistoryRevision: number; lastAcceptedSequence: number; score: { home: number; away: number }; period: { kind: "REGULATION" | "OVERTIME"; index: number }; periodScores: KomoControlGameplayPeriodScore[]; clockSeconds: number; clockRunning: boolean; clockStartedAtMs: number | null; possession: KomoControlTeamSide | null; alternatingPossession: KomoControlTeamSide; finished: boolean; latestEvent: KomoControlGameplayEventSummary | null; rules: { startingPlayers: number; regulationPeriods: number; regulationPeriodSeconds: number; overtimeSeconds: number; resultPolicy: "ALLOW_TIE" | "REQUIRE_WINNER" }; teams: [KomoControlSafeGameplayTeam, KomoControlSafeGameplayTeam]; penalty: KomoControlSafeGameplayPenalty | null; sync: { status: "synced" | "pending" | "retry-needed" | "conflict"; acknowledgedRevision: number; lastAttemptAtUtc: string | null; lastSuccessAtUtc: string | null; lastErrorCode: string | null; }; }
type KomoControlScorerEventGroupingSource = "EXPLICIT" | "LEGACY_UNAMBIGUOUS" | "LEGACY_ATOMIC";
interface KomoControlGameplayHistoryItem extends KomoControlGameplayEventSummary { scorerEventGroupId: string; scorerEventGroupOrdinal: number; scorerEventGroupingSource: KomoControlScorerEventGroupingSource; scorerEventGroupSafeForReconstruction: boolean; isGoalFoul?: boolean; period: { kind: "REGULATION" | "OVERTIME"; index: number }; clockSeconds: number; intent: KomoControlGameplayIntent | null; }
interface KomoControlGameplayHistoryPage { runId: string; items: KomoControlGameplayHistoryItem[]; nextBeforeSequence: number | null; total: number; }
type KomoControlGameplayHistoryResult = { ok: true; history: KomoControlGameplayHistoryPage; state: KomoControlAuthState } | { ok: false; errorCode: string; state: KomoControlAuthState };
interface KomoControlScorerEventGroup { scorerEventGroupId: string; groupingSource: KomoControlScorerEventGroupingSource; groupOrdinal: number; canonicalEventIds: string[]; visibleEventIds: string[]; firstSequence: number; lastSequence: number; period: { kind: "REGULATION" | "OVERTIME"; index: number }; clockSeconds: number; scorerEventTerminal?: KomoControlScorerEventTerminal; terminalConflict: boolean; safeForReconstruction: boolean; items: KomoControlGameplayHistoryItem[]; }
type KomoControlScorerEventGroupResult = { ok: true; group: KomoControlScorerEventGroup | null; state: KomoControlAuthState } | { ok: false; errorCode: string; state: KomoControlAuthState };
type KomoControlHistoricalEditTargetKind = "SHOOTER" | "TECHNICAL_PLAYER" | "FOULER" | "DRAWN_BY" | "ASSIST" | "BLOCKER" | "FREE_THROW_SHOOTER" | "TURNOVER_BY" | "STEALER" | "REBOUNDER" | "SHOT_RESULT" | "FREE_THROW_RESULT";
interface KomoControlHistoricalPlayerContext { playerId: string; side: KomoControlTeamSide; displayName: string; shirtNumber: string; participating: true; onCourt: boolean; eligible: boolean; foulStatus: string; foulStatusReason: string | null; totalFouls: number; directDisqualification: boolean; }
interface KomoControlHistoricalEditTarget { targetId: string; kind: KomoControlHistoricalEditTargetKind; eventId: string; currentPlayerId: string | null; canonicalSide: KomoControlTeamSide | null; candidatePlayerIds: string[]; sameTeamOnly: boolean; forwardPropagation: boolean; currentValue?: "MADE" | "MISS"; allowedValues?: ["MADE", "MISS"]; editable: boolean; readOnlyReason: "UNSAFE_GROUP" | "FINALIZED_RUN" | "UNSUPPORTED_TARGET" | "NO_HISTORICAL_CANDIDATES" | null; }
interface KomoControlHistoricalPenaltyContext { penaltyId: string; sourceFoulEventId: string; beneficiarySide: KomoControlTeamSide; shooterPolicy: "FOULED_PLAYER" | "ANY_OPPONENT"; designatedPlayerId: string | null; totalAttempts: number; completedAttempts: number; remainingAttempts: number; nextAttemptNumber: number | null; restartKind: string; liveBallReboundAfterFinalMiss: boolean; }
type KomoControlHistoricalContinuationPlan = { kind: "ASSIST"; shotEventId: string; side: KomoControlTeamSide; candidatePlayerIds: string[]; noAssistAllowed: true } | { kind: "STEALER"; turnoverEventId: string; side: KomoControlTeamSide; candidatePlayerIds: string[]; noStealAllowed: true } | { kind: "CHOOSE_SHOOTER"; penalty: KomoControlHistoricalPenaltyContext; candidatePlayerIds: string[] } | { kind: "FREE_THROW_RESULT"; penalty: KomoControlHistoricalPenaltyContext; shooterPlayerId: string; candidatePlayerIds: string[]; attemptNumber: number; allowedResults: ["MADE", "MISS"]; postResultContinuation: "NEXT_FREE_THROW" | "REBOUNDER_IF_FINAL_MISS" | "END" } | { kind: "REBOUNDER"; sourceEventId: string; candidatePlayerIds: string[]; teamReboundAllowed: true; penaltyId: string | null };
interface KomoControlScorerEventEditContext { group: KomoControlScorerEventGroup; lifecycle: "live" | "finalized"; expectedHistoryRevision: number; historicalState: { anchor: "BEFORE_GROUP"; teams: Array<{ side: KomoControlTeamSide; players: KomoControlHistoricalPlayerContext[] }> }; editCapabilities: { safeForEdit: boolean; canResume: boolean; canDeleteGroup: boolean; targets: KomoControlHistoricalEditTarget[] }; continuationPlan: KomoControlHistoricalContinuationPlan | null; timeContext: { period: { kind: "REGULATION" | "OVERTIME"; index: number }; clockSeconds: number; stoppageId: string | null }; }
type KomoControlScorerEventEditContextResult = { ok: true; context: KomoControlScorerEventEditContext | null; state: KomoControlAuthState } | { ok: false; errorCode: string; state: KomoControlAuthState };
type KomoControlScorerEventDraftAction = { kind: "CORRECT_PLAYER"; targetId: string; playerId: string } | { kind: "CORRECT_SHOT_RESULT" | "CORRECT_FREE_THROW_RESULT"; targetId: string; made: boolean } | { kind: "ASSIST"; playerId: string | null } | { kind: "STEALER"; playerId: string | null } | { kind: "CHOOSE_SHOOTER"; playerId: string } | { kind: "FREE_THROW_RESULT"; made: boolean } | { kind: "REBOUNDER"; team: KomoControlTeamSide; playerId?: string; teamRebound: boolean };
interface KomoControlScorerEventMutationPreviewInput { scorerEventGroupId: string; expectedHistoryRevision: number; mode?: KomoControlScorerEventEditMode; events: Array<{ draftId: string; eventId?: string; intent: KomoControlGameplayIntent }>; action?: KomoControlScorerEventDraftAction; }
interface KomoControlScorerEventMutationPreview { scorerEventGroupId: string; expectedHistoryRevision: number; normalizedGroup: KomoControlScorerEventGroup; editContext: KomoControlScorerEventEditContext; draftEvents: Array<{ draftId: string; eventId?: string; intent: KomoControlGameplayIntent | null }> }
type KomoControlScorerEventMutationPreviewResult = { ok: true; preview: KomoControlScorerEventMutationPreview; state: KomoControlAuthState } | { ok: false; errorCode: string; dependentEventIds?: string[]; state: KomoControlAuthState };
type KomoControlStartReadinessCode = "START_PARTICIPANT_COUNT_BELOW_MINIMUM" | "START_PARTICIPANT_COUNT_ABOVE_MAXIMUM" | "START_SHIRT_NUMBER_MISSING" | "START_SHIRT_NUMBER_INVALID" | "START_SHIRT_NUMBER_DUPLICATE" | "START_CAPTAIN_MISSING" | "START_CAPTAIN_NOT_PARTICIPATING" | "START_STARTER_COUNT_INVALID" | "START_STARTER_NOT_PARTICIPATING" | "START_TEAM_COLOR_MISSING" | "START_TEAM_COLOR_INVALID";
interface KomoControlStartReadinessIssue { code: KomoControlStartReadinessCode; message: string; teamSide: KomoControlTeamSide; affectedPlayers: { playerId: string; displayName: string }[]; }
type KomoControlMatchGameplayResult = { ok: true; gameplay: KomoControlSafeMatchGameplay; state: KomoControlAuthState } | { ok: false; errorCode: string; dependentEventIds?: string[]; startReadiness?: KomoControlStartReadinessIssue; state: KomoControlAuthState };
interface KomoControlResumableLiveFlow { flowSchemaVersion: 1; flowKind: "SHOOTING_FOUL"; stage: "PENALTY"; rootEventId: string; sourceFoulEventId: string; selectedFreeThrowShooterId: string; expectedHistoryRevision: number; createdAtUtc: string; updatedAtUtc: string; }
type KomoControlResumableLiveFlowResult = { ok: true; flow: KomoControlResumableLiveFlow | null; state: KomoControlAuthState } | { ok: false; errorCode: string; state: KomoControlAuthState };

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
    listMyGamesRunStates(): Promise<KomoControlMyGamesRunStateCatalogueResult>;
    getOrCreatePreGameConfiguration(gameId: string): Promise<KomoControlPreGameConfigurationResult>;
    savePreGameConfigurationDraft(input: KomoControlPreGameConfigurationSaveDraftInput): Promise<KomoControlPreGameConfigurationResult>;
    startMatch(runId: string): Promise<KomoControlMatchGameplayResult>;
    recoverMatchGameplay(runId: string): Promise<KomoControlMatchGameplayResult>;
    appendGameplayIntent(runId: string, intent: KomoControlGameplayIntent): Promise<KomoControlMatchGameplayResult>;
    appendAndResolveResumableGameplayFlow(runId: string, intent: KomoControlGameplayIntent): Promise<KomoControlMatchGameplayResult>;
    saveResumableLiveFlow(runId: string, flow: Omit<KomoControlResumableLiveFlow, "flowSchemaVersion" | "createdAtUtc" | "updatedAtUtc">): Promise<KomoControlResumableLiveFlowResult>;
    getResumableLiveFlow(runId: string): Promise<KomoControlResumableLiveFlowResult>;
    appendGameplayIntents(runId: string, intents: KomoControlGameplayIntent[]): Promise<KomoControlMatchGameplayResult>;
    getGameplayHistory(runId: string, query?: { limit?: number; beforeSequence?: number | null; period?: { kind: "REGULATION" | "OVERTIME"; index: number } | null }): Promise<KomoControlGameplayHistoryResult>;
    getScorerEventGroup(runId: string, scorerEventGroupId: string): Promise<KomoControlScorerEventGroupResult>;
    getScorerEventEditContext(runId: string, scorerEventGroupId: string, mode?: KomoControlScorerEventEditMode): Promise<KomoControlScorerEventEditContextResult>;
    previewScorerEventMutation(runId: string, preview: KomoControlScorerEventMutationPreviewInput): Promise<KomoControlScorerEventMutationPreviewResult>;
    mutateScorerEventGroup(runId: string, mutation: KomoControlScorerEventMutationInput): Promise<KomoControlMatchGameplayResult>;
    removeGameplayEvent(runId: string, eventId: string, cascadeDependencies?: boolean): Promise<KomoControlMatchGameplayResult>;
    correctGameplayEvent(runId: string, eventId: string, intent: KomoControlGameplayIntent, cascadeDependencies?: boolean): Promise<KomoControlMatchGameplayResult>;
    finalizeMatch(runId: string, input: KomoControlMatchFinalizationInput): Promise<KomoControlMatchGameplayResult>;
    retryGameplaySync(runId: string): Promise<KomoControlMatchGameplayResult>;
    reconnectGameplaySync(runId: string, credentials: { username: string; password: string }): Promise<KomoControlMatchGameplayResult>;
    onGameplaySyncStateChanged(callback: (runId: string) => void): () => void;
}

interface Window {
    komoControl?: KomoControlDesktopBridge;
}
