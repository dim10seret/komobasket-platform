import { contextBridge, ipcRenderer } from "electron";
import type { AuthOperationResult, DesktopAuthState, LoginInput } from "./auth/auth-contracts.cjs";

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
});

contextBridge.exposeInMainWorld("komoControl", bridge);
