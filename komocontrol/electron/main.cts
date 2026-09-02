import { app, BrowserWindow, ipcMain, Menu, safeStorage, session } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { AuthCoordinator } from "./auth/auth-coordinator.cjs";
import { authErrorCode, type LoginInput } from "./auth/auth-contracts.cjs";
import { PlatformAuthClient } from "./auth/platform-auth-client.cjs";
import { SecureSessionStore, type SessionCipher } from "./auth/secure-session-store.cjs";
import { LiveRunAuthorizationManager } from "./auth/live-run-authorization.cjs";
import { LocalDatabase } from "./persistence/local-database.cjs";
import { GamePackageDownloadManager } from "./games/game-package-download.cjs";
import { MatchSetupManager } from "./games/match-setup.cjs";
import { MatchRunManager } from "./runs/match-run.cjs";
import { MatchGameplayManager, type MatchGameplayFinalizationInput } from "./runs/match-gameplay.cjs";
import { parseGameplayHistoryQuery, parseGameplayIntent, parseGameplayIntents, parseGameplayScorerEventEditModeInput, parseGameplayScorerEventMutationInput, parseGameplayScorerEventMutationPreviewInput, parseResumableLiveFlowInput } from "./runs/gameplay-runtime.cjs";
import { GameplaySyncWorker } from "./sync/gameplay-sync.cjs";
import { EXTRA_BENCH_ROLES, PreGameConfigurationManager, type ExtraBenchEntryV1, type ExtraBenchRole, type PreGameConfigurationPlayerDraft, type PreGameConfigurationPresentationDraft, type PreGameConfigurationSaveDraftInput, type PreGameConfigurationStaffDraft, type PreGameConfigurationTeamDraft } from "./runs/pre-game-configuration.cjs";

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

function gameplayObject(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid gameplay request.");
    return value as Record<string, unknown>;
}

function gameplayId(value: unknown): string {
    if (typeof value !== "string" || !value.trim() || value.length > 200) throw new Error("Invalid gameplay identity.");
    return value;
}

function matchGameplayFinalizationInput(value: unknown): MatchGameplayFinalizationInput {
    const input = gameplayObject(value);
    if (!(input.incidentReport === null || typeof input.incidentReport === "string")) throw new Error("Invalid Match finalization input.");
    const incidentReport = input.incidentReport === null ? null : input.incidentReport.replace(/\r\n?/g, "\n").trim() || null;
    if (incidentReport !== null && incidentReport.length > 20_000) throw new Error("Invalid Match finalization input.");
    return { incidentReport };
}

function preGameConfigurationPlayerDraft(value: unknown): PreGameConfigurationPlayerDraft {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid pre-game configuration player.");
    const player = value as Record<string, unknown>;
    if (typeof player.playerId !== "string" || !player.playerId.trim() || player.playerId.length > 200 || typeof player.participating !== "boolean" || !(player.gameShirtNumber === null || (typeof player.gameShirtNumber === "string" && player.gameShirtNumber.length <= 2))) throw new Error("Invalid pre-game configuration player.");
    return { playerId: player.playerId, participating: player.participating, gameShirtNumber: player.gameShirtNumber };
}

function preGameConfigurationStaffDraft(value: unknown): PreGameConfigurationStaffDraft {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid pre-game configuration staff member.");
    const staff = value as Record<string, unknown>;
    if (typeof staff.staffId !== "string" || !staff.staffId.trim() || staff.staffId.length > 200 || typeof staff.participating !== "boolean") throw new Error("Invalid pre-game configuration staff member.");
    return { staffId: staff.staffId, participating: staff.participating };
}

function preGameConfigurationExtraBenchEntry(value: unknown): ExtraBenchEntryV1 {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid Run-only Bench entry.");
    const entry = value as Record<string, unknown>;
    if (typeof entry.entryId !== "string" || entry.entryId.length > 100 || typeof entry.name !== "string" || entry.name.length > 120 || typeof entry.role !== "string" || !EXTRA_BENCH_ROLES.includes(entry.role as ExtraBenchRole)) throw new Error("Invalid Run-only Bench entry.");
    return { entryId: entry.entryId, name: entry.name, role: entry.role as ExtraBenchRole };
}

