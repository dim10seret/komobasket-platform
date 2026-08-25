import { contextBridge, ipcRenderer } from "electron";
import type { AuthOperationResult, DesktopAuthState, LoginInput } from "./auth/auth-contracts.cjs";
import type { GameDiscoveryOperationResult } from "./games/game-discovery-contracts.cjs";
import type { GamePackageDownloadResult } from "./games/game-package-download.cjs";
import type { LocalGamePackageStatus } from "./persistence/local-database.cjs";
import type { MatchSetupOperationResult } from "./games/match-setup.cjs";
import type { MatchRunOperationResult } from "./runs/match-run.cjs";

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
});

contextBridge.exposeInMainWorld("komoControl", bridge);
