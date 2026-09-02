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

export interface CreateLocalGameRunConfigurationInput {
    runId: string;
    organizationId: string;
    scorerId: string;
    deviceId: string;
    configurationSchemaVersion: 1;
    configurationJson: string;
    configurationHash: string;
}

export interface SaveLocalGameRunConfigurationInput {
    runId: string;
    organizationId: string;
    scorerId: string;
    deviceId: string;
    expectedRevision: number;
    configurationJson: string;
    configurationHash: string;
}

export interface SaveLiveLocalGameRunConfigurationInput extends SaveLocalGameRunConfigurationInput {
    expectedHistoryRevision: number;
    expectedLastAcceptedSequence: number;
    events: LocalMatchEventWrite[];
    updatedAtUtc: string;
}

export interface StoredLocalGameRunConfiguration {
    runId: string;
    configurationSchemaVersion: 1;
    revision: number;
    status: "draft" | "ready";
    configurationJson: string;
    configurationHash: string;
    readyAtUtc: string | null;
    createdAtUtc: string;
    updatedAtUtc: string;
}

export type LocalGameRunConfigurationStoreResult = {
    outcome: "created" | "existing";
    configuration: StoredLocalGameRunConfiguration;
};

export class LocalGameRunConfigurationConflictError extends Error {
    constructor(readonly kind: "ownership" | "state" | "revision") {
        super(`Local Game Run configuration conflict: ${kind}`);
        this.name = "LocalGameRunConfigurationConflictError";
    }
}

export interface StoredLocalMatchEngineSnapshot {
    runId: string;
    snapshotSchemaVersion: 1;
    matchEventSchemaVersion: 2;
    configurationRevision: number;
    configurationHash: string;
    initialStateJson: string;
    initialStateHash: string;
    eventHistoryRevision: number;
    createdAtUtc: string;
}

export interface LocalMatchEventWrite {
    eventId: string;
    sequence: number;
    eventSchemaVersion: 2;
    eventJson: string;
    eventHash: string;
    persistedAtUtc: string;
}

export interface StoredLocalMatchEvent extends LocalMatchEventWrite {
    runId: string;
}

export interface InitializeLocalMatchGameplayInput {
    runId: string;
    organizationId: string;
    scorerId: string;
    deviceId: string;
    configurationRevision: number;
    configurationHash: string;
    snapshotSchemaVersion: 1;
    matchEventSchemaVersion: 2;
    initialStateJson: string;
    initialStateHash: string;
    initialEvent: LocalMatchEventWrite;
    encryptedLiveAuthorization: string;
    startedAtUtc: string;
}

export interface RewriteLocalMatchEventHistoryInput {
    runId: string;
    organizationId: string;
    scorerId: string;
    deviceId: string;
    expectedHistoryRevision: number;
    lastAcceptedSequence: number;
    events: LocalMatchEventWrite[];
    updatedAtUtc: string;
    clearResumableFlow?: boolean;
    sequencePolicy?: "PRESERVE_HIGH_WATER" | "DENSE_RENUMBERED";
}

export interface AppendLocalMatchEventInput {
    runId: string;
    organizationId: string;
    scorerId: string;
    deviceId: string;
    expectedHistoryRevision: number;
    expectedLastAcceptedSequence: number;
    event: LocalMatchEventWrite;
    updatedAtUtc: string;
    clearResumableFlow?: boolean;
}

export interface AppendLocalMatchEventsInput {
    runId: string;
    organizationId: string;
    scorerId: string;
    deviceId: string;
    expectedHistoryRevision: number;
    expectedLastAcceptedSequence: number;
    events: LocalMatchEventWrite[];
    updatedAtUtc: string;
    clearResumableFlow?: boolean;
}

export interface StoredLocalResumableLiveFlow {
    runId: string;
    flowSchemaVersion: 1;
    flowKind: "SHOOTING_FOUL";
    stage: "PENALTY";
    rootEventId: string;
    sourceFoulEventId: string;
    selectedFreeThrowShooterId: string;
    eventHistoryRevision: number;
    stateJson: string;
    stateHash: string;
    createdAtUtc: string;
    updatedAtUtc: string;
}

export interface SaveLocalResumableLiveFlowInput {
    runId: string; organizationId: string; scorerId: string; deviceId: string;
    expectedHistoryRevision: number;
    flowKind: "SHOOTING_FOUL"; stage: "PENALTY";
    rootEventId: string; sourceFoulEventId: string; selectedFreeThrowShooterId: string;
    stateJson: string; stateHash: string; updatedAtUtc: string;
}

export interface StoredLocalLiveRunAuthorization {
    runId: string;
    authorizationSchemaVersion: 1;
    encryptedAuthorization: string;
    suspended: boolean;
    createdAtUtc: string;
    updatedAtUtc: string;
}

export interface StoredLocalGameplaySyncState {
    runId: string;
    syncSchemaVersion: 1;
    lastAcknowledgedHistoryRevision: number;
    lastAcknowledgedHistoryHash: string | null;
    lastAcknowledgedFinalizationHash: string | null;
    lastAttemptedRevision: number | null;
    lastAttemptAtUtc: string | null;
    lastSuccessAtUtc: string | null;
    lastErrorCode: string | null;
    consecutiveFailures: number;
    nextRetryAtUtc: string | null;
    updatedAtUtc: string;
}

export interface StoredLocalMatchFinalization {
    runId: string;
    finalizationSchemaVersion: 1;
    finalizedHistoryRevision: number;
    finalizedHistoryHash: string;
    finalStateJson: string;
    finalStateHash: string;
    finalizationJson: string;
    finalizationHash: string;
    finalizedAtUtc: string;
}

export interface FinalizeLocalMatchGameplayInput extends RewriteLocalMatchEventHistoryInput {
    finalizedHistoryHash: string;
    finalStateJson: string;
    finalStateHash: string;
    finalizationJson: string;
    finalizationHash: string;
    finalizedAtUtc: string;
}

export interface AcknowledgeGameplaySyncInput {
    runId: string;
    historyRevision: number;
    historyHash: string;
    configurationRevision: number;
    configurationHash: string;
    finalizationHash: string | null;
    succeededAtUtc: string;
}

