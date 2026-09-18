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
import { activeGameLineupDecision } from "../../src/components/LiveControl.tsx";

const owner = { scorerId: "scorer-gameplay-fixture", organizationId: "organization-gameplay-fixture" };
const deviceId = "33333333-3333-4333-8333-333333333333";
const roots = [];
const databases = [];

function payload(overrides = {}, playerCount = 3) {
    const extraPlayers = (side) => Array.from({ length: Math.max(0, playerCount - 3) }, (_, index) => ({ id: `${side}-${index + 4}`, displayName: `${side} ${index + 4}`, shirtNumber: index + 8, photoUrl: null }));
    return {
        schemaVersion: 1,
        game: { id: "game-gameplay", organizationId: owner.organizationId, competitionId: "competition-1", competitionName: "Gameplay Competition", seasonName: "2026-27", phaseName: "League", roundLabel: "Round 1", scheduledDate: "2026-08-26", scheduledTime: "19:00", scheduledAt: "2026-08-26T16:00:00.000Z", venue: null },
        settings: { game_mode: "FULL", min_players: 2, max_players: 12, starting_players: 2, regulation_periods: 4, regulation_period_seconds: 600, overtime_seconds: 300, tie_allowed: false, winner_required: true, ...overrides },
        teams: [
            { side: "AWAY", id: "away-team", name: "Away Team", logoUrl: null, players: [{ id: "away-1", displayName: "Away One", shirtNumber: 0, photoUrl: null }, { id: "away-2", displayName: "Away Two", shirtNumber: null, photoUrl: null }, { id: "away-3", displayName: "Away Three", shirtNumber: 7, photoUrl: null }, ...extraPlayers("away")], staff: [] },
            { side: "HOME", id: "home-team", name: "Home Team", logoUrl: null, players: [{ id: "home-1", displayName: "Home One", shirtNumber: 0, photoUrl: null }, { id: "home-2", displayName: "Home Two", shirtNumber: null, photoUrl: null }, { id: "home-3", displayName: "Home Three", shirtNumber: 7, photoUrl: null }, ...extraPlayers("home")], staff: [] },
        ],
    };
}

function packageInput(settings = {}, playerCount = 3) {
    const payloadJson = JSON.stringify(payload(settings, playerCount));
    return { packageId: "package-gameplay-v2", gameId: "game-gameplay", packageVersion: 2, packageSchemaVersion: 1, payloadJson, payloadHash: createHash("sha256").update(Buffer.from(payloadJson, "utf8")).digest("hex"), publishedAtUtc: "2026-08-26T10:00:00.000Z" };
}

function copyMigrations(target, maximum = "0008") {
    fs.mkdirSync(target, { recursive: true });
    for (const name of fs.readdirSync(path.resolve("electron/migrations")).filter((name) => name.endsWith(".sql") && name.slice(0, 4) <= maximum).sort()) fs.copyFileSync(path.resolve("electron/migrations", name), path.join(target, name));
}

function configurationDraft(configuration, starterCount = 2) {
    return {
        gameId: configuration.gameId,
        expectedRevision: configuration.revision,
        teams: configuration.teams.map((team) => ({
            side: team.side,
            players: team.players.map((player) => {
                const participating = Number(player.playerId.split("-").at(-1)) <= starterCount;
                const gameShirtNumber = player.playerId.endsWith("-1") ? "0" : player.playerId.endsWith("-2") ? (team.side === "HOME" ? "00" : "2") : player.gameShirtNumber;
                return { playerId: player.playerId, participating, gameShirtNumber };
            }),
            staff: team.staff.map((member) => ({ staffId: member.staffId, participating: false })),
            extraBench: [],
            captainPlayerId: `${team.side.toLowerCase()}-1`,
            starterPlayerIds: Array.from({ length: starterCount }, (_, index) => `${team.side.toLowerCase()}-${index + 1}`),
            gameColor: team.side === "HOME" ? "#D62828" : "#168B4B",
        })),
        presentation: { leftSide: "AWAY" },
    };
}

function fixture(settings = {}, playerCount = 3) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "komocontrol-gameplay-")); roots.push(root);
    const migrationsDirectory = path.join(root, "migrations"); copyMigrations(migrationsDirectory);
    const localDatabase = new LocalDatabase({ databasePath: path.join(root, "komocontrol.sqlite"), migrationsDirectory, backupDirectory: path.join(root, "backups") }); databases.push(localDatabase);
    localDatabase.initialize();
    const identity = localDatabase.getDeviceIdentity();
    if (identity.deviceId !== deviceId) {
        localDatabase.close();
        const raw = new DatabaseSync(localDatabase.databasePath); raw.prepare("UPDATE device_identity SET device_id = ? WHERE singleton_key = 1").run(deviceId); raw.close();
        const reopened = new LocalDatabase({ databasePath: localDatabase.databasePath, migrationsDirectory, backupDirectory: path.join(root, "backups") }); databases.push(reopened); reopened.initialize();
        return populatedFixture(root, migrationsDirectory, reopened, settings, playerCount);
    }
    return populatedFixture(root, migrationsDirectory, localDatabase, settings, playerCount);
}

