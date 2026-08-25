interface KomoControlAppInfo {
    version: string;
    environment: "development" | "production";
}

interface KomoControlDesktopBridge {
    getAppInfo(): Promise<KomoControlAppInfo>;
}

interface Window {
    komoControl?: KomoControlDesktopBridge;
}
