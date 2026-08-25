import { contextBridge, ipcRenderer } from "electron";

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
});

contextBridge.exposeInMainWorld("komoControl", bridge);
