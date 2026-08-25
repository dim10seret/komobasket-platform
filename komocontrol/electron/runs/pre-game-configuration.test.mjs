import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import persistence from "../../dist-electron/persistence/local-database.cjs";
import setupModule from "../../dist-electron/games/match-setup.cjs";
import runModule from "../../dist-electron/runs/match-run.cjs";
import configurationModule from "../../dist-electron/runs/pre-game-configuration.cjs";
import authModule from "../../dist-electron/auth/auth-coordinator.cjs";

const { LocalDatabase } = persistence;
const { MatchSetupManager } = setupModule;
const { MatchRunManager } = runModule;
const { PreGameConfigurationManager } = configurationModule;
const { AuthCoordinator } = authModule;
const roots = [];
const databases = [];
const owner = { scorerId: "scorer-synthetic", organizationId: "organization-synthetic" };
const deviceId = "11111111-1111-4111-8111-111111111111";

function payload(version = 2) {
    return {
        schemaVersion: 1,
        game: { id: "game-1", organizationId: owner.organizationId, competitionId: "competition-1", competitionName: `Competition v${version}`, seasonName: "2026-27", phaseName: "League", roundLabel: "Round 1", scheduledDate: "2026-08-25", scheduledTime: "19:00", scheduledAt: "2026-08-25T16:00:00.000Z", venue: null },
        settings: { game_mode: "FULL", min_players: 2, max_players: 12, starting_players: 2, regulation_periods: 4, regulation_period_seconds: 600, overtime_seconds: 300, tie_allowed: false, winner_required: true },
        teams: [
            { side: "AWAY", id: "away-team", name: `Away v${version}`, logoUrl: null, players: [{ id: "away-1", displayName: "Away One", shirtNumber: 0, photoUrl: null }, { id: "away-2", displayName: "Away Two", shirtNumber: null, photoUrl: null }, { id: "away-3", displayName: "Away Three", shirtNumber: 7, photoUrl: null }], staff: [{ id: "away-staff", displayName: "Away Staff", role: "coach", roleLabel: "Coach" }] },
            { side: "HOME", id: "home-team", name: `Home v${version}`, logoUrl: null, players: [{ id: "home-1", displayName: "Home One", shirtNumber: 0, photoUrl: null }, { id: "home-2", displayName: "Home Two", shirtNumber: null, photoUrl: null }, { id: "home-3", displayName: "Home Three", shirtNumber: 7, photoUrl: null }], staff: [{ id: "home-staff", displayName: "Home Staff", role: "coach", roleLabel: "Coach" }] },
        ],
    };
}

function packageInput(version = 2) {
    const payloadJson = JSON.stringify(payload(version));
    return { packageId: `package-v${version}`, gameId: "game-1", packageVersion: version, packageSchemaVersion: 1, payloadJson, payloadHash: createHash("sha256").update(Buffer.from(payloadJson, "utf8")).digest("hex"), publishedAtUtc: `2026-08-2${version}T10:00:00.000Z` };
}

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "komocontrol-kc5b9a-")); roots.push(root);
    const migrationsDirectory = path.join(root, "migrations"); fs.cpSync(path.resolve("electron/migrations"), migrationsDirectory, { recursive: true });
    const localDatabase = new LocalDatabase({ databasePath: path.join(root, "komocontrol.sqlite"), migrationsDirectory, backupDirectory: path.join(root, "backups") }); databases.push(localDatabase);
    localDatabase.initialize(); localDatabase.storeVerifiedGamePackage(packageInput());
    const setup = new MatchSetupManager(localDatabase); const runs = new MatchRunManager(setup, localDatabase, localDatabase.getDeviceIdentity().deviceId);
    const run = runs.createOrOpen("game-1", owner).run;
    const manager = new PreGameConfigurationManager(setup, localDatabase, localDatabase.getDeviceIdentity().deviceId);
    return { root, migrationsDirectory, localDatabase, setup, runs, run, manager };
}

function draft(configuration) {
    return { gameId: configuration.gameId, expectedRevision: configuration.revision, teams: configuration.teams.map((team) => ({ side: team.side, players: team.players.map((player) => ({ playerId: player.playerId, participating: player.participating, gameShirtNumber: player.gameShirtNumber })) })) };
}

function select(input, side, playerId, gameShirtNumber) {
    return { ...input, teams: input.teams.map((team) => team.side !== side ? team : { ...team, players: team.players.map((player) => player.playerId === playerId ? { ...player, participating: true, gameShirtNumber } : player) }) };
}

