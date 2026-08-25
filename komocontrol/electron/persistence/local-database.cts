import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const BUSY_TIMEOUT_MS = 5_000;

interface LocalDatabaseOptions {
    databasePath: string;
    migrationsDirectory: string;
    backupDirectory: string;
}

interface MigrationFile {
    migrationId: string;
    sql: string;
    checksum: string;
}

interface AppliedMigration {
    migrationId: string;
    appliedAtUtc: string;
    checksum: string;
}

export interface DeviceIdentity {
    deviceId: string;
    createdAtUtc: string;
}

export interface LocalDatabaseStatus {
    ready: true;
    schemaVersion: string;
    deviceIdentity: DeviceIdentity;
}

export interface LocalIntegrityResult {
    quickCheck: "ok";
    foreignKeyExceptions: 0;
}

export interface LocalDurabilityStatus {
    foreignKeys: number;
    journalMode: string;
    synchronous: number;
    busyTimeout: number;
}

export interface LocalBackupResult extends LocalIntegrityResult {
    backupPath: string;
    schemaVersion: string;
    deviceIdentity: DeviceIdentity;
}

function objectRow(value: unknown, context: string): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`Invalid SQLite row for ${context}.`);
    }

    return value as Record<string, unknown>;
}

function stringField(row: Record<string, unknown>, field: string, context: string): string {
    const value = row[field];
    if (typeof value !== "string" || value.length === 0) {
        throw new Error(`Invalid ${field} in ${context}.`);
    }

    return value;
}

function numberField(row: Record<string, unknown>, field: string, context: string): number {
    const value = row[field];
    if (typeof value !== "number") {
        throw new Error(`Invalid ${field} in ${context}.`);
    }

    return value;
}

function migrationChecksum(contents: Buffer): string {
    return createHash("sha256").update(contents).digest("hex");
}

function readMigrationFiles(directory: string): MigrationFile[] {
    const names = fs.readdirSync(directory)
        .filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name))
        .sort((left, right) => left.localeCompare(right));

    if (names.length === 0) {
        throw new Error("No local database migrations were found.");
    }

    return names.map((migrationId) => {
        const contents = fs.readFileSync(path.join(directory, migrationId));
        return {
            migrationId,
            sql: contents.toString("utf8"),
            checksum: migrationChecksum(contents),
        };
    });
}

function tableExists(database: DatabaseSync, tableName: string): boolean {
    const row = database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    ).get(tableName);
    return row !== undefined;
}

function readAppliedMigrations(database: DatabaseSync): AppliedMigration[] {
    if (!tableExists(database, "local_schema_migrations")) {
        return [];
    }

    return database.prepare(
        "SELECT migration_id, applied_at_utc, checksum FROM local_schema_migrations ORDER BY migration_id",
    ).all().map((value) => {
        const row = objectRow(value, "local_schema_migrations");
        return {
            migrationId: stringField(row, "migration_id", "local_schema_migrations"),
            appliedAtUtc: stringField(row, "applied_at_utc", "local_schema_migrations"),
            checksum: stringField(row, "checksum", "local_schema_migrations"),
        };
    });
}

