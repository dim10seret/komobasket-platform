import { contextBridge, ipcRenderer } from "electron";

interface AppInfo {
    version: string;
    environment: "development" | "production";
}

const bridge = Object.freeze({
    getAppInfo: (): Promise<AppInfo> => ipcRenderer.invoke("app:get-info") as Promise<AppInfo>,
});

contextBridge.exposeInMainWorld("komoControl", bridge);
