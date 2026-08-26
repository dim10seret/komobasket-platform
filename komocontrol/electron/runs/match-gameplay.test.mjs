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
import { LiveRunAuthorizationManager } from "../../dist-electron/auth/live-run-authorization.cjs";

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

function copyMigrations(target, maximum = "0007") {
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
    let time = Date.parse("2026-08-26T12:00:00.000Z"); let id = 0; const now = () => new Date(time += 1_000);
    const liveAuthorization = new LiveRunAuthorizationManager(localDatabase, { isEncryptionAvailable: () => true, encryptString: (value) => Buffer.from(value, "utf8"), decryptString: (value) => value.toString("utf8") }, deviceId, now);
    const gameplay = new MatchGameplayManager(setup, localDatabase, deviceId, now, () => `gameplay-event-${++id}`, (input) => liveAuthorization.seal(input));
    return { root, migrationsDirectory, localDatabase, setup, run, configuration, configurations, gameplay, liveAuthorization };
}

function addFixtureRun(fixtureValue, suffix) {
    const gameId = `game-cache-${suffix}`; const packageId = `package-cache-${suffix}`; const packagePayload = payload(); packagePayload.game = { ...packagePayload.game, id: gameId };
    const payloadJson = JSON.stringify(packagePayload); fixtureValue.localDatabase.storeVerifiedGamePackage({ packageId, gameId, packageVersion: 1, packageSchemaVersion: 1, payloadJson, payloadHash: createHash("sha256").update(Buffer.from(payloadJson, "utf8")).digest("hex"), publishedAtUtc: "2026-08-26T10:00:00.000Z" });
    const run = new MatchRunManager(fixtureValue.setup, fixtureValue.localDatabase, deviceId).createOrOpen(gameId, owner).run; const initial = fixtureValue.configurations.getOrCreate(gameId, owner).configuration; fixtureValue.configurations.saveDraft(configurationDraft(initial), owner); return run;
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
        fs.copyFileSync(path.resolve("electron/migrations/0006_gameplay_sync.sql"), path.join(migrationsDirectory, "0006_gameplay_sync.sql"));
        fs.copyFileSync(path.resolve("electron/migrations/0007_live_pre_game_corrections.sql"), path.join(migrationsDirectory, "0007_live_pre_game_corrections.sql"));
        const migrated = new LocalDatabase({ databasePath, migrationsDirectory, backupDirectory: path.join(root, "backups") }); databases.push(migrated);
        expect(migrated.initialize().schemaVersion).toBe("0007_live_pre_game_corrections.sql"); expect(migrated.getDeviceIdentity().deviceId).toBe(preservedDevice); expect(migrated.readGamePackage("package-gameplay-v2")?.packageVersion).toBe(2); expect(migrated.readLocalGameRun(runId)?.runId).toBe(runId); expect(migrated.readLocalGameRunConfiguration(runId)?.revision).toBe(1); expect(migrated.readLocalMatchEngineSnapshot(runId)).toBeNull(); expect(migrated.readLocalMatchEvents(runId)).toEqual([]);
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
        ["null shirt number", "START_SHIRT_NUMBER_MISSING", (configuration) => { configuration.teams[0].players.find((player) => player.playerId === "home-1").gameShirtNumber = null; }],
        ["invalid shirt number", "START_SHIRT_NUMBER_INVALID", (configuration) => { configuration.teams[0].players.find((player) => player.playerId === "home-1").gameShirtNumber = "01"; }],
        ["duplicate shirt number", "START_SHIRT_NUMBER_DUPLICATE", (configuration) => { configuration.teams[0].players.find((player) => player.playerId === "home-2").gameShirtNumber = "0"; }],
        ["incomplete starters", "START_STARTER_COUNT_INVALID", (configuration) => { configuration.teams[0].starterPlayerIds.pop(); }],
        ["non-participating starter", "START_STARTER_NOT_PARTICIPATING", (configuration) => { configuration.teams[0].players.find((player) => player.playerId === "home-2").participating = false; configuration.teams[0].players.find((player) => player.playerId === "home-3").participating = true; }],
        ["missing captain", "START_CAPTAIN_MISSING", (configuration) => { configuration.teams[0].captainPlayerId = null; }],
        ["non-participating captain", "START_CAPTAIN_NOT_PARTICIPATING", (configuration) => { configuration.teams[0].players.find((player) => player.playerId === "home-1").participating = false; configuration.teams[0].players.find((player) => player.playerId === "home-3").participating = true; configuration.teams[0].starterPlayerIds = ["home-2", "home-3"]; }],
        ["missing color", "START_TEAM_COLOR_MISSING", (configuration) => { configuration.teams[0].gameColor = null; }],
        ["below minimum participants", "START_PARTICIPANT_COUNT_BELOW_MINIMUM", (configuration) => { configuration.teams[0].players.find((player) => player.playerId === "home-2").participating = false; configuration.teams[0].players.find((player) => player.playerId === "home-3").participating = false; configuration.teams[0].starterPlayerIds = ["home-1"]; }],
    ])("reports %s before any gameplay write", async (_label, expectedCode, mutate) => {
        const f = fixture(); mutateConfiguration(f, mutate); expect(f.gameplay.validateStartReadiness(f.run.runId, owner)).toMatchObject({ code: expectedCode, teamSide: "HOME" }); await expect(f.gameplay.initialize(f.run.runId, owner)).rejects.toThrow(/MATCH_ENGINE_BOOTSTRAP_INVALID/); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toBeNull(); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual([]); expect(f.localDatabase.readLocalGameRun(f.run.runId)).toMatchObject({ startedAtUtc: null, lastAcceptedSequence: 0 });
    });

    it("creates snapshot, MATCH_START, and Run start metadata atomically", async () => {
        const f = fixture(); const started = await f.gameplay.initialize(f.run.runId, owner); const snapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const events = f.localDatabase.readLocalMatchEvents(f.run.runId); const run = f.localDatabase.readLocalGameRun(f.run.runId);
        expect(snapshot).toMatchObject({ snapshotSchemaVersion: 1, matchEventSchemaVersion: 2, configurationRevision: f.configuration.revision, eventHistoryRevision: 1 }); expect(events).toHaveLength(1); expect(JSON.parse(events[0].eventJson)).toMatchObject({ schemaVersion: 2, sequence: 1, type: "MATCH_START" }); expect(run).toMatchObject({ lastAcceptedSequence: 1 }); expect(run.startedAtUtc).not.toBeNull(); expect(started.eventIds).toEqual([events[0].eventId]);
    });

    it("rejects duplicate Start without changing the accepted snapshot, event history, or Run", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const snapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const events = f.localDatabase.readLocalMatchEvents(f.run.runId); const run = f.localDatabase.readLocalGameRun(f.run.runId);
        await expect(f.gameplay.initialize(f.run.runId, owner)).rejects.toThrow(/GAMEPLAY_CONFLICT/); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(snapshot); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(events); expect(f.localDatabase.readLocalGameRun(f.run.runId)).toEqual(run);
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
        const readAfterCorrection = f.localDatabase.readLocalMatchEvents.bind(f.localDatabase); f.localDatabase.readLocalMatchEvents = () => { throw new Error("normal append replayed durable history after correction"); };
        const next = await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); expect(readAfterCorrection(f.run.runId).map((event) => event.sequence)).toEqual([1, 3]); expect(next.lastAcceptedSequence).toBe(3);
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
        const cleanup = new DatabaseSync(f.localDatabase.databasePath); cleanup.exec("DROP TRIGGER synthetic_gameplay_failure"); cleanup.close(); const acceptedAfterRollback = await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); expect(acceptedAfterRollback.lastAcceptedSequence).toBe(2); expect(acceptedAfterRollback.state.clockRunning).toBe(true);
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
        const f = fixture(); let localPackageReads = 0; const localSetup = { getVerifiedPackageMatchSetup: (packageId) => { localPackageReads += 1; return f.setup.getVerifiedPackageMatchSetup(packageId); } }; const gameplay = new MatchGameplayManager(localSetup, f.localDatabase, deviceId, undefined, undefined, () => "sealed-live-run-authorization"); await gameplay.initialize(f.run.runId, owner); await gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); await gameplay.recover(f.run.runId, owner); expect(localPackageReads).toBe(1);
    });

    it("atomically creates Run continuity and sync state, then finalizes locally without network", async () => {
        const f = fixture({ tie_allowed: true, winner_required: false, regulation_periods: 1 });
        const started = await f.gameplay.initialize(f.run.runId, owner);
        expect(started.lifecycle).toBe("live");
        expect(f.localDatabase.readLocalLiveRunAuthorization(f.run.runId)).toMatchObject({ runId: f.run.runId, encryptedAuthorization: expect.any(String), suspended: false });
        expect(f.localDatabase.readLocalGameplaySyncState(f.run.runId)).toMatchObject({ runId: f.run.runId, lastAcknowledgedHistoryRevision: 0, consecutiveFailures: 0 });
        await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0 });
        await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } });
        const finalized = await f.gameplay.finalize(f.run.runId, owner);
        expect(finalized.lifecycle).toBe("finalized");
        expect(finalized.state.finished).toBe(true);
        expect(f.localDatabase.readLocalGameRun(f.run.runId)).toMatchObject({ status: "finalized", lastAcceptedSequence: 4 });
        expect(f.localDatabase.readLocalMatchFinalization(f.run.runId)).toMatchObject({ runId: f.run.runId, finalizedHistoryRevision: finalized.eventHistoryRevision });
        expect(f.localDatabase.listPendingGameplaySyncRunIds(owner.organizationId, owner.scorerId)).toEqual([f.run.runId]);
    });

    it("persists LIVE roster amendments as factual events while keeping the initial snapshot immutable", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" });
        const before = f.configurations.getOrCreate("game-gameplay", owner).configuration; const input = configurationDraft(before); const home = input.teams.find((team) => team.side === "HOME");
        home.players.find((player) => player.playerId === "home-1").gameShirtNumber = "9"; Object.assign(home.players.find((player) => player.playerId === "home-3"), { participating: true, gameShirtNumber: "7" }); home.gameColor = "#123456"; input.presentation.leftSide = "HOME";
        const snapshotBefore = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const eventsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId); const runBefore = f.localDatabase.readLocalGameRun(f.run.runId);
        const saved = f.configurations.saveDraft(input, owner);
        expect(saved).toMatchObject({ lifecycle: "live", revision: before.revision + 1, presentation: { leftSide: "HOME" } }); expect(saved.teams[0]).toMatchObject({ side: "HOME", teamId: "home-team", captainPlayerId: "home-1", starterPlayerIds: ["home-1", "home-2"], gameColor: "#123456" }); expect(saved.teams[0].players.find((player) => player.playerId === "home-1")).toMatchObject({ participating: true, gameShirtNumber: "9" }); expect(saved.teams[0].players.find((player) => player.playerId === "home-3")).toMatchObject({ participating: true, gameShirtNumber: "7" });
        expect(f.liveAuthorization.resolve(f.run.runId)).toMatchObject({ runId: f.run.runId, configurationRevision: snapshotBefore.configurationRevision, configurationHash: snapshotBefore.configurationHash });
        const snapshotAfter = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const eventsAfter = f.localDatabase.readLocalMatchEvents(f.run.runId); const runAfter = f.localDatabase.readLocalGameRun(f.run.runId);
        expect(snapshotAfter).toMatchObject({ initialStateJson: snapshotBefore.initialStateJson, initialStateHash: snapshotBefore.initialStateHash, configurationRevision: snapshotBefore.configurationRevision, configurationHash: snapshotBefore.configurationHash, eventHistoryRevision: snapshotBefore.eventHistoryRevision + 1 });
        expect(eventsAfter.slice(0, eventsBefore.length)).toEqual(eventsBefore); expect(eventsAfter).toHaveLength(eventsBefore.length + 1); expect(JSON.parse(eventsAfter.at(-1).eventJson)).toMatchObject({ type: "ROSTER_PLAYER_ADDED", team: "HOME", playerId: "home-3", displayName: "Home Three", shirtNumber: "7", sequence: runBefore.lastAcceptedSequence + 1 });
        expect(runAfter).toMatchObject({ runId: runBefore.runId, packageId: runBefore.packageId, packageHash: runBefore.packageHash, lastAcceptedSequence: runBefore.lastAcceptedSequence + 1 });
        const readAfterAmendment = f.localDatabase.readLocalMatchEvents.bind(f.localDatabase); let amendmentReloads = 0; f.localDatabase.readLocalMatchEvents = (runId) => { amendmentReloads += 1; return readAfterAmendment(runId); };
        const substituted = await f.gameplay.append(f.run.runId, owner, { type: "SUBSTITUTION", team: "HOME", playerInId: "home-3", playerOutId: "home-1" }); expect(amendmentReloads).toBe(1); expect(substituted.state.home.players.find((player) => player.playerId === "home-3")).toMatchObject({ shirtNumber: "7", onCourt: true });
        const recovered = await f.gameplay.recover(f.run.runId, owner); expect(recovered.state).toEqual(substituted.state); expect(recovered.state.home.players.find((player) => player.playerId === "home-3")).toMatchObject({ playerId: "home-3", shirtNumber: "7", onCourt: true });
    });

    it("persists presentation and shirt corrections as current configuration without fabricating gameplay events", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const before = f.configurations.getOrCreate("game-gameplay", owner).configuration; const input = configurationDraft(before); const home = input.teams.find((team) => team.side === "HOME"); home.players.find((player) => player.playerId === "home-1").gameShirtNumber = "9"; home.gameColor = "#123456"; input.presentation.leftSide = "HOME";
        const snapshotBefore = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const eventsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId); const saved = f.configurations.saveDraft(input, owner);
        expect(saved).toMatchObject({ lifecycle: "live", revision: before.revision + 1, presentation: { leftSide: "HOME" } }); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(eventsBefore); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(snapshotBefore); expect(f.localDatabase.readLocalGameplaySyncState(f.run.runId).lastErrorCode).toBe("SYNC_PENDING_CONFIGURATION");
    });

    it("uses append-only storage for normal accepted events", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const database = new DatabaseSync(f.localDatabase.databasePath); database.exec("CREATE TRIGGER reject_gameplay_delete BEFORE DELETE ON local_match_events BEGIN SELECT RAISE(ABORT, 'append attempted rewrite'); END;"); database.close();
        const appended = await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); expect(appended.eventHistoryRevision).toBe(2); expect(f.localDatabase.readLocalMatchEvents(f.run.runId).map((event) => event.sequence)).toEqual([1, 2]);
    });

    it("does not reload or replay durable history for normal ADD after Start", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); f.localDatabase.readLocalMatchEvents = () => { throw new Error("normal append loaded durable history"); };
        const started = await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); const stopped = await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_STOP" }); expect(started.lastAcceptedSequence).toBe(2); expect(stopped.lastAcceptedSequence).toBe(3); expect(stopped.state.clockRunning).toBe(false);
    });

    it("replays once after restart and then keeps normal ADD incremental", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); const restarted = new MatchGameplayManager(f.setup, f.localDatabase, deviceId, () => new Date("2026-08-26T13:00:00.000Z"), () => "restart-event"); const originalRead = f.localDatabase.readLocalMatchEvents.bind(f.localDatabase); let reads = 0; f.localDatabase.readLocalMatchEvents = (runId) => { reads += 1; return originalRead(runId); };
        const recovered = await restarted.recover(f.run.runId, owner); expect(reads).toBe(1); reads = 0; const stopped = await restarted.append(f.run.runId, owner, { type: "CLOCK_STOP" }); expect(reads).toBe(0); expect(stopped.state.clockRunning).toBe(false); expect(stopped.lastAcceptedSequence).toBe(recovered.lastAcceptedSequence + 1);
    });

    it("bounds the Run-scoped runtime cache, evicts the oldest inactive Run, and recovers it deterministically", async () => {
        const f = fixture(); const secondRun = addFixtureRun(f, "second"); const thirdRun = addFixtureRun(f, "third"); let eventId = 0; const gameplay = new MatchGameplayManager(f.setup, f.localDatabase, deviceId, () => new Date("2026-08-26T13:00:00.000Z"), () => `cache-event-${++eventId}`, () => "synthetic-cache-authorization", 2);
        const firstStarted = await gameplay.initialize(f.run.runId, owner); await gameplay.initialize(secondRun.runId, owner); await gameplay.initialize(thirdRun.runId, owner);
        expect([...gameplay.sessions.keys()]).toEqual([secondRun.runId, thirdRun.runId]);
        const originalRead = f.localDatabase.readLocalMatchEvents.bind(f.localDatabase); const reads = new Map(); f.localDatabase.readLocalMatchEvents = (runId) => { reads.set(runId, (reads.get(runId) ?? 0) + 1); return originalRead(runId); };
        const secondAccepted = await gameplay.append(secondRun.runId, owner, { type: "CLOCK_START" }); expect(reads.get(secondRun.runId) ?? 0).toBe(0);
        const firstAccepted = await gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); expect(reads.get(f.run.runId)).toBe(1); expect(firstAccepted.state.clockRunning).toBe(true); expect(firstStarted.lastAcceptedSequence).toBe(1);
        await gameplay.append(secondRun.runId, owner, { type: "CLOCK_STOP" }); expect(reads.get(secondRun.runId) ?? 0).toBe(0); expect(f.localDatabase.readLocalGameRun(secondRun.runId).lastAcceptedSequence).toBe(secondAccepted.lastAcceptedSequence + 1); expect(f.localDatabase.readLocalGameRun(thirdRun.runId).lastAcceptedSequence).toBe(1);
        const firstRows = originalRead(f.run.runId); gameplay.clearRuntimeSessions(); expect(gameplay.sessions.size).toBe(0); expect(originalRead(f.run.runId)).toEqual(firstRows);
        const recovered = await gameplay.recover(f.run.runId, owner); expect(recovered.state).toEqual(firstAccepted.state); expect(gameplay.sessions.size).toBe(1);
    });

    it("evicts a finalized runtime session while preserving durable recovery", async () => {
        const f = fixture({ tie_allowed: true, winner_required: false, regulation_periods: 1 }); await f.gameplay.initialize(f.run.runId, owner); expect(f.gameplay.sessions.has(f.run.runId)).toBe(true); await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0 }); await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } }); const finalized = await f.gameplay.finalize(f.run.runId, owner); expect(f.gameplay.sessions.has(f.run.runId)).toBe(false); const rowsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId); const recovered = await f.gameplay.recover(f.run.runId, owner); expect(recovered.state).toEqual(finalized.state); expect(f.gameplay.sessions.has(f.run.runId)).toBe(false); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(rowsBefore);
    });

    it("isolates incremental runtime state and failures by Run", async () => {
        const f = fixture(); const secondGameId = "game-gameplay-second"; const secondPayload = payload(); secondPayload.game = { ...secondPayload.game, id: secondGameId };
        const payloadJson = JSON.stringify(secondPayload); f.localDatabase.storeVerifiedGamePackage({ packageId: "package-gameplay-second-v1", gameId: secondGameId, packageVersion: 1, packageSchemaVersion: 1, payloadJson, payloadHash: createHash("sha256").update(Buffer.from(payloadJson, "utf8")).digest("hex"), publishedAtUtc: "2026-08-26T10:01:00.000Z" });
        const secondRun = new MatchRunManager(f.setup, f.localDatabase, deviceId).createOrOpen(secondGameId, owner).run; const secondInitial = f.configurations.getOrCreate(secondGameId, owner).configuration; f.configurations.saveDraft(configurationDraft(secondInitial), owner);
        let eventId = 0; const gameplay = new MatchGameplayManager(f.setup, f.localDatabase, deviceId, () => new Date("2026-08-26T13:00:00.000Z"), () => `multi-run-event-${++eventId}`, () => "synthetic-sealed-live-authorization");
        await Promise.all([gameplay.initialize(f.run.runId, owner), gameplay.initialize(secondRun.runId, owner)]); await Promise.all([gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }), gameplay.append(secondRun.runId, owner, { type: "CLOCK_START" })]);
        const [failed, independent] = await Promise.allSettled([gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }), gameplay.append(secondRun.runId, owner, { type: "CLOCK_STOP" })]);
        expect(failed.status).toBe("rejected"); expect(independent.status).toBe("fulfilled"); expect(f.localDatabase.readLocalMatchEvents(f.run.runId).map((event) => event.sequence)).toEqual([1, 2]); expect(f.localDatabase.readLocalMatchEvents(secondRun.runId).map((event) => event.sequence)).toEqual([1, 2, 3]);
    });

    it("rejects local acknowledgment that is not exactly bound to current history and configuration", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const snapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const configuration = f.localDatabase.readLocalGameRunConfiguration(f.run.runId); const events = f.localDatabase.readLocalMatchEvents(f.run.runId); const historyHash = createHash("sha256").update(Buffer.from(`[${events.map((event) => event.eventJson).join(",")}]`, "utf8")).digest("hex"); const before = f.localDatabase.readLocalGameplaySyncState(f.run.runId);
        expect(() => f.localDatabase.acknowledgeGameplaySync({ runId: f.run.runId, historyRevision: snapshot.eventHistoryRevision, historyHash, configurationRevision: configuration.revision, configurationHash: "f".repeat(64), finalizationHash: null, succeededAtUtc: "2026-08-26T13:00:00.000Z" })).toThrow(/does not match current local Run state/); expect(f.localDatabase.readLocalGameplaySyncState(f.run.runId)).toEqual(before);
    });

    it.each([
        ["existing participant removal", "LIVE_PARTICIPANT_REMOVAL_NOT_ALLOWED", (input) => { input.teams[0].players.find((player) => player.playerId === "home-1").participating = false; }],
        ["missing number on added player", "LIVE_SHIRT_NUMBER_REQUIRED", (input) => { Object.assign(input.teams[0].players.find((player) => player.playerId === "home-3"), { participating: true, gameShirtNumber: null }); }],
        ["duplicate number on added player", "LIVE_SHIRT_NUMBER_DUPLICATE", (input) => { Object.assign(input.teams[0].players.find((player) => player.playerId === "home-3"), { participating: true, gameShirtNumber: "0" }); }],
        ["invalid number on added player", "LIVE_SHIRT_NUMBER_INVALID", (input) => { Object.assign(input.teams[0].players.find((player) => player.playerId === "home-3"), { participating: true, gameShirtNumber: "01" }); }],
        ["required team color removal", "LIVE_TEAM_COLOR_REQUIRED", (input) => { input.teams[0].gameColor = null; }],
        ["captain mutation", "LIVE_LOCKED_FIELD_CHANGE", (input) => { input.teams[0].captainPlayerId = "home-2"; }],
        ["bench mutation", "LIVE_LOCKED_FIELD_CHANGE", (input) => { input.teams[0].extraBench = [{ entryId: "55555555-5555-4555-8555-555555555555", name: "Synthetic Bench", role: "coach" }]; }],
    ])("rejects LIVE %s with typed validation and zero configuration/gameplay writes", async (_label, code, mutate) => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const current = f.configurations.getOrCreate("game-gameplay", owner).configuration; const input = configurationDraft(current); mutate(input);
        const storedBefore = f.localDatabase.readLocalGameRunConfiguration(f.run.runId); const snapshotBefore = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const eventsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId); let failure;
        try { f.configurations.saveDraft(input, owner); } catch (error) { failure = error; }
        expect(failure).toMatchObject({ code: "CONFIGURATION_INVALID", validation: { code } }); expect(f.localDatabase.readLocalGameRunConfiguration(f.run.runId)).toEqual(storedBefore); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(snapshotBefore); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(eventsBefore);
    });

    it("rejects adding a LIVE participant above the Package maximum with zero writes", async () => {
        const f = fixture({ max_players: 2 }); await f.gameplay.initialize(f.run.runId, owner); const current = f.configurations.getOrCreate("game-gameplay", owner).configuration; const input = configurationDraft(current); Object.assign(input.teams[0].players.find((player) => player.playerId === "home-3"), { participating: true, gameShirtNumber: "7" }); const before = f.localDatabase.readLocalGameRunConfiguration(f.run.runId); let failure;
        try { f.configurations.saveDraft(input, owner); } catch (error) { failure = error; }
        expect(failure).toMatchObject({ validation: { code: "LIVE_PARTICIPANT_COUNT_ABOVE_MAXIMUM", teamSide: "HOME" } }); expect(f.localDatabase.readLocalGameRunConfiguration(f.run.runId)).toEqual(before);
    });

    it("rejects finalized configuration access without changing local gameplay or configuration", async () => {
        const f = fixture({ tie_allowed: true, winner_required: false, regulation_periods: 1 }); await f.gameplay.initialize(f.run.runId, owner); await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0 }); await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } }); await f.gameplay.finalize(f.run.runId, owner); const storedBefore = f.localDatabase.readLocalGameRunConfiguration(f.run.runId); const eventsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId);
        expect(() => f.configurations.getOrCreate("game-gameplay", owner)).toThrow(/CONFIGURATION_CONFLICT/); expect(f.localDatabase.readLocalGameRunConfiguration(f.run.runId)).toEqual(storedBefore); expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(eventsBefore);
    });
});
