interface KomoControlAppInfo {
    version: string;
    environment: "development" | "production";
}

interface KomoControlDesktopBridge {
    getAppInfo(): Promise<KomoControlAppInfo>;
    getLocalStatus(): Promise<{
        ready: true;
        schemaVersion: string;
        deviceIdSuffix: string;
    }>;
}

interface Window {
    komoControl?: KomoControlDesktopBridge;
}