function preGameConfigurationTeamDraft(value: unknown): PreGameConfigurationTeamDraft {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid pre-game configuration team.");
    const team = value as Record<string, unknown>;
    if ((team.side !== "HOME" && team.side !== "AWAY") || !Array.isArray(team.players) || team.players.length > 100 || !Array.isArray(team.staff) || team.staff.length > 100 || !(team.captainPlayerId === null || (typeof team.captainPlayerId === "string" && team.captainPlayerId.trim() && team.captainPlayerId.length <= 200)) || !Array.isArray(team.starterPlayerIds) || team.starterPlayerIds.length > 100 || !team.starterPlayerIds.every((id) => typeof id === "string" && id.trim() && id.length <= 200) || !(team.gameColor === null || (typeof team.gameColor === "string" && /^#[0-9a-fA-F]{6}$/.test(team.gameColor))) || !Array.isArray(team.extraBench) || team.extraBench.length > 10) throw new Error("Invalid pre-game configuration team.");
    return { side: team.side, players: team.players.map(preGameConfigurationPlayerDraft), staff: team.staff.map(preGameConfigurationStaffDraft), captainPlayerId: team.captainPlayerId, starterPlayerIds: team.starterPlayerIds as string[], gameColor: team.gameColor, extraBench: team.extraBench.map(preGameConfigurationExtraBenchEntry) };
}

function preGameConfigurationPresentationDraft(value: unknown): PreGameConfigurationPresentationDraft {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid pre-game presentation.");
    const presentation = value as Record<string, unknown>;
    if (presentation.leftSide !== "HOME" && presentation.leftSide !== "AWAY") throw new Error("Invalid pre-game presentation.");
    return { leftSide: presentation.leftSide };
}

function preGameConfigurationSaveInput(value: unknown): PreGameConfigurationSaveDraftInput {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid pre-game configuration request.");
    const input = value as Record<string, unknown>;
    const gameId = gameIdInput(input.gameId);
    if (!Number.isInteger(input.expectedRevision) || Number(input.expectedRevision) < 1 || !Array.isArray(input.teams) || input.teams.length !== 2) throw new Error("Invalid pre-game configuration request.");
    return { gameId, expectedRevision: Number(input.expectedRevision), teams: [preGameConfigurationTeamDraft(input.teams[0]), preGameConfigurationTeamDraft(input.teams[1])], presentation: preGameConfigurationPresentationDraft(input.presentation) };
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
ipcMain.handle("games:get-match-setup", (event, value: unknown) => { requireTrustedSender(event); return requireAuthCoordinator().getMatchSetup(gameIdInput(value)); });
ipcMain.handle("runs:create-or-open", async (event, value: unknown) => { requireTrustedSender(event); return requireAuthCoordinator().createOrOpenGameRun(gameIdInput(value)); });
ipcMain.handle("runs:get-active", async (event, value: unknown) => { requireTrustedSender(event); return requireAuthCoordinator().getActiveGameRun(gameIdInput(value)); });
ipcMain.handle("runs:list-local", async (event) => { requireTrustedSender(event); return requireAuthCoordinator().listLocalRuns(); });
ipcMain.handle("runs:list-my-games-state", async (event) => { requireTrustedSender(event); return requireAuthCoordinator().listMyGamesRunStates(); });
ipcMain.handle("pregame:get-or-create", async (event, value: unknown) => { requireTrustedSender(event); return requireAuthCoordinator().getOrCreatePreGameConfiguration(gameIdInput(value)); });
ipcMain.handle("pregame:save-draft", async (event, value: unknown) => { requireTrustedSender(event); return requireAuthCoordinator().savePreGameConfigurationDraft(preGameConfigurationSaveInput(value)); });
ipcMain.handle("gameplay:start", async (event, value: unknown) => { requireTrustedSender(event); return requireAuthCoordinator().startMatch(gameplayId(value)); });
ipcMain.handle("gameplay:recover", async (event, value: unknown) => { requireTrustedSender(event); return requireAuthCoordinator().recoverMatchGameplay(gameplayId(value)); });
ipcMain.handle("gameplay:append-intent", async (event, value: unknown) => {
    requireTrustedSender(event); const input = gameplayObject(value);
    return requireAuthCoordinator().appendGameplayIntent(gameplayId(input.runId), parseGameplayIntent(input.intent));
});
ipcMain.handle("gameplay:append-and-resolve-flow", async (event, value: unknown) => {
    requireTrustedSender(event); const input = gameplayObject(value);
    return requireAuthCoordinator().appendAndResolveResumableGameplayFlow(gameplayId(input.runId), parseGameplayIntent(input.intent));
});
ipcMain.handle("gameplay:save-resumable-flow", async (event, value: unknown) => {
    requireTrustedSender(event); const input = gameplayObject(value);
    return requireAuthCoordinator().saveResumableLiveFlow(gameplayId(input.runId), parseResumableLiveFlowInput(input.flow));
});
ipcMain.handle("gameplay:get-resumable-flow", async (event, value: unknown) => { requireTrustedSender(event); return requireAuthCoordinator().getResumableLiveFlow(gameplayId(value)); });
ipcMain.handle("gameplay:append-intents", async (event, value: unknown) => {
    requireTrustedSender(event); const input = gameplayObject(value);
    return requireAuthCoordinator().appendGameplayIntents(gameplayId(input.runId), parseGameplayIntents(input.intents));
});
ipcMain.handle("gameplay:get-history", async (event, value: unknown) => {
    requireTrustedSender(event); const input = gameplayObject(value);
    return requireAuthCoordinator().getGameplayHistory(gameplayId(input.runId), parseGameplayHistoryQuery(input.query));
});
ipcMain.handle("gameplay:get-scorer-event-group", async (event, value: unknown) => {
    requireTrustedSender(event); const input = gameplayObject(value);
    return requireAuthCoordinator().getScorerEventGroup(gameplayId(input.runId), gameplayId(input.scorerEventGroupId));
});
ipcMain.handle("gameplay:get-scorer-event-edit-context", async (event, value: unknown) => {
    requireTrustedSender(event); const input = gameplayObject(value);
    return requireAuthCoordinator().getScorerEventEditContext(gameplayId(input.runId), gameplayId(input.scorerEventGroupId), input.mode === undefined ? undefined : parseGameplayScorerEventEditModeInput(input.mode));
});
ipcMain.handle("gameplay:preview-scorer-event-mutation", async (event, value: unknown) => {
    requireTrustedSender(event); const input = gameplayObject(value);
    return requireAuthCoordinator().previewGameplayScorerEventMutation(gameplayId(input.runId), parseGameplayScorerEventMutationPreviewInput(input.preview));
});
ipcMain.handle("gameplay:mutate-scorer-event-group", async (event, value: unknown) => {
    requireTrustedSender(event); const input = gameplayObject(value);
    return requireAuthCoordinator().mutateGameplayScorerEventGroup(gameplayId(input.runId), parseGameplayScorerEventMutationInput(input.mutation));
});
ipcMain.handle("gameplay:remove-event", async (event, value: unknown) => {
    requireTrustedSender(event); const input = gameplayObject(value);
    return requireAuthCoordinator().removeGameplayEvent(gameplayId(input.runId), gameplayId(input.eventId), input.cascadeDependencies === true);
});
ipcMain.handle("gameplay:correct-event", async (event, value: unknown) => {
    requireTrustedSender(event); const input = gameplayObject(value);
    return requireAuthCoordinator().correctGameplayEvent(gameplayId(input.runId), gameplayId(input.eventId), parseGameplayIntent(input.intent), input.cascadeDependencies === true);
});
ipcMain.handle("gameplay:finalize", async (event, value: unknown) => { requireTrustedSender(event); const request = gameplayObject(value); return requireAuthCoordinator().finalizeMatch(gameplayId(request.runId), matchGameplayFinalizationInput(request.input)); });
ipcMain.handle("gameplay:retry-sync", async (event, value: unknown) => { requireTrustedSender(event); return requireAuthCoordinator().retryGameplaySync(gameplayId(value)); });
ipcMain.handle("gameplay:reconnect-sync", async (event, value: unknown) => {
    requireTrustedSender(event); const input = gameplayObject(value);
    return requireAuthCoordinator().reconnectGameplaySync(gameplayId(input.runId), loginInput(input.credentials));
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
            const sessionCipher: SessionCipher = {
                isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
                encryptString: (value) => safeStorage.encryptString(value),
                decryptString: (value) => safeStorage.decryptString(value),
            };
            const secureSessionStore = new SecureSessionStore(path.join(userDataPath, "secure", "session.bin"), sessionCipher);
            const baseUrl = platformBaseUrl();
            const platformClient = baseUrl ? new PlatformAuthClient(baseUrl) : null;
            const matchSetupManager = new MatchSetupManager(localDatabase);
            const matchRunManager = new MatchRunManager(matchSetupManager, localDatabase, localStatus.deviceIdentity.deviceId);
            const preGameConfigurationManager = new PreGameConfigurationManager(matchSetupManager, localDatabase, localStatus.deviceIdentity.deviceId);
            const liveAuthorization = new LiveRunAuthorizationManager(localDatabase, sessionCipher, localStatus.deviceIdentity.deviceId);
            const matchGameplayManager = new MatchGameplayManager(matchSetupManager, localDatabase, localStatus.deviceIdentity.deviceId, undefined, undefined, (details) => liveAuthorization.seal(details));
            const syncWorker = platformClient ? new GameplaySyncWorker(localDatabase, platformClient, undefined, (runId) => {
                if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("gameplay:sync-state-changed", runId);
            }) : null;
            authCoordinator = new AuthCoordinator(platformClient, secureSessionStore, localStatus.deviceIdentity.deviceId,
                platformClient ? new GamePackageDownloadManager(platformClient, localDatabase) : null,
                matchSetupManager, matchRunManager, preGameConfigurationManager, matchGameplayManager, undefined, liveAuthorization, syncWorker);
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