function applyMigrations(database: DatabaseSync, migrationsDirectory: string): AppliedMigration[] {
    const knownMigrations = readMigrationFiles(migrationsDirectory);
    const knownById = new Map(knownMigrations.map((migration) => [migration.migrationId, migration]));
    const applied = readAppliedMigrations(database);

    for (const migration of applied) {
        const known = knownById.get(migration.migrationId);
        if (!known) {
            throw new Error(`Local database migration ${migration.migrationId} is newer or unknown to this app.`);
        }
        if (known.checksum !== migration.checksum) {
            throw new Error(`Local database migration checksum mismatch: ${migration.migrationId}.`);
        }
    }

    const appliedIds = new Set(applied.map((migration) => migration.migrationId));
    for (const migration of knownMigrations) {
        if (appliedIds.has(migration.migrationId)) {
            continue;
        }

        database.exec("BEGIN IMMEDIATE");
        try {
            database.exec(migration.sql);
            database.prepare(
                "INSERT INTO local_schema_migrations (migration_id, applied_at_utc, checksum) VALUES (?, ?, ?)",
            ).run(migration.migrationId, new Date().toISOString(), migration.checksum);
            database.exec("COMMIT");
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    }

    return readAppliedMigrations(database);
}

function configureDatabase(database: DatabaseSync): void {
    database.exec("PRAGMA foreign_keys = ON");
    const journalRow = objectRow(database.prepare("PRAGMA journal_mode = WAL").get(), "journal_mode");
    database.exec("PRAGMA synchronous = FULL");
    database.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);

    const foreignKeys = numberField(
        objectRow(database.prepare("PRAGMA foreign_keys").get(), "foreign_keys"),
        "foreign_keys",
        "foreign_keys",
    );
    const journalMode = stringField(journalRow, "journal_mode", "journal_mode").toLowerCase();
    const synchronous = numberField(
        objectRow(database.prepare("PRAGMA synchronous").get(), "synchronous"),
        "synchronous",
        "synchronous",
    );
    const busyTimeout = numberField(
        objectRow(database.prepare("PRAGMA busy_timeout").get(), "busy_timeout"),
        "timeout",
        "busy_timeout",
    );

    if (foreignKeys !== 1 || journalMode !== "wal" || synchronous !== 2 || busyTimeout !== BUSY_TIMEOUT_MS) {
        throw new Error("Required SQLite durability settings could not be established.");
    }
}

function runIntegrityCheck(database: DatabaseSync): LocalIntegrityResult {
    const quickRows = database.prepare("PRAGMA quick_check").all();
    if (quickRows.length !== 1) {
        throw new Error("SQLite quick_check returned an unexpected result.");
    }

    const quickCheck = stringField(objectRow(quickRows[0], "quick_check"), "quick_check", "quick_check");
    if (quickCheck !== "ok") {
        throw new Error(`SQLite quick_check failed: ${quickCheck}.`);
    }

    const foreignKeyRows = database.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyRows.length !== 0) {
        throw new Error(`SQLite foreign_key_check found ${foreignKeyRows.length} exception(s).`);
    }

    return { quickCheck: "ok", foreignKeyExceptions: 0 };
}

function readDeviceIdentity(database: DatabaseSync): DeviceIdentity | null {
    const value = database.prepare(
        "SELECT device_id, created_at_utc FROM device_identity WHERE singleton_key = 1",
    ).get();
    if (value === undefined) {
        return null;
    }

    const row = objectRow(value, "device_identity");
    return {
        deviceId: stringField(row, "device_id", "device_identity"),
        createdAtUtc: stringField(row, "created_at_utc", "device_identity"),
    };
}

function loadOrCreateDeviceIdentity(database: DatabaseSync): DeviceIdentity {
    const existing = readDeviceIdentity(database);
    if (existing) {
        return existing;
    }

    database.exec("BEGIN IMMEDIATE");
    try {
        database.prepare(
            "INSERT INTO device_identity (singleton_key, device_id, created_at_utc) VALUES (1, ?, ?)",
        ).run(randomUUID(), new Date().toISOString());
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }

    const created = readDeviceIdentity(database);
    if (!created) {
        throw new Error("Local device identity was not created.");
    }
    return created;
}

function verifyExpectedSchema(database: DatabaseSync): void {
    for (const tableName of ["local_schema_migrations", "device_identity"]) {
        if (!tableExists(database, tableName)) {
            throw new Error(`Required local table is missing: ${tableName}.`);
        }
    }
}

export class LocalDatabase {
    readonly databasePath: string;
    readonly backupDirectory: string;
    private readonly migrationsDirectory: string;
    private database: DatabaseSync | null = null;
    private status: LocalDatabaseStatus | null = null;

