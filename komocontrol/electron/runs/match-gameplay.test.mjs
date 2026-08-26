import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDatabase } from "../../dist-electron/persistence/local-database.cjs";
import { MatchSetupManager } from "../../dist-electron/games/match-setup.cjs";
import { MatchRunManager } from "../../dist-electron/runs/match-run.cjs";
import { PreGameConfigurationManager } from "../../dist-electron/runs/pre-game-configuration.cjs";
import { MatchGameplayManager } from "../../dist-electron/runs/match-gameplay.cjs";
import { deterministicJson, sha256JsonBytes } from "../../dist-electron/runs/match-engine-bootstrap.cjs";

const owner = { scorerId: "scorer-gameplay-fixture", organizationId: "organization-gameplay-fixture" };
const deviceId = "33333333-3333-4333-8333-333333333333";
const roots = [];
const databases = [];

function payload(overrides = {}) {
    return {
        schemaVersion: 1,
        game: { id: "game-gameplay", organizationId: owner.organizationId, competitionId: "competition-1", competitionName: "Gameplay Competition", seasonName: "2026-27", phaseName: "League", roundLabel: "Round 1", scheduledDate: "2026-08-26", scheduledTime: "19:00", scheduledAt: "2026-08-26T16:00:00.000Z", venue: null },
        settings: { game_mode: "FULL", min_players: 2, max_players: 12, starting_players: 2, regulation_periods: 4, regulation_period_seconds: 600, overtime_seconds: 300, tie_allowed: false, winner_required: true, ...overrides },
        teams: [
            { side: "AWAY", id: "away-team", name: "Away Team", logoUrl: null, players: [{ id: "away-1", displayName: "Away One", shirtNumber: 0, photoUrl: null }, { id: "away-2", displayName: "Away Two", shirtNumber: null, photoUrl: null }, { id: "away-3", displayName: "Away Three", shirtNumber: 7, photoUrl: null }], staff: [] },
            { side: "HOME", id: "home-team", name: "Home Team", logoUrl: null, players: [{ id: "home-1", displayName: "Home One", shirtNumber: 0, photoUrl: null }, { id: "home-2", displayName: "Home Two", shirtNumber: null, photoUrl: null }, { id: "home-3", displayName: "Home Three", shirtNumber: 7, photoUrl: null }], staff: [] },
        ],
    };
}

function packageInput(settings = {}) {
    const payloadJson = JSON.stringify(payload(settings));
    return { packageId: "package-gameplay-v2", gameId: "game-gameplay", packageVersion: 2, packageSchemaVersion: 1, payloadJson, payloadHash: createHash("sha256").update(Buffer.from(payloadJson, "utf8")).digest("hex"), publishedAtUtc: "2026-08-26T10:00:00.000Z" };
}

function copyMigrations(target, maximum = "0005") {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(path.resolve("electron/migrations")).filter((name) => name.endsWith(".sql") && name.slice(0, 4) <= maximum).sort()) fs.copyFileSync(path.resolve("electron/migrations", name), path.join(target, name));
}

function configurationDraft(configuration) {
    return {
        gameId: configuration.gameId,
        expectedRevision: configuration.revision,
        teams: configuration.teams.map((team) => ({
            side: team.side,
            players: team.players.map((player) => {
                const participating = player.playerId.endsWith("-1") || player.playerId.endsWith("-2");
                const gameShirtNumber = player.playerId.endsWith("-1") ? "0" : player.playerId.endsWith("-2") ? (team.side === "HOME" ? "00" : "2") : player.gameShirtNumber;
                return { playerId: player.playerId, participating, gameShirtNumber };
            }),
            staff: team.staff.map((member) => ({ staffId: member.staffId, participating: false })),
            extraBench: [],
            captainPlayerId: `${team.side.toLowerCase()}-1`,
            starterPlayerIds: [`${team.side.toLowerCase()}-1`, `${team.side.toLowerCase()}-2`],
            gameColor: team.side === "HOME" ? "#D62828" : "#168B4B",
        })),
        presentation: { leftSide: "AWAY" },
    };
}

