import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import persistence from "../../dist-electron/persistence/local-database.cjs";

const { LocalDatabase } = persistence;
const roots = []; const databases = [];
function fixture(options = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "komocontrol-packages-")); roots.push(root);
    const migrationsDirectory = path.join(root, "migrations"); fs.mkdirSync(migrationsDirectory);
    fs.copyFileSync(path.resolve("electron/migrations/0001_initial.sql"), path.join(migrationsDirectory, "0001_initial.sql"));
    if (options.includeV2 !== false) fs.copyFileSync(path.resolve("electron/migrations/0002_game_packages.sql"), path.join(migrationsDirectory, "0002_game_packages.sql"));
    const localDatabase = new LocalDatabase({ databasePath: path.join(root, "komocontrol.sqlite"), migrationsDirectory, backupDirectory: path.join(root, "backups") }); databases.push(localDatabase);
    return { root, migrationsDirectory, localDatabase };
}
function input(gameId = "game-1", version = 1, overrides = {}) {
    const payloadJson = JSON.stringify({ schemaVersion: 1, game: { id: gameId }, teams: [] });
    return { packageId: `package-${gameId}-v${version}`, gameId, packageVersion: version, packageSchemaVersion: 1, payloadJson, payloadHash: "a".repeat(64), publishedAtUtc: "2026-08-25T10:00:00.000Z", ...overrides };
}
function createLegacyDatabase(fixtureValue) {
    const migrationId = "0001_initial.sql";
    const migrationPath = path.join(fixtureValue.migrationsDirectory, migrationId);
    const sql = fs.readFileSync(migrationPath, "utf8");
    const checksum = createHash("sha256").update(fs.readFileSync(migrationPath)).digest("hex");
    const deviceId = "11111111-1111-4111-8111-111111111111";
    const createdAt = "2026-08-25T10:00:00.000Z";
    const db = new DatabaseSync(fixtureValue.localDatabase.databasePath);
    try {
        db.exec("PRAGMA foreign_keys = ON");
        db.exec("BEGIN IMMEDIATE");
        try {
            db.exec(sql);
            db.prepare("INSERT INTO local_schema_migrations (migration_id, applied_at_utc, checksum) VALUES (?, ?, ?)").run(migrationId, createdAt, checksum);
            db.prepare("INSERT INTO device_identity (singleton_key, device_id, created_at_utc) VALUES (1, ?, ?)").run(deviceId, createdAt);
            db.exec("COMMIT");
        } catch (error) { db.exec("ROLLBACK"); throw error; }
        expect(db.prepare("SELECT migration_id FROM local_schema_migrations ORDER BY migration_id DESC LIMIT 1").get().migration_id).toBe(migrationId);
        expect(db.prepare("SELECT COUNT(*) AS count FROM device_identity").get().count).toBe(1);
        expect(db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='local_game_packages'").get().count).toBe(0);
        expect(db.prepare("PRAGMA quick_check").get().quick_check).toBe("ok");
        expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    } finally { db.close(); }
    return deviceId;
}
function rows(databasePath, gameId = "game-1") { const db = new DatabaseSync(databasePath, { readOnly: true }); try { return db.prepare("SELECT package_id, package_version, payload_json, payload_hash, is_current FROM local_game_packages WHERE game_id=? ORDER BY package_version").all(gameId); } finally { db.close(); } }
afterEach(() => { for (const db of databases.splice(0)) db.close(); for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("KomoControl local immutable GamePackage store", () => {
    it("migrates an existing 0001 database to 0002", () => { const f = fixture({ includeV2: false }); createLegacyDatabase(f); fs.copyFileSync(path.resolve("electron/migrations/0002_game_packages.sql"), path.join(f.migrationsDirectory, "0002_game_packages.sql")); const reopened = new LocalDatabase({ databasePath: f.localDatabase.databasePath, migrationsDirectory: f.migrationsDirectory, backupDirectory: path.join(f.root, "backups") }); databases.push(reopened); expect(reopened.initialize().schemaVersion).toBe("0002_game_packages.sql"); });
    it("preserves device identity across migration", () => { const f = fixture({ includeV2: false }); const before = createLegacyDatabase(f); fs.copyFileSync(path.resolve("electron/migrations/0002_game_packages.sql"), path.join(f.migrationsDirectory, "0002_game_packages.sql")); const reopened = new LocalDatabase({ databasePath: f.localDatabase.databasePath, migrationsDirectory: f.migrationsDirectory, backupDirectory: path.join(f.root, "backups") }); databases.push(reopened); expect(reopened.initialize().deviceIdentity.deviceId).toBe(before); });
    it("stores the first Package as current", () => { const f = fixture(); f.localDatabase.initialize(); expect(f.localDatabase.storeVerifiedGamePackage(input()).status).toMatchObject({ availableOffline: true, currentVersion: 1 }); });
    it("treats the same exact Package as idempotent", () => { const f = fixture(); f.localDatabase.initialize(); f.localDatabase.storeVerifiedGamePackage(input()); expect(f.localDatabase.storeVerifiedGamePackage(input()).outcome).toBe("unchanged"); expect(rows(f.localDatabase.databasePath)).toHaveLength(1); });
    it("makes a newer Package current", () => { const f = fixture(); f.localDatabase.initialize(); f.localDatabase.storeVerifiedGamePackage(input()); f.localDatabase.storeVerifiedGamePackage(input("game-1", 2, { payloadHash: "b".repeat(64) })); expect(f.localDatabase.getCurrentGamePackageStatus("game-1").currentVersion).toBe(2); });
    it("preserves the old Package after replacement", () => { const f = fixture(); f.localDatabase.initialize(); f.localDatabase.storeVerifiedGamePackage(input()); f.localDatabase.storeVerifiedGamePackage(input("game-1", 2, { payloadHash: "b".repeat(64) })); expect(rows(f.localDatabase.databasePath).map((row) => row.package_version)).toEqual([1, 2]); });
    it("keeps exactly one current Package per Game", () => { const f = fixture(); f.localDatabase.initialize(); f.localDatabase.storeVerifiedGamePackage(input()); f.localDatabase.storeVerifiedGamePackage(input("game-1", 2, { payloadHash: "b".repeat(64) })); expect(rows(f.localDatabase.databasePath).filter((row) => row.is_current === 1)).toHaveLength(1); });
    it("rejects downgrade without writes", () => { const f = fixture(); f.localDatabase.initialize(); f.localDatabase.storeVerifiedGamePackage(input("game-1", 2)); expect(() => f.localDatabase.storeVerifiedGamePackage(input("game-1", 1))).toThrow(/downgrade/i); expect(rows(f.localDatabase.databasePath)).toHaveLength(1); });
    it("rejects same-version different hash", () => { const f = fixture(); f.localDatabase.initialize(); f.localDatabase.storeVerifiedGamePackage(input()); expect(() => f.localDatabase.storeVerifiedGamePackage(input("game-1", 1, { payloadHash: "b".repeat(64) }))).toThrow(/same-version/i); });
    it("rejects same-version different Package ID", () => { const f = fixture(); f.localDatabase.initialize(); f.localDatabase.storeVerifiedGamePackage(input()); expect(() => f.localDatabase.storeVerifiedGamePackage(input("game-1", 1, { packageId: "different" }))).toThrow(/same-version/i); });
    it("rejects immutable payload updates", () => { const f = fixture(); f.localDatabase.initialize(); f.localDatabase.storeVerifiedGamePackage(input()); f.localDatabase.close(); const db = new DatabaseSync(f.localDatabase.databasePath); try { expect(() => db.prepare("UPDATE local_game_packages SET payload_json=? WHERE package_id=?").run("{}", "package-game-1-v1")).toThrow(/immutable/i); } finally { db.close(); } });
    it("rejects immutable hash updates", () => { const f = fixture(); f.localDatabase.initialize(); f.localDatabase.storeVerifiedGamePackage(input()); f.localDatabase.close(); const db = new DatabaseSync(f.localDatabase.databasePath); try { expect(() => db.prepare("UPDATE local_game_packages SET payload_hash=? WHERE package_id=?").run("b".repeat(64), "package-game-1-v1")).toThrow(/immutable/i); } finally { db.close(); } });
    it("rolls back a failed replacement and preserves current", () => { const f = fixture(); f.localDatabase.initialize(); f.localDatabase.storeVerifiedGamePackage(input("game-1", 1, { packageId: "shared-package" })); f.localDatabase.storeVerifiedGamePackage(input("game-2", 1)); expect(() => f.localDatabase.storeVerifiedGamePackage(input("game-2", 2, { packageId: "shared-package", payloadHash: "b".repeat(64) }))).toThrow(); expect(f.localDatabase.getCurrentGamePackageStatus("game-2").currentVersion).toBe(1); expect(rows(f.localDatabase.databasePath, "game-2")).toHaveLength(1); });
    it("rejects unsupported Package schema before storage", () => { const f = fixture(); f.localDatabase.initialize(); expect(() => f.localDatabase.storeVerifiedGamePackage({ ...input(), packageSchemaVersion: 2 })).toThrow(/unsupported/i); expect(rows(f.localDatabase.databasePath)).toHaveLength(0); });
    it("returns a status DTO without payload or hash", () => { const f = fixture(); f.localDatabase.initialize(); f.localDatabase.storeVerifiedGamePackage(input()); const serialized = JSON.stringify(f.localDatabase.getCurrentGamePackageStatus("game-1")); expect(serialized).not.toContain("payload"); expect(serialized).not.toContain("hash"); expect(serialized).not.toContain("packageId"); });
});