function populatedFixture(root, migrationsDirectory, localDatabase, settings, playerCount = 3) {
    localDatabase.storeVerifiedGamePackage(packageInput(settings, playerCount));
    const setup = new MatchSetupManager(localDatabase);
    const run = new MatchRunManager(setup, localDatabase, deviceId).createOrOpen("game-gameplay", owner).run;
    const configurations = new PreGameConfigurationManager(setup, localDatabase, deviceId);
    const initial = configurations.getOrCreate("game-gameplay", owner).configuration;
    const configuration = configurations.saveDraft(configurationDraft(initial, settings.starting_players ?? 2), owner);
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

function draftEvents(group) {
    return group.items.map((item) => ({ draftId: item.eventId, eventId: item.eventId, facts: item.facts }));
}

function factsOf(group, type) {
    return group.items.find((item) => item.type === type)?.facts;
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

describe("SIMPLE mode discipline and reduced-lineup certification", () => {
    const cases = [
        ["C", ["COACH"], 1, 0, false],
        ["C+C", ["COACH", "COACH"], 2, 0, true],
        ["B", ["BENCH"], 0, 1, false],
        ["B+B", ["BENCH", "BENCH"], 0, 2, false],
        ["C+B", ["COACH", "BENCH"], 1, 1, false],
        ["B+C", ["BENCH", "COACH"], 1, 1, false],
        ["C+B+B", ["COACH", "BENCH", "BENCH"], 1, 2, true],
        ["B+C+B", ["BENCH", "COACH", "BENCH"], 1, 2, true],
        ["B+B+C", ["BENCH", "BENCH", "COACH"], 1, 2, true],
        ["B+B+B", ["BENCH", "BENCH", "BENCH"], 0, 3, true],
    ];

    it.each(cases)("persists and recovers SIMPLE staff technical sequence %s", async (_label, sources, expectedCoach, expectedBench, expectedDisqualified) => {
        const f = fixture({ game_mode: "SIMPLE" });
        const started = await f.gameplay.initialize(f.run.runId, owner);
        expect(started.setup.settings.gameMode).toBe("SIMPLE");
        let live = started;
        for (const [index, technicalStaffSource] of sources.entries()) {
            const offender = technicalStaffSource === "COACH"
                ? { kind: "BENCH", personId: "coach:HOME", role: "HEAD_COACH" }
                : { kind: "BENCH", personId: "bench:HOME", role: "ACCOMPANYING_DELEGATION" };
            const foul = await f.gameplay.append(f.run.runId, owner, { type: "TECHNICAL_FOUL", team: "HOME", stoppageId: `simple-staff-${index}`, offender, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1", scorerEventId: `simple-staff-${index}`, scorerEventContext: { technicalStaffSource } });
            live = await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: `penalty:${foul.eventIds.at(-1)}` });
        }
        const expectedDiscipline = { headCoachCategory1TechnicalCount: expectedCoach, benchCategory1TechnicalCount: expectedBench, headCoachDisqualified: expectedDisqualified };
        expect(live.state.home.discipline).toMatchObject(expectedDiscipline);
        const persisted = f.localDatabase.readLocalMatchEvents(f.run.runId).map((row) => JSON.parse(row.eventJson)).filter((event) => event.type === "TECHNICAL_FOUL");
        expect(persisted).toHaveLength(sources.length);
        for (const [index, source] of sources.entries()) {
            expect(persisted[index]).toMatchObject({ offender: source === "COACH" ? { kind: "BENCH", personId: "coach:HOME", role: "HEAD_COACH" } : { kind: "BENCH", personId: "bench:HOME", role: "ACCOMPANYING_DELEGATION" }, scorerEventContext: { technicalStaffSource: source } });
        }
        const replayed = await f.gameplay.recover(f.run.runId, owner);
        const recovered = await new MatchGameplayManager(f.setup, f.localDatabase, deviceId).recover(f.run.runId, owner);
        expect(replayed.setup.settings.gameMode).toBe("SIMPLE");
        expect(recovered.setup.settings.gameMode).toBe("SIMPLE");
        expect(replayed.state).toEqual(live.state);
        expect(recovered.state).toEqual(live.state);
        expect(recovered.state.home.discipline).toMatchObject(expectedDiscipline);
    });

    it("continues SIMPLE bench technical attribution after direct coach disqualification", async () => {
        const f = fixture({ game_mode: "SIMPLE" });
        const started = await f.gameplay.initialize(f.run.runId, owner);
        expect(started.setup.settings.gameMode).toBe("SIMPLE");
        for (const index of [0, 1]) {
            const foul = await f.gameplay.append(f.run.runId, owner, { type: "TECHNICAL_FOUL", team: "HOME", stoppageId: `simple-coach-${index}`, offender: { kind: "BENCH", personId: "coach:HOME", role: "HEAD_COACH" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1", scorerEventContext: { technicalStaffSource: "COACH" } });
            await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: `penalty:${foul.eventIds.at(-1)}` });
        }
        expect((await f.gameplay.recover(f.run.runId, owner)).state.home.discipline.headCoachDisqualified).toBe(true);
        const bench = await f.gameplay.append(f.run.runId, owner, { type: "TECHNICAL_FOUL", team: "HOME", stoppageId: "simple-bench-after-coach-dq", offender: { kind: "BENCH", personId: "bench:HOME", role: "ACCOMPANYING_DELEGATION" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1", scorerEventContext: { technicalStaffSource: "BENCH" } });
        expect(bench.state.home.discipline).toMatchObject({ headCoachCategory1TechnicalCount: 2, benchCategory1TechnicalCount: 1, headCoachDisqualified: true });
    });

    it("replays and recovers SIMPLE 5-to-4-to-3-to-2 foul-outs without substitutes, then blocks normal play at one", async () => {
        const f = fixture({ game_mode: "SIMPLE", min_players: 5, starting_players: 5 }, 5);
        const started = await f.gameplay.initialize(f.run.runId, owner);
        expect(started.setup.settings.gameMode).toBe("SIMPLE");
        expect(started.state.rules.startingPlayers).toBe(5);
        const decision = (state) => activeGameLineupDecision(state.home.players.map((player) => ({ playerId: player.playerId, onCourt: player.onCourt, fouls: { status: player.foulState.status } })), 5);
        expect(decision(started.state)).toMatchObject({ projectedOnCourtCount: 5, normalGameplayAllowed: true });
        let live = started;
        for (const excludedPlayer of [1, 2, 3, 4]) {
            for (let foulNumber = 1; foulNumber <= 5; foulNumber++) {
                const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "HOME", stoppageId: `simple-foul-${excludedPlayer}-${foulNumber}`, offender: { kind: "PLAYER", playerId: `home-${excludedPlayer}` }, context: { kind: "NON_SHOOTING", teamControlFoul: false }, fouledPlayerId: "away-1" });
                live = foul;
                const penalty = foul.state.penaltyResolution?.freeThrowQueue[0];
                if (penalty) live = await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: penalty.penaltyId });
            }
            const expectedActive = 5 - excludedPlayer;
            const current = decision(live.state);
            expect(current.eligibleSubstituteIds).toEqual([]);
            expect(current.mandatoryReplacementIds).toEqual([]);
            expect(current.projectedOnCourtCount).toBe(expectedActive);
            expect(current.normalGameplayAllowed).toBe(expectedActive >= 2);
            expect(new Set(live.state.home.players.map((player) => player.playerId)).size).toBe(5);
            expect(live.state.home.players.find((player) => player.playerId === `home-${excludedPlayer}`).foulState.status).toBe("EXCLUDED");
            if (excludedPlayer === 3) {
                const replayed = await f.gameplay.recover(f.run.runId, owner);
                const recovered = await new MatchGameplayManager(f.setup, f.localDatabase, deviceId).recover(f.run.runId, owner);
                expect(replayed.setup.settings.gameMode).toBe("SIMPLE");
                expect(recovered.setup.settings.gameMode).toBe("SIMPLE");
                expect(replayed.state).toEqual(live.state);
                expect(recovered.state).toEqual(live.state);
                expect(decision(recovered.state)).toEqual(current);
            }
        }
        expect(decision(live.state)).toMatchObject({ projectedOnCourtCount: 1, normalGameplayAllowed: false });
    });
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
        fs.copyFileSync(path.resolve("electron/migrations/0008_resumable_live_flows.sql"), path.join(migrationsDirectory, "0008_resumable_live_flows.sql"));
        const migrated = new LocalDatabase({ databasePath, migrationsDirectory, backupDirectory: path.join(root, "backups") }); databases.push(migrated);
        expect(migrated.initialize().schemaVersion).toBe("0008_resumable_live_flows.sql"); expect(migrated.getDeviceIdentity().deviceId).toBe(preservedDevice); expect(migrated.readGamePackage("package-gameplay-v2")?.packageVersion).toBe(2); expect(migrated.readLocalGameRun(runId)?.runId).toBe(runId); expect(migrated.readLocalGameRunConfiguration(runId)?.revision).toBe(1); expect(migrated.readLocalMatchEngineSnapshot(runId)).toBeNull(); expect(migrated.readLocalMatchEvents(runId)).toEqual([]); expect(migrated.readLocalResumableLiveFlow(runId)).toBeNull();
    });

    it("bootstraps strict HOME/AWAY participating identity, text numbers, starters, and pinned rules", async () => {
        const f = fixture(); const started = await f.gameplay.initialize(f.run.runId, owner); const state = started.state;
        expect(state.id).toBe(f.run.runId); expect(state.started).toBe(true); expect(state.lastProcessedSequence).toBe(1); expect(state.possession).toBeNull();
        expect(state.home.id).toBe("home-team"); expect(state.away.id).toBe("away-team"); expect(state.home.players.map((player) => [player.playerId, player.displayName, player.shirtNumber, player.onCourt])).toEqual([["home-1", "Home One", "0", true], ["home-2", "Home Two", "00", true]]); expect(state.away.players.map((player) => player.playerId)).toEqual(["away-1", "away-2"]);
        expect(state.rules).toMatchObject({ schemaVersion: 1, rulesEdition: "FIBA_2026", minPlayers: 2, maxPlayers: 12, startingPlayers: 2, regulationPeriods: 4, regulationPeriodSeconds: 600, overtimeSeconds: 300, resultPolicy: "REQUIRE_WINNER" });
        const snapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); expect(snapshot.initialStateJson).not.toContain("captainPlayerId"); expect(snapshot.initialStateJson).not.toContain("gameColor"); expect(snapshot.initialStateJson).not.toContain("leftSide");
    });

    it("persists ACTIVE Run officials without gameplay events or Package writeback and recovers them after restart", async () => {
        const f = fixture();
        const packageBefore = f.localDatabase.readGamePackage("package-gameplay-v2");
        await f.gameplay.initialize(f.run.runId, owner);
        const live = f.configurations.getOrCreate("game-gameplay", owner).configuration;
        const eventsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId);
        const sequenceBefore = f.localDatabase.readLocalGameRun(f.run.runId).lastAcceptedSequence;
        const officials = { referees: { a: "Person B", b: null, c: null }, table: { timer: null, shotClock: "Manual Person X", scoresheet: null, commissioner: null } };
        const saved = f.configurations.saveDraft({ ...configurationDraft(live), expectedRevision: live.revision, officials }, owner);

        expect(saved).toMatchObject({ lifecycle: "live", officials });
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(eventsBefore);
        expect(f.localDatabase.readLocalGameRun(f.run.runId).lastAcceptedSequence).toBe(sequenceBefore);
        expect(f.localDatabase.readGamePackage("package-gameplay-v2")).toEqual(packageBefore);

        f.localDatabase.close();
        const reopened = new LocalDatabase({ databasePath: f.localDatabase.databasePath, migrationsDirectory: f.migrationsDirectory, backupDirectory: path.join(f.root, "backups") });
        databases.push(reopened);
        reopened.initialize();
        const recovered = new PreGameConfigurationManager(new MatchSetupManager(reopened), reopened, deviceId).getOrCreate("game-gameplay", owner).configuration;
        expect(recovered).toMatchObject({ lifecycle: "live", officials });
        expect(reopened.readLocalMatchEvents(f.run.runId)).toEqual(eventsBefore);
        expect(reopened.readLocalGameRun(f.run.runId).lastAcceptedSequence).toBe(sequenceBefore);
    });

    it("adds, edits, removes, and recovers ACTIVE Run-only Extra Bench without gameplay or Package writes", async () => {
        const f = fixture();
        const packageBefore = f.localDatabase.readGamePackage("package-gameplay-v2");
        await f.gameplay.initialize(f.run.runId, owner);
        const eventsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId);
        const sequenceBefore = f.localDatabase.readLocalGameRun(f.run.runId).lastAcceptedSequence;
        const entryId = "55555555-5555-4555-8555-555555555555";
        const withHomeBench = (configuration, extraBench) => {
            const input = configurationDraft(configuration);
            return { ...input, expectedRevision: configuration.revision, teams: input.teams.map((team) => team.side === "HOME" ? { ...team, extraBench } : team) };
        };

        const live = f.configurations.getOrCreate("game-gameplay", owner).configuration;
        const added = f.configurations.saveDraft(withHomeBench(live, [{ entryId, name: "Run Coach", role: "coach" }]), owner);
        expect(added.teams.find((team) => team.side === "HOME").extraBench).toEqual([{ entryId, name: "Run Coach", role: "coach" }]);

        const edited = f.configurations.saveDraft(withHomeBench(added, [{ entryId, name: "Run Doctor", role: "doctor" }]), owner);
        expect(edited.teams.find((team) => team.side === "HOME").extraBench).toEqual([{ entryId, name: "Run Doctor", role: "doctor" }]);
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(eventsBefore);
        expect(f.localDatabase.readLocalGameRun(f.run.runId).lastAcceptedSequence).toBe(sequenceBefore);
        expect(f.localDatabase.readGamePackage("package-gameplay-v2")).toEqual(packageBefore);

        f.localDatabase.close();
        const reopened = new LocalDatabase({ databasePath: f.localDatabase.databasePath, migrationsDirectory: f.migrationsDirectory, backupDirectory: path.join(f.root, "backups") });
        databases.push(reopened);
        reopened.initialize();
        const configurations = new PreGameConfigurationManager(new MatchSetupManager(reopened), reopened, deviceId);
        const recovered = configurations.getOrCreate("game-gameplay", owner).configuration;
        expect(recovered.teams.find((team) => team.side === "HOME").extraBench).toEqual([{ entryId, name: "Run Doctor", role: "doctor" }]);

        const removed = configurations.saveDraft(withHomeBench(recovered, []), owner);
        expect(removed.teams.find((team) => team.side === "HOME").extraBench).toEqual([]);
        expect(reopened.readLocalMatchEvents(f.run.runId)).toEqual(eventsBefore);
        expect(reopened.readLocalGameRun(f.run.runId).lastAcceptedSequence).toBe(sequenceBefore);
        expect(reopened.readGamePackage("package-gameplay-v2")).toEqual(packageBefore);
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

    it("persists one run-scoped incomplete shooting-foul flow without duplicating MatchEvents and clears it atomically on the final free throw", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: "resumable-stoppage" });
        const rootEventId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "resumable-stoppage", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: rootEventId });
        const sourceFoulEventId = foul.eventIds.at(-1); const before = f.localDatabase.readLocalMatchEvents(f.run.runId);
        const saved = await f.gameplay.saveResumableLiveFlow(f.run.runId, owner, { flowKind: "SHOOTING_FOUL", stage: "PENALTY", rootEventId, sourceFoulEventId, selectedFreeThrowShooterId: "home-2", expectedHistoryRevision: foul.eventHistoryRevision });
        expect(saved).toMatchObject({ flowKind: "SHOOTING_FOUL", stage: "PENALTY", rootEventId, sourceFoulEventId, selectedFreeThrowShooterId: "home-2" });
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(before);
        const recovered = await new MatchGameplayManager(f.setup, f.localDatabase, deviceId).recover(f.run.runId, owner);
        expect(f.localDatabase.readLocalResumableLiveFlow(f.run.runId)).toMatchObject({ selectedFreeThrowShooterId: "home-2", eventHistoryRevision: recovered.eventHistoryRevision });
        const penaltyId = `penalty:${sourceFoulEventId}`;
        await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-2", penaltyId, attemptIndex: 1, made: true });
        await f.gameplay.appendAndResolveResumableFlow(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-2", penaltyId, attemptIndex: 2, made: true });
        expect(f.localDatabase.readLocalResumableLiveFlow(f.run.runId)).toBeNull();
    });

    it("persists an early penalty administration end without inventing a free throw", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "FLAGRANT_FOUL", team: "AWAY", stoppageId: "early-flagrant", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "NON_SHOOTING", teamControlFoul: false }, fouledPlayerId: "home-1" });
        const penaltyId = `penalty:${foul.eventIds.at(-1)}`;
        const ended = await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId });
        expect(ended.state.penaltyResolution?.freeThrowQueue).toEqual([]);
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId).map((event) => JSON.parse(event.eventJson).type)).toEqual(["MATCH_START", "FLAGRANT_FOUL", "PENALTY_ADMINISTRATION_ENDED"]);
        expect((await new MatchGameplayManager(f.setup, f.localDatabase, deviceId).recover(f.run.runId, owner)).state).toEqual(ended.state);
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

    it("enforces dense ordering and exact high-water only for DENSE_RENUMBERED history rewrites", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); await f.gameplay.append(f.run.runId, owner, { type: "TIMEOUT", team: "HOME" });
        const snapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const run = f.localDatabase.readLocalGameRun(f.run.runId); const beforeEvents = f.localDatabase.readLocalMatchEvents(f.run.runId);
        const rewritten = (sequences) => beforeEvents.map((row, index) => { const event = { ...JSON.parse(row.eventJson), sequence: sequences[index] }; const eventJson = deterministicJson(event); return { eventId: row.eventId, sequence: sequences[index], eventSchemaVersion: 2, eventJson, eventHash: sha256JsonBytes(eventJson), persistedAtUtc: row.persistedAtUtc }; });
        const input = (events, lastAcceptedSequence) => ({ runId: f.run.runId, organizationId: owner.organizationId, scorerId: owner.scorerId, deviceId, expectedHistoryRevision: snapshot.eventHistoryRevision, lastAcceptedSequence, events, updatedAtUtc: "2026-08-26T13:00:00.000Z", sequencePolicy: "DENSE_RENUMBERED" });
        expect(() => f.localDatabase.rewriteLocalMatchEventHistory(input(rewritten([1, 3]), 3))).toThrow(/history ordering is invalid/);
        expect(() => f.localDatabase.rewriteLocalMatchEventHistory(input(rewritten([1, 1]), 1))).toThrow(/history ordering is invalid/);
        expect(() => f.localDatabase.rewriteLocalMatchEventHistory(input(rewritten([1, 2]), 3))).toThrow(/high-water sequence is invalid/);
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(beforeEvents); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(snapshot); expect(f.localDatabase.readLocalGameRun(f.run.runId)).toEqual(run);
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
        const f = fixture(); let localPackageReads = 0; const localSetup = { getVerifiedPackageMatchSetup: (packageId) => { localPackageReads += 1; return f.setup.getVerifiedPackageMatchSetup(packageId); }, getMatchSetup: (gameId) => { localPackageReads += 1; return f.setup.getMatchSetup(gameId); } }; const gameplay = new MatchGameplayManager(localSetup, f.localDatabase, deviceId, undefined, undefined, () => "sealed-live-run-authorization"); await gameplay.initialize(f.run.runId, owner); await gameplay.append(f.run.runId, owner, { type: "CLOCK_START" }); await gameplay.recover(f.run.runId, owner); expect(localPackageReads).toBe(4);
    });

    it("persists and replays stopped zero without disturbing an active free-throw penalty", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" });
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: "clock-zero-penalty", scorerEventId: "clock-zero-penalty" }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "clock-zero-penalty", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId: "clock-zero-penalty" });
        const penaltyId = `penalty:${foul.eventIds.at(-1)}`; const penaltyBefore = foul.state.penaltyResolution;
        const expired = await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0 });
        expect(expired.state).toMatchObject({ period: { kind: "REGULATION", index: 1 }, clock: 0, clockRunning: false, penaltyResolution: penaltyBefore });
        const eventTypes = f.localDatabase.readLocalMatchEvents(f.run.runId).map((row) => JSON.parse(row.eventJson).type);
        expect(eventTypes.filter((type) => type === "CLOCK_SET")).toHaveLength(1); expect(eventTypes).not.toContain("CLOCK_STOP"); expect(eventTypes).not.toContain("PERIOD_END"); expect(eventTypes).not.toContain("MATCH_END");
        f.gameplay.clearRuntimeSessions(); const recovered = await f.gameplay.recover(f.run.runId, owner);
        expect(recovered.state).toMatchObject({ period: { kind: "REGULATION", index: 1 }, clock: 0, clockRunning: false, penaltyResolution: penaltyBefore });
        const continued = await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId, attemptIndex: 1, made: true, scorerEventId: "clock-zero-penalty" });
        expect(continued.state.penaltyResolution.freeThrowQueue[0]).toEqual({ ...penaltyBefore.freeThrowQueue[0], completedAttempts: 1 });
        expect(f.localDatabase.readLocalGameRun(f.run.runId).status).toBe("active");
    });

    it("persists and replays the first-half, second-half, and per-overtime timeout pools", async () => {
        const f = fixture(); const started = await f.gameplay.initialize(f.run.runId, owner);
        expect(started.state).toMatchObject({ home: { timeouts: 2, timeoutAllowance: 2 }, away: { timeouts: 2, timeoutAllowance: 2 } });
        await f.gameplay.append(f.run.runId, owner, { type: "TIMEOUT", team: "HOME" });
        await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0 }); await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } });
        let current = await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_START", period: { kind: "REGULATION", index: 2 } });
        expect(current.state.home).toMatchObject({ timeouts: 1, timeoutAllowance: 2 });
        f.gameplay.clearRuntimeSessions(); expect((await f.gameplay.recover(f.run.runId, owner)).state.home).toMatchObject({ timeouts: 1, timeoutAllowance: 2 });

        await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0 }); await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_END", period: { kind: "REGULATION", index: 2 } });
        current = await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_START", period: { kind: "REGULATION", index: 3 } });
        expect(current.state).toMatchObject({ home: { timeouts: 3, timeoutAllowance: 3 }, away: { timeouts: 3, timeoutAllowance: 3 } });
        await f.gameplay.append(f.run.runId, owner, { type: "TIMEOUT", team: "HOME" });
        await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0 }); await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_END", period: { kind: "REGULATION", index: 3 } });
        current = await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_START", period: { kind: "REGULATION", index: 4 } });
        expect(current.state.home).toMatchObject({ timeouts: 2, timeoutAllowance: 3 });
        f.gameplay.clearRuntimeSessions(); expect((await f.gameplay.recover(f.run.runId, owner)).state.home).toMatchObject({ timeouts: 2, timeoutAllowance: 3 });

        await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0 }); await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_END", period: { kind: "REGULATION", index: 4 } });
        current = await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_START", period: { kind: "OVERTIME", index: 1 } });
        expect(current.state).toMatchObject({ home: { timeouts: 1, timeoutAllowance: 1 }, away: { timeouts: 1, timeoutAllowance: 1 } });
        await f.gameplay.append(f.run.runId, owner, { type: "TIMEOUT", team: "HOME" });
        await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0 }); await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_END", period: { kind: "OVERTIME", index: 1 } });
        current = await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_START", period: { kind: "OVERTIME", index: 2 } });
        expect(current.state).toMatchObject({ home: { timeouts: 1, timeoutAllowance: 1 }, away: { timeouts: 1, timeoutAllowance: 1 } });
        f.gameplay.clearRuntimeSessions(); const recovered = await f.gameplay.recover(f.run.runId, owner);
        expect(recovered.state).toMatchObject({ period: { kind: "OVERTIME", index: 2 }, home: { timeouts: 1, timeoutAllowance: 1 }, away: { timeouts: 1, timeoutAllowance: 1 } });
    });

    it("atomically creates Run continuity and sync state, then finalizes locally without network", async () => {
        const f = fixture({ tie_allowed: true, winner_required: false, regulation_periods: 1 });
        const started = await f.gameplay.initialize(f.run.runId, owner);
        expect(started.lifecycle).toBe("live");
        expect(f.localDatabase.readLocalLiveRunAuthorization(f.run.runId)).toMatchObject({ runId: f.run.runId, encryptedAuthorization: expect.any(String), suspended: false });
        expect(f.localDatabase.readLocalGameplaySyncState(f.run.runId)).toMatchObject({ runId: f.run.runId, lastAcknowledgedHistoryRevision: 0, consecutiveFailures: 0 });
        await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0 });
        await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } });
        const finalized = await f.gameplay.finalize(f.run.runId, owner, { incidentReport: "  Ελληνική αναφορά 🏀\r\nδεύτερη γραμμή  " });
        expect(finalized.lifecycle).toBe("finalized");
        expect(finalized.state.finished).toBe(true);
        expect(f.localDatabase.readLocalGameRun(f.run.runId)).toMatchObject({ status: "finalized", lastAcceptedSequence: 4 });
        const storedFinalization = f.localDatabase.readLocalMatchFinalization(f.run.runId);
        expect(storedFinalization).toMatchObject({ runId: f.run.runId, finalizedHistoryRevision: finalized.eventHistoryRevision });
        const manifest = JSON.parse(storedFinalization.finalizationJson);
        expect(manifest.incidentReport).toBe("Ελληνική αναφορά 🏀\nδεύτερη γραμμή");
        expect(storedFinalization.finalizationHash).toBe(sha256JsonBytes(storedFinalization.finalizationJson));
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId).map((row) => JSON.parse(row.eventJson).type)).not.toContain("INCIDENT_REPORT");
        expect(sha256JsonBytes(deterministicJson(manifest))).toBe(storedFinalization.finalizationHash);
        expect(sha256JsonBytes(deterministicJson({ ...manifest, incidentReport: "Διαφορετική αναφορά" }))).not.toBe(storedFinalization.finalizationHash);
        expect(f.localDatabase.listPendingGameplaySyncRunIds(owner.organizationId, owner.scorerId)).toEqual([f.run.runId]);

        const rejected = fixture({ tie_allowed: true, winner_required: false, regulation_periods: 1 });
        await rejected.gameplay.initialize(rejected.run.runId, owner);
        await rejected.gameplay.append(rejected.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0 });
        await rejected.gameplay.append(rejected.run.runId, owner, { type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } });
        const before = { run: rejected.localDatabase.readLocalGameRun(rejected.run.runId), snapshot: rejected.localDatabase.readLocalMatchEngineSnapshot(rejected.run.runId), events: rejected.localDatabase.readLocalMatchEvents(rejected.run.runId) };
        await expect(rejected.gameplay.finalize(rejected.run.runId, owner, { incidentReport: "x".repeat(20_001) })).rejects.toThrow(/GAMEPLAY_EVENT_REJECTED/);
        expect(rejected.localDatabase.readLocalGameRun(rejected.run.runId)).toEqual(before.run);
        expect(rejected.localDatabase.readLocalMatchEngineSnapshot(rejected.run.runId)).toEqual(before.snapshot);
        expect(rejected.localDatabase.readLocalMatchEvents(rejected.run.runId)).toEqual(before.events);
        expect(rejected.localDatabase.readLocalMatchFinalization(rejected.run.runId)).toBeNull();
    });

    it("finalizes a SIMPLE Run without fabricated FULL-stat events", async () => {
        const f = fixture({ game_mode: "SIMPLE", tie_allowed: false, winner_required: true, regulation_periods: 1 });
        const started = await f.gameplay.initialize(f.run.runId, owner);
        expect(started.setup.settings.gameMode).toBe("SIMPLE");
        await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT", team: "HOME", playerId: "home-1" });
        await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT", team: "HOME", playerId: "home-1" });
        await f.gameplay.append(f.run.runId, owner, { type: "THREE_POINT", team: "HOME", playerId: "home-1" });
        await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "simple-finalization-foul", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "NON_SHOOTING" }, fouledPlayerId: "home-1" });
        await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0 });
        await f.gameplay.append(f.run.runId, owner, { type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } });
        const finalized = await f.gameplay.finalize(f.run.runId, owner);
        const home = finalized.state.home.players.find((player) => player.playerId === "home-1");
        expect(finalized).toMatchObject({ lifecycle: "finalized", setup: { settings: { gameMode: "SIMPLE" } }, state: { finished: true, home: { score: 7 } } });
        expect(home.statistics).toMatchObject({ points: 7, twoPointMade: 2, twoPointAttempts: 2, threePointMade: 1, threePointAttempts: 1, offensiveRebounds: 0, defensiveRebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0 });
        expect(finalized.state.away.players.find((player) => player.playerId === "away-1").foulState.total).toBe(1);
        const eventTypes = f.localDatabase.readLocalMatchEvents(f.run.runId).map((row) => JSON.parse(row.eventJson).type);
        expect(eventTypes.at(-1)).toBe("MATCH_END");
        expect(eventTypes).not.toEqual(expect.arrayContaining(["TURNOVER", "JUMP_BALL", "REBOUND", "ASSIST", "BLOCK", "TWO_POINT_MISSED", "THREE_POINT_MISSED"]));
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

    it("persists a guided multi-event action in one atomic history revision", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const accepted = await f.gameplay.appendMany(f.run.runId, owner, [{ type: "CLOCK_START" }, { type: "CLOCK_STOP" }]);
        expect(accepted.lastAcceptedSequence).toBe(3);
        expect(accepted.eventHistoryRevision).toBe(2);
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId).map((event) => event.sequence)).toEqual([1, 2, 3]);
        const before = f.localDatabase.readLocalMatchEvents(f.run.runId);
        await expect(f.gameplay.appendMany(f.run.runId, owner, [{ type: "CLOCK_START" }, { type: "CLOCK_START" }])).rejects.toThrow(/GAMEPLAY_EVENT_REJECTED/);
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(before);
        expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId).eventHistoryRevision).toBe(2);
    });

    it("persists, replays, and preserves scorer-event metadata through correction", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const scorerEventId = "scorer-event-guided";
        await f.gameplay.appendMany(f.run.runId, owner, [
            { type: "CLOCK_START", scorerEventId },
            { type: "CLOCK_STOP", scorerEventId, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT1", resumeContext: { penaltyShooterPlayerId: "home-1" } } },
        ]);
        const persisted = f.localDatabase.readLocalMatchEvents(f.run.runId).slice(-2).map((row) => JSON.parse(row.eventJson));
        expect(persisted).toMatchObject([
            { scorerEventId },
            { scorerEventId, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT1", resumeContext: { penaltyShooterPlayerId: "home-1" } } },
        ]);
        await f.gameplay.correct(f.run.runId, owner, persisted[1].id, { type: "CLOCK_STOP" });
        const recovered = await f.gameplay.recover(f.run.runId, owner);
        expect(recovered.events.slice(-2)).toMatchObject([
            { scorerEventId },
            { scorerEventId, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT1", resumeContext: { penaltyShooterPlayerId: "home-1" } } },
        ]);
        const history = await f.gameplay.history(f.run.runId, owner, { limit: 10, beforeSequence: null, period: null });
        expect(history.items.find((item) => item.scorerEventTerminal)?.facts).toMatchObject({ scorerEventId, scorerEventTerminal: { reason: "ENTER_EARLY" } });
        expect(recovered.state).toMatchObject({ clockRunning: false });
    });

    it("preserves Technical GD staff source metadata and gates ambiguous historical reconstruction", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const addStaffTechnical = async (side, groupId, technicalStaffSource) => {
            const offender = technicalStaffSource === "COACH" ? { kind: "BENCH", personId: `coach:${side}`, role: "HEAD_COACH" } : { kind: "BENCH", personId: `bench:${side}`, role: "ACCOMPANYING_DELEGATION" };
            const foul = await f.gameplay.append(f.run.runId, owner, { type: "TECHNICAL_FOUL", team: side, stoppageId: `stop-${groupId}`, offender, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1", scorerEventId: groupId, scorerEventContext: { technicalStaffSource } });
            const foulId = foul.eventIds.at(-1);
            await f.gameplay.correct(f.run.runId, owner, foulId, { type: "TECHNICAL_FOUL", team: side, stoppageId: `stop-${groupId}`, offender, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1" });
            await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: `penalty:${foulId}`, scorerEventId: groupId, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER" } });
            return foulId;
        };
        const coachId = await addStaffTechnical("HOME", "technical-coach", "COACH");
        const benchId = await addStaffTechnical("AWAY", "technical-bench", "BENCH");
        const recovered = await f.gameplay.recover(f.run.runId, owner);
        const persisted = f.localDatabase.readLocalMatchEvents(f.run.runId).map((row) => JSON.parse(row.eventJson));
        expect(persisted.find((event) => event.id === coachId)).toMatchObject({ offender: { kind: "BENCH", personId: "coach:HOME", role: "HEAD_COACH" }, scorerEventContext: { technicalStaffSource: "COACH" } });
        expect(persisted.find((event) => event.id === benchId)).toMatchObject({ offender: { kind: "BENCH", personId: "bench:AWAY", role: "ACCOMPANYING_DELEGATION" }, scorerEventContext: { technicalStaffSource: "BENCH" } });
        expect(recovered.events.find((event) => event.eventId === coachId)).toMatchObject({ scorerEventContext: { technicalStaffSource: "COACH" } });
        expect(recovered.events.find((event) => event.eventId === benchId)).toMatchObject({ scorerEventContext: { technicalStaffSource: "BENCH" } });
        expect(recovered.state).toMatchObject({ home: { discipline: { headCoachCategory1TechnicalCount: 1, benchCategory1TechnicalCount: 0 } }, away: { discipline: { headCoachCategory1TechnicalCount: 0, benchCategory1TechnicalCount: 1 } } });
        expect(await f.gameplay.scorerEventGroup(f.run.runId, owner, "explicit:technical-coach")).toMatchObject({ safeForReconstruction: true, items: [{ scorerEventContext: { technicalStaffSource: "COACH" } }, {}] });
        expect(await f.gameplay.scorerEventGroup(f.run.runId, owner, "explicit:technical-bench")).toMatchObject({ safeForReconstruction: true, items: [{ scorerEventContext: { technicalStaffSource: "BENCH" } }, {}] });

        const old = fixture(); await old.gameplay.initialize(old.run.runId, owner);
        const ambiguous = await old.gameplay.append(old.run.runId, owner, { type: "TECHNICAL_FOUL", team: "HOME", stoppageId: "old-technical", offender: { kind: "BENCH", personId: "coach:HOME", role: "HEAD_COACH" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1", scorerEventId: "old-technical" });
        const ambiguousId = ambiguous.eventIds.at(-1);
        await old.gameplay.append(old.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: `penalty:${ambiguousId}`, scorerEventId: "old-technical", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER" } });
        expect(await old.gameplay.scorerEventGroup(old.run.runId, owner, "explicit:old-technical")).toMatchObject({ groupingSource: "EXPLICIT", safeForReconstruction: false });
        const player = await old.gameplay.append(old.run.runId, owner, { type: "TECHNICAL_FOUL", team: "AWAY", stoppageId: "player-technical", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1", scorerEventId: "player-technical" });
        const playerId = player.eventIds.at(-1);
        await old.gameplay.append(old.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: `penalty:${playerId}`, scorerEventId: "player-technical", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER" } });
        expect(await old.gameplay.scorerEventGroup(old.run.runId, owner, "explicit:player-technical")).toMatchObject({ groupingSource: "EXPLICIT", safeForReconstruction: true });
    });

    it("projects explicit scorer groups, hidden terminal carriers, and distinct negative decisions", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const groupId = "technical-enter-early";
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "TECHNICAL_FOUL", team: "AWAY", stoppageId: "technical-group", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_2", scorerEventId: groupId });
        const foulId = foul.eventIds.at(-1); const penaltyId = `penalty:${foulId}`;
        await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId, scorerEventId: groupId, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER" } });
        await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT", team: "HOME", playerId: "home-1", scorerEventId: "no-assist", scorerEventTerminal: { reason: "NATURAL", decisions: { assist: "NONE" } } });
        await f.gameplay.append(f.run.runId, owner, { type: "TURNOVER", team: "HOME", playerId: "home-1", scorerEventId: "no-steal", scorerEventTerminal: { reason: "NATURAL", decisions: { steal: "NONE" } } });
        await f.gameplay.append(f.run.runId, owner, { type: "TURNOVER", team: "AWAY", playerId: "away-1", scorerEventId: "early-stealer", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "STEALER" } });
        const page = await f.gameplay.history(f.run.runId, owner, { limit: 20, beforeSequence: null, period: null });
        const groupedRows = page.items.filter((item) => item.scorerEventGroupId === `explicit:${groupId}`);
        expect(groupedRows.map((item) => item.eventId).sort()).toEqual([foulId, page.items.find((item) => item.type === "PENALTY_ADMINISTRATION_ENDED")?.eventId].sort());
        expect(new Set(groupedRows.map((item) => item.scorerEventGroupOrdinal)).size).toBe(1);
        const before = f.localDatabase.readLocalMatchEvents(f.run.runId);
        const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, `explicit:${groupId}`);
        expect(group).toMatchObject({ groupingSource: "EXPLICIT", canonicalEventIds: [foulId, expect.any(String)], visibleEventIds: [foulId], scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER" }, terminalConflict: false, safeForReconstruction: true });
        expect(group.items.map((item) => item.type)).toEqual(["TECHNICAL_FOUL", "PENALTY_ADMINISTRATION_ENDED"]);
        expect((await f.gameplay.scorerEventGroup(f.run.runId, owner, "explicit:no-assist"))?.scorerEventTerminal).toEqual({ reason: "NATURAL", decisions: { assist: "NONE" } });
        expect((await f.gameplay.scorerEventGroup(f.run.runId, owner, "explicit:no-steal"))?.scorerEventTerminal).toEqual({ reason: "NATURAL", decisions: { steal: "NONE" } });
        expect((await f.gameplay.scorerEventGroup(f.run.runId, owner, "explicit:early-stealer"))?.scorerEventTerminal).toEqual({ reason: "ENTER_EARLY", unresolvedStep: "STEALER" });
        expect(await f.gameplay.scorerEventGroup(f.run.runId, owner, "explicit:missing")).toBeNull();
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(before);
    });

    it("groups only provable legacy causal chains and leaves ambiguous play sequences atomic", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: "legacy-shooting" }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "legacy-shooting", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId }); const foulId = foul.eventIds.at(-1); const penaltyId = `penalty:${foulId}`;
        await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId, attemptIndex: 1, made: true });
        await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId });
        const turnover = await f.gameplay.append(f.run.runId, owner, { type: "TURNOVER", team: "HOME", playerId: "home-1" }); const turnoverId = turnover.eventIds.at(-1);
        const steal = await f.gameplay.append(f.run.runId, owner, { type: "STEAL", team: "AWAY", playerId: "away-1" }); const stealId = steal.eventIds.at(-1);
        const miss = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT_MISSED", team: "AWAY", playerId: "away-1" }); const missId = miss.eventIds.at(-1);
        const rebound = await f.gameplay.append(f.run.runId, owner, { type: "REBOUND", team: "HOME", playerId: "home-1", offensive: false }); const reboundId = rebound.eventIds.at(-1);
        const blockedMiss = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT_MISSED", team: "HOME", playerId: "home-1" }); const blockedMissId = blockedMiss.eventIds.at(-1);
        const block = await f.gameplay.append(f.run.runId, owner, { type: "BLOCK", team: "AWAY", playerId: "away-1" }); const blockId = block.eventIds.at(-1);
        const blockRebound = await f.gameplay.append(f.run.runId, owner, { type: "REBOUND", team: "AWAY", playerId: "away-1", offensive: false }); const blockReboundId = blockRebound.eventIds.at(-1);
        const page = await f.gameplay.history(f.run.runId, owner, { limit: 30, beforeSequence: null, period: null }); const byId = new Map(page.items.map((item) => [item.eventId, item]));
        expect([shotId, foulId].map((id) => byId.get(id)?.scorerEventGroupId)).toEqual([`legacy:${shotId}`, `legacy:${shotId}`]);
        expect((await f.gameplay.scorerEventGroup(f.run.runId, owner, `legacy:${shotId}`))?.canonicalEventIds).toEqual([shotId, foulId, expect.any(String), expect.any(String)]);
        expect((await f.gameplay.scorerEventGroup(f.run.runId, owner, `legacy:${shotId}`))?.safeForReconstruction).toBe(false);
        expect([turnoverId, stealId].map((id) => byId.get(id)?.scorerEventGroupId)).toEqual([`legacy:${turnoverId}`, `legacy:${turnoverId}`]);
        expect([missId, reboundId, blockedMissId, blockId, blockReboundId].map((id) => byId.get(id)?.scorerEventGroupingSource)).toEqual(["LEGACY_ATOMIC", "LEGACY_ATOMIC", "LEGACY_ATOMIC", "LEGACY_ATOMIC", "LEGACY_ATOMIC"]);
        expect(new Set([missId, reboundId, blockedMissId, blockId, blockReboundId].map((id) => byId.get(id)?.scorerEventGroupId)).size).toBe(5);
        expect((await f.gameplay.scorerEventGroup(f.run.runId, owner, `legacy:${missId}`))?.safeForReconstruction).toBe(false);
    });

    it("assigns full-history ordinals before paging and preserves a group crossing the 28-row boundary", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const facts = [{ type: "CLOCK_SET", remainingSeconds: 599, scorerEventId: "clock-preface", scorerEventTerminal: { reason: "NATURAL" } }, { type: "CLOCK_START", scorerEventId: "boundary-group" }, { type: "CLOCK_STOP", scorerEventId: "boundary-group", scorerEventTerminal: { reason: "NATURAL" } }];
        for (let index = 3; index < 30; index += 1) facts.push({ type: index % 2 === 1 ? "CLOCK_START" : "CLOCK_STOP", scorerEventId: `clock-${index}`, scorerEventTerminal: { reason: "NATURAL" } });
        await f.gameplay.appendMany(f.run.runId, owner, facts.slice(0, 16));
        await f.gameplay.appendMany(f.run.runId, owner, facts.slice(16));
        const page = await f.gameplay.history(f.run.runId, owner, { limit: 28, beforeSequence: null, period: null });
        const visibleBoundaryMember = page.items.find((item) => item.sequence === 4);
        expect(visibleBoundaryMember).toMatchObject({ scorerEventGroupId: "explicit:boundary-group", scorerEventGroupingSource: "EXPLICIT" });
        const complete = await f.gameplay.scorerEventGroup(f.run.runId, owner, "explicit:boundary-group");
        expect(complete?.canonicalEventIds).toHaveLength(2);
        expect(visibleBoundaryMember?.scorerEventGroupOrdinal).toBe(complete?.groupOrdinal);
        const restarted = new MatchGameplayManager(f.setup, f.localDatabase, deviceId, () => new Date("2026-08-26T13:00:00.000Z"), () => "unused-history-id", () => "synthetic-cache-authorization");
        const reloaded = await restarted.scorerEventGroup(f.run.runId, owner, "explicit:boundary-group");
        expect(reloaded?.groupOrdinal).toBe(complete?.groupOrdinal);
        expect(reloaded?.canonicalEventIds).toEqual(complete?.canonicalEventIds);
    });

    it("projects GOAL FOUL only from factual made-shot shooting-foul relationships", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const addShootingFoul = async (shotType, groupId, stoppageId) => {
            const shot = await f.gameplay.append(f.run.runId, owner, { type: shotType, team: "HOME", playerId: "home-1", stoppageId, scorerEventId: groupId }); const shotId = shot.eventIds.at(-1);
            const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId, offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId: groupId }); const foulId = foul.eventIds.at(-1);
            await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: `penalty:${foulId}`, scorerEventId: groupId, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT1" } });
            return shotId;
        };
        const madeTwoId = await addShootingFoul("TWO_POINT", "goal-foul-two", "stop-goal-foul-two");
        const madeThreeId = await addShootingFoul("THREE_POINT", "goal-foul-three", "stop-goal-foul-three");
        const missedId = await addShootingFoul("TWO_POINT_MISSED", "missed-shooting-foul", "stop-missed-shooting-foul");
        const ordinary = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT", team: "HOME", playerId: "home-1", scorerEventId: "same-group-no-relation" }); const ordinaryId = ordinary.eventIds.at(-1);
        await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "stop-unrelated", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "NON_SHOOTING" }, fouledPlayerId: "home-1", scorerEventId: "same-group-no-relation", scorerEventTerminal: { reason: "NATURAL" } });
        const page = await f.gameplay.history(f.run.runId, owner, { limit: 30, beforeSequence: null, period: null }); const byId = new Map(page.items.map((item) => [item.eventId, item]));
        expect(byId.get(madeTwoId)).toMatchObject({ type: "TWO_POINT", isGoalFoul: true });
        expect(byId.get(madeThreeId)).toMatchObject({ type: "THREE_POINT", isGoalFoul: true });
        expect(byId.get(missedId)).not.toHaveProperty("isGoalFoul");
        expect(byId.get(ordinaryId)).not.toHaveProperty("isGoalFoul");
    });

    it("projects GOAL FOUL before paging when the related Shot and Foul cross a page boundary", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "THREE_POINT", team: "HOME", playerId: "home-1", stoppageId: "stop-cross-page", scorerEventId: "cross-page-goal-foul" }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "stop-cross-page", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId: "cross-page-goal-foul" }); const foulId = foul.eventIds.at(-1);
        await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: `penalty:${foulId}`, scorerEventId: "cross-page-goal-foul", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT1" } });
        const filler = Array.from({ length: 26 }, (_, index) => ({ type: index % 2 === 0 ? "CLOCK_START" : "CLOCK_STOP", scorerEventId: `cross-page-clock-${index}`, scorerEventTerminal: { reason: "NATURAL" } }));
        await f.gameplay.appendMany(f.run.runId, owner, filler.slice(0, 16));
        await f.gameplay.appendMany(f.run.runId, owner, filler.slice(16));
        const firstPage = await f.gameplay.history(f.run.runId, owner, { limit: 28, beforeSequence: null, period: null });
        expect(firstPage.items.some((item) => item.eventId === foulId)).toBe(true);
        expect(firstPage.items.some((item) => item.eventId === shotId)).toBe(false);
        const secondPage = await f.gameplay.history(f.run.runId, owner, { limit: 28, beforeSequence: firstPage.nextBeforeSequence, period: null });
        expect(secondPage.items.find((item) => item.eventId === shotId)).toMatchObject({ type: "THREE_POINT", isGoalFoul: true });
    });

    it("marks multiple terminal carriers as a deterministic non-editable conflict", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        await f.gameplay.appendMany(f.run.runId, owner, [{ type: "CLOCK_START", scorerEventId: "terminal-conflict", scorerEventTerminal: { reason: "NATURAL" } }, { type: "CLOCK_STOP", scorerEventId: "terminal-conflict", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "ASSIST" } }]);
        const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, "explicit:terminal-conflict");
        expect(group).toMatchObject({ terminalConflict: true, safeForReconstruction: false });
        expect(group).not.toHaveProperty("scorerEventTerminal");
    });

    it("atomically resumes an ENTER_EARLY scorer event with stable historical identities and context", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const early = await f.gameplay.append(f.run.runId, owner, { type: "TURNOVER", team: "HOME", playerId: "home-1", scorerEventId: "turnover-resume", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "STEALER" } });
        const turnoverId = early.eventIds.at(-1);
        const later = await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START", scorerEventId: "later-clock", scorerEventTerminal: { reason: "NATURAL" } });
        const laterId = later.eventIds.at(-1);
        const beforeGroup = await f.gameplay.scorerEventGroup(f.run.runId, owner, "explicit:turnover-resume");
        const replaced = await f.gameplay.mutateScorerEventGroup(f.run.runId, owner, { kind: "REPLACE_GROUP", scorerEventGroupId: "explicit:turnover-resume", expectedHistoryRevision: later.eventHistoryRevision, events: [
            { eventId: turnoverId, facts: { type: "TURNOVER", team: "HOME", playerId: "home-1" } },
            { facts: { type: "STEAL", team: "AWAY", playerId: "away-1", scorerEventTerminal: { reason: "NATURAL" } } },
        ] });
        const afterGroup = await f.gameplay.scorerEventGroup(f.run.runId, owner, "explicit:turnover-resume");
        expect(afterGroup).toMatchObject({ period: beforeGroup.period, clockSeconds: beforeGroup.clockSeconds, scorerEventTerminal: { reason: "NATURAL" }, safeForReconstruction: true });
        expect(afterGroup.canonicalEventIds[0]).toBe(turnoverId); expect(afterGroup.canonicalEventIds[1]).not.toBe(turnoverId);
        expect(replaced.eventIds).toContain(laterId); expect(replaced.eventIds.filter((id) => id === laterId)).toHaveLength(1);
        expect((await f.gameplay.recover(f.run.runId, owner)).state).toEqual(replaced.state);
        await expect(f.gameplay.mutateScorerEventGroup(f.run.runId, owner, { kind: "DELETE_GROUP", scorerEventGroupId: "explicit:turnover-resume", expectedHistoryRevision: later.eventHistoryRevision })).rejects.toMatchObject({ code: "GAMEPLAY_CONFLICT" });
    });

    it("propagates a DRAWN BY correction forward but keeps a direct remaining-FT shooter correction independent", async () => {
        const buildShootingGroup = async (f, groupId) => {
            await f.gameplay.initialize(f.run.runId, owner);
            const shot = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: groupId, scorerEventId: groupId }); const shotId = shot.eventIds.at(-1);
            const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: groupId, offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId: groupId }); const foulId = foul.eventIds.at(-1); const penaltyId = `penalty:${foulId}`;
            const freeThrow = await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId, attemptIndex: 1, made: true, scorerEventId: groupId }); const freeThrowId = freeThrow.eventIds.at(-1);
            const ended = await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId, scorerEventId: groupId, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT2", resumeContext: { penaltyShooterPlayerId: "home-1" } } }); const endId = ended.eventIds.at(-1);
            return { shotId, foulId, freeThrowId, endId, penaltyId, revision: ended.eventHistoryRevision };
        };
        const corrected = fixture(); const first = await buildShootingGroup(corrected, "drawn-by-correction");
        await corrected.gameplay.mutateScorerEventGroup(corrected.run.runId, owner, { kind: "REPLACE_GROUP", scorerEventGroupId: "explicit:drawn-by-correction", expectedHistoryRevision: first.revision, events: [
            { eventId: first.shotId, facts: { type: "TWO_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: "drawn-by-correction" } },
            { eventId: first.foulId, facts: { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "drawn-by-correction", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-2", relatedShotEventId: first.shotId } },
            { eventId: first.freeThrowId, facts: { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId: first.penaltyId, attemptIndex: 1, made: true } },
            { eventId: first.endId, facts: { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: first.penaltyId, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT2", resumeContext: { penaltyShooterPlayerId: "home-2" } } } },
        ] });
        const correctedFacts = (await corrected.gameplay.scorerEventGroup(corrected.run.runId, owner, "explicit:drawn-by-correction")).items.map((item) => item.facts);
        expect(correctedFacts.find((item) => item.type === "TWO_POINT_MISSED").playerId).toBe("home-2");
        expect(correctedFacts.find((item) => item.type === "PERSONAL_FOUL").fouledPlayerId).toBe("home-2");
        expect(correctedFacts.find((item) => item.type === "FREE_THROW").playerId).toBe("home-2");

        const shooterOnly = fixture(); const second = await buildShootingGroup(shooterOnly, "shooter-only-correction");
        await shooterOnly.gameplay.mutateScorerEventGroup(shooterOnly.run.runId, owner, { kind: "REPLACE_GROUP", scorerEventGroupId: "explicit:shooter-only-correction", expectedHistoryRevision: second.revision, events: [
            { eventId: second.shotId, facts: { type: "TWO_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: "shooter-only-correction" } },
            { eventId: second.foulId, facts: { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "shooter-only-correction", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: second.shotId } },
            { eventId: second.freeThrowId, facts: { type: "FREE_THROW", team: "HOME", playerId: "home-2", penaltyId: second.penaltyId, attemptIndex: 1, made: true } },
            { eventId: second.endId, facts: { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: second.penaltyId, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT2", resumeContext: { penaltyShooterPlayerId: "home-2" } } } },
        ] });
        const shooterFacts = (await shooterOnly.gameplay.scorerEventGroup(shooterOnly.run.runId, owner, "explicit:shooter-only-correction")).items.map((item) => item.facts);
        expect(shooterFacts.find((item) => item.type === "PERSONAL_FOUL").fouledPlayerId).toBe("home-1");
        expect(shooterFacts.find((item) => item.type === "FREE_THROW").playerId).toBe("home-2");
    });

    it("deletes a complete safe group including hidden terminal facts and densely replays later events", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "TECHNICAL_FOUL", team: "HOME", stoppageId: "delete-technical", offender: { kind: "PLAYER", playerId: "home-1" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_2", scorerEventId: "delete-technical" }); const foulId = foul.eventIds.at(-1);
        const ended = await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: `penalty:${foulId}`, scorerEventId: "delete-technical", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER" } });
        const later = await f.gameplay.append(f.run.runId, owner, { type: "TIMEOUT", team: "AWAY", scorerEventId: "later-timeout", scorerEventTerminal: { reason: "NATURAL" } }); const laterId = later.eventIds.at(-1);
        const deleted = await f.gameplay.mutateScorerEventGroup(f.run.runId, owner, { kind: "DELETE_GROUP", scorerEventGroupId: "explicit:delete-technical", expectedHistoryRevision: later.eventHistoryRevision });
        expect(deleted.eventIds).not.toContain(foulId); expect(deleted.eventIds).toContain(laterId); expect(deleted.lastAcceptedSequence).toBe(later.lastAcceptedSequence - 2);
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId).map((row) => row.sequence)).toEqual(Array.from({ length: deleted.lastAcceptedSequence }, (_, index) => index + 1));
        expect(await f.gameplay.scorerEventGroup(f.run.runId, owner, "explicit:delete-technical")).toBeNull();
        expect((await f.gameplay.recover(f.run.runId, owner)).state).toEqual(deleted.state);
        expect(ended.eventHistoryRevision).toBeLessThan(deleted.eventHistoryRevision);
    });

    it("allows delete-only compatibility for an explicit single-event zero-terminal TIMEOUT", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START" });
        const timeout = await f.gameplay.append(f.run.runId, owner, { type: "TIMEOUT", team: "HOME", scorerEventId: "legacy-explicit-timeout" }); const timeoutId = timeout.eventIds.at(-1);
        const stopped = await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_STOP" }); const stopId = stopped.eventIds.at(-1);
        await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START", scorerEventId: "later-clock", scorerEventTerminal: { reason: "NATURAL" } });
        const unsafe = await f.gameplay.append(f.run.runId, owner, { type: "ALTERNATING_POSSESSION", scorerEventId: "unrelated-zero-terminal" });
        expect(await f.gameplay.scorerEventEditContext(f.run.runId, owner, "explicit:legacy-explicit-timeout")).toMatchObject({ group: { safeForReconstruction: true, canonicalEventIds: [timeoutId] }, editCapabilities: { safeForEdit: false, canResume: false, canDeleteGroup: true, targets: [] } });
        expect(await f.gameplay.scorerEventEditContext(f.run.runId, owner, "explicit:unrelated-zero-terminal")).toMatchObject({ group: { safeForReconstruction: false }, editCapabilities: { safeForEdit: false, canResume: false, canDeleteGroup: false } });
        const deleted = await f.gameplay.mutateScorerEventGroup(f.run.runId, owner, { kind: "DELETE_GROUP", scorerEventGroupId: "explicit:legacy-explicit-timeout", expectedHistoryRevision: unsafe.eventHistoryRevision });
        expect(deleted.eventIds).not.toContain(timeoutId); expect(deleted.eventIds).toContain(stopId); expect(deleted.state.home.timeouts).toBe(2); expect(deleted.state.clockRunning).toBe(true);
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId).map((row) => row.sequence)).toEqual(Array.from({ length: deleted.lastAcceptedSequence }, (_, index) => index + 1));
    });

    it("rejects unsafe, finalized, and replay-invalid group mutations without partial durable changes", async () => {
        const unsafe = fixture(); await unsafe.gameplay.initialize(unsafe.run.runId, owner);
        const legacy = await unsafe.gameplay.append(unsafe.run.runId, owner, { type: "TIMEOUT", team: "HOME" }); const legacyId = legacy.eventIds.at(-1); const unsafeRows = unsafe.localDatabase.readLocalMatchEvents(unsafe.run.runId);
        await expect(unsafe.gameplay.mutateScorerEventGroup(unsafe.run.runId, owner, { kind: "DELETE_GROUP", scorerEventGroupId: `legacy:${legacyId}`, expectedHistoryRevision: legacy.eventHistoryRevision })).rejects.toMatchObject({ code: "GAMEPLAY_EVENT_REJECTED" });
        expect(unsafe.localDatabase.readLocalMatchEvents(unsafe.run.runId)).toEqual(unsafeRows);

        const invalid = fixture();
        const currentConfiguration = invalid.configurations.getOrCreate("game-gameplay", owner).configuration; const participatingConfiguration = configurationDraft(currentConfiguration); const homeConfiguration = participatingConfiguration.teams.find((team) => team.side === "HOME");
        Object.assign(homeConfiguration.players.find((player) => player.playerId === "home-3"), { participating: true, gameShirtNumber: "7" });
        invalid.configurations.saveDraft(participatingConfiguration, owner);
        await invalid.gameplay.initialize(invalid.run.runId, owner);
        const substitution = await invalid.gameplay.append(invalid.run.runId, owner, { type: "SUBSTITUTION", team: "HOME", playerInId: "home-3", playerOutId: "home-1", scorerEventId: "sub-in-home3", scorerEventTerminal: { reason: "NATURAL" } }); const substitutionId = substitution.eventIds.at(-1);
        const miss = await invalid.gameplay.append(invalid.run.runId, owner, { type: "TWO_POINT_MISSED", team: "HOME", playerId: "home-3", scorerEventId: "home3-shot", scorerEventTerminal: { reason: "NATURAL" } }); const missId = miss.eventIds.at(-1);
        const substitutionGroup = await invalid.gameplay.scorerEventGroup(invalid.run.runId, owner, "explicit:sub-in-home3"); const shotGroup = await invalid.gameplay.scorerEventGroup(invalid.run.runId, owner, "explicit:home3-shot");
        expect(substitutionGroup).toMatchObject({ safeForReconstruction: true, canonicalEventIds: [substitutionId] }); expect(shotGroup).toMatchObject({ safeForReconstruction: true, canonicalEventIds: [missId] });
        const invalidRows = invalid.localDatabase.readLocalMatchEvents(invalid.run.runId); const invalidSnapshot = invalid.localDatabase.readLocalMatchEngineSnapshot(invalid.run.runId); const invalidRun = invalid.localDatabase.readLocalGameRun(invalid.run.runId); const invalidState = miss.state;
        const rowIdentity = (rows) => rows.map((row) => { const event = JSON.parse(row.eventJson); return { eventId: row.eventId, sequence: row.sequence, scorerEventId: event.scorerEventId, eventJson: row.eventJson, eventHash: row.eventHash }; });
        await expect(invalid.gameplay.mutateScorerEventGroup(invalid.run.runId, owner, { kind: "DELETE_GROUP", scorerEventGroupId: "explicit:sub-in-home3", expectedHistoryRevision: invalidSnapshot.eventHistoryRevision })).rejects.toMatchObject({ code: "GAMEPLAY_EVENT_REJECTED" });
        const rowsAfterRejectedMutation = invalid.localDatabase.readLocalMatchEvents(invalid.run.runId);
        expect(rowsAfterRejectedMutation).toEqual(invalidRows); expect(rowsAfterRejectedMutation).toHaveLength(invalidRows.length); expect(rowIdentity(rowsAfterRejectedMutation)).toEqual(rowIdentity(invalidRows));
        expect(invalid.localDatabase.readLocalMatchEngineSnapshot(invalid.run.runId)).toEqual(invalidSnapshot); expect(invalid.localDatabase.readLocalGameRun(invalid.run.runId)).toEqual(invalidRun);
        expect((await invalid.gameplay.recover(invalid.run.runId, owner)).state).toEqual(invalidState);
        expect(await invalid.gameplay.scorerEventGroup(invalid.run.runId, owner, "explicit:sub-in-home3")).toEqual(substitutionGroup); expect(await invalid.gameplay.scorerEventGroup(invalid.run.runId, owner, "explicit:home3-shot")).toEqual(shotGroup);

        const finalized = fixture({ tie_allowed: true, winner_required: false, regulation_periods: 1 }); await finalized.gameplay.initialize(finalized.run.runId, owner);
        const grouped = await finalized.gameplay.append(finalized.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0, scorerEventId: "finalized-clock", scorerEventTerminal: { reason: "NATURAL" } });
        await finalized.gameplay.append(finalized.run.runId, owner, { type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } }); await finalized.gameplay.finalize(finalized.run.runId, owner);
        await expect(finalized.gameplay.mutateScorerEventGroup(finalized.run.runId, owner, { kind: "DELETE_GROUP", scorerEventGroupId: "explicit:finalized-clock", expectedHistoryRevision: grouped.eventHistoryRevision })).rejects.toMatchObject({ code: "GAMEPLAY_CONFLICT" });
    });

    it("derives historical candidates from target-time lineup, survives reload, and performs zero writes", async () => {
        const f = fixture(); const current = f.configurations.getOrCreate("game-gameplay", owner).configuration; const draft = configurationDraft(current); const home = draft.teams.find((team) => team.side === "HOME");
        Object.assign(home.players.find((player) => player.playerId === "home-3"), { participating: true, gameShirtNumber: "7" }); f.configurations.saveDraft(draft, owner); await f.gameplay.initialize(f.run.runId, owner);
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT", team: "HOME", playerId: "home-1", scorerEventId: "historical-assist", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "ASSIST" } });
        await f.gameplay.append(f.run.runId, owner, { type: "SUBSTITUTION", team: "HOME", playerInId: "home-3", playerOutId: "home-1", scorerEventId: "later-sub", scorerEventTerminal: { reason: "NATURAL" } });
        const rowsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId); const snapshotBefore = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const context = await f.gameplay.scorerEventEditContext(f.run.runId, owner, "explicit:historical-assist");
        expect(context).toMatchObject({ expectedHistoryRevision: snapshotBefore.eventHistoryRevision, editCapabilities: { safeForEdit: true, canResume: true, canDeleteGroup: true }, continuationPlan: { kind: "ASSIST", side: "HOME", candidatePlayerIds: ["home-2"], noAssistAllowed: true } });
        const historicalHomePlayers = new Map(context.historicalState.teams.find((team) => team.side === "HOME").players.map((player) => [player.playerId, player]));
        expect(historicalHomePlayers.get("home-1")).toMatchObject({ side: "HOME", onCourt: true, eligible: true, foulStatus: "ELIGIBLE" });
        expect(historicalHomePlayers.get("home-2")).toMatchObject({ side: "HOME", onCourt: true, eligible: true, foulStatus: "ELIGIBLE" });
        expect(historicalHomePlayers.get("home-3")).toMatchObject({ side: "HOME", onCourt: false, eligible: true, foulStatus: "ELIGIBLE" });
        expect(context.editCapabilities.targets.find((target) => target.kind === "SHOOTER")).toMatchObject({ eventId: shot.eventIds.at(-1), currentPlayerId: "home-1", candidatePlayerIds: ["home-1", "home-2"] });
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(rowsBefore); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(snapshotBefore);
        const restarted = new MatchGameplayManager(f.setup, f.localDatabase, deviceId, () => new Date("2026-08-26T13:00:00.000Z"), () => "unused-edit-context-id", () => "synthetic-edit-context-authorization"); expect(await restarted.scorerEventEditContext(f.run.runId, owner, "explicit:historical-assist")).toEqual(context);
    });

    it("projects factual target candidates, causal conflicts, and unsupported staff as read-only", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT", team: "HOME", playerId: "home-1", assistPlayerId: "home-2", stoppageId: "targets", scorerEventId: "targets" }); const shotId = shot.eventIds.at(-1);
        await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "targets", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId: "targets", scorerEventTerminal: { reason: "NATURAL" } });
        const context = await f.gameplay.scorerEventEditContext(f.run.runId, owner, "explicit:targets"); const byKind = new Map(context.editCapabilities.targets.map((target) => [target.kind, target]));
        expect(byKind.get("SHOOTER")).toMatchObject({ canonicalSide: "HOME", candidatePlayerIds: ["home-1"] }); expect(byKind.get("ASSIST")).toMatchObject({ candidatePlayerIds: ["home-2"] }); expect(byKind.get("FOULER")).toMatchObject({ canonicalSide: "AWAY", currentPlayerId: "away-1" }); expect(byKind.get("DRAWN_BY")).toMatchObject({ canonicalSide: "HOME", candidatePlayerIds: ["home-1"], forwardPropagation: true }); expect(byKind.get("DRAWN_BY").candidatePlayerIds).not.toContain("home-2");
        const staffFixture = fixture(); await staffFixture.gameplay.initialize(staffFixture.run.runId, owner);
        const staff = await staffFixture.gameplay.append(staffFixture.run.runId, owner, { type: "TECHNICAL_FOUL", team: "HOME", stoppageId: "staff-target", offender: { kind: "BENCH", personId: "coach:HOME", role: "HEAD_COACH" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_1", scorerEventId: "staff-target", scorerEventContext: { technicalStaffSource: "BENCH" } }); const penaltyId = `penalty:${staff.eventIds.at(-1)}`;
        await staffFixture.gameplay.append(staffFixture.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId, scorerEventId: "staff-target", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER" } }); const staffContext = await staffFixture.gameplay.scorerEventEditContext(staffFixture.run.runId, owner, "explicit:staff-target");
        expect(staffContext.editCapabilities.targets.find((target) => target.kind === "FOULER")).toMatchObject({ editable: false, readOnlyReason: "UNSUPPORTED_TARGET" }); expect(staffContext.editCapabilities).toMatchObject({ safeForEdit: true, canResume: true });
    });

    it("projects non-penalty continuation plans from factual history and terminal metadata", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT", team: "HOME", playerId: "home-1", scorerEventId: "resume-assist", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "ASSIST" } }); await f.gameplay.append(f.run.runId, owner, { type: "TURNOVER", team: "HOME", playerId: "home-1", scorerEventId: "resume-stealer", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "STEALER" } }); await f.gameplay.append(f.run.runId, owner, { type: "THREE_POINT_MISSED", team: "AWAY", playerId: "away-1", scorerEventId: "resume-rebound", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "REBOUNDER" } });
        expect((await f.gameplay.scorerEventEditContext(f.run.runId, owner, "explicit:resume-assist")).continuationPlan).toMatchObject({ kind: "ASSIST", candidatePlayerIds: ["home-2"], noAssistAllowed: true }); expect((await f.gameplay.scorerEventEditContext(f.run.runId, owner, "explicit:resume-stealer")).continuationPlan).toMatchObject({ kind: "STEALER", side: "AWAY", candidatePlayerIds: ["away-1", "away-2"], noStealAllowed: true }); expect((await f.gameplay.scorerEventEditContext(f.run.runId, owner, "explicit:resume-rebound")).continuationPlan).toMatchObject({ kind: "REBOUNDER", teamReboundAllowed: true, penaltyId: null });
    });

    it("derives manual and preselected Technical plus shooting-FT continuation from authoritative entitlements", async () => {
        const technical = fixture(); await technical.gameplay.initialize(technical.run.runId, owner); const foul = await technical.gameplay.append(technical.run.runId, owner, { type: "TECHNICAL_FOUL", team: "HOME", stoppageId: "technical-edit", offender: { kind: "PLAYER", playerId: "home-1" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_2", scorerEventId: "technical-edit" }); const penaltyId = `penalty:${foul.eventIds.at(-1)}`; await technical.gameplay.append(technical.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId, scorerEventId: "technical-edit", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER" } });
        expect((await technical.gameplay.scorerEventEditContext(technical.run.runId, owner, "explicit:technical-edit")).continuationPlan).toMatchObject({ kind: "CHOOSE_SHOOTER", candidatePlayerIds: ["away-1", "away-2"], penalty: { totalAttempts: 1, completedAttempts: 0, remainingAttempts: 1, restartKind: "RESUME_INTERRUPTED" } });
        const selected = fixture(); await selected.gameplay.initialize(selected.run.runId, owner); const selectedFoul = await selected.gameplay.append(selected.run.runId, owner, { type: "TECHNICAL_FOUL", team: "HOME", stoppageId: "technical-selected", offender: { kind: "PLAYER", playerId: "home-1" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_2", scorerEventId: "technical-selected" }); const selectedPenaltyId = `penalty:${selectedFoul.eventIds.at(-1)}`; await selected.gameplay.append(selected.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: selectedPenaltyId, scorerEventId: "technical-selected", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER", resumeContext: { penaltyShooterPlayerId: "away-2" } } }); expect((await selected.gameplay.scorerEventEditContext(selected.run.runId, owner, "explicit:technical-selected")).continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", shooterPlayerId: "away-2", attemptNumber: 1, postResultContinuation: "END" });
        const shooting = fixture(); await shooting.gameplay.initialize(shooting.run.runId, owner); const shot = await shooting.gameplay.append(shooting.run.runId, owner, { type: "THREE_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: "shooting-edit", scorerEventId: "shooting-edit" }); const shotId = shot.eventIds.at(-1); const shootingFoul = await shooting.gameplay.append(shooting.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "shooting-edit", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId: "shooting-edit" }); const shootingPenaltyId = `penalty:${shootingFoul.eventIds.at(-1)}`; await shooting.gameplay.append(shooting.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId: shootingPenaltyId, attemptIndex: 1, made: true, scorerEventId: "shooting-edit" }); await shooting.gameplay.append(shooting.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: shootingPenaltyId, scorerEventId: "shooting-edit", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT2", resumeContext: { penaltyShooterPlayerId: "home-1" } } }); expect((await shooting.gameplay.scorerEventEditContext(shooting.run.runId, owner, "explicit:shooting-edit")).continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 2, penalty: { totalAttempts: 3, completedAttempts: 1, remainingAttempts: 2, restartKind: "LIVE_BALL" }, postResultContinuation: "NEXT_FREE_THROW" });
    });

    it("exposes final live-ball rebound and keeps preview, edit, delete, unsafe, and finalized capabilities separate", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const shot = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: "final-ft", scorerEventId: "final-ft" }); const shotId = shot.eventIds.at(-1); const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "final-ft", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId: "final-ft" }); const penaltyId = `penalty:${foul.eventIds.at(-1)}`; await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId, attemptIndex: 1, made: true, scorerEventId: "final-ft" }); await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId, attemptIndex: 2, made: false, scorerEventId: "final-ft", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "REBOUNDER" } }); expect((await f.gameplay.scorerEventEditContext(f.run.runId, owner, "explicit:final-ft")).continuationPlan).toMatchObject({ kind: "REBOUNDER", penaltyId, teamReboundAllowed: true });
        const timeout = await f.gameplay.append(f.run.runId, owner, { type: "TIMEOUT", team: "HOME", scorerEventId: "preview-only", scorerEventTerminal: { reason: "NATURAL" } }); expect(await f.gameplay.scorerEventEditContext(f.run.runId, owner, "explicit:preview-only")).toMatchObject({ group: { safeForReconstruction: true }, editCapabilities: { safeForEdit: false, canResume: false, canDeleteGroup: true, targets: [] }, expectedHistoryRevision: timeout.eventHistoryRevision }); const legacy = await f.gameplay.append(f.run.runId, owner, { type: "TIMEOUT", team: "AWAY" }); expect(await f.gameplay.scorerEventEditContext(f.run.runId, owner, `legacy:${legacy.eventIds.at(-1)}`)).toMatchObject({ editCapabilities: { safeForEdit: false, canResume: false, canDeleteGroup: false }, continuationPlan: null });
        const finalized = fixture({ tie_allowed: true, winner_required: false, regulation_periods: 1 }); await finalized.gameplay.initialize(finalized.run.runId, owner); await finalized.gameplay.append(finalized.run.runId, owner, { type: "CLOCK_SET", remainingSeconds: 0, scorerEventId: "finalized-context", scorerEventTerminal: { reason: "NATURAL" } }); await finalized.gameplay.append(finalized.run.runId, owner, { type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } }); await finalized.gameplay.finalize(finalized.run.runId, owner); expect(await finalized.gameplay.scorerEventEditContext(finalized.run.runId, owner, "explicit:finalized-context")).toMatchObject({ lifecycle: "finalized", editCapabilities: { safeForEdit: false, canResume: false, canDeleteGroup: false }, continuationPlan: null });
    });

    it("previews DRAWN BY forward propagation, direct FT independence, refreshed capabilities, and SAVE equivalence without writes", async () => {
        const f = fixture({ min_players: 3, starting_players: 3 });
        const current = f.configurations.getOrCreate("game-gameplay", owner).configuration; const draft = configurationDraft(current);
        for (const team of draft.teams) { const third = team.players.find((player) => player.playerId === `${team.side.toLowerCase()}-3`); Object.assign(third, { participating: true, gameShirtNumber: "7" }); team.starterPlayerIds.push(third.playerId); }
        f.configurations.saveDraft(draft, owner); await f.gameplay.initialize(f.run.runId, owner);
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT", team: "HOME", playerId: "home-1", assistPlayerId: "home-2", stoppageId: "preview-propagation", scorerEventId: "preview-propagation" }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "preview-propagation", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId: "preview-propagation" }); const foulId = foul.eventIds.at(-1); const penaltyId = `penalty:${foulId}`;
        const completed = await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId, attemptIndex: 1, made: true, scorerEventId: "preview-propagation", scorerEventTerminal: { reason: "NATURAL" } });
        const groupId = "explicit:preview-propagation"; const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); const context = await f.gameplay.scorerEventEditContext(f.run.runId, owner, groupId);
        const beforeRows = f.localDatabase.readLocalMatchEvents(f.run.runId); const beforeSnapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId); const beforeRun = f.localDatabase.readLocalGameRun(f.run.runId);
        const drawnBy = context.editCapabilities.targets.find((target) => target.kind === "DRAWN_BY");
        const preview = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: draftEvents(group), action: { kind: "CORRECT_PLAYER", targetId: drawnBy.targetId, playerId: "home-3" } });
        expect(factsOf(preview.normalizedGroup, "TWO_POINT")).toMatchObject({ playerId: "home-3", assistPlayerId: "home-2" });
        expect(factsOf(preview.normalizedGroup, "PERSONAL_FOUL")).toMatchObject({ fouledPlayerId: "home-3" });
        expect(factsOf(preview.normalizedGroup, "FREE_THROW")).toMatchObject({ playerId: "home-3" });
        expect(preview.editContext.editCapabilities.targets.find((target) => target.kind === "DRAWN_BY")).toMatchObject({ currentPlayerId: "home-3", forwardPropagation: true });
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(beforeRows); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(beforeSnapshot); expect(f.localDatabase.readLocalGameRun(f.run.runId)).toEqual(beforeRun);

        const directDraft = draftEvents(group).map((event) => event.eventId === completed.eventIds.at(-1) ? { ...event, facts: { ...event.facts, playerId: "home-3" } } : event);
        const direct = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: directDraft });
        expect(factsOf(direct.normalizedGroup, "PERSONAL_FOUL")).toMatchObject({ fouledPlayerId: "home-1" }); expect(factsOf(direct.normalizedGroup, "FREE_THROW")).toMatchObject({ playerId: "home-3" });
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(beforeRows);

        await f.gameplay.mutateScorerEventGroup(f.run.runId, owner, { kind: "REPLACE_GROUP", scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: preview.draftEvents.map((event) => ({ ...(event.eventId ? { eventId: event.eventId } : {}), facts: event.facts })) });
        const saved = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId);
        expect(saved.items.map((item) => item.facts)).toEqual(preview.normalizedGroup.items.map((item) => item.facts));
    });

    it("previews repeated FT1 to FT2 to FT3 progression and final LIVE_BALL rebound without persistence", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "THREE_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: "preview-ft", scorerEventId: "preview-ft" }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "preview-ft", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId: "preview-ft" }); const penaltyId = `penalty:${foul.eventIds.at(-1)}`;
        const ended = await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId, scorerEventId: "preview-ft", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT1", resumeContext: { penaltyShooterPlayerId: "home-1" } } });
        const groupId = "explicit:preview-ft"; const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); const rowsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId); const snapshotBefore = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId);
        const initial = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: ended.eventHistoryRevision, events: draftEvents(group) }); expect(initial.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 1, postResultContinuation: "NEXT_FREE_THROW" });
        const ft1 = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: ended.eventHistoryRevision, events: initial.draftEvents, action: { kind: "FREE_THROW_RESULT", made: false } }); expect(ft1.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 2, postResultContinuation: "NEXT_FREE_THROW" });
        const ft2 = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: ended.eventHistoryRevision, events: ft1.draftEvents, action: { kind: "FREE_THROW_RESULT", made: true } }); expect(ft2.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 3, postResultContinuation: "REBOUNDER_IF_FINAL_MISS" });
        const ft3 = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: ended.eventHistoryRevision, events: ft2.draftEvents, action: { kind: "FREE_THROW_RESULT", made: false } }); expect(ft3.editContext.continuationPlan).toMatchObject({ kind: "REBOUNDER", teamReboundAllowed: true, penaltyId, candidatePlayerIds: expect.arrayContaining(["home-1", "away-1"]) });
        const rebound = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: ended.eventHistoryRevision, events: ft3.draftEvents, action: { kind: "REBOUNDER", team: "AWAY", playerId: "away-1", teamRebound: false } });
        expect(rebound.editContext.continuationPlan).toBeNull(); expect(factsOf(rebound.normalizedGroup, "REBOUND")).toMatchObject({ team: "AWAY", playerId: "away-1", offensive: false, scorerEventTerminal: { reason: "NATURAL" } });
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(rowsBefore); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(snapshotBefore);
        await f.gameplay.mutateScorerEventGroup(f.run.runId, owner, { kind: "REPLACE_GROUP", scorerEventGroupId: groupId, expectedHistoryRevision: ended.eventHistoryRevision, events: rebound.draftEvents.map((event) => ({ ...(event.eventId ? { eventId: event.eventId } : {}), facts: event.facts })) });
        const saved = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); expect(saved.items.map((item) => item.facts)).toEqual(rebound.normalizedGroup.items.map((item) => item.facts));
    });

    it("normalizes a corrected 3PT Shooting Foul result across authoritative MADE and MISS branches", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "THREE_POINT", team: "HOME", playerId: "home-1", assistPlayerId: "home-2", stoppageId: "correct-shot-result", scorerEventId: "correct-shot-result" }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "correct-shot-result", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId: "correct-shot-result" }); const foulId = foul.eventIds.at(-1); const penaltyId = `penalty:${foulId}`;
        const completed = await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId, attemptIndex: 1, made: true, scorerEventId: "correct-shot-result", scorerEventTerminal: { reason: "NATURAL" } });
        const groupId = "explicit:correct-shot-result"; const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); const context = await f.gameplay.scorerEventEditContext(f.run.runId, owner, groupId); const resultTarget = context.editCapabilities.targets.find((target) => target.kind === "SHOT_RESULT");
        const corrected = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: draftEvents(group), action: { kind: "CORRECT_SHOT_RESULT", targetId: resultTarget.targetId, made: false } });
        const correctedShot = factsOf(corrected.normalizedGroup, "THREE_POINT_MISSED"); expect(correctedShot).toMatchObject({ playerId: "home-1" }); expect(correctedShot).not.toHaveProperty("assistPlayerId");
        expect(factsOf(corrected.normalizedGroup, "PERSONAL_FOUL")).toMatchObject({ offender: { kind: "PLAYER", playerId: "away-1" }, fouledPlayerId: "home-1", relatedShotEventId: shotId });
        expect(corrected.normalizedGroup.items.filter((item) => item.type === "FREE_THROW")).toHaveLength(0);
        expect(factsOf(corrected.normalizedGroup, "PENALTY_ADMINISTRATION_ENDED")).toMatchObject({ penaltyId, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT1", resumeContext: { penaltyShooterPlayerId: "home-1" } } });
        expect(corrected.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 1, penalty: { penaltyId, totalAttempts: 3, remainingAttempts: 3 }, postResultContinuation: "NEXT_FREE_THROW" });

        const ft1Made = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: corrected.draftEvents, action: { kind: "FREE_THROW_RESULT", made: true } }); expect(ft1Made.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 2, postResultContinuation: "NEXT_FREE_THROW" });
        const ft1Miss = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: corrected.draftEvents, action: { kind: "FREE_THROW_RESULT", made: false } }); expect(ft1Miss.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 2, postResultContinuation: "NEXT_FREE_THROW" });
        const ft2 = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: ft1Made.draftEvents, action: { kind: "FREE_THROW_RESULT", made: false } }); expect(ft2.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 3, postResultContinuation: "REBOUNDER_IF_FINAL_MISS" });
        const ft3Made = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: ft2.draftEvents, action: { kind: "FREE_THROW_RESULT", made: true } }); expect(ft3Made.editContext.continuationPlan).toBeNull();
        const ft3Miss = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: ft2.draftEvents, action: { kind: "FREE_THROW_RESULT", made: false } }); expect(ft3Miss.editContext.continuationPlan).toMatchObject({ kind: "REBOUNDER", penaltyId, teamReboundAllowed: true });
        expect(ft3Made.normalizedGroup.items.every((item) => item.scorerEventId === "correct-shot-result")).toBe(true);
        await f.gameplay.mutateScorerEventGroup(f.run.runId, owner, { kind: "REPLACE_GROUP", scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: ft3Made.draftEvents.map((event) => ({ ...(event.eventId ? { eventId: event.eventId } : {}), facts: event.facts })) });
        const saved = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); expect(saved.items.map((item) => item.facts)).toEqual(ft3Made.normalizedGroup.items.map((item) => item.facts));

        const reverse = fixture(); await reverse.gameplay.initialize(reverse.run.runId, owner);
        const reverseShot = await reverse.gameplay.append(reverse.run.runId, owner, { type: "THREE_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: "correct-shot-reverse", scorerEventId: "correct-shot-reverse" }); const reverseShotId = reverseShot.eventIds.at(-1);
        const reverseFoul = await reverse.gameplay.append(reverse.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "correct-shot-reverse", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: reverseShotId, scorerEventId: "correct-shot-reverse" }); const reversePenaltyId = `penalty:${reverseFoul.eventIds.at(-1)}`;
        await reverse.gameplay.append(reverse.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId: reversePenaltyId, attemptIndex: 1, made: true, scorerEventId: "correct-shot-reverse" });
        await reverse.gameplay.append(reverse.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId: reversePenaltyId, attemptIndex: 2, made: true, scorerEventId: "correct-shot-reverse" });
        await reverse.gameplay.append(reverse.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId: reversePenaltyId, attemptIndex: 3, made: false, scorerEventId: "correct-shot-reverse" });
        const reverseCompleted = await reverse.gameplay.append(reverse.run.runId, owner, { type: "REBOUND", team: "AWAY", playerId: "away-1", offensive: false, scorerEventId: "correct-shot-reverse", scorerEventTerminal: { reason: "NATURAL" } });
        const reverseGroupId = "explicit:correct-shot-reverse"; const reverseGroup = await reverse.gameplay.scorerEventGroup(reverse.run.runId, owner, reverseGroupId); const reverseContext = await reverse.gameplay.scorerEventEditContext(reverse.run.runId, owner, reverseGroupId); const reverseTarget = reverseContext.editCapabilities.targets.find((target) => target.kind === "SHOT_RESULT");
        const made = await reverse.gameplay.previewScorerEventGroupMutation(reverse.run.runId, owner, { scorerEventGroupId: reverseGroupId, expectedHistoryRevision: reverseCompleted.eventHistoryRevision, events: draftEvents(reverseGroup), action: { kind: "CORRECT_SHOT_RESULT", targetId: reverseTarget.targetId, made: true } });
        expect(factsOf(made.normalizedGroup, "THREE_POINT")).toMatchObject({ playerId: "home-1" }); expect(made.normalizedGroup.items.some((item) => item.type === "FREE_THROW" || item.type === "REBOUND")).toBe(false); expect(made.editContext.continuationPlan).toMatchObject({ kind: "ASSIST", shotEventId: reverseShotId });
        const noAssist = await reverse.gameplay.previewScorerEventGroupMutation(reverse.run.runId, owner, { scorerEventGroupId: reverseGroupId, expectedHistoryRevision: reverseCompleted.eventHistoryRevision, events: made.draftEvents, action: { kind: "ASSIST", playerId: null } }); expect(noAssist.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 1, penalty: { totalAttempts: 1, remainingAttempts: 1 } });
    });

    it("edits the authoritative CURRENT_OPEN zero-terminal scorer event", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const scorerEventId = "current-open-shot"; const mode = { mode: "CURRENT_OPEN", scorerEventId };
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "THREE_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: scorerEventId, scorerEventId }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: scorerEventId, offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId });
        const groupId = `explicit:${scorerEventId}`; const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId);
        const historical = await f.gameplay.scorerEventEditContext(f.run.runId, owner, groupId); const historicalTarget = historical.editCapabilities.targets.find((target) => target.kind === "SHOT_RESULT");
        expect(historical).toMatchObject({ group: { safeForReconstruction: false }, editCapabilities: { safeForEdit: false } }); expect(historicalTarget).toMatchObject({ editable: false, readOnlyReason: "UNSAFE_GROUP" });
        const context = await f.gameplay.scorerEventEditContext(f.run.runId, owner, groupId, mode); const target = context.editCapabilities.targets.find((candidate) => candidate.kind === "SHOT_RESULT" && candidate.eventId === shotId);
        expect(context).toMatchObject({ group: { safeForReconstruction: false }, editCapabilities: { safeForEdit: true, canResume: false, canDeleteGroup: false }, continuationPlan: { kind: "FREE_THROW_RESULT", attemptNumber: 1, penalty: { totalAttempts: 3, remainingAttempts: 3 } } }); expect(target).toMatchObject({ editable: true, currentValue: "MISS" });
        const rowsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId); const snapshotBefore = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId);
        const preview = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: foul.eventHistoryRevision, mode, events: draftEvents(group), action: { kind: "CORRECT_SHOT_RESULT", targetId: target.targetId, made: true } });
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(rowsBefore); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(snapshotBefore);
        expect(factsOf(preview.normalizedGroup, "THREE_POINT")).toMatchObject({ playerId: "home-1" }); expect(factsOf(preview.normalizedGroup, "PERSONAL_FOUL")).toMatchObject({ offender: { kind: "PLAYER", playerId: "away-1" }, fouledPlayerId: "home-1", relatedShotEventId: shotId });
        expect(preview.normalizedGroup.items.some((item) => item.type === "FREE_THROW" || item.type === "PENALTY_ADMINISTRATION_ENDED")).toBe(false); expect(preview.normalizedGroup.items.every((item) => item.scorerEventId === scorerEventId)).toBe(true); expect(preview.normalizedGroup.items.every((item) => item.scorerEventTerminal === undefined)).toBe(true); expect(preview.editContext.continuationPlan).toMatchObject({ kind: "ASSIST", shotEventId: shotId });
        let rewrites = 0; const rewrite = f.localDatabase.rewriteLocalMatchEventHistory.bind(f.localDatabase); f.localDatabase.rewriteLocalMatchEventHistory = (...args) => { rewrites += 1; return rewrite(...args); };
        const savedResult = await f.gameplay.mutateScorerEventGroup(f.run.runId, owner, { kind: "REPLACE_GROUP", scorerEventGroupId: groupId, expectedHistoryRevision: foul.eventHistoryRevision, mode, events: preview.draftEvents.map((event) => ({ ...(event.eventId ? { eventId: event.eventId } : {}), facts: event.facts })) });
        const saved = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); expect(rewrites).toBe(1); expect(saved.items.map((item) => item.facts)).toEqual(preview.normalizedGroup.items.map((item) => item.facts)); expect(saved.items.every((item) => item.scorerEventId === scorerEventId)).toBe(true); expect(savedResult.state.home.score).toBe(3);
    });

    it("rejects an older completed scorer group in CURRENT_OPEN mode", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const scorerEventId = "completed-shot";
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT", team: "HOME", playerId: "home-1", scorerEventId, scorerEventTerminal: { reason: "NATURAL", decisions: { assist: "NONE" } } });
        await f.gameplay.append(f.run.runId, owner, { type: "CLOCK_START", scorerEventId: "later-group", scorerEventTerminal: { reason: "NATURAL" } });
        const context = await f.gameplay.scorerEventEditContext(f.run.runId, owner, `explicit:${scorerEventId}`, { mode: "CURRENT_OPEN", scorerEventId });
        const target = context.editCapabilities.targets.find((candidate) => candidate.kind === "SHOT_RESULT" && candidate.eventId === shot.eventIds.at(-1));
        expect(context).toMatchObject({ editCapabilities: { safeForEdit: false } });
        expect(target).toMatchObject({ editable: false });
    });

    it("keeps a factual FT1 editable in CURRENT_OPEN while FT2 remains unresolved", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const scorerEventId = "current-open-ft"; const mode = { mode: "CURRENT_OPEN", scorerEventId };
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "THREE_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: scorerEventId, scorerEventId }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: scorerEventId, offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId }); const penaltyId = `penalty:${foul.eventIds.at(-1)}`;
        const ft1 = await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId, attemptIndex: 1, made: true, scorerEventId }); const ft1Id = ft1.eventIds.at(-1);
        const groupId = `explicit:${scorerEventId}`; const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); const context = await f.gameplay.scorerEventEditContext(f.run.runId, owner, groupId, mode); const target = context.editCapabilities.targets.find((candidate) => candidate.kind === "FREE_THROW_RESULT" && candidate.eventId === ft1Id);
        expect(target).toMatchObject({ editable: true, currentValue: "MADE" }); expect(context.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 2 });
        const rowsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId); const preview = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: ft1.eventHistoryRevision, mode, events: draftEvents(group), action: { kind: "CORRECT_FREE_THROW_RESULT", targetId: target.targetId, made: false } });
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(rowsBefore); expect(preview.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 2 }); expect(preview.normalizedGroup.items.find((item) => item.eventId === ft1Id)?.facts).toMatchObject({ made: false }); expect(preview.normalizedGroup.items.every((item) => item.scorerEventTerminal === undefined)).toBe(true);
    });

    it.each([true, false])("advances CURRENT_OPEN FT1 %s to FT2 without PAE", async (made) => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const scorerEventId = `current-open-ft1-${made ? "made" : "miss"}`; const mode = { mode: "CURRENT_OPEN", scorerEventId };
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "THREE_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: scorerEventId, scorerEventId }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: scorerEventId, offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId });
        const groupId = `explicit:${scorerEventId}`; const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); const rowsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId); const snapshotBefore = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId);
        const preview = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: foul.eventHistoryRevision, mode, events: draftEvents(group), action: { kind: "FREE_THROW_RESULT", made } });
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(rowsBefore); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(snapshotBefore);
        expect(preview.normalizedGroup.items.filter((item) => item.type === "FREE_THROW")).toHaveLength(1); expect(factsOf(preview.normalizedGroup, "FREE_THROW")).toMatchObject({ attemptIndex: 1, made, scorerEventId });
        expect(preview.normalizedGroup.items.some((item) => item.type === "PENALTY_ADMINISTRATION_ENDED")).toBe(false); expect(preview.normalizedGroup.items.every((item) => item.scorerEventTerminal === undefined)).toBe(true); expect(preview.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 2 });
        let rewrites = 0; const rewrite = f.localDatabase.rewriteLocalMatchEventHistory.bind(f.localDatabase); f.localDatabase.rewriteLocalMatchEventHistory = (...args) => { rewrites += 1; return rewrite(...args); };
        await f.gameplay.mutateScorerEventGroup(f.run.runId, owner, { kind: "REPLACE_GROUP", scorerEventGroupId: groupId, expectedHistoryRevision: foul.eventHistoryRevision, mode, events: preview.draftEvents.map((event) => ({ ...(event.eventId ? { eventId: event.eventId } : {}), facts: event.facts })) });
        const saved = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); expect(rewrites).toBe(1); expect(saved.items.map((item) => item.facts)).toEqual(preview.normalizedGroup.items.map((item) => item.facts)); expect(saved.items.every((item) => item.scorerEventId === scorerEventId)).toBe(true);
    });

    it.each([true, false])("advances CURRENT_OPEN FT2 %s to FT3 without PAE", async (made) => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const scorerEventId = `current-open-ft2-${made ? "made" : "miss"}`; const mode = { mode: "CURRENT_OPEN", scorerEventId };
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "THREE_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: scorerEventId, scorerEventId }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: scorerEventId, offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId }); const penaltyId = `penalty:${foul.eventIds.at(-1)}`;
        const ft1 = await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId, attemptIndex: 1, made: true, scorerEventId });
        const groupId = `explicit:${scorerEventId}`; const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); const rowsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId);
        const preview = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: ft1.eventHistoryRevision, mode, events: draftEvents(group), action: { kind: "FREE_THROW_RESULT", made } });
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(rowsBefore); expect(preview.normalizedGroup.items.filter((item) => item.type === "FREE_THROW")).toHaveLength(2); expect(preview.normalizedGroup.items.filter((item) => item.type === "FREE_THROW").at(-1)?.facts).toMatchObject({ attemptIndex: 2, made, scorerEventId });
        expect(preview.normalizedGroup.items.some((item) => item.type === "PENALTY_ADMINISTRATION_ENDED")).toBe(false); expect(preview.normalizedGroup.items.every((item) => item.scorerEventTerminal === undefined)).toBe(true); expect(preview.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 3 });
    });

    it("continues the corrected CURRENT_OPEN 3PT Shooting Foul from FT1 to FT2", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const scorerEventId = "current-open-corrected-shot-ft"; const mode = { mode: "CURRENT_OPEN", scorerEventId };
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "THREE_POINT", team: "HOME", playerId: "home-1", assistPlayerId: "home-2", stoppageId: scorerEventId, scorerEventId }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: scorerEventId, offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId });
        const groupId = `explicit:${scorerEventId}`; const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); const context = await f.gameplay.scorerEventEditContext(f.run.runId, owner, groupId, mode); const resultTarget = context.editCapabilities.targets.find((target) => target.kind === "SHOT_RESULT");
        const corrected = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: foul.eventHistoryRevision, mode, events: draftEvents(group), action: { kind: "CORRECT_SHOT_RESULT", targetId: resultTarget.targetId, made: false } });
        expect(corrected.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 1, penalty: { totalAttempts: 3 } });
        const ft1 = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: foul.eventHistoryRevision, mode, events: corrected.draftEvents, action: { kind: "FREE_THROW_RESULT", made: true } });
        expect(ft1.normalizedGroup.items.filter((item) => item.type === "FREE_THROW")).toHaveLength(1); expect(ft1.normalizedGroup.items.some((item) => item.type === "PENALTY_ADMINISTRATION_ENDED")).toBe(false); expect(ft1.normalizedGroup.items.every((item) => item.scorerEventTerminal === undefined)).toBe(true); expect(ft1.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 2 });
    });

    it("CORRECT_FREE_THROW_RESULT reopens a final LIVE_BALL miss at REBOUNDER and preserves preview-save equivalence", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "THREE_POINT", team: "HOME", playerId: "home-1", assistPlayerId: "home-2", stoppageId: "correct-final-ft", scorerEventId: "correct-final-ft" }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "correct-final-ft", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId: "correct-final-ft" }); const foulId = foul.eventIds.at(-1); const penaltyId = `penalty:${foulId}`;
        const completed = await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId, attemptIndex: 1, made: true, scorerEventId: "correct-final-ft", scorerEventTerminal: { reason: "NATURAL" } }); const freeThrowId = completed.eventIds.at(-1);
        const groupId = "explicit:correct-final-ft"; const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); const context = await f.gameplay.scorerEventEditContext(f.run.runId, owner, groupId); const target = context.editCapabilities.targets.find((candidate) => candidate.kind === "FREE_THROW_RESULT");
        const rowsBefore = f.localDatabase.readLocalMatchEvents(f.run.runId); const snapshotBefore = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId);
        const corrected = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: draftEvents(group), action: { kind: "CORRECT_FREE_THROW_RESULT", targetId: target.targetId, made: false } });
        const correctedFreeThrow = corrected.normalizedGroup.items.find((item) => item.type === "FREE_THROW");
        expect(correctedFreeThrow).toMatchObject({ eventId: freeThrowId, scorerEventId: "correct-final-ft", facts: { playerId: "home-1", penaltyId, attemptIndex: 1, made: false, scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "REBOUNDER" } } });
        expect(corrected.normalizedGroup.items.find((item) => item.type === "THREE_POINT")?.facts).toMatchObject({ assistPlayerId: "home-2" }); expect(corrected.normalizedGroup.items.find((item) => item.type === "PERSONAL_FOUL")?.eventId).toBe(foulId);
        expect(corrected.normalizedGroup.items.some((item) => item.type === "REBOUND")).toBe(false); expect(corrected.editContext.continuationPlan).toMatchObject({ kind: "REBOUNDER", sourceEventId: freeThrowId, penaltyId, teamReboundAllowed: true, candidatePlayerIds: expect.arrayContaining(["home-1", "away-1"]) });
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(rowsBefore); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(snapshotBefore);
        const reversed = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: corrected.draftEvents, action: { kind: "CORRECT_FREE_THROW_RESULT", targetId: corrected.editContext.editCapabilities.targets.find((candidate) => candidate.kind === "FREE_THROW_RESULT").targetId, made: true } });
        expect(reversed.editContext.continuationPlan).toBeNull(); expect(reversed.normalizedGroup.items.find((item) => item.type === "FREE_THROW")?.facts.scorerEventTerminal).toEqual({ reason: "NATURAL" }); expect(reversed.normalizedGroup.items.some((item) => item.type === "REBOUND")).toBe(false);
        await f.gameplay.mutateScorerEventGroup(f.run.runId, owner, { kind: "REPLACE_GROUP", scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: corrected.draftEvents.map((event) => ({ ...(event.eventId ? { eventId: event.eventId } : {}), facts: event.facts })) });
        const saved = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); expect(saved.items.map((item) => item.facts)).toEqual(corrected.normalizedGroup.items.map((item) => item.facts));
    });

    it("CORRECT_FREE_THROW_RESULT keeps non-final misses on the next factual FT", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const shot = await f.gameplay.append(f.run.runId, owner, { type: "THREE_POINT_MISSED", team: "HOME", playerId: "home-1", stoppageId: "correct-non-final-ft", scorerEventId: "correct-non-final-ft" }); const shotId = shot.eventIds.at(-1);
        const foul = await f.gameplay.append(f.run.runId, owner, { type: "PERSONAL_FOUL", team: "AWAY", stoppageId: "correct-non-final-ft", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "SHOOTING" }, fouledPlayerId: "home-1", relatedShotEventId: shotId, scorerEventId: "correct-non-final-ft" }); const penaltyId = `penalty:${foul.eventIds.at(-1)}`;
        const ft1 = await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: "HOME", playerId: "home-1", penaltyId, attemptIndex: 1, made: true, scorerEventId: "correct-non-final-ft" }); const ft1Id = ft1.eventIds.at(-1);
        const ended = await f.gameplay.append(f.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId, scorerEventId: "correct-non-final-ft", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT2", resumeContext: { penaltyShooterPlayerId: "home-1" } } });
        const groupId = "explicit:correct-non-final-ft"; const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); const context = await f.gameplay.scorerEventEditContext(f.run.runId, owner, groupId); const target = context.editCapabilities.targets.find((candidate) => candidate.kind === "FREE_THROW_RESULT" && candidate.eventId === ft1Id);
        const corrected = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: ended.eventHistoryRevision, events: draftEvents(group), action: { kind: "CORRECT_FREE_THROW_RESULT", targetId: target.targetId, made: false } });
        expect(corrected.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 2 }); expect(corrected.normalizedGroup.items.find((item) => item.eventId === ft1Id)?.facts.scorerEventTerminal).toBeUndefined(); expect(corrected.normalizedGroup.items.some((item) => item.scorerEventTerminal?.unresolvedStep === "REBOUNDER")).toBe(false);
    });

    it("CORRECT_FREE_THROW_RESULT keeps non-LIVE_BALL final misses naturally terminal", async () => {
        const cases = [
            { name: "technical", foul: { type: "TECHNICAL_FOUL", team: "HOME", stoppageId: "correct-technical-ft", offender: { kind: "PLAYER", playerId: "home-1" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_2", scorerEventId: "correct-technical-ft" }, shooterTeam: "AWAY", shooter: "away-1", attempts: 1 },
            ...["FLAGRANT_FOUL", "DISRUPTIVE_FOUL", "DISQUALIFYING_FOUL"].map((type) => ({ name: type, foul: { type, team: "AWAY", stoppageId: `correct-${type}`, offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "NON_SHOOTING" }, fouledPlayerId: "home-1", scorerEventId: `correct-${type}` }, shooterTeam: "HOME", shooter: "home-1", attempts: 2 })),
        ];
        for (const scenario of cases) {
            const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const foul = await f.gameplay.append(f.run.runId, owner, scenario.foul); const penaltyId = `penalty:${foul.eventIds.at(-1)}`;
            if (scenario.attempts === 2) await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: scenario.shooterTeam, playerId: scenario.shooter, penaltyId, attemptIndex: 1, made: true, scorerEventId: scenario.foul.scorerEventId });
            const completed = await f.gameplay.append(f.run.runId, owner, { type: "FREE_THROW", team: scenario.shooterTeam, playerId: scenario.shooter, penaltyId, attemptIndex: scenario.attempts, made: true, scorerEventId: scenario.foul.scorerEventId, scorerEventTerminal: { reason: "NATURAL" } }); const finalFtId = completed.eventIds.at(-1);
            const groupId = `explicit:${scenario.foul.scorerEventId}`; const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); const context = await f.gameplay.scorerEventEditContext(f.run.runId, owner, groupId); const target = context.editCapabilities.targets.find((candidate) => candidate.kind === "FREE_THROW_RESULT" && candidate.eventId === finalFtId);
            const corrected = await f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: completed.eventHistoryRevision, events: draftEvents(group), action: { kind: "CORRECT_FREE_THROW_RESULT", targetId: target.targetId, made: false } });
            expect(corrected.editContext.continuationPlan, scenario.name).toBeNull(); expect(corrected.normalizedGroup.items.find((item) => item.eventId === finalFtId)?.facts.scorerEventTerminal, scenario.name).toEqual({ reason: "NATURAL" }); expect(corrected.normalizedGroup.items.some((item) => item.type === "REBOUND"), scenario.name).toBe(false);
        }
    });

    it("previews Technical shooter selection and keeps non-LIVE_BALL final misses naturally terminal", async () => {
        const technical = fixture(); await technical.gameplay.initialize(technical.run.runId, owner);
        const foul = await technical.gameplay.append(technical.run.runId, owner, { type: "TECHNICAL_FOUL", team: "HOME", stoppageId: "preview-technical", offender: { kind: "PLAYER", playerId: "home-1" }, context: { kind: "NON_CONTACT" }, category: "CATEGORY_2", scorerEventId: "preview-technical" }); const penaltyId = `penalty:${foul.eventIds.at(-1)}`;
        const ended = await technical.gameplay.append(technical.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId, scorerEventId: "preview-technical", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "CHOOSE_SHOOTER" } }); const groupId = "explicit:preview-technical"; const group = await technical.gameplay.scorerEventGroup(technical.run.runId, owner, groupId);
        const selected = await technical.gameplay.previewScorerEventGroupMutation(technical.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: ended.eventHistoryRevision, events: draftEvents(group), action: { kind: "CHOOSE_SHOOTER", playerId: "away-1" } }); expect(selected.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", shooterPlayerId: "away-1", attemptNumber: 1, postResultContinuation: "END" });
        const missed = await technical.gameplay.previewScorerEventGroupMutation(technical.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: ended.eventHistoryRevision, events: selected.draftEvents, action: { kind: "FREE_THROW_RESULT", made: false } }); expect(missed.editContext.continuationPlan).toBeNull(); expect(factsOf(missed.normalizedGroup, "FREE_THROW")).toMatchObject({ playerId: "away-1", made: false, scorerEventTerminal: { reason: "NATURAL" } });

        const severe = fixture(); await severe.gameplay.initialize(severe.run.runId, owner); const severeFoul = await severe.gameplay.append(severe.run.runId, owner, { type: "FLAGRANT_FOUL", team: "AWAY", stoppageId: "preview-frontcourt", offender: { kind: "PLAYER", playerId: "away-1" }, context: { kind: "NON_SHOOTING" }, fouledPlayerId: "home-1", scorerEventId: "preview-frontcourt" }); const severePenaltyId = `penalty:${severeFoul.eventIds.at(-1)}`;
        const severeEnd = await severe.gameplay.append(severe.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId: severePenaltyId, scorerEventId: "preview-frontcourt", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "FT1", resumeContext: { penaltyShooterPlayerId: "home-1" } } }); const severeGroupId = "explicit:preview-frontcourt"; const severeGroup = await severe.gameplay.scorerEventGroup(severe.run.runId, owner, severeGroupId);
        const severeFt1 = await severe.gameplay.previewScorerEventGroupMutation(severe.run.runId, owner, { scorerEventGroupId: severeGroupId, expectedHistoryRevision: severeEnd.eventHistoryRevision, events: draftEvents(severeGroup), action: { kind: "FREE_THROW_RESULT", made: true } }); expect(severeFt1.editContext.continuationPlan).toMatchObject({ kind: "FREE_THROW_RESULT", attemptNumber: 2, postResultContinuation: "END" });
        const severeFinal = await severe.gameplay.previewScorerEventGroupMutation(severe.run.runId, owner, { scorerEventGroupId: severeGroupId, expectedHistoryRevision: severeEnd.eventHistoryRevision, events: severeFt1.draftEvents, action: { kind: "FREE_THROW_RESULT", made: false } }); const finalSevereFreeThrow = severeFinal.normalizedGroup.items.filter((item) => item.type === "FREE_THROW").at(-1); expect(severeFinal.editContext.continuationPlan).toBeNull(); expect(finalSevereFreeThrow.facts.scorerEventTerminal).toEqual({ reason: "NATURAL" });
    });

    it("previews Assist, no Assist, Stealer, no Steal, player Rebound, and TEAM Rebound continuations", async () => {
        const assist = fixture(); await assist.gameplay.initialize(assist.run.runId, owner); const shot = await assist.gameplay.append(assist.run.runId, owner, { type: "TWO_POINT", team: "HOME", playerId: "home-1", scorerEventId: "preview-assist", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "ASSIST" } }); const assistGroup = await assist.gameplay.scorerEventGroup(assist.run.runId, owner, "explicit:preview-assist");
        const assisted = await assist.gameplay.previewScorerEventGroupMutation(assist.run.runId, owner, { scorerEventGroupId: "explicit:preview-assist", expectedHistoryRevision: shot.eventHistoryRevision, events: draftEvents(assistGroup), action: { kind: "ASSIST", playerId: "home-2" } }); expect(factsOf(assisted.normalizedGroup, "TWO_POINT")).toMatchObject({ assistPlayerId: "home-2", scorerEventTerminal: { reason: "NATURAL" } });
        const noAssist = await assist.gameplay.previewScorerEventGroupMutation(assist.run.runId, owner, { scorerEventGroupId: "explicit:preview-assist", expectedHistoryRevision: shot.eventHistoryRevision, events: draftEvents(assistGroup), action: { kind: "ASSIST", playerId: null } }); expect(factsOf(noAssist.normalizedGroup, "TWO_POINT").scorerEventTerminal).toEqual({ reason: "NATURAL", decisions: { assist: "NONE" } });

        const steal = fixture(); await steal.gameplay.initialize(steal.run.runId, owner); const turnover = await steal.gameplay.append(steal.run.runId, owner, { type: "TURNOVER", team: "HOME", playerId: "home-1", scorerEventId: "preview-steal", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "STEALER" } }); const stealGroup = await steal.gameplay.scorerEventGroup(steal.run.runId, owner, "explicit:preview-steal");
        const stolen = await steal.gameplay.previewScorerEventGroupMutation(steal.run.runId, owner, { scorerEventGroupId: "explicit:preview-steal", expectedHistoryRevision: turnover.eventHistoryRevision, events: draftEvents(stealGroup), action: { kind: "STEALER", playerId: "away-1" } }); expect(factsOf(stolen.normalizedGroup, "STEAL")).toMatchObject({ playerId: "away-1", scorerEventTerminal: { reason: "NATURAL" } });
        const noSteal = await steal.gameplay.previewScorerEventGroupMutation(steal.run.runId, owner, { scorerEventGroupId: "explicit:preview-steal", expectedHistoryRevision: turnover.eventHistoryRevision, events: draftEvents(stealGroup), action: { kind: "STEALER", playerId: null } }); expect(factsOf(noSteal.normalizedGroup, "TURNOVER").scorerEventTerminal).toEqual({ reason: "NATURAL", decisions: { steal: "NONE" } });

        const rebound = fixture(); await rebound.gameplay.initialize(rebound.run.runId, owner); const miss = await rebound.gameplay.append(rebound.run.runId, owner, { type: "TWO_POINT_MISSED", team: "HOME", playerId: "home-1", scorerEventId: "preview-rebound", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "REBOUNDER" } }); const reboundGroup = await rebound.gameplay.scorerEventGroup(rebound.run.runId, owner, "explicit:preview-rebound");
        const player = await rebound.gameplay.previewScorerEventGroupMutation(rebound.run.runId, owner, { scorerEventGroupId: "explicit:preview-rebound", expectedHistoryRevision: miss.eventHistoryRevision, events: draftEvents(reboundGroup), action: { kind: "REBOUNDER", team: "AWAY", playerId: "away-1", teamRebound: false } }); const playerRebound = factsOf(player.normalizedGroup, "REBOUND"); expect(playerRebound).toMatchObject({ playerId: "away-1", offensive: false }); expect(playerRebound).not.toHaveProperty("teamRebound");
        const team = await rebound.gameplay.previewScorerEventGroupMutation(rebound.run.runId, owner, { scorerEventGroupId: "explicit:preview-rebound", expectedHistoryRevision: miss.eventHistoryRevision, events: draftEvents(reboundGroup), action: { kind: "REBOUNDER", team: "HOME", teamRebound: true } }); expect(factsOf(team.normalizedGroup, "REBOUND")).toMatchObject({ team: "HOME", teamRebound: true, offensive: true, scorerEventTerminal: { reason: "NATURAL" } });
    });

    it("rejects stale, invalid-candidate, and later-replay-invalid previews with zero durable writes", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner); const shot = await f.gameplay.append(f.run.runId, owner, { type: "TWO_POINT", team: "HOME", playerId: "home-1", scorerEventId: "preview-errors", scorerEventTerminal: { reason: "ENTER_EARLY", unresolvedStep: "ASSIST" } }); const groupId = "explicit:preview-errors"; const group = await f.gameplay.scorerEventGroup(f.run.runId, owner, groupId); const beforeRows = f.localDatabase.readLocalMatchEvents(f.run.runId); const beforeSnapshot = f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId);
        await expect(f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: shot.eventHistoryRevision - 1, events: draftEvents(group) })).rejects.toMatchObject({ code: "GAMEPLAY_CONFLICT" });
        await expect(f.gameplay.previewScorerEventGroupMutation(f.run.runId, owner, { scorerEventGroupId: groupId, expectedHistoryRevision: shot.eventHistoryRevision, events: draftEvents(group), action: { kind: "ASSIST", playerId: "home-1" } })).rejects.toMatchObject({ code: "GAMEPLAY_EVENT_REJECTED" });
        expect(f.localDatabase.readLocalMatchEvents(f.run.runId)).toEqual(beforeRows); expect(f.localDatabase.readLocalMatchEngineSnapshot(f.run.runId)).toEqual(beforeSnapshot);

        const replay = fixture(); await replay.gameplay.initialize(replay.run.runId, owner); const foul = await replay.gameplay.append(replay.run.runId, owner, { type: "DISQUALIFYING_FOUL", team: "HOME", stoppageId: "preview-replay", offender: { kind: "PLAYER", playerId: "home-1" }, context: { kind: "NON_SHOOTING" }, fouledPlayerId: "away-1", scorerEventId: "preview-replay" }); const foulId = foul.eventIds.at(-1); const penaltyId = `penalty:${foulId}`; const ended = await replay.gameplay.append(replay.run.runId, owner, { type: "PENALTY_ADMINISTRATION_ENDED", penaltyId, scorerEventId: "preview-replay", scorerEventTerminal: { reason: "NATURAL" } }); await replay.gameplay.append(replay.run.runId, owner, { type: "TWO_POINT", team: "HOME", playerId: "home-2", scorerEventId: "later-home2", scorerEventTerminal: { reason: "NATURAL" } });
        const replayGroup = await replay.gameplay.scorerEventGroup(replay.run.runId, owner, "explicit:preview-replay"); const replayRows = replay.localDatabase.readLocalMatchEvents(replay.run.runId); const replaySnapshot = replay.localDatabase.readLocalMatchEngineSnapshot(replay.run.runId); const changed = draftEvents(replayGroup).map((event) => event.eventId === foulId ? { ...event, facts: { ...event.facts, offender: { kind: "PLAYER", playerId: "home-2" } } } : event);
        await expect(replay.gameplay.previewScorerEventGroupMutation(replay.run.runId, owner, { scorerEventGroupId: "explicit:preview-replay", expectedHistoryRevision: ended.eventHistoryRevision + 1, events: changed })).rejects.toMatchObject({ code: "GAMEPLAY_EVENT_REJECTED" });
        expect(replay.localDatabase.readLocalMatchEvents(replay.run.runId)).toEqual(replayRows); expect(replay.localDatabase.readLocalMatchEngineSnapshot(replay.run.runId)).toEqual(replaySnapshot);
    });

    it("keeps the 1000-event live hot path append-only without durable history replay", async () => {
        const f = fixture(); await f.gameplay.initialize(f.run.runId, owner);
        const originalRead = f.localDatabase.readLocalMatchEvents.bind(f.localDatabase);
        const originalRewrite = f.localDatabase.rewriteLocalMatchEventHistory.bind(f.localDatabase);
        let historyReads = 0; let historyRewrites = 0;
        f.localDatabase.readLocalMatchEvents = (...args) => { historyReads += 1; return originalRead(...args); };
        f.localDatabase.rewriteLocalMatchEventHistory = (...args) => { historyRewrites += 1; return originalRewrite(...args); };
        const samples = []; const reports = {};
        const percentile = (values, ratio) => [...values].sort((left, right) => left - right)[Math.floor((values.length - 1) * ratio)];
        for (let index = 1; index <= 1000; index += 1) {
            const startedAt = performance.now();
            await f.gameplay.append(f.run.runId, owner, { type: index % 2 === 1 ? "CLOCK_START" : "CLOCK_STOP" });
            samples.push(performance.now() - startedAt);
            if ([100, 250, 500, 1000].includes(index)) reports[index] = { p50: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
        }
        console.info("KC5B10 LIVE_EVENT_HOT_PATH", JSON.stringify(reports));
        expect(historyReads).toBe(0);
        expect(historyRewrites).toBe(0);
        expect(f.localDatabase.readLocalGameRun(f.run.runId).lastAcceptedSequence).toBe(1001);
        expect(reports[1000].p95).toBeLessThan(250);
    }, 30_000);
});