function fixture(settings = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "komocontrol-gameplay-")); roots.push(root);
    const migrationsDirectory = path.join(root, "migrations"); copyMigrations(migrationsDirectory);
    const localDatabase = new LocalDatabase({ databasePath: path.join(root, "komocontrol.sqlite"), migrationsDirectory, backupDirectory: path.join(root, "backups") }); databases.push(localDatabase);
    localDatabase.initialize();
    const identity = localDatabase.getDeviceIdentity();
    if (identity.deviceId !== deviceId) {
        localDatabase.close();
        const raw = new DatabaseSync(localDatabase.databasePath); raw.prepare("UPDATE device_identity SET device_id = ? WHERE singleton_key = 1").run(deviceId); raw.close();
        const reopened = new LocalDatabase({ databasePath: localDatabase.databasePath, migrationsDirectory, backupDirectory: path.join(root, "backups") }); databases.push(reopened); reopened.initialize();
        return populatedFixture(root, migrationsDirectory, reopened, settings);
    }
    return populatedFixture(root, migrationsDirectory, localDatabase, settings);
}

function populatedFixture(root, migrationsDirectory, localDatabase, settings) {
    localDatabase.storeVerifiedGamePackage(packageInput(settings));
    const setup = new MatchSetupManager(localDatabase);
    const run = new MatchRunManager(setup, localDatabase, deviceId).createOrOpen("game-gameplay", owner).run;
    const configurations = new PreGameConfigurationManager(setup, localDatabase, deviceId);
    const initial = configurations.getOrCreate("game-gameplay", owner).configuration;
    const configuration = configurations.saveDraft(configurationDraft(initial), owner);
    let time = Date.parse("2026-08-26T12:00:00.000Z"); let id = 0;
    const gameplay = new MatchGameplayManager(setup, localDatabase, deviceId, () => new Date(time += 1_000), () => `gameplay-event-${++id}`);
    return { root, migrationsDirectory, localDatabase, setup, run, configuration, gameplay };
}

function rows(databasePath, sql, ...params) {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    try { return database.prepare(sql).all(...params); } finally { database.close(); }
}

function mutateConfiguration(fixtureValue, change) {
    const stored = fixtureValue.localDatabase.readLocalGameRunConfiguration(fixtureValue.run.runId);
    const value = JSON.parse(stored.configurationJson); change(value);
    const json = JSON.stringify(value); const hash = createHash("sha256").update(Buffer.from(json, "utf8")).digest("hex");
    const database = new DatabaseSync(fixtureValue.localDatabase.databasePath);
    try { database.prepare("UPDATE local_game_run_configurations SET configuration_json = ?, configuration_hash = ? WHERE run_id = ?").run(json, hash, fixtureValue.run.runId); } finally { database.close(); }
}

afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("KC-5B10A durable local Match gameplay foundation", () => {
    it("migrates 0004 to 0005 while preserving device, Package, Run, and configuration", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "komocontrol-gameplay-migration-")); roots.push(root);
        const migrationsDirectory = path.join(root, "migrations"); copyMigrations(migrationsDirectory, "0004");
        const databasePath = path.join(root, "legacy.sqlite"); const preservedDevice = deviceId; const runId = "run-before-0005"; const packageValue = packageInput(); const timestamp = "2026-08-26T10:00:00.000Z";
        const configurationValue = { schemaVersion: 1, runId, gameId: packageValue.gameId, teams: [{ side: "HOME", teamId: "home-team", players: [], staff: [], extraBench: [], captainPlayerId: null, starterPlayerIds: [], gameColor: null }, { side: "AWAY", teamId: "away-team", players: [], staff: [], extraBench: [], captainPlayerId: null, starterPlayerIds: [], gameColor: null }], presentation: { leftSide: "HOME" } }; const configurationJson = JSON.stringify(configurationValue); const configurationHash = createHash("sha256").update(Buffer.from(configurationJson, "utf8")).digest("hex");
        const legacy = new DatabaseSync(databasePath); legacy.exec("PRAGMA foreign_keys = ON");
        for (const migrationId of fs.readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).sort()) { const bytes = fs.readFileSync(path.join(migrationsDirectory, migrationId)); legacy.exec(bytes.toString("utf8")); legacy.prepare("INSERT INTO local_schema_migrations (migration_id,applied_at_utc,checksum) VALUES (?,?,?)").run(migrationId, timestamp, createHash("sha256").update(bytes).digest("hex")); }
        legacy.prepare("INSERT INTO device_identity (singleton_key,device_id,created_at_utc) VALUES (1,?,?)").run(preservedDevice, timestamp); legacy.prepare("INSERT INTO local_game_packages (package_id,game_id,package_version,package_schema_version,payload_json,payload_hash,published_at_utc,downloaded_at_utc,is_current) VALUES (?,?,2,1,?,?,?,?,1)").run(packageValue.packageId, packageValue.gameId, packageValue.payloadJson, packageValue.payloadHash, packageValue.publishedAtUtc, timestamp); legacy.prepare("INSERT INTO local_game_runs (run_id,run_schema_version,game_id,package_id,package_version,package_schema_version,package_hash,organization_id,scorer_id,device_id,status,setup_snapshot_json,last_accepted_sequence,started_at_utc,created_at_utc,updated_at_utc) VALUES (?,1,?,?,2,1,?,?,?,?,'active','{}',0,NULL,?,?)").run(runId, packageValue.gameId, packageValue.packageId, packageValue.payloadHash, owner.organizationId, owner.scorerId, preservedDevice, timestamp, timestamp); legacy.prepare("INSERT INTO local_game_run_configurations (run_id,configuration_schema_version,revision,status,configuration_json,configuration_hash,ready_at_utc,created_at_utc,updated_at_utc) VALUES (?,1,1,'draft',?,?,NULL,?,?)").run(runId, configurationJson, configurationHash, timestamp, timestamp); legacy.close();
        fs.copyFileSync(path.resolve("electron/migrations/0005_match_gameplay.sql"), path.join(migrationsDirectory, "0005_match_gameplay.sql"));
        const migrated = new LocalDatabase({ databasePath, migrationsDirectory, backupDirectory: path.join(root, "backups") }); databases.push(migrated);
        expect(migrated.initialize().schemaVersion).toBe("0005_match_gameplay.sql"); expect(migrated.getDeviceIdentity().deviceId).toBe(preservedDevice); expect(migrated.readGamePackage("package-gameplay-v2")?.packageVersion).toBe(2); expect(migrated.readLocalGameRun(runId)?.runId).toBe(runId); expect(migrated.readLocalGameRunConfiguration(runId)?.revision).toBe(1); expect(migrated.readLocalMatchEngineSnapshot(runId)).toBeNull(); expect(migrated.readLocalMatchEvents(runId)).toEqual([]);
    });

    it("bootstraps strict HOME/AWAY participating identity, text numbers, starters, and pinned rules", async () => {
        const f = fixture(); const started = await f.gameplay.initialize(f.run.runId, owner); const state = started.state;
        expect(state.id).toBe(f.run.runId); expect(state.started).toBe(true); expect(state.lastProcessedSequence).toBe(1); expect(state.possession).toBeNull();
        expect(state.home.id).toBe("home-team"); expect(state.away.id).toBe("away-team"); expect(state.home.players.map((player) => [player.playerId, player.displayName, player.shirtNumber, player.onCourt])).toEqual([["home-1", "Home One", "0", true], ["home-2", "Home Two", "00", true]]); expect(state.away.players.map((player) => player.playerId)).toEqual(["away-1", "away-2"]);
        expect(state.rules).toMatchObject({ schemaVersion: 1, rulesEdition: "FIBA_2026", minPlayers: 2, maxPlayers: 12, startingPlayers: 2, regulationPeriods: 4, regulationPeriodSeconds: 600, overtimeSeconds: 300, resultPolicy: "REQUIRE_WINNER" });
        const snapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); expect(snapshot.initialStateJson).not.toContain("captainPlayerId"); expect(snapshot.initialStateJson).not.toContain("gameColor"); expect(snapshot.initialStateJson).not.toContain("leftSide");
    });

    it("preserves ALLOW_TIE and variable Package period, clock, and starter rules", async () => {
        const f = fixture({ regulation_periods: 2, regulation_period_seconds: 480, overtime_seconds: 240, tie_allowed: true, winner_required: false }); const started = await f.gameplay.initialize(f.run.runId, owner);
        expect(started.state.rules).toMatchObject({ regulationPeriods: 2, regulationPeriodSeconds: 480, overtimeSeconds: 240, startingPlayers: 2, resultPolicy: "ALLOW_TIE" }); expect(started.state.clock).toBe(480);
    });

    it.each([
        ["null shirt number", (configuration) => { configuration.teams[0].players.find((player) => player.playerId === "home-1").gameShirtNumber = null; }],
        ["duplicate shirt number", (configuration) => { configuration.teams[0].players.find((player) => player.playerId === "home-2").gameShirtNumber = "0"; }],
        ["incomplete starters", (configuration) => { configuration.teams[0].starterPlayerIds.pop(); }],
        ["missing captain", (configuration) => { configuration.teams[0].captainPlayerId = null; }],
        ["missing color", (configuration) => { configuration.teams[0].gameColor = null; }],
        ["below minimum participants", (configuration) => { configuration.teams[0].players.find((player) => player.playerId === "home-2").participating = false; configuration.teams[0].starterPlayerIds = ["home-1", "home-3"]; }],
    ])("rejects %s before any gameplay write", async (_label, mutate) => {
        const f = fixture(); mutateConfiguration(f, mutate); await expect(f.gameplay.initialize(f.run.runId, owner)).rejects.toThrow(/MATCH_ENGINE_BOOTSTRAP_INVALID/); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toBeNull(); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual([]); expect(f.localDatabase.readLocalGameRun(f.run.runId)).toMatchObject({ startedAtUtc: null, lastAcceptedSequence: 0 });
    });

    it("creates snapshot, MATCH_START, and Run start metadata atomically", async () => {
        const f = fixture(); const started = await f.gameplay.initialize(f.run.runId, owner); const snapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const events = f.localDatabase.readLocalMatchEvents(f.run.runId); const run = f.localDatabase.readLocalGameRun(f.run.runId);
        expect(snapshot).toMatchObject({ snapshotSchemaVersion: 1, matchEventSchemaVersion: 2, configurationRevision: f.configuration.revision, eventHistoryRevision: 1 }); expect(events).toHaveLength(1); expect(JSON.parse(events[0].eventJson)).toMatchObject({ schemaVersion: 2, sequence: 1, type: "MATCH_START" }); expect(run).toMatchObject({ lastAcceptedSequence: 1 }); expect(run.startedAtUtc).not.toBeNull(); expect(started.eventIds).toEqual([events[0].eventId]);
    });

    it("appends atomically, rejects invalid engine events without writes, and recovers identically after restart", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const appended = await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); expect(appended.lastAcceptedSequence).toBe(2); expect(appended.eventHistoryRevision).toBe(2); const before = rows(f.localDatabase.databasePath, "SELECT * FROM local_match_events WHERE run_id=? ORDER BY sequence", f.run.runId); const revision = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId).eventHistoryRevision;
        await expect(f.gameplay.append(f.run.runId, owner, { type: "MATCH_START" })).rejects.toThrow(/GAMEPLAY_EVENT_REJECTED/); expect(rows(f.localDatabase.databasePath, "SELECT * FROM local_match_events WHERE run_id=? ORDER BY sequence", f.run.runId)).toEqual(before); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId).eventHistoryRevision).toBe(revision);
        f.localDatabase.close(); const reopened = new LocalDatabase({ databasePath: f.localDatabase.databasePath, migrationsDirectory: f.migrationsDirectory, backupDirectory: path.join(f.root, "backups") }); databases.push(reopened); reopened.initialize(); const recovered = await new MatchGameplayManager(new MatchSetupManager(reopened), reopened, deviceId).recover(f.run.runId, owner); expect(recovered.state).toEqual(appended.state); expect(recovered.eventIds).toEqual(appended.eventIds);
    });

    it("preserves correction identity and sequence while incrementing only history revision", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const appended = await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); const eventId = appended.eventIds[1]; const corrected = await f.gameplay.correct(f.run.runId, owner, eventId, { type: "CLOCK_START" }); const event = f.localDatabase.readLocalMatchEvents(f.run.runId).find((value) => value.eventId === eventId);
        expect(event).toMatchObject({ eventId, sequence: 2 }); expect(corrected.lastAcceptedSequence).toBe(2); expect(corrected.eventHistoryRevision).toBe(3); expect(JSON.parse(event.eventJson)).toMatchObject({ id: eventId, sequence: 2 });
    });

    it("rewrites exact surviving history for removal/cascade and never reduces sequence high-water", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const appended = await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); const removed = await f.gameplay.remove(f.run.runId, owner, appended.eventIds[1], true); expect(removed.eventIds).toHaveLength(1); expect(removed.lastAcceptedSequence).toBe(2); expect(f.localDatabase.readLocalGameRun(f.run.runId).lastAcceptedSequence).toBe(2);
        const next = await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); expect(f.localDatabase.readLocalMatchEvents(f.run.runId).map((event) => event.sequence)).toEqual([1, 3]); expect(next.lastAcceptedSequence).toBe(3);
    });

    it("rejects removal of the immutable initial MATCH_START with zero writes", async () => {
        const f = fixture(); const started = await f.gameplay.initialize(f.run.runId, owner); const beforeEvents = f.localDatabase.readLocalMatchEvents(f.run.runId); const beforeSnapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const beforeRun = f.localDatabase.readLocalGameRun(f.run.runId);
        await expect(f.gameplay.remove(f.run.runId, owner, started.eventIds[0], true)).rejects.toThrow(/GAMEPLAY_EVENT_REJECTED/); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(beforeEvents); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(beforeSnapshot); expect(f.localDatabase.readLocalGameRun(f.run.runId)).toEqual(beforeRun);
    });

    it("rejects correction of the immutable initial MATCH_START with zero writes", async () => {
        const f = fixture(); const started = await f.gameplay.initialize(f.run.runId, owner); const beforeEvents = f.localDatabase.readLocalMatchEvents(f.run.runId); const beforeSnapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const beforeRun = f.localDatabase.readLocalGameRun(f.run.runId);
        await expect(f.gameplay.correct(f.run.runId, owner, started.eventIds[0], { type: "MATCH_START" })).rejects.toThrow(/GAMEPLAY_EVENT_REJECTED/); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(beforeEvents); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(beforeSnapshot); expect(f.localDatabase.readLocalGameRun(f.run.runId)).toEqual(beforeRun);
    });

    it("rejects a direct authoritative rewrite without MATCH_START with zero writes", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const snapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const run = f.localDatabase.readLocalGameRun(f.run.runId); const beforeEvents = f.localDatabase.readLocalMatchEvents(f.run.runId);
        expect(() => f.localDatabase.rewriteLocalMatchEventHistory({ runId: f.run.runId, organizationId: owner.organizationId, scorerId: owner.scorerId, deviceId, expectedHistoryRevision: snapshot.eventHistoryRevision, lastAcceptedSequence: run.lastAcceptedSequence, events: [], updatedAtUtc: "2026-08-26T13:00:00.000Z" })).toThrow(/immutable MATCH_START sequence one/); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(beforeEvents); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(snapshot); expect(f.localDatabase.readLocalGameRun(f.run.runId)).toEqual(run);
    });

    it("rejects a direct authoritative rewrite whose first event sequence is not one with zero writes", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const snapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const run = f.localDatabase.readLocalGameRun(f.run.runId); const beforeEvents = f.localDatabase.readLocalMatchEvents(f.run.runId); const first = JSON.parse(beforeEvents[0].eventJson); const invalidEvent = { ...first, sequence: 2 }; const eventJson = deterministicJson(invalidEvent);
        expect(() => f.localDatabase.rewriteLocalMatchEventHistory({ runId: f.run.runId, organizationId: owner.organizationId, scorerId: owner.scorerId, deviceId, expectedHistoryRevision: snapshot.eventHistoryRevision, lastAcceptedSequence: run.lastAcceptedSequence, events: [{ eventId: invalidEvent.id, sequence: 2, eventSchemaVersion: 2, eventJson, eventHash: sha256JsonBytes(eventJson), persistedAtUtc: "2026-08-26T13:00:00.000Z" }], updatedAtUtc: "2026-08-26T13:00:00.000Z" })).toThrow(/immutable MATCH_START sequence one/); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(beforeEvents); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(snapshot); expect(f.localDatabase.readLocalGameRun(f.run.runId)).toEqual(run);
    });

    it("rolls back event rows, history revision, and Run metadata on a transaction failure", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const beforeEvents = f.localDatabase.readLocalMatchEvents(f.run.runId); const beforeSnapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const beforeRun = f.localDatabase.readLocalGameRun(f.run.runId); const database = new DatabaseSync(f.localDatabase.databasePath); database.exec("CREATE TRIGGER synthetic_gameplay_failure BEFORE INSERT ON local_match_events WHEN NEW.sequence = 2 BEGIN SELECT RAISE(ABORT, 'synthetic rollback'); END;"); database.close();
        await expect(f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" })).rejects.toThrow(/synthetic rollback/); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(beforeEvents); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(beforeSnapshot); expect(f.localDatabase.readLocalGameRun(f.run.runId)).toEqual(beforeRun);
    });

    it("fails closed for corrupted snapshot and event hashes", async () => {
        const snapshotFixture = fixture(); await snapshotFixture.gameplay.initialize(snapshotFixture.run.runId, owner); let database = new DatabaseSync(snapshotFixture.localDatabase.databasePath); database.exec("DROP TRIGGER local_match_engine_snapshots_immutable"); database.prepare("UPDATE local_match_engine_snapshots SET initial_state_hash=? WHERE run_id=?").run("f".repeat(64), snapshotFixture.run.runId); database.close(); await expect(snapshotFixture.gameplay.recover(snapshotFixture.run.runId, owner)).rejects.toThrow(/GAMEPLAY_CORRUPTED/);
        const eventFixture = fixture(); await eventFixture.gameplay.initialize(eventFixture.run.runId, owner); database = new DatabaseSync(eventFixture.localDatabase.databasePath); database.exec("DROP TRIGGER local_match_events_immutable"); database.prepare("UPDATE local_match_events SET event_hash=? WHERE run_id=?").run("e".repeat(64), eventFixture.run.runId); database.close(); await expect(eventFixture.gameplay.recover(eventFixture.run.runId, owner)).rejects.toThrow(/GAMEPLAY_CORRUPTED/);
    });

    it("fails closed when intact stored JSON cannot be replayed", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const duplicateStart = { schemaVersion: 2, id: "corrupt-event-2", occurredAt: Date.parse("2026-08-26T12:30:00.000Z"), sequence: 2, type: "MATCH_START" }; const eventJson = deterministicJson(duplicateStart); const database = new DatabaseSync(f.localDatabase.databasePath); database.prepare("INSERT INTO local_match_events (run_id,event_id,sequence,event_schema_version,event_json,event_hash,persisted_at_utc) VALUES (?,?,2,2,?,?,?)").run(f.run.runId, duplicateStart.id, eventJson, sha256JsonBytes(eventJson), "2026-08-26T12:30:00.000Z"); database.prepare("UPDATE local_match_engine_snapshots SET event_history_revision=2 WHERE run_id=?").run(f.run.runId); database.prepare("UPDATE local_game_runs SET last_accepted_sequence=2 WHERE run_id=?").run(f.run.runId); database.close(); await expect(f.gameplay.recover(f.run.runId, owner)).rejects.toThrow(/GAMEPLAY_CORRUPTED/);
    });

    it("denies logout/wrong ownership while preserving offline gameplay for the same re-authenticated owner", async () => {
        const f = fixture(); const started = await f.gameplay.initialize(f.run.runId, owner); const beforeEvents = f.localDatabase.readLocalMatchEvents(f.run.runId); await expect(f.gameplay.recover(f.run.runId, null)).rejects.toThrow(/GAMEPLAY_UNAVAILABLE/); await expect(f.gameplay.recover(f.run.runId, { ...owner, scorerId: "other-scorer" })).rejects.toThrow(/GAMEPLAY_OWNERSHIP_CONFLICT/); await expect(f.gameplay.recover(f.run.runId, { ...owner, organizationId: "other-organization" })).rejects.toThrow(/GAMEPLAY_OWNERSHIP_CONFLICT/); const otherDevice = new MatchGameplayManager(f.setup, f.localDatabase, "44444444-4444-4444-8444-444444444444"); await expect(otherDevice.recover(f.run.runId, owner)).rejects.toThrow(/GAMEPLAY_OWNERSHIP_CONFLICT/); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(beforeEvents); expect((await f.gameplay.recover(f.run.runId, owner)).state).toEqual(started.state);
    });

    it("uses only local Package/configuration stores for bootstrap, mutation, and recovery", async () => {
        const f = fixture(); let localPackageReads = 0; const localSetup = { getVerifiedPackageMatchSetup: (packageId) => { localPackageReads += 1; return f.setup.getVerifiedPackageMatchSetup(packageId); } }; const gameplay = new MatchGameplayManager(localSetup, f.localDatabase, deviceId); await gameplay.initialize(f.run.runId, owner); await gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); await gameplay.recover(f.run.runId, owner); expect(localPackageReads).toBe(1);
    });
});
