import { app, BrowserWindow, ipcMain, Menu, safeStorage, session } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AuthCoordinator } from "./auth/auth-coordinator.cjs";
import { authErrorCode, type LoginInput } from "./auth/auth-contracts.cjs";
import { PlatformAuthClient } from "./auth/platform-auth-client.cjs";
import { SecureSessionStore } from "./auth/secure-session-store.cjs";
import { LocalDatabase } from "./persistence/local-database.cjs";
import { GamePackageDownloadManager } from "./games/game-package-download.cjs";

const developmentUrl = process.env.KOMOCONTROL_RENDERER_URL;
const productionPlatformOrigin = "https://komobasket.gr";
const isDevelopment = !app.isPackaged && Boolean(developmentUrl);
let mainWindow: BrowserWindow | null = null;
let localDatabase: LocalDatabase | null = null;
let authCoordinator: AuthCoordinator | null = null;

const profileName = app.isPackaged ? "KomoControl" : "KomoControl Dev";
app.setName(profileName);
app.setPath("userData", path.join(app.getPath("appData"), profileName));

function rendererRootUrl(): string {
    return pathToFileURL(path.join(__dirname, "..", "dist") + path.sep).href;
}

function isAllowedRendererUrl(rawUrl: string): boolean {
    try {
        const url = new URL(rawUrl);

        if (isDevelopment && developmentUrl) {
            return url.origin === new URL(developmentUrl).origin;
        }

        return url.protocol === "file:" && url.href.startsWith(rendererRootUrl());
    } catch {
        return false;
    }
}

function requireTrustedSender(event: Electron.IpcMainInvokeEvent): void {
    if (event.senderFrame === null || !isAllowedRendererUrl(event.senderFrame.url)) throw new Error("Untrusted renderer IPC request.");
}

function platformBaseUrl(): string | null {
    if (app.isPackaged) return productionPlatformOrigin;
    const configured = process.env.KOMOCONTROL_PLATFORM_URL?.trim();
    if (!configured) return "http://localhost:3000";
    try { const url = new URL(configured); if (url.protocol !== "http:" && url.protocol !== "https:") return null; return url.origin; }
    catch { return null; }
}

function requireAuthCoordinator(): AuthCoordinator { if (!authCoordinator) throw new Error("Authentication is not ready."); return authCoordinator; }

function loginInput(value: unknown): LoginInput {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Login input.");
    const input = value as Record<string, unknown>;
    if (typeof input.username !== "string" || typeof input.password !== "string") throw new Error("Invalid Login input.");
    const username = input.username.trim();
    if (!username || username.length > 100 || !input.password || input.password.length > 512) throw new Error("Invalid Login input.");
    return { username, password: input.password };
}

function gameIdInput(value: unknown): string {
    if (typeof value !== "string") throw new Error("Invalid Game identity.");
    const gameId = value.trim();
    if (!gameId || gameId.length > 200) throw new Error("Invalid Game identity.");
    return gameId;
}

function createMainWindow(): void {
    const window = new BrowserWindow({
        width: 1440,
        height: 920,
        minWidth: 1024,
        minHeight: 700,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, "preload.cjs"),
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webSecurity: true,
            allowRunningInsecureContent: false,
            devTools: isDevelopment,
        },
    });

    mainWindow = window;
    Menu.setApplicationMenu(null);

    window.once("ready-to-show", () => window.show());

    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, targetUrl) => {
        if (!isAllowedRendererUrl(targetUrl)) {
            event.preventDefault();
        }
    });
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());

    window.on("closed", () => {
        if (mainWindow === window) {
            mainWindow = null;
        }
    });

    if (isDevelopment && developmentUrl) {
        void window.loadURL(developmentUrl);
    } else {
        void window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
    }
}

ipcMain.handle("app:get-info", (event) => {
    requireTrustedSender(event);

    return {
        version: app.getVersion(),
        environment: isDevelopment ? "development" : "production",
    } as const;
});

ipcMain.handle("app:get-local-status", (event) => {
    requireTrustedSender(event);

    if (localDatabase === null) {
        throw new Error("Local persistence is not ready.");
    }

    return localDatabase.getSafeStatus();
});

ipcMain.handle("auth:get-state", async (event) => { requireTrustedSender(event); return requireAuthCoordinator().getState(); });
ipcMain.handle("auth:login", async (event, value: unknown) => {
    requireTrustedSender(event);
    try { return await requireAuthCoordinator().login(loginInput(value)); }
    catch (error) { const coordinator = requireAuthCoordinator(); return { ok: false, errorCode: authErrorCode(error), state: await coordinator.getState() } as const; }
});
ipcMain.handle("auth:retry-session", async (event) => { requireTrustedSender(event); return requireAuthCoordinator().retrySession(); });
ipcMain.handle("auth:logout", async (event) => { requireTrustedSender(event); return requireAuthCoordinator().logout(); });
ipcMain.handle("games:list", async (event) => { requireTrustedSender(event); return requireAuthCoordinator().listGames(); });
ipcMain.handle("games:get-offline-status", (event, value: unknown) => { requireTrustedSender(event); return requireAuthCoordinator().getGamePackageStatus(gameIdInput(value)); });
ipcMain.handle("games:download-package", async (event, value: unknown) => { requireTrustedSender(event); return requireAuthCoordinator().downloadGamePackage(gameIdInput(value)); });

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
    app.quit();
} else {
    app.on("second-instance", () => {
        if (!mainWindow) {
            return;
        }

        if (mainWindow.isMinimized()) {
            mainWindow.restore();
        }
        mainWindow.focus();
    });

    void app.whenReady().then(async () => {
        session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
            callback(false);
        });
        session.defaultSession.setPermissionCheckHandler(() => false);

        const userDataPath = app.getPath("userData");
        const migrationDirectory = app.isPackaged
            ? path.join(process.resourcesPath, "local-migrations")
            : path.join(app.getAppPath(), "electron", "migrations");

        localDatabase = new LocalDatabase({
            databasePath: path.join(userDataPath, "komocontrol.sqlite"),
            migrationsDirectory: migrationDirectory,
            backupDirectory: path.join(userDataPath, "backups"),
        });

        try {
            const localStatus = localDatabase.initialize();
            console.info("KomoControl local persistence ready.", {
                ...localDatabase.getSafeStatus(),
                durability: localDatabase.getDurabilityStatus(),
            });
            const secureSessionStore = new SecureSessionStore(path.join(userDataPath, "secure", "session.bin"), {
                isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
                encryptString: (value) => safeStorage.encryptString(value),
                decryptString: (value) => safeStorage.decryptString(value),
            });
            const baseUrl = platformBaseUrl();
            const platformClient = baseUrl ? new PlatformAuthClient(baseUrl) : null;
            authCoordinator = new AuthCoordinator(platformClient, secureSessionStore, localStatus.deviceIdentity.deviceId, platformClient ? new GamePackageDownloadManager(platformClient, localDatabase) : null);
            void authCoordinator.initialize();
        } catch (error) {
            console.error("KomoControl local persistence initialization failed.", error);
            localDatabase.close();
            localDatabase = null;
            app.quit();
            return;
        }

        createMainWindow();

        app.on("activate", () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createMainWindow();
            }
        });
    });
}

app.on("window-all-closed", () => {
    app.quit();
});

app.on("before-quit", () => {
    authCoordinator?.dispose();
    authCoordinator = null;
    localDatabase?.close();
    localDatabase = null;
});