export class LocalMatchGameplayConflictError extends Error {
    constructor(readonly kind: "ownership" | "state" | "revision") {
        super(`Local Match gameplay conflict: ${kind}`);
        this.name = "LocalMatchGameplayConflictError";
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

function nullableStringField(row: Record<string, unknown>, field: string, context: string): string | null {
    const value = row[field];
    if (value === null) return null;
    if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${field} in ${context}.`);
    return value;
}

function nullableNumberField(row: Record<string, unknown>, field: string, context: string): number | null {
    const value = row[field];
    if (value === null) return null;
    if (typeof value !== "number") throw new Error(`Invalid ${field} in ${context}.`);
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
    for (const tableName of ["local_schema_migrations", "device_identity", "local_game_packages", "local_game_runs", "local_game_run_configurations", "local_match_engine_snapshots", "local_match_events", "local_live_run_authorizations", "local_gameplay_sync_state", "local_match_finalizations", "local_resumable_live_flows"]) {
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

function storedGameRunConfiguration(value: unknown): StoredLocalGameRunConfiguration {
    const row = objectRow(value, "local_game_run_configurations");
    const status = stringField(row, "status", "local_game_run_configurations");
    const readyAtUtc = row.ready_at_utc;
    if (status !== "draft" && status !== "ready") throw new Error("Invalid status in local_game_run_configurations.");
    if (readyAtUtc !== null && typeof readyAtUtc !== "string") throw new Error("Invalid ready_at_utc in local_game_run_configurations.");
    const configurationSchemaVersion = numberField(row, "configuration_schema_version", "local_game_run_configurations");
    if (configurationSchemaVersion !== 1) throw new Error("Unsupported local Game Run configuration schema.");
    return {
        runId: stringField(row, "run_id", "local_game_run_configurations"),
        configurationSchemaVersion: 1,
        revision: numberField(row, "revision", "local_game_run_configurations"),
        status,
        configurationJson: stringField(row, "configuration_json", "local_game_run_configurations"),
        configurationHash: stringField(row, "configuration_hash", "local_game_run_configurations"),
        readyAtUtc,
        createdAtUtc: stringField(row, "created_at_utc", "local_game_run_configurations"),
        updatedAtUtc: stringField(row, "updated_at_utc", "local_game_run_configurations"),
    };
}

function storedMatchEngineSnapshot(value: unknown): StoredLocalMatchEngineSnapshot {
    const row = objectRow(value, "local_match_engine_snapshots");
    const snapshotSchemaVersion = numberField(row, "snapshot_schema_version", "local_match_engine_snapshots");
    const matchEventSchemaVersion = numberField(row, "match_event_schema_version", "local_match_engine_snapshots");
    if (snapshotSchemaVersion !== 1 || matchEventSchemaVersion !== 2) throw new Error("Unsupported local Match gameplay schema.");
    return {
        runId: stringField(row, "run_id", "local_match_engine_snapshots"),
        snapshotSchemaVersion: 1,
        matchEventSchemaVersion: 2,
        configurationRevision: numberField(row, "configuration_revision", "local_match_engine_snapshots"),
        configurationHash: stringField(row, "configuration_hash", "local_match_engine_snapshots"),
        initialStateJson: stringField(row, "initial_state_json", "local_match_engine_snapshots"),
        initialStateHash: stringField(row, "initial_state_hash", "local_match_engine_snapshots"),
        eventHistoryRevision: numberField(row, "event_history_revision", "local_match_engine_snapshots"),
        createdAtUtc: stringField(row, "created_at_utc", "local_match_engine_snapshots"),
    };
}

function storedMatchEvent(value: unknown): StoredLocalMatchEvent {
    const row = objectRow(value, "local_match_events");
    const eventSchemaVersion = numberField(row, "event_schema_version", "local_match_events");
    if (eventSchemaVersion !== 2) throw new Error("Unsupported local MatchEvent schema.");
    return {
        runId: stringField(row, "run_id", "local_match_events"),
        eventId: stringField(row, "event_id", "local_match_events"),
        sequence: numberField(row, "sequence", "local_match_events"),
        eventSchemaVersion: 2,
        eventJson: stringField(row, "event_json", "local_match_events"),
        eventHash: stringField(row, "event_hash", "local_match_events"),
        persistedAtUtc: stringField(row, "persisted_at_utc", "local_match_events"),
    };
}

function storedLiveRunAuthorization(value: unknown): StoredLocalLiveRunAuthorization {
    const row = objectRow(value, "local_live_run_authorizations");
    const schemaVersion = numberField(row, "authorization_schema_version", "local_live_run_authorizations");
    const suspended = numberField(row, "suspended", "local_live_run_authorizations");
    if (schemaVersion !== 1 || (suspended !== 0 && suspended !== 1)) throw new Error("Unsupported local Live Run authorization schema.");
    return {
        runId: stringField(row, "run_id", "local_live_run_authorizations"),
        authorizationSchemaVersion: 1,
        encryptedAuthorization: stringField(row, "encrypted_authorization", "local_live_run_authorizations"),
        suspended: suspended === 1,
        createdAtUtc: stringField(row, "created_at_utc", "local_live_run_authorizations"),
        updatedAtUtc: stringField(row, "updated_at_utc", "local_live_run_authorizations"),
    };
}

function storedGameplaySyncState(value: unknown): StoredLocalGameplaySyncState {
    const row = objectRow(value, "local_gameplay_sync_state");
    const schemaVersion = numberField(row, "sync_schema_version", "local_gameplay_sync_state");
    if (schemaVersion !== 1) throw new Error("Unsupported local gameplay sync schema.");
    return {
        runId: stringField(row, "run_id", "local_gameplay_sync_state"),
        syncSchemaVersion: 1,
        lastAcknowledgedHistoryRevision: numberField(row, "last_acknowledged_history_revision", "local_gameplay_sync_state"),
        lastAcknowledgedHistoryHash: nullableStringField(row, "last_acknowledged_history_hash", "local_gameplay_sync_state"),
        lastAcknowledgedFinalizationHash: nullableStringField(row, "last_acknowledged_finalization_hash", "local_gameplay_sync_state"),
        lastAttemptedRevision: nullableNumberField(row, "last_attempted_revision", "local_gameplay_sync_state"),
        lastAttemptAtUtc: nullableStringField(row, "last_attempt_at_utc", "local_gameplay_sync_state"),
        lastSuccessAtUtc: nullableStringField(row, "last_success_at_utc", "local_gameplay_sync_state"),
        lastErrorCode: nullableStringField(row, "last_error_code", "local_gameplay_sync_state"),
        consecutiveFailures: numberField(row, "consecutive_failures", "local_gameplay_sync_state"),
        nextRetryAtUtc: nullableStringField(row, "next_retry_at_utc", "local_gameplay_sync_state"),
        updatedAtUtc: stringField(row, "updated_at_utc", "local_gameplay_sync_state"),
    };
}

function storedMatchFinalization(value: unknown): StoredLocalMatchFinalization {
    const row = objectRow(value, "local_match_finalizations");
    const schemaVersion = numberField(row, "finalization_schema_version", "local_match_finalizations");
    if (schemaVersion !== 1) throw new Error("Unsupported local Match finalization schema.");
    return {
        runId: stringField(row, "run_id", "local_match_finalizations"),
        finalizationSchemaVersion: 1,
        finalizedHistoryRevision: numberField(row, "finalized_history_revision", "local_match_finalizations"),
        finalizedHistoryHash: stringField(row, "finalized_history_hash", "local_match_finalizations"),
        finalStateJson: stringField(row, "final_state_json", "local_match_finalizations"),
        finalStateHash: stringField(row, "final_state_hash", "local_match_finalizations"),
        finalizationJson: stringField(row, "finalization_json", "local_match_finalizations"),
        finalizationHash: stringField(row, "finalization_hash", "local_match_finalizations"),
        finalizedAtUtc: stringField(row, "finalized_at_utc", "local_match_finalizations"),
    };
}

function storedResumableLiveFlow(value: unknown): StoredLocalResumableLiveFlow {
    const row = objectRow(value, "local_resumable_live_flows");
    const flowSchemaVersion = numberField(row, "flow_schema_version", "local_resumable_live_flows");
    const flowKind = stringField(row, "flow_kind", "local_resumable_live_flows");
    const stage = stringField(row, "stage", "local_resumable_live_flows");
    if (flowSchemaVersion !== 1 || flowKind !== "SHOOTING_FOUL" || stage !== "PENALTY") throw new Error("Unsupported resumable Live flow schema.");
    const stateJson = stringField(row, "state_json", "local_resumable_live_flows");
    const stateHash = stringField(row, "state_hash", "local_resumable_live_flows");
    if (!/^[0-9a-f]{64}$/.test(stateHash) || sha256Utf8(stateJson) !== stateHash) throw new Error("Resumable Live flow hash is invalid.");
    const state = parsedObject(stateJson, "local_resumable_live_flows");
    if (state.schemaVersion !== 1 || state.flowKind !== flowKind || state.stage !== stage) throw new Error("Resumable Live flow payload is invalid.");
    return {
        runId: stringField(row, "run_id", "local_resumable_live_flows"), flowSchemaVersion: 1, flowKind: "SHOOTING_FOUL", stage: "PENALTY",
        rootEventId: stringField(row, "root_event_id", "local_resumable_live_flows"), sourceFoulEventId: stringField(row, "source_foul_event_id", "local_resumable_live_flows"),
        selectedFreeThrowShooterId: stringField(row, "selected_free_throw_shooter_id", "local_resumable_live_flows"), eventHistoryRevision: numberField(row, "event_history_revision", "local_resumable_live_flows"),
        stateJson, stateHash, createdAtUtc: stringField(row, "created_at_utc", "local_resumable_live_flows"), updatedAtUtc: stringField(row, "updated_at_utc", "local_resumable_live_flows"),
    };
}

function sha256Utf8(value: string): string {
    return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

function parsedObject(value: string, label: string): Record<string, unknown> {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { throw new Error(`${label} JSON is malformed.`); }
    return objectRow(parsed, label);
}

function validateMatchEventWrite(event: LocalMatchEventWrite): void {
    if (!event.eventId.trim() || !Number.isInteger(event.sequence) || event.sequence < 1 || event.eventSchemaVersion !== 2 || !event.persistedAtUtc.trim()) throw new Error("Local MatchEvent metadata is invalid.");
    if (!/^[0-9a-f]{64}$/.test(event.eventHash) || sha256Utf8(event.eventJson) !== event.eventHash) throw new Error("Local MatchEvent hash is invalid.");
    const payload = parsedObject(event.eventJson, "local_match_events");
    if (payload.schemaVersion !== 2 || payload.id !== event.eventId || payload.sequence !== event.sequence) throw new Error("Local MatchEvent JSON metadata does not match its row.");
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
        const value = this.requireDatabase().prepare("SELECT * FROM local_game_runs WHERE game_id = ? AND status IN ('active', 'finalized') ORDER BY created_at_utc DESC LIMIT 1").get(gameId);
        return value === undefined ? null : storedGameRun(value);
    }

    listActiveLocalGameRunsForOwner(organizationId: string, scorerId: string, deviceId: string): StoredLocalGameRun[] {
        if (!organizationId.trim() || !scorerId.trim() || !deviceId.trim()) throw new Error("Local Game Run owner identity is required.");
        const values = this.requireDatabase().prepare(`SELECT * FROM local_game_runs
            WHERE organization_id = ? AND scorer_id = ? AND device_id = ? AND status IN ('active', 'finalized')
            ORDER BY created_at_utc, run_id`).all(organizationId, scorerId, deviceId);
        return values.map(storedGameRun);
    }

    listMyGamesLocalRunsForOwner(organizationId: string, scorerId: string, deviceId: string): StoredLocalGameRun[] {
        if (!organizationId.trim() || !scorerId.trim() || !deviceId.trim()) throw new Error("Local Game Run owner identity is required.");
        const values = this.requireDatabase().prepare(`SELECT * FROM local_game_runs
            WHERE organization_id = ? AND scorer_id = ? AND device_id = ? AND status IN ('active', 'finalized')
            ORDER BY game_id,
                CASE status WHEN 'active' THEN 0 ELSE 1 END,
                updated_at_utc DESC, created_at_utc DESC, run_id DESC`).all(organizationId, scorerId, deviceId);
        return values.map(storedGameRun);
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

    readLocalGameRunConfiguration(runId: string): StoredLocalGameRunConfiguration | null {
        if (!runId.trim()) throw new Error("Run identity is required.");
        const value = this.requireDatabase().prepare("SELECT * FROM local_game_run_configurations WHERE run_id = ?").get(runId);
        return value === undefined ? null : storedGameRunConfiguration(value);
    }

    createOrOpenLocalGameRunConfiguration(input: CreateLocalGameRunConfigurationInput): LocalGameRunConfigurationStoreResult {
        if (!input.runId.trim() || !input.organizationId.trim() || !input.scorerId.trim() || !input.deviceId.trim()) throw new Error("Local Game Run configuration identity is invalid.");
        if (input.configurationSchemaVersion !== 1 || !input.configurationJson.trim() || !/^[0-9a-f]{64}$/.test(input.configurationHash)) throw new Error("Local Game Run configuration payload is invalid.");
        try { JSON.parse(input.configurationJson); } catch { throw new Error("Local Game Run configuration payload is malformed."); }
        const database = this.requireDatabase();
        database.exec("BEGIN IMMEDIATE");
        try {
            const runValue = database.prepare("SELECT * FROM local_game_runs WHERE run_id = ?").get(input.runId);
            if (runValue === undefined) throw new LocalGameRunConfigurationConflictError("state");
            const run = storedGameRun(runValue);
            if (run.organizationId !== input.organizationId || run.scorerId !== input.scorerId || run.deviceId !== input.deviceId) throw new LocalGameRunConfigurationConflictError("ownership");
            if (run.status !== "active" || run.startedAtUtc !== null || run.lastAcceptedSequence !== 0) throw new LocalGameRunConfigurationConflictError("state");
            const currentValue = database.prepare("SELECT * FROM local_game_run_configurations WHERE run_id = ?").get(input.runId);
            if (currentValue !== undefined) {
                const current = storedGameRunConfiguration(currentValue);
                database.exec("COMMIT");
                return { outcome: "existing", configuration: current };
            }
            const timestamp = new Date().toISOString();
            database.prepare(`INSERT INTO local_game_run_configurations
                (run_id, configuration_schema_version, revision, status, configuration_json, configuration_hash, ready_at_utc, created_at_utc, updated_at_utc)
                VALUES (?, ?, 1, 'draft', ?, ?, NULL, ?, ?)`).run(input.runId, input.configurationSchemaVersion, input.configurationJson, input.configurationHash, timestamp, timestamp);
            const createdValue = database.prepare("SELECT * FROM local_game_run_configurations WHERE run_id = ?").get(input.runId);
            if (createdValue === undefined) throw new Error("Local Game Run configuration was not created.");
            const created = storedGameRunConfiguration(createdValue);
            database.exec("COMMIT");
            return { outcome: "created", configuration: created };
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    }

    saveLocalGameRunConfiguration(input: SaveLocalGameRunConfigurationInput): StoredLocalGameRunConfiguration {
        if (!input.runId.trim() || !input.organizationId.trim() || !input.scorerId.trim() || !input.deviceId.trim()) throw new Error("Local Game Run configuration identity is invalid.");
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || !input.configurationJson.trim() || !/^[0-9a-f]{64}$/.test(input.configurationHash)) throw new Error("Local Game Run configuration save is invalid.");
        try { JSON.parse(input.configurationJson); } catch { throw new Error("Local Game Run configuration payload is malformed."); }
        const database = this.requireDatabase();
        database.exec("BEGIN IMMEDIATE");
        try {
            const runValue = database.prepare("SELECT * FROM local_game_runs WHERE run_id = ?").get(input.runId);
            if (runValue === undefined) throw new LocalGameRunConfigurationConflictError("state");
            const run = storedGameRun(runValue);
            if (run.organizationId !== input.organizationId || run.scorerId !== input.scorerId || run.deviceId !== input.deviceId) throw new LocalGameRunConfigurationConflictError("ownership");
            const preStart = run.startedAtUtc === null && run.lastAcceptedSequence === 0;
            if (run.status !== "active" || !preStart) throw new LocalGameRunConfigurationConflictError("state");
            const currentValue = database.prepare("SELECT * FROM local_game_run_configurations WHERE run_id = ?").get(input.runId);
            if (currentValue === undefined) throw new LocalGameRunConfigurationConflictError("state");
            const current = storedGameRunConfiguration(currentValue);
            if (current.revision !== input.expectedRevision) throw new LocalGameRunConfigurationConflictError("revision");
            const timestamp = new Date().toISOString();
            database.prepare(`UPDATE local_game_run_configurations
                SET revision = revision + 1, status = 'draft', configuration_json = ?, configuration_hash = ?, ready_at_utc = NULL, updated_at_utc = ?
                WHERE run_id = ? AND revision = ?`).run(input.configurationJson, input.configurationHash, timestamp, input.runId, input.expectedRevision);
            const savedValue = database.prepare("SELECT * FROM local_game_run_configurations WHERE run_id = ?").get(input.runId);
            if (savedValue === undefined) throw new Error("Local Game Run configuration was not saved.");
            const saved = storedGameRunConfiguration(savedValue);
            if (saved.revision !== input.expectedRevision + 1) throw new LocalGameRunConfigurationConflictError("revision");
            database.exec("COMMIT");
            return saved;
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    }

    saveLiveLocalGameRunConfiguration(input: SaveLiveLocalGameRunConfigurationInput): StoredLocalGameRunConfiguration {
        if (!input.runId.trim() || !input.organizationId.trim() || !input.scorerId.trim() || !input.deviceId.trim() || !input.updatedAtUtc.trim()) throw new Error("Live Game Run configuration identity is invalid.");
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1
            || !Number.isInteger(input.expectedHistoryRevision) || input.expectedHistoryRevision < 1
            || !Number.isInteger(input.expectedLastAcceptedSequence) || input.expectedLastAcceptedSequence < 1
            || !input.configurationJson.trim() || !/^[0-9a-f]{64}$/.test(input.configurationHash)) {
            throw new Error("Live Game Run configuration save is invalid.");
        }
        try { JSON.parse(input.configurationJson); } catch { throw new Error("Live Game Run configuration payload is malformed."); }
        let expectedSequence = input.expectedLastAcceptedSequence;
        const eventIds = new Set<string>();
        for (const event of input.events) {
            validateMatchEventWrite(event);
            expectedSequence += 1;
            const parsed = parsedObject(event.eventJson, "local_match_events");
            if (event.sequence !== expectedSequence || parsed.type !== "ROSTER_PLAYER_ADDED" || eventIds.has(event.eventId)) {
                throw new Error("Live roster amendment history is invalid.");
            }
            eventIds.add(event.eventId);
        }

        const database = this.requireDatabase();
        database.exec("BEGIN IMMEDIATE");
        try {
            const runValue = database.prepare("SELECT * FROM local_game_runs WHERE run_id = ?").get(input.runId);
            if (runValue === undefined) throw new LocalGameRunConfigurationConflictError("state");
            const run = storedGameRun(runValue);
            if (run.organizationId !== input.organizationId || run.scorerId !== input.scorerId || run.deviceId !== input.deviceId) throw new LocalGameRunConfigurationConflictError("ownership");
            if (run.status !== "active" || run.startedAtUtc === null || run.lastAcceptedSequence !== input.expectedLastAcceptedSequence) throw new LocalGameRunConfigurationConflictError("state");

            const currentValue = database.prepare("SELECT * FROM local_game_run_configurations WHERE run_id = ?").get(input.runId);
            const snapshotValue = database.prepare("SELECT * FROM local_match_engine_snapshots WHERE run_id = ?").get(input.runId);
            if (currentValue === undefined || snapshotValue === undefined) throw new LocalGameRunConfigurationConflictError("state");
            const current = storedGameRunConfiguration(currentValue);
            const snapshot = storedMatchEngineSnapshot(snapshotValue);
            if (current.revision !== input.expectedRevision || snapshot.eventHistoryRevision !== input.expectedHistoryRevision) throw new LocalGameRunConfigurationConflictError("revision");

            const configurationUpdate = database.prepare(`UPDATE local_game_run_configurations
                SET revision = revision + 1, status = 'draft', configuration_json = ?, configuration_hash = ?, ready_at_utc = NULL, updated_at_utc = ?
                WHERE run_id = ? AND revision = ?`)
                .run(input.configurationJson, input.configurationHash, input.updatedAtUtc, input.runId, input.expectedRevision);
            if (Number(configurationUpdate.changes) !== 1) throw new LocalGameRunConfigurationConflictError("revision");

            if (input.events.length > 0) {
                const insert = database.prepare(`INSERT INTO local_match_events
                    (run_id, event_id, sequence, event_schema_version, event_json, event_hash, persisted_at_utc)
                    VALUES (?, ?, ?, 2, ?, ?, ?)`);
                for (const event of input.events) insert.run(input.runId, event.eventId, event.sequence, event.eventJson, event.eventHash, event.persistedAtUtc);
                const snapshotUpdate = database.prepare(`UPDATE local_match_engine_snapshots
                    SET event_history_revision = event_history_revision + 1
                    WHERE run_id = ? AND event_history_revision = ?`).run(input.runId, input.expectedHistoryRevision);
                if (Number(snapshotUpdate.changes) !== 1) throw new LocalGameRunConfigurationConflictError("revision");
                const runUpdate = database.prepare(`UPDATE local_game_runs
                    SET last_accepted_sequence = ?, updated_at_utc = ?
                    WHERE run_id = ? AND last_accepted_sequence = ?`)
                    .run(expectedSequence, input.updatedAtUtc, input.runId, input.expectedLastAcceptedSequence);
                if (Number(runUpdate.changes) !== 1) throw new LocalGameRunConfigurationConflictError("state");
            }

            const syncUpdate = database.prepare(`UPDATE local_gameplay_sync_state
                SET last_error_code = 'SYNC_PENDING_CONFIGURATION', consecutive_failures = 0,
                    next_retry_at_utc = NULL, updated_at_utc = ?
                WHERE run_id = ?`).run(input.updatedAtUtc, input.runId);
            if (Number(syncUpdate.changes) !== 1) throw new LocalGameRunConfigurationConflictError("state");

            const savedValue = database.prepare("SELECT * FROM local_game_run_configurations WHERE run_id = ?").get(input.runId);
            if (savedValue === undefined) throw new Error("Live Game Run configuration was not saved.");
            const saved = storedGameRunConfiguration(savedValue);
            database.exec("COMMIT");
            return saved;
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    }

    readLocalGameRun(runId: string): StoredLocalGameRun | null {
        if (!runId.trim()) throw new Error("Run identity is required.");
        const value = this.requireDatabase().prepare("SELECT * FROM local_game_runs WHERE run_id = ?").get(runId);
        return value === undefined ? null : storedGameRun(value);
    }

    readLocalMatchEngineSnapshot(runId: string): StoredLocalMatchEngineSnapshot | null {
        if (!runId.trim()) throw new Error("Run identity is required.");
        const value = this.requireDatabase().prepare("SELECT * FROM local_match_engine_snapshots WHERE run_id = ?").get(runId);
        return value === undefined ? null : storedMatchEngineSnapshot(value);
    }

    readLocalMatchEvents(runId: string): StoredLocalMatchEvent[] {
        if (!runId.trim()) throw new Error("Run identity is required.");
        return this.requireDatabase().prepare("SELECT * FROM local_match_events WHERE run_id = ? ORDER BY sequence ASC").all(runId).map(storedMatchEvent);
    }

    readLocalLiveRunAuthorization(runId: string): StoredLocalLiveRunAuthorization | null {
        if (!runId.trim()) throw new Error("Run identity is required.");
        const value = this.requireDatabase().prepare("SELECT * FROM local_live_run_authorizations WHERE run_id = ?").get(runId);
        return value === undefined ? null : storedLiveRunAuthorization(value);
    }

    listLocalLiveRunAuthorizations(includeSuspended = false): StoredLocalLiveRunAuthorization[] {
        const sql = includeSuspended
            ? "SELECT * FROM local_live_run_authorizations ORDER BY created_at_utc, run_id"
            : "SELECT * FROM local_live_run_authorizations WHERE suspended = 0 ORDER BY created_at_utc, run_id";
        return this.requireDatabase().prepare(sql).all().map(storedLiveRunAuthorization);
    }

    setLocalLiveRunAuthorizationsSuspended(organizationId: string, scorerId: string, deviceId: string, suspended: boolean, updatedAtUtc: string): number {
        if (!organizationId.trim() || !scorerId.trim() || !deviceId.trim() || !updatedAtUtc.trim()) throw new Error("Live Run authorization owner is invalid.");
        const result = this.requireDatabase().prepare(`UPDATE local_live_run_authorizations
            SET suspended = ?, updated_at_utc = ?
            WHERE run_id IN (
                SELECT run_id FROM local_game_runs
                WHERE organization_id = ? AND scorer_id = ? AND device_id = ?
            )`).run(suspended ? 1 : 0, updatedAtUtc, organizationId, scorerId, deviceId);
        return Number(result.changes);
    }

    readLocalGameplaySyncState(runId: string): StoredLocalGameplaySyncState | null {
        if (!runId.trim()) throw new Error("Run identity is required.");
        const value = this.requireDatabase().prepare("SELECT * FROM local_gameplay_sync_state WHERE run_id = ?").get(runId);
        return value === undefined ? null : storedGameplaySyncState(value);
    }

    readLocalMatchFinalization(runId: string): StoredLocalMatchFinalization | null {
        if (!runId.trim()) throw new Error("Run identity is required.");
        const value = this.requireDatabase().prepare("SELECT * FROM local_match_finalizations WHERE run_id = ?").get(runId);
        return value === undefined ? null : storedMatchFinalization(value);
    }

    readLocalResumableLiveFlow(runId: string): StoredLocalResumableLiveFlow | null {
        if (!runId.trim()) throw new Error("Run identity is required.");
        const value = this.requireDatabase().prepare("SELECT * FROM local_resumable_live_flows WHERE run_id = ?").get(runId);
        return value === undefined ? null : storedResumableLiveFlow(value);
    }

    saveLocalResumableLiveFlow(input: SaveLocalResumableLiveFlowInput): StoredLocalResumableLiveFlow {
        if (!input.runId.trim() || !input.organizationId.trim() || !input.scorerId.trim() || !input.deviceId.trim() || !input.rootEventId.trim() || !input.sourceFoulEventId.trim() || !input.selectedFreeThrowShooterId.trim() || !input.updatedAtUtc.trim()
            || input.flowKind !== "SHOOTING_FOUL" || input.stage !== "PENALTY" || !Number.isInteger(input.expectedHistoryRevision) || input.expectedHistoryRevision < 1
            || !/^[0-9a-f]{64}$/.test(input.stateHash) || sha256Utf8(input.stateJson) !== input.stateHash) throw new Error("Resumable Live flow metadata is invalid.");
        const state = parsedObject(input.stateJson, "local_resumable_live_flows");
        if (state.schemaVersion !== 1 || state.flowKind !== input.flowKind || state.stage !== input.stage || state.rootEventId !== input.rootEventId || state.sourceFoulEventId !== input.sourceFoulEventId || state.selectedFreeThrowShooterId !== input.selectedFreeThrowShooterId) throw new Error("Resumable Live flow state is invalid.");
        const database = this.requireDatabase();
        database.exec("BEGIN IMMEDIATE");
        try {
            const runValue = database.prepare("SELECT * FROM local_game_runs WHERE run_id = ?").get(input.runId);
            const snapshotValue = database.prepare("SELECT * FROM local_match_engine_snapshots WHERE run_id = ?").get(input.runId);
            if (runValue === undefined || snapshotValue === undefined) throw new LocalMatchGameplayConflictError("state");
            const run = storedGameRun(runValue); const snapshot = storedMatchEngineSnapshot(snapshotValue);
            if (run.organizationId !== input.organizationId || run.scorerId !== input.scorerId || run.deviceId !== input.deviceId) throw new LocalMatchGameplayConflictError("ownership");
            if (run.status !== "active" || run.startedAtUtc === null || snapshot.eventHistoryRevision !== input.expectedHistoryRevision) throw new LocalMatchGameplayConflictError("state");
            const rootValue = database.prepare("SELECT * FROM local_match_events WHERE run_id = ? AND event_id = ?").get(input.runId, input.rootEventId);
            const sourceValue = database.prepare("SELECT * FROM local_match_events WHERE run_id = ? AND event_id = ?").get(input.runId, input.sourceFoulEventId);
            if (rootValue === undefined || sourceValue === undefined) throw new LocalMatchGameplayConflictError("state");
            const root = parsedObject(storedMatchEvent(rootValue).eventJson, "local_match_events");
            const source = parsedObject(storedMatchEvent(sourceValue).eventJson, "local_match_events");
            if (!(root.type === "TWO_POINT" || root.type === "TWO_POINT_MISSED" || root.type === "THREE_POINT" || root.type === "THREE_POINT_MISSED")
                || !(source.type === "PERSONAL_FOUL" || source.type === "TECHNICAL_FOUL" || source.type === "DISRUPTIVE_FOUL" || source.type === "FLAGRANT_FOUL" || source.type === "DISQUALIFYING_FOUL")
                || source.relatedShotEventId !== input.rootEventId) throw new LocalMatchGameplayConflictError("state");
            database.prepare(`INSERT INTO local_resumable_live_flows
                (run_id, flow_schema_version, flow_kind, stage, root_event_id, source_foul_event_id, selected_free_throw_shooter_id, event_history_revision, state_json, state_hash, created_at_utc, updated_at_utc)
                VALUES (?, 1, 'SHOOTING_FOUL', 'PENALTY', ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(run_id) DO UPDATE SET root_event_id=excluded.root_event_id, source_foul_event_id=excluded.source_foul_event_id,
                selected_free_throw_shooter_id=excluded.selected_free_throw_shooter_id, event_history_revision=excluded.event_history_revision,
                state_json=excluded.state_json, state_hash=excluded.state_hash, updated_at_utc=excluded.updated_at_utc`)
                .run(input.runId, input.rootEventId, input.sourceFoulEventId, input.selectedFreeThrowShooterId, input.expectedHistoryRevision, input.stateJson, input.stateHash, input.updatedAtUtc, input.updatedAtUtc);
            const saved = this.readLocalResumableLiveFlow(input.runId); if (!saved) throw new Error("Resumable Live flow was not stored.");
            database.exec("COMMIT"); return saved;
        } catch (error) { database.exec("ROLLBACK"); throw error; }
    }

    listPendingGameplaySyncRunIds(organizationId: string, scorerId: string): string[] {
        if (!organizationId.trim() || !scorerId.trim()) throw new Error("Gameplay sync owner is invalid.");
        return this.requireDatabase().prepare(`SELECT r.run_id
            FROM local_game_runs r
            JOIN local_match_engine_snapshots s ON s.run_id = r.run_id
            JOIN local_gameplay_sync_state y ON y.run_id = r.run_id
            LEFT JOIN local_match_finalizations f ON f.run_id = r.run_id
            WHERE r.organization_id = ? AND r.scorer_id = ?
              AND (
                s.event_history_revision > y.last_acknowledged_history_revision
                OR y.last_error_code LIKE 'SYNC_PENDING_CONFIGURATION%'
                OR (
                    f.finalization_hash IS NOT NULL
                    AND y.last_acknowledged_finalization_hash IS NOT f.finalization_hash
                )
              )
            ORDER BY r.updated_at_utc, r.run_id`).all(organizationId, scorerId)
            .map((value) => stringField(objectRow(value, "pending gameplay sync"), "run_id", "pending gameplay sync"));
    }

    markGameplaySyncAttempt(runId: string, revision: number, attemptedAtUtc: string): StoredLocalGameplaySyncState {
        if (!runId.trim() || !Number.isInteger(revision) || revision < 1 || !attemptedAtUtc.trim()) throw new Error("Gameplay sync attempt is invalid.");
        const result = this.requireDatabase().prepare(`UPDATE local_gameplay_sync_state
            SET last_attempted_revision = ?, last_attempt_at_utc = ?, updated_at_utc = ?
            WHERE run_id = ?`).run(revision, attemptedAtUtc, attemptedAtUtc, runId);
        if (Number(result.changes) !== 1) throw new Error("Gameplay sync state is unavailable.");
        return this.readLocalGameplaySyncState(runId)!;
    }

    recordGameplaySyncFailure(runId: string, errorCode: string, failedAtUtc: string, retryable = true): StoredLocalGameplaySyncState {
        if (!runId.trim() || !/^[A-Z0-9_]{1,80}$/.test(errorCode) || !failedAtUtc.trim()) throw new Error("Gameplay sync failure is invalid.");
        const current = this.readLocalGameplaySyncState(runId);
        if (!current) throw new Error("Gameplay sync state is unavailable.");
        const delays = [5, 30, 120, 300];
        const failures = current.consecutiveFailures + 1;
        const retrySeconds = delays[Math.min(failures - 1, delays.length - 1)];
        const retryAtUtc = retryable ? new Date(Date.parse(failedAtUtc) + retrySeconds * 1_000).toISOString() : null;
        const pendingConfiguration = current.lastErrorCode?.startsWith("SYNC_PENDING_CONFIGURATION") === true;
        const storedErrorCode = pendingConfiguration ? `SYNC_PENDING_CONFIGURATION_${errorCode}` : errorCode;
        this.requireDatabase().prepare(`UPDATE local_gameplay_sync_state
            SET last_error_code = ?, consecutive_failures = ?, next_retry_at_utc = ?, updated_at_utc = ?
            WHERE run_id = ?`).run(storedErrorCode, failures, retryAtUtc, failedAtUtc, runId);
        return this.readLocalGameplaySyncState(runId)!;
    }

    acknowledgeGameplaySync(input: AcknowledgeGameplaySyncInput): StoredLocalGameplaySyncState {
        if (!input.runId.trim() || !Number.isInteger(input.historyRevision) || input.historyRevision < 1
            || !/^[0-9a-f]{64}$/.test(input.historyHash)
            || !Number.isInteger(input.configurationRevision) || input.configurationRevision < 1
            || !/^[0-9a-f]{64}$/.test(input.configurationHash)
            || !(input.finalizationHash === null || /^[0-9a-f]{64}$/.test(input.finalizationHash))
            || !input.succeededAtUtc.trim()) throw new Error("Gameplay sync acknowledgment is invalid.");
        const database = this.requireDatabase();
        database.exec("BEGIN IMMEDIATE");
        try {
            const currentValue = database.prepare("SELECT * FROM local_gameplay_sync_state WHERE run_id = ?").get(input.runId);
            const snapshotValue = database.prepare("SELECT * FROM local_match_engine_snapshots WHERE run_id = ?").get(input.runId);
            const configurationValue = database.prepare("SELECT * FROM local_game_run_configurations WHERE run_id = ?").get(input.runId);
            if (currentValue === undefined || snapshotValue === undefined || configurationValue === undefined) throw new Error("Gameplay sync acknowledgment state is unavailable.");
            const current = storedGameplaySyncState(currentValue);
            const snapshot = storedMatchEngineSnapshot(snapshotValue);
            const configuration = storedGameRunConfiguration(configurationValue);
            const events = database.prepare("SELECT * FROM local_match_events WHERE run_id = ? ORDER BY sequence ASC").all(input.runId).map(storedMatchEvent);
            const finalizationValue = database.prepare("SELECT * FROM local_match_finalizations WHERE run_id = ?").get(input.runId);
            const finalizationHash = finalizationValue === undefined ? null : storedMatchFinalization(finalizationValue).finalizationHash;
            const calculatedHistoryHash = sha256Utf8(`[${events.map((event) => event.eventJson).join(",")}]`);
            if (input.historyRevision < current.lastAcknowledgedHistoryRevision
                || snapshot.eventHistoryRevision !== input.historyRevision
                || calculatedHistoryHash !== input.historyHash
                || configuration.revision !== input.configurationRevision
                || configuration.configurationHash !== input.configurationHash
                || finalizationHash !== input.finalizationHash) {
                throw new Error("Gameplay sync acknowledgment does not match current local Run state.");
            }
            const update = database.prepare(`UPDATE local_gameplay_sync_state SET
                last_acknowledged_history_revision = ?,
                last_acknowledged_history_hash = ?,
                last_acknowledged_finalization_hash = ?,
                last_success_at_utc = ?,
                last_error_code = NULL,
                consecutive_failures = 0,
                next_retry_at_utc = NULL,
                updated_at_utc = ?
                WHERE run_id = ?`).run(input.historyRevision, input.historyHash, input.finalizationHash, input.succeededAtUtc, input.succeededAtUtc, input.runId);
            if (Number(update.changes) !== 1) throw new Error("Gameplay sync acknowledgment was not stored.");
            const savedValue = database.prepare("SELECT * FROM local_gameplay_sync_state WHERE run_id = ?").get(input.runId);
            if (savedValue === undefined) throw new Error("Gameplay sync acknowledgment state is unavailable.");
            const saved = storedGameplaySyncState(savedValue);
            database.exec("COMMIT");
            return saved;
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    }

    initializeLocalMatchGameplay(input: InitializeLocalMatchGameplayInput): StoredLocalMatchEngineSnapshot {
        if (!input.runId.trim() || !input.organizationId.trim() || !input.scorerId.trim() || !input.deviceId.trim() || !input.startedAtUtc.trim()) throw new Error("Local Match gameplay identity is invalid.");
        if (input.snapshotSchemaVersion !== 1 || input.matchEventSchemaVersion !== 2 || !Number.isInteger(input.configurationRevision) || input.configurationRevision < 1) throw new Error("Local Match gameplay version is invalid.");
        if (!/^[0-9a-f]{64}$/.test(input.configurationHash) || !/^[0-9a-f]{64}$/.test(input.initialStateHash) || sha256Utf8(input.initialStateJson) !== input.initialStateHash) throw new Error("Local Match gameplay snapshot hash is invalid.");
        if (!input.encryptedLiveAuthorization.trim() || input.encryptedLiveAuthorization.length > 32_768) throw new Error("Secure Live Run authorization is invalid.");
        const initialState = parsedObject(input.initialStateJson, "local_match_engine_snapshots");
        if (initialState.id !== input.runId || initialState.started !== false || initialState.lastProcessedSequence !== 0) throw new Error("Local Match gameplay initial state is invalid.");
        validateMatchEventWrite(input.initialEvent);
        if (input.initialEvent.sequence !== 1) throw new Error("Initial MatchEvent sequence must be one.");

        const database = this.requireDatabase();
        database.exec("BEGIN IMMEDIATE");
        try {
            const runValue = database.prepare("SELECT * FROM local_game_runs WHERE run_id = ?").get(input.runId);
            if (runValue === undefined) throw new LocalMatchGameplayConflictError("state");
            const run = storedGameRun(runValue);
            if (run.organizationId !== input.organizationId || run.scorerId !== input.scorerId || run.deviceId !== input.deviceId) throw new LocalMatchGameplayConflictError("ownership");
            if (run.status !== "active" || run.startedAtUtc !== null || run.lastAcceptedSequence !== 0) throw new LocalMatchGameplayConflictError("state");
            const configurationValue = database.prepare("SELECT * FROM local_game_run_configurations WHERE run_id = ?").get(input.runId);
            if (configurationValue === undefined) throw new LocalMatchGameplayConflictError("state");
            const configuration = storedGameRunConfiguration(configurationValue);
            if (configuration.revision !== input.configurationRevision || configuration.configurationHash !== input.configurationHash) throw new LocalMatchGameplayConflictError("revision");
            if (database.prepare("SELECT run_id FROM local_match_engine_snapshots WHERE run_id = ?").get(input.runId) !== undefined) throw new LocalMatchGameplayConflictError("state");

            database.prepare(`INSERT INTO local_match_engine_snapshots
                (run_id, snapshot_schema_version, match_event_schema_version, configuration_revision, configuration_hash, initial_state_json, initial_state_hash, event_history_revision, created_at_utc)
                VALUES (?, 1, 2, ?, ?, ?, ?, 1, ?)`)
                .run(input.runId, input.configurationRevision, input.configurationHash, input.initialStateJson, input.initialStateHash, input.startedAtUtc);
            database.prepare(`INSERT INTO local_match_events
                (run_id, event_id, sequence, event_schema_version, event_json, event_hash, persisted_at_utc)
                VALUES (?, ?, ?, 2, ?, ?, ?)`)
                .run(input.runId, input.initialEvent.eventId, input.initialEvent.sequence, input.initialEvent.eventJson, input.initialEvent.eventHash, input.initialEvent.persistedAtUtc);
            database.prepare(`INSERT INTO local_live_run_authorizations
                (run_id, authorization_schema_version, encrypted_authorization, suspended, created_at_utc, updated_at_utc)
                VALUES (?, 1, ?, 0, ?, ?)`)
                .run(input.runId, input.encryptedLiveAuthorization, input.startedAtUtc, input.startedAtUtc);
            database.prepare(`INSERT INTO local_gameplay_sync_state
                (run_id, sync_schema_version, last_acknowledged_history_revision, consecutive_failures, updated_at_utc)
                VALUES (?, 1, 0, 0, ?)`)
                .run(input.runId, input.startedAtUtc);
            const update = database.prepare(`UPDATE local_game_runs
                SET started_at_utc = ?, last_accepted_sequence = 1, updated_at_utc = ?
                WHERE run_id = ? AND status = 'active' AND started_at_utc IS NULL AND last_accepted_sequence = 0`)
                .run(input.startedAtUtc, input.startedAtUtc, input.runId);
            if (Number(update.changes) !== 1) throw new LocalMatchGameplayConflictError("state");
            const snapshotValue = database.prepare("SELECT * FROM local_match_engine_snapshots WHERE run_id = ?").get(input.runId);
            if (snapshotValue === undefined) throw new Error("Local Match gameplay snapshot was not created.");
            const snapshot = storedMatchEngineSnapshot(snapshotValue);
            database.exec("COMMIT");
            return snapshot;
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    }

    rewriteLocalMatchEventHistory(input: RewriteLocalMatchEventHistoryInput): StoredLocalMatchEngineSnapshot {
        if (!input.runId.trim() || !input.organizationId.trim() || !input.scorerId.trim() || !input.deviceId.trim() || !input.updatedAtUtc.trim()) throw new Error("Local Match gameplay identity is invalid.");
        if (!Number.isInteger(input.expectedHistoryRevision) || input.expectedHistoryRevision < 1 || !Number.isInteger(input.lastAcceptedSequence) || input.lastAcceptedSequence < 1) throw new Error("Local Match gameplay revision is invalid.");
        const sequencePolicy = input.sequencePolicy ?? "PRESERVE_HIGH_WATER";
        let previousSequence = 0;
        const ids = new Set<string>();
        for (const event of input.events) {
            validateMatchEventWrite(event);
            const invalidSequence = sequencePolicy === "DENSE_RENUMBERED" ? event.sequence !== previousSequence + 1 : event.sequence <= previousSequence;
            if (invalidSequence || ids.has(event.eventId)) throw new Error("Local MatchEvent history ordering is invalid.");
            previousSequence = event.sequence;
            ids.add(event.eventId);
        }
        const firstEvent = input.events[0];
        if (!firstEvent || firstEvent.sequence !== 1 || parsedObject(firstEvent.eventJson, "local_match_events").type !== "MATCH_START") throw new Error("Local MatchEvent history must begin with immutable MATCH_START sequence one.");
        if (sequencePolicy === "DENSE_RENUMBERED" ? input.lastAcceptedSequence !== previousSequence : input.lastAcceptedSequence < previousSequence) throw new Error("Local MatchEvent history high-water sequence is invalid.");

        const database = this.requireDatabase();
        database.exec("BEGIN IMMEDIATE");
        try {
            const runValue = database.prepare("SELECT * FROM local_game_runs WHERE run_id = ?").get(input.runId);
            if (runValue === undefined) throw new LocalMatchGameplayConflictError("state");
            const run = storedGameRun(runValue);
            if (run.organizationId !== input.organizationId || run.scorerId !== input.scorerId || run.deviceId !== input.deviceId) throw new LocalMatchGameplayConflictError("ownership");
            if (run.status !== "active" || run.startedAtUtc === null) throw new LocalMatchGameplayConflictError("state");
            const snapshotValue = database.prepare("SELECT * FROM local_match_engine_snapshots WHERE run_id = ?").get(input.runId);
            if (snapshotValue === undefined) throw new LocalMatchGameplayConflictError("state");
            const snapshot = storedMatchEngineSnapshot(snapshotValue);
            if (snapshot.eventHistoryRevision !== input.expectedHistoryRevision) throw new LocalMatchGameplayConflictError("revision");

            database.prepare("DELETE FROM local_match_events WHERE run_id = ?").run(input.runId);
            const insert = database.prepare(`INSERT INTO local_match_events
                (run_id, event_id, sequence, event_schema_version, event_json, event_hash, persisted_at_utc)
                VALUES (?, ?, ?, 2, ?, ?, ?)`);
            for (const event of input.events) insert.run(input.runId, event.eventId, event.sequence, event.eventJson, event.eventHash, event.persistedAtUtc);
            const snapshotUpdate = database.prepare(`UPDATE local_match_engine_snapshots
                SET event_history_revision = event_history_revision + 1
                WHERE run_id = ? AND event_history_revision = ?`).run(input.runId, input.expectedHistoryRevision);
            if (Number(snapshotUpdate.changes) !== 1) throw new LocalMatchGameplayConflictError("revision");
            const runUpdate = database.prepare(`UPDATE local_game_runs
                SET last_accepted_sequence = ?, updated_at_utc = ?
                WHERE run_id = ? AND last_accepted_sequence = ?`).run(input.lastAcceptedSequence, input.updatedAtUtc, input.runId, run.lastAcceptedSequence);
            if (Number(runUpdate.changes) !== 1) throw new LocalMatchGameplayConflictError("state");
            if (input.clearResumableFlow) database.prepare("DELETE FROM local_resumable_live_flows WHERE run_id = ?").run(input.runId);
            const savedValue = database.prepare("SELECT * FROM local_match_engine_snapshots WHERE run_id = ?").get(input.runId);
            if (savedValue === undefined) throw new Error("Local Match gameplay revision was not saved.");
            const saved = storedMatchEngineSnapshot(savedValue);
            database.exec("COMMIT");
            return saved;
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    }

    appendLocalMatchEvent(input: AppendLocalMatchEventInput): StoredLocalMatchEngineSnapshot {
        return this.appendLocalMatchEvents({ ...input, events: [input.event] });
    }

    appendLocalMatchEvents(input: AppendLocalMatchEventsInput): StoredLocalMatchEngineSnapshot {
        if (!input.runId.trim() || !input.organizationId.trim() || !input.scorerId.trim() || !input.deviceId.trim() || !input.updatedAtUtc.trim()) throw new Error("Local Match append identity is invalid.");
        if (!Number.isInteger(input.expectedHistoryRevision) || input.expectedHistoryRevision < 1
            || !Number.isInteger(input.expectedLastAcceptedSequence) || input.expectedLastAcceptedSequence < 1) throw new Error("Local Match append revision is invalid.");
        if (!Array.isArray(input.events) || input.events.length < 1 || input.events.length > 16) throw new Error("Local Match append batch is invalid.");
        const eventIds = new Set<string>();
        input.events.forEach((event, index) => {
            validateMatchEventWrite(event);
            if (event.sequence !== input.expectedLastAcceptedSequence + index + 1 || eventIds.has(event.eventId)) throw new Error("Local Match append sequence is invalid.");
            eventIds.add(event.eventId);
        });
        const lastEvent = input.events[input.events.length - 1];

        const database = this.requireDatabase();
        database.exec("BEGIN IMMEDIATE");
        try {
            const runValue = database.prepare("SELECT * FROM local_game_runs WHERE run_id = ?").get(input.runId);
            const snapshotValue = database.prepare("SELECT * FROM local_match_engine_snapshots WHERE run_id = ?").get(input.runId);
            if (runValue === undefined || snapshotValue === undefined) throw new LocalMatchGameplayConflictError("state");
            const run = storedGameRun(runValue);
            const snapshot = storedMatchEngineSnapshot(snapshotValue);
            if (run.organizationId !== input.organizationId || run.scorerId !== input.scorerId || run.deviceId !== input.deviceId) throw new LocalMatchGameplayConflictError("ownership");
            if (run.status !== "active" || run.startedAtUtc === null || run.lastAcceptedSequence !== input.expectedLastAcceptedSequence) throw new LocalMatchGameplayConflictError("state");
            if (snapshot.eventHistoryRevision !== input.expectedHistoryRevision) throw new LocalMatchGameplayConflictError("revision");

            const insert = database.prepare(`INSERT INTO local_match_events
                (run_id, event_id, sequence, event_schema_version, event_json, event_hash, persisted_at_utc)
                VALUES (?, ?, ?, 2, ?, ?, ?)`);
            for (const event of input.events) insert.run(input.runId, event.eventId, event.sequence, event.eventJson, event.eventHash, event.persistedAtUtc);
            const snapshotUpdate = database.prepare(`UPDATE local_match_engine_snapshots
                SET event_history_revision = event_history_revision + 1
                WHERE run_id = ? AND event_history_revision = ?`).run(input.runId, input.expectedHistoryRevision);
            const runUpdate = database.prepare(`UPDATE local_game_runs
                SET last_accepted_sequence = ?, updated_at_utc = ?
                WHERE run_id = ? AND last_accepted_sequence = ?`)
                .run(lastEvent.sequence, input.updatedAtUtc, input.runId, input.expectedLastAcceptedSequence);
            if (Number(snapshotUpdate.changes) !== 1) throw new LocalMatchGameplayConflictError("revision");
            if (Number(runUpdate.changes) !== 1) throw new LocalMatchGameplayConflictError("state");
            if (input.clearResumableFlow) database.prepare("DELETE FROM local_resumable_live_flows WHERE run_id = ?").run(input.runId);
            const savedValue = database.prepare("SELECT * FROM local_match_engine_snapshots WHERE run_id = ?").get(input.runId);
            if (savedValue === undefined) throw new Error("Local Match append revision was not stored.");
            const saved = storedMatchEngineSnapshot(savedValue);
            database.exec("COMMIT");
            return saved;
        } catch (error) {
            database.exec("ROLLBACK");
            throw error;
        }
    }

    finalizeLocalMatchGameplay(input: FinalizeLocalMatchGameplayInput): StoredLocalMatchEngineSnapshot {
        if (!input.finalizedAtUtc.trim() || !/^[0-9a-f]{64}$/.test(input.finalizedHistoryHash)
            || !/^[0-9a-f]{64}$/.test(input.finalStateHash) || sha256Utf8(input.finalStateJson) !== input.finalStateHash
            || !/^[0-9a-f]{64}$/.test(input.finalizationHash) || sha256Utf8(input.finalizationJson) !== input.finalizationHash) {
            throw new Error("Local Match finalization integrity is invalid.");
        }
        let previousSequence = 0;
        const ids = new Set<string>();
        for (const event of input.events) {
            validateMatchEventWrite(event);
            if (event.sequence <= previousSequence || ids.has(event.eventId)) throw new Error("Local MatchEvent history ordering is invalid.");
            previousSequence = event.sequence;
            ids.add(event.eventId);
        }
        const first = input.events[0];
        const last = input.events.at(-1);
        if (!first || first.sequence !== 1 || parsedObject(first.eventJson, "local_match_events").type !== "MATCH_START"
            || !last || last.sequence !== input.lastAcceptedSequence || parsedObject(last.eventJson, "local_match_events").type !== "MATCH_END") {
            throw new Error("Finalized history must be sealed by MATCH_START and MATCH_END.");
        }
        const calculatedHistoryHash = sha256Utf8(`[${input.events.map((event) => event.eventJson).join(",")}]`);
        if (calculatedHistoryHash !== input.finalizedHistoryHash) throw new Error("Finalized MatchEvent history hash is invalid.");
        const finalState = parsedObject(input.finalStateJson, "local_match_finalizations");
        if (finalState.id !== input.runId || finalState.finished !== true || finalState.lastProcessedSequence !== input.lastAcceptedSequence) throw new Error("Finalized Match state is invalid.");
        const manifest = parsedObject(input.finalizationJson, "local_match_finalizations");
        if (Object.prototype.hasOwnProperty.call(manifest, "incidentReport")) {
            const report = manifest.incidentReport;
            if (!(report === null || (typeof report === "string" && report.length > 0 && report.length <= 20_000 && report === report.replace(/\r\n?/g, "\n").trim()))) throw new Error("Finalization incident report is invalid.");
        }
        if (manifest.schemaVersion !== 1 || manifest.runId !== input.runId
            || manifest.finalizedHistoryRevision !== input.expectedHistoryRevision + 1
            || manifest.finalizedHistoryHash !== input.finalizedHistoryHash
            || manifest.finalStateHash !== input.finalStateHash
            || manifest.finalizedAtUtc !== input.finalizedAtUtc) throw new Error("Finalization manifest is invalid.");

        const database = this.requireDatabase();
        database.exec("BEGIN IMMEDIATE");
        try {
            const runValue = database.prepare("SELECT * FROM local_game_runs WHERE run_id = ?").get(input.runId);
            if (runValue === undefined) throw new LocalMatchGameplayConflictError("state");
            const run = storedGameRun(runValue);
            if (run.organizationId !== input.organizationId || run.scorerId !== input.scorerId || run.deviceId !== input.deviceId) throw new LocalMatchGameplayConflictError("ownership");
            if (run.status !== "active" || run.startedAtUtc === null || input.lastAcceptedSequence !== run.lastAcceptedSequence + 1) throw new LocalMatchGameplayConflictError("state");
            if (database.prepare("SELECT run_id FROM local_match_finalizations WHERE run_id = ?").get(input.runId) !== undefined) throw new LocalMatchGameplayConflictError("state");
            const snapshotValue = database.prepare("SELECT * FROM local_match_engine_snapshots WHERE run_id = ?").get(input.runId);
            if (snapshotValue === undefined) throw new LocalMatchGameplayConflictError("state");
            const snapshot = storedMatchEngineSnapshot(snapshotValue);
            if (snapshot.eventHistoryRevision !== input.expectedHistoryRevision) throw new LocalMatchGameplayConflictError("revision");

            database.prepare("DELETE FROM local_match_events WHERE run_id = ?").run(input.runId);
            const insertEvent = database.prepare(`INSERT INTO local_match_events
                (run_id, event_id, sequence, event_schema_version, event_json, event_hash, persisted_at_utc)
                VALUES (?, ?, ?, 2, ?, ?, ?)`);
            for (const event of input.events) insertEvent.run(input.runId, event.eventId, event.sequence, event.eventJson, event.eventHash, event.persistedAtUtc);
            const snapshotUpdate = database.prepare(`UPDATE local_match_engine_snapshots
                SET event_history_revision = event_history_revision + 1
                WHERE run_id = ? AND event_history_revision = ?`).run(input.runId, input.expectedHistoryRevision);
            if (Number(snapshotUpdate.changes) !== 1) throw new LocalMatchGameplayConflictError("revision");
            const runUpdate = database.prepare(`UPDATE local_game_runs
                SET status = 'finalized', last_accepted_sequence = ?, updated_at_utc = ?
                WHERE run_id = ? AND status = 'active' AND last_accepted_sequence = ?`)
                .run(input.lastAcceptedSequence, input.finalizedAtUtc, input.runId, run.lastAcceptedSequence);
            if (Number(runUpdate.changes) !== 1) throw new LocalMatchGameplayConflictError("state");
            database.prepare(`INSERT INTO local_match_finalizations
                (run_id, finalization_schema_version, finalized_history_revision, finalized_history_hash,
                 final_state_json, final_state_hash, finalization_json, finalization_hash, finalized_at_utc)
                VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`)
                .run(input.runId, input.expectedHistoryRevision + 1, input.finalizedHistoryHash, input.finalStateJson, input.finalStateHash, input.finalizationJson, input.finalizationHash, input.finalizedAtUtc);
            const savedValue = database.prepare("SELECT * FROM local_match_engine_snapshots WHERE run_id = ?").get(input.runId);
            if (savedValue === undefined) throw new Error("Finalized Match snapshot is unavailable.");
            const saved = storedMatchEngineSnapshot(savedValue);
            database.exec("COMMIT");
            return saved;
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