    constructor(options: LocalDatabaseOptions) {
        this.databasePath = options.databasePath;
        this.migrationsDirectory = options.migrationsDirectory;
        this.backupDirectory = options.backupDirectory;
    }

    initialize(): LocalDatabaseStatus {
        if (this.status) {
            return this.status;
        }

        fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
        fs.mkdirSync(this.backupDirectory, { recursive: true });

        const database = new DatabaseSync(this.databasePath);
        this.database = database;

        try {
            configureDatabase(database);
            const migrations = applyMigrations(database, this.migrationsDirectory);
            verifyExpectedSchema(database);
            runIntegrityCheck(database);
            const deviceIdentity = loadOrCreateDeviceIdentity(database);
            const schemaVersion = migrations.at(-1)?.migrationId;
            if (!schemaVersion) {
                throw new Error("Local database schema version is unavailable.");
            }

            this.status = { ready: true, schemaVersion, deviceIdentity };
            return this.status;
        } catch (error) {
            this.close();
            throw error;
        }
    }

    getDeviceIdentity(): DeviceIdentity {
        return this.requireStatus().deviceIdentity;
    }

    getSafeStatus(): { ready: true; schemaVersion: string; deviceIdSuffix: string } {
        const status = this.requireStatus();
        return {
            ready: true,
            schemaVersion: status.schemaVersion,
            deviceIdSuffix: status.deviceIdentity.deviceId.slice(-8),
        };
    }

    runIntegrityCheck(): LocalIntegrityResult {
        return runIntegrityCheck(this.requireDatabase());
    }

    getDurabilityStatus(): LocalDurabilityStatus {
        const database = this.requireDatabase();
        return {
            foreignKeys: numberField(
                objectRow(database.prepare("PRAGMA foreign_keys").get(), "foreign_keys"),
                "foreign_keys",
                "foreign_keys",
            ),
            journalMode: stringField(
                objectRow(database.prepare("PRAGMA journal_mode").get(), "journal_mode"),
                "journal_mode",
                "journal_mode",
            ).toLowerCase(),
            synchronous: numberField(
                objectRow(database.prepare("PRAGMA synchronous").get(), "synchronous"),
                "synchronous",
                "synchronous",
            ),
            busyTimeout: numberField(
                objectRow(database.prepare("PRAGMA busy_timeout").get(), "busy_timeout"),
                "timeout",
                "busy_timeout",
            ),
        };
    }

    async createConsistentBackup(): Promise<LocalBackupResult> {
        const database = this.requireDatabase();
        const status = this.requireStatus();
        fs.mkdirSync(this.backupDirectory, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = path.join(this.backupDirectory, `komocontrol-${timestamp}.sqlite`);

        await backup(database, backupPath);

        const backupDatabase = new DatabaseSync(backupPath, { readOnly: true });
        try {
            backupDatabase.exec("PRAGMA foreign_keys = ON");
            const integrity = runIntegrityCheck(backupDatabase);
            const migrations = readAppliedMigrations(backupDatabase);
            const deviceIdentity = readDeviceIdentity(backupDatabase);
            const schemaVersion = migrations.at(-1)?.migrationId;
            if (!schemaVersion || !deviceIdentity) {
                throw new Error("Consistent backup is missing required local metadata.");
            }
            if (deviceIdentity.deviceId !== status.deviceIdentity.deviceId) {
                throw new Error("Consistent backup device identity does not match its source.");
            }

            return { backupPath, schemaVersion, deviceIdentity, ...integrity };
        } finally {
            backupDatabase.close();
        }
    }

    close(): void {
        this.status = null;
        if (this.database) {
            this.database.close();
            this.database = null;
        }
    }

    private requireDatabase(): DatabaseSync {
        if (!this.database) {
            throw new Error("Local database is not initialized.");
        }
        return this.database;
    }

    private requireStatus(): LocalDatabaseStatus {
        if (!this.status) {
            throw new Error("Local database is not initialized.");
        }
        return this.status;
    }
}
