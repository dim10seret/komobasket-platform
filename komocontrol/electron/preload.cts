import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { AuthOperationResult, DesktopAuthState, LoginInput } from "./auth/auth-contracts.cjs";
import type { GameDiscoveryOperationResult } from "./games/game-discovery-contracts.cjs";
import type { GamePackageDownloadResult } from "./games/game-package-download.cjs";
import type { LocalGamePackageStatus } from "./persistence/local-database.cjs";
import type { MatchSetupOperationResult } from "./games/match-setup.cjs";
import type { LocalRunCatalogueResult, MatchRunOperationResult, MyGamesRunStateCatalogueResult } from "./runs/match-run.cjs";
import type { PreGameConfigurationOperationResult, PreGameConfigurationSaveDraftInput } from "./runs/pre-game-configuration.cjs";
import type { GameplayHistoryOperationResult, GameplayHistoryQueryInput, GameplayIntent, GameplayScorerEventEditContextOperationResult, GameplayScorerEventEditModeInput, GameplayScorerEventMutationInput, GameplayScorerEventMutationPreviewInput, GameplayScorerEventMutationPreviewOperationResult, GameplayScorerEventGroupOperationResult, MatchGameplayOperationResult, ResumableLiveFlowInput, ResumableLiveFlowOperationResult } from "./runs/gameplay-runtime.cjs";

interface AppInfo {
    version: string;
    environment: "development" | "production";
}

interface LocalStatus {
    ready: true;
    schemaVersion: string;
    deviceIdSuffix: string;
}

