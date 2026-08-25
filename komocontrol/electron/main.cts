import { app, BrowserWindow, ipcMain, Menu, session } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";

const developmentUrl = process.env.KOMOCONTROL_RENDERER_URL;
const isDevelopment = !app.isPackaged && Boolean(developmentUrl);
let mainWindow: BrowserWindow | null = null;

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
    if (event.senderFrame === null || !isAllowedRendererUrl(event.senderFrame.url)) {
        throw new Error("Untrusted renderer IPC request.");
    }

    return {
        version: app.getVersion(),
        environment: isDevelopment ? "development" : "production",
    } as const;
});

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

    void app.whenReady().then(() => {
        session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
            callback(false);
        });
        session.defaultSession.setPermissionCheckHandler(() => false);

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
