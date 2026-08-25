import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import persistence from "../../dist-electron/persistence/local-database.cjs";

const { LocalDatabase } = persistence;
const temporaryRoots = [];
const openDatabases = [];

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "komocontrol-kc5b2-"));
    temporaryRoots.push(root);
    const migrationsDirectory = path.join(root, "migrations");
    fs.cpSync(path.resolve("electron/migrations"), migrationsDirectory, { recursive: true });
    const localDatabase = new LocalDatabase({
        databasePath: path.join(root, "komocontrol.sqlite"),
        migrationsDirectory,
        backupDirectory: path.join(root, "backups"),
    });
    openDatabases.push(localDatabase);
    return { root, migrationsDirectory, localDatabase };
}

afterEach(() => {
    for (const database of openDatabases.splice(0)) {
        database.close();
    }
    for (const root of temporaryRoots.splice(0)) {
        if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()))) {
            throw new Error("Refusing to remove a non-temporary test directory.");
        }
        fs.rmSync(root, { recursive: true, force: true });
    }
});

describe("KomoControl local persistence", () => {
    it("creates migration 0001, its checksum, device identity, durability settings and healthy schema", () => {
        const { migrationsDirectory, localDatabase } = fixture();
        const status = localDatabase.initialize();
        const db = new DatabaseSync(localDatabase.databasePath, { readOnly: true });
        try {
            const migration = db.prepare("SELECT migration_id, checksum FROM local_schema_migrations").get();
            const tables = db.prepare(
                "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
            ).all().map((row) => row.name);
            const expectedChecksum = createHash("sha256")
                .update(fs.readFileSync(path.join(migrationsDirectory, "0001_initial.sql")))
                .digest("hex");

            expect(status.schemaVersion).toBe("0001_initial.sql");
            expect(status.deviceIdentity.deviceId).toMatch(/^[0-9a-f-]{36}$/);
            expect(migration).toEqual({ migration_id: "0001_initial.sql", checksum: expectedChecksum });
            expect(tables).toEqual(["device_identity", "local_schema_migrations"]);
            expect(db.prepare("PRAGMA foreign_keys").get().foreign_keys).toBe(1);
            expect(db.prepare("PRAGMA journal_mode").get().journal_mode).toBe("wal");
            expect(db.prepare("PRAGMA synchronous").get().synchronous).toBe(2);
            expect(localDatabase.getDurabilityStatus()).toEqual({
                foreignKeys: 1,
                journalMode: "wal",
                synchronous: 2,
                busyTimeout: 5000,
            });
            expect(localDatabase.runIntegrityCheck()).toEqual({ quickCheck: "ok", foreignKeyExceptions: 0 });
        } finally {
            db.close();
        }
    });

    it("does not reapply migrations and preserves one device identity after reopen", () => {
        const { root, migrationsDirectory, localDatabase } = fixture();
        const first = localDatabase.initialize();
        localDatabase.close();

        const reopened = new LocalDatabase({
            databasePath: path.join(root, "komocontrol.sqlite"),
            migrationsDirectory,
            backupDirectory: path.join(root, "backups"),
        });
        openDatabases.push(reopened);
        const second = reopened.initialize();
        const db = new DatabaseSync(reopened.databasePath, { readOnly: true });

        expect(second.deviceIdentity).toEqual(first.deviceIdentity);
        expect(db.prepare("SELECT COUNT(*) AS count FROM device_identity").get().count).toBe(1);
        expect(db.prepare("SELECT COUNT(*) AS count FROM local_schema_migrations").get().count).toBe(1);
        db.close();
    });

    it("creates and independently verifies an online backup with the same device identity", async () => {
        const { localDatabase } = fixture();
        const source = localDatabase.initialize();
        const result = await localDatabase.createConsistentBackup();
        const backupDb = new DatabaseSync(result.backupPath, { readOnly: true });

        expect(result.quickCheck).toBe("ok");
        expect(result.foreignKeyExceptions).toBe(0);
        expect(result.schemaVersion).toBe("0001_initial.sql");
        expect(result.deviceIdentity).toEqual(source.deviceIdentity);
        expect(backupDb.prepare("PRAGMA quick_check").get().quick_check).toBe("ok");
        expect(backupDb.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
        backupDb.close();
    });

    it("refuses an already-applied migration whose source checksum changed", () => {
        const { migrationsDirectory, localDatabase } = fixture();
        localDatabase.initialize();
        localDatabase.close();
        fs.appendFileSync(path.join(migrationsDirectory, "0001_initial.sql"), "\n-- tampered\n");

        expect(() => localDatabase.initialize()).toThrow(/checksum mismatch/i);
    });

    it("refuses an unknown newer migration recorded in the local ledger", () => {
        const { localDatabase } = fixture();
        localDatabase.initialize();
        localDatabase.close();
        const db = new DatabaseSync(localDatabase.databasePath);
        db.prepare(
            "INSERT INTO local_schema_migrations (migration_id, applied_at_utc, checksum) VALUES (?, ?, ?)",
        ).run("9999_future.sql", new Date().toISOString(), "0".repeat(64));
        db.close();

        expect(() => localDatabase.initialize()).toThrow(/newer or unknown/i);
    });
});
