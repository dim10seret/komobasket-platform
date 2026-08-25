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

export interface VerifiedGamePackageInput {
    packageId: string;
    gameId: string;
    packageVersion: number;
    packageSchemaVersion: 1;
    payloadJson: string;
    payloadHash: string;
    publishedAtUtc: string | null;
}

export interface LocalGamePackageStatus {
    gameId: string;
    availableOffline: boolean;
    currentVersion: number | null;
    downloadedAt: string | null;
}

export interface LocalGamePackageStoreResult {
    outcome: "stored" | "unchanged";
    status: LocalGamePackageStatus;
}

export interface StoredLocalGamePackage {
    packageId: string;
    gameId: string;
    packageVersion: number;
    packageSchemaVersion: number;
    payloadJson: string;
    payloadHash: string;
    publishedAtUtc: string | null;
    downloadedAtUtc: string;
}

export interface CreateLocalGameRunInput {
    runId: string;
    runSchemaVersion: 1;
    gameId: string;
    packageId: string;
    packageVersion: number;
    packageSchemaVersion: 1;
    packageHash: string;
    organizationId: string;
    scorerId: string;
    deviceId: string;
    setupSnapshotJson: string;
}

export interface StoredLocalGameRun extends CreateLocalGameRunInput {
    status: "active" | "finalized" | "abandoned";
    lastAcceptedSequence: number;
    startedAtUtc: string | null;
    createdAtUtc: string;
    updatedAtUtc: string;
}

export interface LocalGameRunStoreResult {
    outcome: "created" | "existing";
    run: StoredLocalGameRun;
}

export class LocalGameRunConflictError extends Error {
    constructor(readonly kind: "ownership" | "state") {
        super(kind === "ownership" ? "Local active Game Run ownership conflict." : "Local active Game Run state conflict.");
        this.name = "LocalGameRunConflictError";
    }
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
    for (const tableName of ["local_schema_migrations", "device_identity", "local_game_packages", "local_game_runs"]) {
        if (!tableExists(database, tableName)) {
            throw new Error(`Required local table is missing: ${tableName}.`);
        }
    }
}

function storedGamePackage(value: unknown): StoredLocalGamePackage {
    const row = objectRow(value, "local_game_packages");
    const publishedAtUtc = row.published_at_utc;
    if (publishedAtUtc !== null && typeof publishedAtUtc !== "string") throw new Error("Invalid published_at_utc in local_game_packages.");
    return {
        packageId: stringField(row, "package_id", "local_game_packages"),
        gameId: stringField(row, "game_id", "local_game_packages"),
        packageVersion: numberField(row, "package_version", "local_game_packages"),
        packageSchemaVersion: numberField(row, "package_schema_version", "local_game_packages"),
        payloadJson: stringField(row, "payload_json", "local_game_packages"),
        payloadHash: stringField(row, "payload_hash", "local_game_packages"),
        publishedAtUtc,
        downloadedAtUtc: stringField(row, "downloaded_at_utc", "local_game_packages"),
    };
}

function storedGameRun(value: unknown): StoredLocalGameRun {
    const row = objectRow(value, "local_game_runs");
    const startedAtUtc = row.started_at_utc;
    if (startedAtUtc !== null && typeof startedAtUtc !== "string") throw new Error("Invalid started_at_utc in local_game_runs.");
    const status = stringField(row, "status", "local_game_runs");
    if (status !== "active" && status !== "finalized" && status !== "abandoned") throw new Error("Invalid status in local_game_runs.");
    return {
        runId: stringField(row, "run_id", "local_game_runs"),
        runSchemaVersion: numberField(row, "run_schema_version", "local_game_runs") as 1,
        gameId: stringField(row, "game_id", "local_game_runs"),
        packageId: stringField(row, "package_id", "local_game_runs"),
        packageVersion: numberField(row, "package_version", "local_game_runs"),
        packageSchemaVersion: numberField(row, "package_schema_version", "local_game_runs") as 1,
        packageHash: stringField(row, "package_hash", "local_game_runs"),
        organizationId: stringField(row, "organization_id", "local_game_runs"),
        scorerId: stringField(row, "scorer_id", "local_game_runs"),
        deviceId: stringField(row, "device_id", "local_game_runs"),
        status,
        setupSnapshotJson: stringField(row, "setup_snapshot_json", "local_game_runs"),
        lastAcceptedSequence: numberField(row, "last_accepted_sequence", "local_game_runs"),
        startedAtUtc,
        createdAtUtc: stringField(row, "created_at_utc", "local_game_runs"),
        updatedAtUtc: stringField(row, "updated_at_utc", "local_game_runs"),
    };
}