const bridge = Object.freeze({
    getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke("app:get-info") as Promise<AppInfo>,
    getLocalStatus: (): Promise<LocalStatus> => ipcRenderer.invoke("app:get-local-status") as Promise<LocalStatus>,
    getAuthState: (): Promise<DesktopAuthState> => ipcRenderer.invoke("auth:get-state") as Promise<DesktopAuthState>,
    login: (input: LoginInput): Promise<AuthOperationResult> => ipcRenderer.invoke("auth:login", input) as Promise<AuthOperationResult>,
    retrySession: (): Promise<AuthOperationResult> => ipcRenderer.invoke("auth:retry-session") as Promise<AuthOperationResult>,
    logout: (): Promise<AuthOperationResult> => ipcRenderer.invoke("auth:logout") as Promise<AuthOperationResult>,
    listAvailableGames: (): Promise<GameDiscoveryOperationResult> => ipcRenderer.invoke("games:list") as Promise<GameDiscoveryOperationResult>,
    getOfflineGameStatus: (gameId: string): Promise<LocalGamePackageStatus> => ipcRenderer.invoke("games:get-offline-status", gameId) as Promise<LocalGamePackageStatus>,
    downloadGamePackage: (gameId: string): Promise<GamePackageDownloadResult> => ipcRenderer.invoke("games:download-package", gameId) as Promise<GamePackageDownloadResult>,
    getMatchSetup: (gameId: string): Promise<MatchSetupOperationResult> => ipcRenderer.invoke("games:get-match-setup", gameId) as Promise<MatchSetupOperationResult>,
    createOrOpenGameRun: (gameId: string): Promise<MatchRunOperationResult> => ipcRenderer.invoke("runs:create-or-open", gameId) as Promise<MatchRunOperationResult>,
    getActiveGameRun: (gameId: string): Promise<MatchRunOperationResult> => ipcRenderer.invoke("runs:get-active", gameId) as Promise<MatchRunOperationResult>,
    listLocalRuns: (): Promise<LocalRunCatalogueResult> => ipcRenderer.invoke("runs:list-local") as Promise<LocalRunCatalogueResult>,
    listMyGamesRunStates: (): Promise<MyGamesRunStateCatalogueResult> => ipcRenderer.invoke("runs:list-my-games-state") as Promise<MyGamesRunStateCatalogueResult>,
    getOrCreatePreGameConfiguration: (gameId: string): Promise<PreGameConfigurationOperationResult> => ipcRenderer.invoke("pregame:get-or-create", gameId) as Promise<PreGameConfigurationOperationResult>,
    savePreGameConfigurationDraft: (input: PreGameConfigurationSaveDraftInput): Promise<PreGameConfigurationOperationResult> => ipcRenderer.invoke("pregame:save-draft", input) as Promise<PreGameConfigurationOperationResult>,
    startMatch: (runId: string): Promise<MatchGameplayOperationResult> => ipcRenderer.invoke("gameplay:start", runId) as Promise<MatchGameplayOperationResult>,
    recoverMatchGameplay: (runId: string): Promise<MatchGameplayOperationResult> => ipcRenderer.invoke("gameplay:recover", runId) as Promise<MatchGameplayOperationResult>,
    appendGameplayIntent: (runId: string, intent: GameplayIntent): Promise<MatchGameplayOperationResult> => ipcRenderer.invoke("gameplay:append-intent", { runId, intent }) as Promise<MatchGameplayOperationResult>,
    appendAndResolveResumableGameplayFlow: (runId: string, intent: GameplayIntent): Promise<MatchGameplayOperationResult> => ipcRenderer.invoke("gameplay:append-and-resolve-flow", { runId, intent }) as Promise<MatchGameplayOperationResult>,
    saveResumableLiveFlow: (runId: string, flow: ResumableLiveFlowInput): Promise<ResumableLiveFlowOperationResult> => ipcRenderer.invoke("gameplay:save-resumable-flow", { runId, flow }) as Promise<ResumableLiveFlowOperationResult>,
    getResumableLiveFlow: (runId: string): Promise<ResumableLiveFlowOperationResult> => ipcRenderer.invoke("gameplay:get-resumable-flow", runId) as Promise<ResumableLiveFlowOperationResult>,
    appendGameplayIntents: (runId: string, intents: GameplayIntent[]): Promise<MatchGameplayOperationResult> => ipcRenderer.invoke("gameplay:append-intents", { runId, intents }) as Promise<MatchGameplayOperationResult>,
    getGameplayHistory: (runId: string, query: GameplayHistoryQueryInput = {}): Promise<GameplayHistoryOperationResult> => ipcRenderer.invoke("gameplay:get-history", { runId, query }) as Promise<GameplayHistoryOperationResult>,
    getScorerEventGroup: (runId: string, scorerEventGroupId: string): Promise<GameplayScorerEventGroupOperationResult> => ipcRenderer.invoke("gameplay:get-scorer-event-group", { runId, scorerEventGroupId }) as Promise<GameplayScorerEventGroupOperationResult>,
    getScorerEventEditContext: (runId: string, scorerEventGroupId: string, mode?: GameplayScorerEventEditModeInput): Promise<GameplayScorerEventEditContextOperationResult> => ipcRenderer.invoke("gameplay:get-scorer-event-edit-context", { runId, scorerEventGroupId, mode }) as Promise<GameplayScorerEventEditContextOperationResult>,
    previewScorerEventMutation: (runId: string, preview: GameplayScorerEventMutationPreviewInput): Promise<GameplayScorerEventMutationPreviewOperationResult> => ipcRenderer.invoke("gameplay:preview-scorer-event-mutation", { runId, preview }) as Promise<GameplayScorerEventMutationPreviewOperationResult>,
    mutateScorerEventGroup: (runId: string, mutation: GameplayScorerEventMutationInput): Promise<MatchGameplayOperationResult> => ipcRenderer.invoke("gameplay:mutate-scorer-event-group", { runId, mutation }) as Promise<MatchGameplayOperationResult>,
    removeGameplayEvent: (runId: string, eventId: string, cascadeDependencies = false): Promise<MatchGameplayOperationResult> => ipcRenderer.invoke("gameplay:remove-event", { runId, eventId, cascadeDependencies }) as Promise<MatchGameplayOperationResult>,
    correctGameplayEvent: (runId: string, eventId: string, intent: GameplayIntent, cascadeDependencies = false): Promise<MatchGameplayOperationResult> => ipcRenderer.invoke("gameplay:correct-event", { runId, eventId, intent, cascadeDependencies }) as Promise<MatchGameplayOperationResult>,
    finalizeMatch: (runId: string): Promise<MatchGameplayOperationResult> => ipcRenderer.invoke("gameplay:finalize", runId) as Promise<MatchGameplayOperationResult>,
    retryGameplaySync: (runId: string): Promise<MatchGameplayOperationResult> => ipcRenderer.invoke("gameplay:retry-sync", runId) as Promise<MatchGameplayOperationResult>,
    reconnectGameplaySync: (runId: string, credentials: LoginInput): Promise<MatchGameplayOperationResult> => ipcRenderer.invoke("gameplay:reconnect-sync", { runId, credentials }) as Promise<MatchGameplayOperationResult>,
    onGameplaySyncStateChanged: (callback: (runId: string) => void): (() => void) => {
        const listener = (_event: IpcRendererEvent, runId: string) => callback(runId);
        ipcRenderer.on("gameplay:sync-state-changed", listener);
        return () => ipcRenderer.removeListener("gameplay:sync-state-changed", listener);
    },
});

contextBridge.exposeInMainWorld("komoControl", bridge);