function readRows(databasePath, sql, ...params) {
    const db = new DatabaseSync(databasePath, { readOnly: true });
    try { return db.prepare(sql).all(...params); } finally { db.close(); }
}

afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("KC-5B9A durable pre-game configuration", () => {
    it("migrates 0003 to 0004 while preserving device, Package, and Run", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "komocontrol-kc5b9a-migration-")); roots.push(root); const databasePath = path.join(root, "legacy.sqlite");
        const db = new DatabaseSync(databasePath); const appliedAt = "2026-08-25T10:00:00.000Z";
        try {
            db.exec("PRAGMA foreign_keys = ON");
            for (const migrationId of ["0001_initial.sql", "0002_game_packages.sql", "0003_game_runs.sql"]) { const bytes = fs.readFileSync(path.resolve("electron/migrations", migrationId)); db.exec(bytes.toString("utf8")); db.prepare("INSERT INTO local_schema_migrations (migration_id, applied_at_utc, checksum) VALUES (?, ?, ?)").run(migrationId, appliedAt, createHash("sha256").update(bytes).digest("hex")); }
            const pkg = packageInput(); db.prepare("INSERT INTO device_identity (singleton_key, device_id, created_at_utc) VALUES (1, ?, ?)").run(deviceId, appliedAt);
            db.prepare("INSERT INTO local_game_packages (package_id, game_id, package_version, package_schema_version, payload_json, payload_hash, published_at_utc, downloaded_at_utc, is_current) VALUES (?, ?, ?, 1, ?, ?, ?, ?, 1)").run(pkg.packageId, pkg.gameId, pkg.packageVersion, pkg.payloadJson, pkg.payloadHash, pkg.publishedAtUtc, appliedAt);
            const setupJson = JSON.stringify({ preserved: true }); db.prepare("INSERT INTO local_game_runs (run_id, run_schema_version, game_id, package_id, package_version, package_schema_version, package_hash, organization_id, scorer_id, device_id, status, setup_snapshot_json, last_accepted_sequence, started_at_utc, created_at_utc, updated_at_utc) VALUES ('run-preserved', 1, ?, ?, ?, 1, ?, ?, ?, ?, 'active', ?, 0, NULL, ?, ?)").run(pkg.gameId, pkg.packageId, pkg.packageVersion, pkg.payloadHash, owner.organizationId, owner.scorerId, deviceId, setupJson, appliedAt, appliedAt);
        } finally { db.close(); }
        const migrationsDirectory = path.join(root, "migrations"); fs.cpSync(path.resolve("electron/migrations"), migrationsDirectory, { recursive: true });
        const localDatabase = new LocalDatabase({ databasePath, migrationsDirectory, backupDirectory: path.join(root, "backups") }); databases.push(localDatabase);
        expect(localDatabase.initialize().schemaVersion).toBe("0004_game_run_configuration.sql");
        expect(localDatabase.getDeviceIdentity().deviceId).toBe(deviceId); expect(localDatabase.readGamePackage("package-v2")?.packageVersion).toBe(2); expect(localDatabase.getActiveLocalGameRun("game-1")?.runId).toBe("run-preserved"); expect(readRows(databasePath, "SELECT * FROM local_game_run_configurations")).toHaveLength(0);
    });

    it("creates one versioned DRAFT configuration per Run with HOME/AWAY Package defaults", () => {
        const f = fixture(); const first = f.manager.getOrCreate("game-1", owner); const second = f.manager.getOrCreate("game-1", owner);
        expect(first.outcome).toBe("created"); expect(second.outcome).toBe("existing"); expect(second.configuration.runId).toBe(first.configuration.runId); expect(first.configuration.status).toBe("draft"); expect(first.configuration.revision).toBe(1);
        expect(first.configuration.teams.map((team) => team.side)).toEqual(["HOME", "AWAY"]); expect(first.configuration.teams.flatMap((team) => team.players).every((player) => !player.participating)).toBe(true);
        expect(first.configuration.teams[0].players.map((player) => player.gameShirtNumber)).toEqual(["0", "7", null]); expect(first.configuration.teams[0].staff.every((member) => !member.participating)).toBe(true); expect(first.configuration.teams[0].captainPlayerId).toBeNull(); expect(first.configuration.teams[0].starterPlayerIds).toEqual([]);
        expect(readRows(f.localDatabase.databasePath, "SELECT * FROM local_game_run_configurations")).toHaveLength(1);
    });

    it("accepts 0, 00, 1 through 99, preserves distinct text values, and allows the same number across sides", () => {
        const f = fixture(); const current = f.manager.getOrCreate("game-1", owner).configuration; let input = draft(current);
        input = select(input, "HOME", "home-1", "0"); input = select(input, "HOME", "home-2", "00"); input = select(input, "HOME", "home-3", "99"); input = select(input, "AWAY", "away-1", "0"); input = select(input, "AWAY", "away-2", "1");
        const saved = f.manager.saveDraft(input, owner); expect(saved.revision).toBe(2); expect(saved.teams[0].players.filter((player) => player.participating).map((player) => player.gameShirtNumber)).toEqual(["0", "99", "00"]); expect(saved.teams[1].players.find((player) => player.playerId === "away-1")?.gameShirtNumber).toBe("0");
    });

    it.each(["-1", "+1", "01", "100", "1.5", " 1", "1 ", "A"])("rejects invalid shirt number %s without a revision write", (number) => {
        const f = fixture(); const current = f.manager.getOrCreate("game-1", owner).configuration; const input = select(draft(current), "HOME", "home-1", number);
        expect(() => f.manager.saveDraft(input, owner)).toThrow(/CONFIGURATION_INVALID/); expect(f.localDatabase.readLocalGameRunConfiguration(current.runId)?.revision).toBe(1);
    });

    it("rejects duplicate participating numbers on one side and rolls back", () => {
        const f = fixture(); const current = f.manager.getOrCreate("game-1", owner).configuration; let input = select(draft(current), "HOME", "home-1", "7"); input = select(input, "HOME", "home-2", "7");
        expect(() => f.manager.saveDraft(input, owner)).toThrow(/CONFIGURATION_INVALID/); expect(f.localDatabase.readLocalGameRunConfiguration(current.runId)?.revision).toBe(1);
    });

    it("persists a Run-only override without mutating the pinned Package", () => {
        const f = fixture(); const before = f.localDatabase.readGamePackage("package-v2"); const current = f.manager.getOrCreate("game-1", owner).configuration; const saved = f.manager.saveDraft(select(draft(current), "HOME", "home-1", "55"), owner);
        expect(saved.teams[0].players.find((player) => player.playerId === "home-1")).toMatchObject({ packageShirtNumber: 0, gameShirtNumber: "55", participating: true }); expect(f.localDatabase.readGamePackage("package-v2")).toEqual(before);
    });

    it("continues to derive from the Run-pinned historical Package after a newer download", () => {
        const f = fixture(); const first = f.manager.getOrCreate("game-1", owner).configuration; f.localDatabase.storeVerifiedGamePackage(packageInput(3)); const reopened = f.manager.getOrCreate("game-1", owner).configuration;
        expect(reopened.packageId).toBe("package-v2"); expect(reopened.packageVersion).toBe(2); expect(reopened.teams[0].teamName).toBe("Home v2"); expect(reopened.runId).toBe(first.runId);
    });

    it("increments revisions and rejects stale expectedRevision without changing the accepted draft", () => {
        const f = fixture(); const current = f.manager.getOrCreate("game-1", owner).configuration; const initialInput = select(draft(current), "HOME", "home-1", "10"); const saved = f.manager.saveDraft(initialInput, owner);
        expect(saved.revision).toBe(2); expect(() => f.manager.saveDraft({ ...initialInput, teams: initialInput.teams }, owner)).toThrow(/CONFIGURATION_CONFLICT/); expect(f.localDatabase.readLocalGameRunConfiguration(current.runId)?.revision).toBe(2);
    });

    it("recovers the same configuration after database restart", () => {
        const f = fixture(); const current = f.manager.getOrCreate("game-1", owner).configuration; const saved = f.manager.saveDraft(select(draft(current), "AWAY", "away-2", "00"), owner); f.localDatabase.close();
        const reopened = new LocalDatabase({ databasePath: f.localDatabase.databasePath, migrationsDirectory: f.migrationsDirectory, backupDirectory: path.join(f.root, "backups") }); databases.push(reopened); reopened.initialize(); const manager = new PreGameConfigurationManager(new MatchSetupManager(reopened), reopened, reopened.getDeviceIdentity().deviceId); const recovered = manager.getOrCreate("game-1", owner).configuration;
        expect(recovered.runId).toBe(saved.runId); expect(recovered.revision).toBe(saved.revision); expect(recovered.teams[1].players.find((player) => player.playerId === "away-2")?.gameShirtNumber).toBe("00");
    });

    it("enforces scorer, Organization, and device ownership", () => {
        const f = fixture(); f.manager.getOrCreate("game-1", owner); expect(() => f.manager.getOrCreate("game-1", { ...owner, scorerId: "other" })).toThrow(/CONFIGURATION_OWNERSHIP_CONFLICT/); const otherDevice = new PreGameConfigurationManager(f.setup, f.localDatabase, "22222222-2222-4222-8222-222222222222"); expect(() => otherDevice.getOrCreate("game-1", owner)).toThrow(/CONFIGURATION_OWNERSHIP_CONFLICT/);
    });

    it("rejects a corrupted integrity hash or malformed configuration JSON", () => {
        const f = fixture(); const current = f.manager.getOrCreate("game-1", owner).configuration; f.localDatabase.close(); const db = new DatabaseSync(f.localDatabase.databasePath); db.prepare("UPDATE local_game_run_configurations SET configuration_hash = ? WHERE run_id = ?").run("f".repeat(64), current.runId); db.close();
        const reopened = new LocalDatabase({ databasePath: f.localDatabase.databasePath, migrationsDirectory: f.migrationsDirectory, backupDirectory: path.join(f.root, "backups") }); databases.push(reopened); reopened.initialize(); const manager = new PreGameConfigurationManager(new MatchSetupManager(reopened), reopened, reopened.getDeviceIdentity().deviceId); expect(() => manager.getOrCreate("game-1", owner)).toThrow(/CONFIGURATION_INVALID/);
    });

    it("denies unauthenticated access, retains the draft over logout, and makes no Platform content request", async () => {
        const f = fixture(); let token = null; let authCalls = 0; let contentCalls = 0;
        const store = { isAvailable: () => true, saveToken: (value) => { token = value; }, loadToken: () => token, clearSession: () => { token = null; } };
        const client = { login: async () => { authCalls += 1; return { token: "synthetic-session-token", scorerId: owner.scorerId, username: "synthetic-scorer", organizationId: owner.organizationId, organizationName: "Synthetic Organization", expiresAt: "2026-08-26T10:00:00.000Z" }; }, getSession: async () => { authCalls += 1; return { scorerId: owner.scorerId, username: "synthetic-scorer", organizationId: owner.organizationId, organizationName: "Synthetic Organization", expiresAt: "2026-08-26T10:00:00.000Z" }; }, logout: async () => { authCalls += 1; }, listGames: async () => { contentCalls += 1; return []; } };
        const coordinator = new AuthCoordinator(client, store, f.localDatabase.getDeviceIdentity().deviceId, null, null, null, f.manager); expect((await coordinator.getOrCreatePreGameConfiguration("game-1")).ok).toBe(false);
        expect((await coordinator.login({ username: "synthetic-scorer", password: "synthetic-fixture-password" })).ok).toBe(true); const opened = await coordinator.getOrCreatePreGameConfiguration("game-1"); expect(opened.ok).toBe(true); expect(contentCalls).toBe(0); const runId = opened.configuration.runId;
        expect((await coordinator.logout()).ok).toBe(true); expect((await coordinator.getOrCreatePreGameConfiguration("game-1")).ok).toBe(false); expect(f.localDatabase.readLocalGameRunConfiguration(runId)).not.toBeNull(); expect(contentCalls).toBe(0); expect(authCalls).toBe(2);
    });

    it("returns a safe DTO and leaves Run gameplay and event state untouched", () => {
        const f = fixture(); const configuration = f.manager.getOrCreate("game-1", owner).configuration; const serialized = JSON.stringify(configuration); const run = f.localDatabase.getActiveLocalGameRun("game-1");
        expect(serialized).not.toContain("configurationJson"); expect(serialized).not.toContain("configurationHash"); expect(serialized).not.toContain("payloadJson"); expect(serialized).not.toContain("payloadHash"); expect(serialized).not.toContain(owner.scorerId); expect(serialized).not.toContain(deviceId);
        expect(run).toMatchObject({ startedAtUtc: null, lastAcceptedSequence: 0, status: "active" }); expect(readRows(f.localDatabase.databasePath, "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name LIKE '%event%'")[0].count).toBe(0);
    });
});