function verifiedGamePackage(input: VerifiedGamePackageInput): VerifiedGamePackageInput {
    if (!input.packageId.trim() || !input.gameId.trim()) throw new Error("Verified GamePackage identity is invalid.");
    if (!Number.isInteger(input.packageVersion) || input.packageVersion < 1 || input.packageSchemaVersion !== 1) throw new Error("Verified GamePackage version is unsupported.");
    if (!input.payloadJson.trim() || !/^[0-9a-f]{64}$/.test(input.payloadHash)) throw new Error("Verified GamePackage payload metadata is invalid.");
    if (input.publishedAtUtc !== null && !input.publishedAtUtc.trim()) throw new Error("Verified GamePackage publication time is invalid.");
    let payload: unknown;
    try { payload = JSON.parse(input.payloadJson); } catch { throw new Error("Verified GamePackage payload is malformed."); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Verified GamePackage payload is malformed.");
    const root = payload as Record<string, unknown>;
    const game = root.game;
    if (root.schemaVersion !== 1 || !game || typeof game !== "object" || Array.isArray(game) || (game as Record<string, unknown>).id !== input.gameId) throw new Error("Verified GamePackage payload identity is invalid.");
    return input;
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

    getCurrentGamePackageStatus(gameId: string): LocalGamePackageStatus {
        if (!gameId.trim()) throw new Error("Game identity is required.");
        const row = this.requireDatabase().prepare(
            "SELECT package_version, downloaded_at_utc FROM local_game_packages WHERE game_id = ? AND is_current = 1",
        ).get(gameId) as { package_version: number; downloaded_at_utc: string } | undefined;
        return row
            ? { gameId, availableOffline: true, currentVersion: row.package_version, downloadedAt: row.downloaded_at_utc }
            : { gameId, availableOffline: false, currentVersion: null, downloadedAt: null };
    }

    readCurrentGamePackage(gameId: string): StoredLocalGamePackage | null {
        if (!gameId.trim()) throw new Error("Game identity is required.");
        const value = this.requireDatabase().prepare(`SELECT package_id, game_id, package_version,
            package_schema_version, payload_json, payload_hash, published_at_utc, downloaded_at_utc
            FROM local_game_packages WHERE game_id = ? AND is_current = 1`).get(gameId);
        if (value === undefined) return null;
        return storedGamePackage(value);
    }

    readGamePackage(packageId: string): StoredLocalGamePackage | null {
        if (!packageId.trim()) throw new Error("Package identity is required.");
        const value = this.requireDatabase().prepare(`SELECT package_id, game_id, package_version,
            package_schema_version, payload_json, payload_hash, published_at_utc, downloaded_at_utc
            FROM local_game_packages WHERE package_id = ?`).get(packageId);
        return value === undefined ? null : storedGamePackage(value);
    }

    getActiveLocalGameRun(gameId: string): StoredLocalGameRun | null {
        if (!gameId.trim()) throw new Error("Game identity is required.");
        const value = this.requireDatabase().prepare("SELECT * FROM local_game_runs WHERE game_id = ? AND status = 'active'").get(gameId);
        return value === undefined ? null : storedGameRun(value);
    }

    createOrOpenLocalGameRun(input: CreateLocalGameRunInput): LocalGameRunStoreResult {
        if (!input.runId.trim() || !input.gameId.trim() || !input.packageId.trim() || !input.organizationId.trim() || !input.scorerId.trim() || !input.deviceId.trim()) throw new Error("Local Game Run identity is invalid.");
        if (input.runSchemaVersion !== 1 || input.packageSchemaVersion !== 1 || !Number.isInteger(input.packageVersion) || input.packageVersion < 1) throw new Error("Local Game Run version is invalid.");
        if (!/^[0-9a-f]{64}$/.test(input.packageHash) || !input.setupSnapshotJson.trim()) throw new Error("Local Game Run snapshot is invalid.");
        try { JSON.parse(input.setupSnapshotJson); } catch { throw new Error("Local Game Run snapshot is malformed."); }
        const database = this.requireDatabase();
        database.exec("BEGIN IMMEDIATE");
        try {
            const pinnedPackage = database.prepare(`SELECT package_id FROM local_game_packages
                WHERE package_id=? AND game_id=? AND package_version=? AND package_schema_version=? AND payload_hash=? AND is_current=1`)
                .get(input.packageId, input.gameId, input.packageVersion, input.packageSchemaVersion, input.packageHash);
            if (pinnedPackage === undefined) throw new LocalGameRunConflictError("state");
            const existingValue = database.prepare("SELECT * FROM local_game_runs WHERE game_id=? AND status='active'").get(input.gameId);
            if (existingValue !== undefined) {
                const existing = storedGameRun(existingValue);
                const sameOwner = existing.organizationId === input.organizationId && existing.scorerId === input.scorerId && existing.deviceId === input.deviceId;
                if (!sameOwner) throw new LocalGameRunConflictError("ownership");
                const sameState = existing.runSchemaVersion === input.runSchemaVersion && existing.packageId === input.packageId && existing.packageVersion === input.packageVersion && existing.packageSchemaVersion === input.packageSchemaVersion && existing.packageHash === input.packageHash && existing.setupSnapshotJson === input.setupSnapshotJson;
                if (!sameState) throw new LocalGameRunConflictError("state");
                database.exec("COMMIT");
                return { outcome: "existing", run: existing };
            }
            const timestamp = new Date().toISOString();
            database.prepare(`INSERT INTO local_game_runs
                (run_id, run_schema_version, game_id, package_id, package_version, package_schema_version, package_hash, organization_id, scorer_id, device_id, status, setup_snapshot_json, last_accepted_sequence, started_at_utc, created_at_utc, updated_at_utc)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, NULL, ?, ?)`)
                .run(input.runId, input.runSchemaVersion, input.gameId, input.packageId, input.packageVersion, input.packageSchemaVersion, input.packageHash, input.organizationId, input.scorerId, input.deviceId, input.setupSnapshotJson, timestamp, timestamp);
            const createdValue = database.prepare("SELECT * FROM local_game_runs WHERE run_id=?").get(input.runId);
            if (createdValue === undefined) throw new Error("Local Game Run was not created.");
            const created = storedGameRun(createdValue);
            database.exec("COMMIT");
            return { outcome: "created", run: created };
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    }

    storeVerifiedGamePackage(value: VerifiedGamePackageInput): LocalGamePackageStoreResult {
        const input = verifiedGamePackage(value);
        const database = this.requireDatabase();
        const current = database.prepare(`SELECT package_id, game_id, package_version, package_schema_version,
            payload_json, payload_hash, published_at_utc, downloaded_at_utc
            FROM local_game_packages WHERE game_id = ? AND is_current = 1`).get(input.gameId) as Record<string, unknown> | undefined;
        const packageCount = Number((database.prepare("SELECT COUNT(*) AS count FROM local_game_packages WHERE game_id = ?").get(input.gameId) as { count: number }).count);
        if (!current && packageCount > 0) throw new Error("Local GamePackage current-version state is invalid.");
        if (current) {
            const currentVersion = Number(current.package_version);
            if (input.packageVersion < currentVersion) throw new Error("Local GamePackage downgrade conflict.");
            if (input.packageVersion === currentVersion) {
                const unchanged = current.package_id === input.packageId
                    && current.game_id === input.gameId
                    && Number(current.package_schema_version) === input.packageSchemaVersion
                    && current.payload_json === input.payloadJson
                    && current.payload_hash === input.payloadHash
                    && current.published_at_utc === input.publishedAtUtc;
                if (!unchanged) throw new Error("Local GamePackage same-version integrity conflict.");
                return { outcome: "unchanged", status: this.getCurrentGamePackageStatus(input.gameId) };
            }
        }

        const downloadedAtUtc = new Date().toISOString();
        database.exec("BEGIN IMMEDIATE");
        try {
            database.prepare(`INSERT INTO local_game_packages
                (package_id, game_id, package_version, package_schema_version, payload_json, payload_hash, published_at_utc, downloaded_at_utc, is_current)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
                .run(input.packageId, input.gameId, input.packageVersion, input.packageSchemaVersion, input.payloadJson, input.payloadHash, input.publishedAtUtc, downloadedAtUtc, current ? 0 : 1);
            if (current) {
                database.prepare("UPDATE local_game_packages SET is_current = 0 WHERE game_id = ? AND is_current = 1").run(input.gameId);
                database.prepare("UPDATE local_game_packages SET is_current = 1 WHERE package_id = ?").run(input.packageId);
            }
            database.exec("COMMIT");
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
        return { outcome: "stored", status: this.getCurrentGamePackageStatus(input.gameId) };
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
