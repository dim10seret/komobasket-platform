import { createHash } from "node:crypto";
import type { DesktopAuthState } from "../auth/auth-contracts.cjs";
import type { MatchSetup, MatchSetupManager, MatchSetupPlayer, MatchSetupStaffMember, MatchSetupTeam } from "../games/match-setup.cjs";
import type {
    CreateLocalGameRunConfigurationInput,
    LocalGameRunConfigurationStoreResult,
    SaveLocalGameRunConfigurationInput,
    StoredLocalGameRun,
    StoredLocalGameRunConfiguration,
} from "../persistence/local-database.cjs";

export const PRE_GAME_CONFIGURATION_ERROR_CODES = [
    "CONFIGURATION_UNAVAILABLE",
    "CONFIGURATION_INVALID",
    "CONFIGURATION_CONFLICT",
    "CONFIGURATION_OWNERSHIP_CONFLICT",
] as const;
export type PreGameConfigurationErrorCode = (typeof PRE_GAME_CONFIGURATION_ERROR_CODES)[number];
export type PreGameConfigurationStatus = "draft" | "ready";
export type TeamSide = "HOME" | "AWAY";

export interface PreGameConfigurationOwner { scorerId: string; organizationId: string; }
export interface PreGameConfigurationPlayerV1 { playerId: string; participating: boolean; gameShirtNumber: string | null; }
export interface PreGameConfigurationStaffV1 { staffId: string; participating: boolean; }
export interface PreGameConfigurationTeamV1 {
    side: TeamSide;
    teamId: string;
    players: PreGameConfigurationPlayerV1[];
    staff: PreGameConfigurationStaffV1[];
    captainPlayerId: string | null;
    starterPlayerIds: string[];
}
export interface PreGameConfigurationV1 {
    schemaVersion: 1;
    runId: string;
    gameId: string;
    teams: [PreGameConfigurationTeamV1, PreGameConfigurationTeamV1];
}

export interface SafePreGameConfigurationPlayer {
    playerId: string;
    displayName: string;
    packageShirtNumber: number | null;
    gameShirtNumber: string | null;
    participating: boolean;
}
export interface SafePreGameConfigurationStaff {
    staffId: string;
    displayName: string;
    role: string;
    roleLabel: string | null;
    participating: boolean;
}
export interface SafePreGameConfigurationTeam {
    side: TeamSide;
    teamId: string;
    teamName: string;
    players: SafePreGameConfigurationPlayer[];
    staff: SafePreGameConfigurationStaff[];
    captainPlayerId: string | null;
    starterPlayerIds: string[];
}
export interface SafePreGameConfiguration {
    runId: string;
    gameId: string;
    packageId: string;
    packageVersion: number;
    configurationSchemaVersion: 1;
    revision: number;
    status: PreGameConfigurationStatus;
    teams: [SafePreGameConfigurationTeam, SafePreGameConfigurationTeam];
    createdAtUtc: string;
    updatedAtUtc: string;
}
export interface PreGameConfigurationPlayerDraft {
    playerId: string;
    participating: boolean;
    gameShirtNumber: string | null;
}
export interface PreGameConfigurationTeamDraft { side: TeamSide; players: PreGameConfigurationPlayerDraft[]; }
export interface PreGameConfigurationSaveDraftInput {
    gameId: string;
    expectedRevision: number;
    teams: [PreGameConfigurationTeamDraft, PreGameConfigurationTeamDraft];
}
export type PreGameConfigurationOperationResult =
    | { ok: true; outcome: "created" | "existing" | "saved"; configuration: SafePreGameConfiguration; state: DesktopAuthState }
    | { ok: false; errorCode: PreGameConfigurationErrorCode | "SESSION_INVALID"; state: DesktopAuthState };

interface PreGameConfigurationStore {
    getActiveLocalGameRun(gameId: string): StoredLocalGameRun | null;
    readLocalGameRunConfiguration(runId: string): StoredLocalGameRunConfiguration | null;
    createOrOpenLocalGameRunConfiguration(input: CreateLocalGameRunConfigurationInput): LocalGameRunConfigurationStoreResult;
    saveLocalGameRunConfiguration(input: SaveLocalGameRunConfigurationInput): StoredLocalGameRunConfiguration;
}

export class PreGameConfigurationFlowError extends Error {
    constructor(readonly code: PreGameConfigurationErrorCode) { super(code); this.name = "PreGameConfigurationFlowError"; }
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function text(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function shirtNumber(value: unknown): string | null {
    if (value === null) return null;
    if (typeof value !== "string" || !/^(?:0|00|[1-9][0-9]?)$/.test(value)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return value;
}
function configurationHash(json: string): string { return createHash("sha256").update(Buffer.from(json, "utf8")).digest("hex"); }
function sideOrder(side: TeamSide): number { return side === "HOME" ? 0 : 1; }
function playerFromUnknown(value: unknown): PreGameConfigurationPlayerV1 {
    const item = record(value); const playerId = text(item?.playerId);
    if (!item || !playerId || typeof item.participating !== "boolean") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return { playerId, participating: item.participating, gameShirtNumber: shirtNumber(item.gameShirtNumber) };
}
function staffFromUnknown(value: unknown): PreGameConfigurationStaffV1 {
    const item = record(value); const staffId = text(item?.staffId);
    if (!item || !staffId || typeof item.participating !== "boolean") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return { staffId, participating: item.participating };
}
function teamFromUnknown(value: unknown): PreGameConfigurationTeamV1 {
    const item = record(value); const teamId = text(item?.teamId);
    if (!item || (item.side !== "HOME" && item.side !== "AWAY") || !teamId || !Array.isArray(item.players) || !Array.isArray(item.staff) || !(item.captainPlayerId === null || typeof item.captainPlayerId === "string") || !Array.isArray(item.starterPlayerIds) || !item.starterPlayerIds.every((entry) => typeof entry === "string" && entry.trim())) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return { side: item.side, teamId, players: item.players.map(playerFromUnknown), staff: item.staff.map(staffFromUnknown), captainPlayerId: item.captainPlayerId, starterPlayerIds: [...item.starterPlayerIds] };
}
function parseConfiguration(json: string): PreGameConfigurationV1 {
    let value: unknown;
    try { value = JSON.parse(json); } catch { throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID"); }
    const item = record(value); const runId = text(item?.runId); const gameId = text(item?.gameId);
    if (!item || item.schemaVersion !== 1 || !runId || !gameId || !Array.isArray(item.teams) || item.teams.length !== 2) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    const teams = item.teams.map(teamFromUnknown).sort((left, right) => sideOrder(left.side) - sideOrder(right.side));
    if (teams[0]?.side !== "HOME" || teams[1]?.side !== "AWAY") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return { schemaVersion: 1, runId, gameId, teams: [teams[0], teams[1]] };
}
function uniqueById<T>(values: T[], id: (value: T) => string): boolean { return new Set(values.map(id)).size === values.length; }
function validateTeam(configuration: PreGameConfigurationTeamV1, source: MatchSetupTeam, status: PreGameConfigurationStatus, startingPlayers: number): void {
    if (configuration.teamId !== source.teamId || configuration.players.length !== source.players.length || configuration.staff.length !== source.staff.length || !uniqueById(configuration.players, (player) => player.playerId) || !uniqueById(configuration.staff, (staff) => staff.staffId)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    const sourcePlayerIds = new Set(source.players.map((player) => player.playerId)); const sourceStaffIds = new Set(source.staff.map((staff) => staff.staffId));
    if (configuration.players.some((player) => !sourcePlayerIds.has(player.playerId)) || configuration.staff.some((staff) => !sourceStaffIds.has(staff.staffId))) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    const participating = configuration.players.filter((player) => player.participating);
    const assigned = participating.map((player) => player.gameShirtNumber).filter((number): number is string => number !== null);
    if (new Set(assigned).size !== assigned.length) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    const participatingIds = new Set(participating.map((player) => player.playerId));
    if (configuration.captainPlayerId !== null && !participatingIds.has(configuration.captainPlayerId)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    if (!uniqueById(configuration.starterPlayerIds, (id) => id) || configuration.starterPlayerIds.some((id) => !participatingIds.has(id))) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    if (status === "ready" && (configuration.captainPlayerId === null || configuration.starterPlayerIds.length !== startingPlayers)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
}
function validateConfiguration(configuration: PreGameConfigurationV1, run: StoredLocalGameRun, setup: MatchSetup, status: PreGameConfigurationStatus): void {
    if (configuration.runId !== run.runId || configuration.gameId !== run.gameId || configuration.teams[0].side !== "HOME" || configuration.teams[1].side !== "AWAY") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    validateTeam(configuration.teams[0], setup.home, status, setup.settings.startingPlayers);
    validateTeam(configuration.teams[1], setup.away, status, setup.settings.startingPlayers);
}
function defaultPlayers(players: MatchSetupPlayer[]): PreGameConfigurationPlayerV1[] { return players.map((player) => ({ playerId: player.playerId, participating: false, gameShirtNumber: player.shirtNumber === null ? null : String(player.shirtNumber) })); }
function defaultStaff(staff: MatchSetupStaffMember[]): PreGameConfigurationStaffV1[] { return staff.map((member) => ({ staffId: member.staffId, participating: false })); }
function defaultTeam(team: MatchSetupTeam): PreGameConfigurationTeamV1 { return { side: team.side, teamId: team.teamId, players: defaultPlayers(team.players), staff: defaultStaff(team.staff), captainPlayerId: null, starterPlayerIds: [] }; }
function defaultConfiguration(run: StoredLocalGameRun, setup: MatchSetup): PreGameConfigurationV1 { return { schemaVersion: 1, runId: run.runId, gameId: run.gameId, teams: [defaultTeam(setup.home), defaultTeam(setup.away)] }; }

function canonicalTeamDraft(value: PreGameConfigurationTeamDraft, current: PreGameConfigurationTeamV1, source: MatchSetupTeam): PreGameConfigurationTeamV1 {
    if (value.side !== source.side || value.players.length !== source.players.length || !uniqueById(value.players, (player) => player.playerId)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    const drafts = new Map(value.players.map((player) => [player.playerId, player]));
    const players = source.players.map((sourcePlayer) => {
        const player = drafts.get(sourcePlayer.playerId);
        if (!player || typeof player.participating !== "boolean") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        return { playerId: sourcePlayer.playerId, participating: player.participating, gameShirtNumber: shirtNumber(player.gameShirtNumber) };
    });
    return { ...current, players };
}
function safeTeam(configuration: PreGameConfigurationTeamV1, source: MatchSetupTeam): SafePreGameConfigurationTeam {
    const players = new Map(configuration.players.map((player) => [player.playerId, player])); const staff = new Map(configuration.staff.map((member) => [member.staffId, member]));
    return {
        side: source.side, teamId: source.teamId, teamName: source.teamName,
        players: source.players.map((sourcePlayer) => { const player = players.get(sourcePlayer.playerId); if (!player) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID"); return { playerId: sourcePlayer.playerId, displayName: sourcePlayer.displayName, packageShirtNumber: sourcePlayer.shirtNumber, gameShirtNumber: player.gameShirtNumber, participating: player.participating }; }),
        staff: source.staff.map((sourceStaff) => { const member = staff.get(sourceStaff.staffId); if (!member) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID"); return { staffId: sourceStaff.staffId, displayName: sourceStaff.displayName, role: sourceStaff.role, roleLabel: sourceStaff.roleLabel, participating: member.participating }; }),
        captainPlayerId: configuration.captainPlayerId, starterPlayerIds: [...configuration.starterPlayerIds],
    };
}
function localConflictKind(error: unknown): "ownership" | "state" | "revision" | null {
    if (error === null || typeof error !== "object" || !("name" in error) || error.name !== "LocalGameRunConfigurationConflictError" || !("kind" in error)) return null;
    return error.kind === "ownership" || error.kind === "state" || error.kind === "revision" ? error.kind : null;
}

export class PreGameConfigurationManager {
    constructor(private readonly setup: MatchSetupManager, private readonly store: PreGameConfigurationStore, private readonly deviceId: string) {}

    getOrCreate(gameId: string, owner: PreGameConfigurationOwner): { outcome: "created" | "existing"; configuration: SafePreGameConfiguration } {
        const { run, setup } = this.verifiedContext(gameId, owner);
        const initial = defaultConfiguration(run, setup); const configurationJson = JSON.stringify(initial);
        let result: LocalGameRunConfigurationStoreResult;
        try {
            result = this.store.createOrOpenLocalGameRunConfiguration({ runId: run.runId, organizationId: owner.organizationId, scorerId: owner.scorerId, deviceId: this.deviceId, configurationSchemaVersion: 1, configurationJson, configurationHash: configurationHash(configurationJson) });
        } catch (error) { throw this.mapStoreError(error); }
        return { outcome: result.outcome, configuration: this.verifyStored(result.configuration, run, setup) };
    }

    saveDraft(input: PreGameConfigurationSaveDraftInput, owner: PreGameConfigurationOwner): SafePreGameConfiguration {
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || input.teams.length !== 2) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        const { run, setup } = this.verifiedContext(input.gameId, owner); const stored = this.store.readLocalGameRunConfiguration(run.runId);
        if (!stored) throw new PreGameConfigurationFlowError("CONFIGURATION_UNAVAILABLE");
        const current = this.verifyStoredConfiguration(stored, run, setup);
        const drafts = [...input.teams].sort((left, right) => sideOrder(left.side) - sideOrder(right.side));
        if (drafts[0]?.side !== "HOME" || drafts[1]?.side !== "AWAY") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        const next: PreGameConfigurationV1 = { ...current, teams: [canonicalTeamDraft(drafts[0], current.teams[0], setup.home), canonicalTeamDraft(drafts[1], current.teams[1], setup.away)] };
        validateConfiguration(next, run, setup, "draft"); const configurationJson = JSON.stringify(next);
        let saved: StoredLocalGameRunConfiguration;
        try { saved = this.store.saveLocalGameRunConfiguration({ runId: run.runId, organizationId: owner.organizationId, scorerId: owner.scorerId, deviceId: this.deviceId, expectedRevision: input.expectedRevision, configurationJson, configurationHash: configurationHash(configurationJson) }); }
        catch (error) { throw this.mapStoreError(error); }
        return this.verifyStored(saved, run, setup);
    }

    private verifiedContext(gameId: string, owner: PreGameConfigurationOwner): { run: StoredLocalGameRun; setup: MatchSetup } {
        const normalized = gameId.trim(); if (!normalized) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        const run = this.store.getActiveLocalGameRun(normalized); if (!run) throw new PreGameConfigurationFlowError("CONFIGURATION_UNAVAILABLE");
        if (run.organizationId !== owner.organizationId || run.scorerId !== owner.scorerId || run.deviceId !== this.deviceId) throw new PreGameConfigurationFlowError("CONFIGURATION_OWNERSHIP_CONFLICT");
        if (run.status !== "active" || run.startedAtUtc !== null || run.lastAcceptedSequence !== 0) throw new PreGameConfigurationFlowError("CONFIGURATION_CONFLICT");
        const source = this.setup.getVerifiedPackageMatchSetup(run.packageId);
        if (source.setup.gameId !== run.gameId || source.setup.packageId !== run.packageId || source.setup.packageVersion !== run.packageVersion || source.packageSchemaVersion !== run.packageSchemaVersion || source.packageHash !== run.packageHash || JSON.stringify(source.setup) !== run.setupSnapshotJson) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        return { run, setup: source.setup };
    }
    private verifyStoredConfiguration(stored: StoredLocalGameRunConfiguration, run: StoredLocalGameRun, setup: MatchSetup): PreGameConfigurationV1 {
        if (stored.configurationSchemaVersion !== 1 || !Number.isInteger(stored.revision) || stored.revision < 1 || configurationHash(stored.configurationJson) !== stored.configurationHash) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        const configuration = parseConfiguration(stored.configurationJson); validateConfiguration(configuration, run, setup, stored.status); return configuration;
    }
    private verifyStored(stored: StoredLocalGameRunConfiguration, run: StoredLocalGameRun, setup: MatchSetup): SafePreGameConfiguration {
        const configuration = this.verifyStoredConfiguration(stored, run, setup);
        return { runId: run.runId, gameId: run.gameId, packageId: run.packageId, packageVersion: run.packageVersion, configurationSchemaVersion: 1, revision: stored.revision, status: stored.status, teams: [safeTeam(configuration.teams[0], setup.home), safeTeam(configuration.teams[1], setup.away)], createdAtUtc: stored.createdAtUtc, updatedAtUtc: stored.updatedAtUtc };
    }
    private mapStoreError(error: unknown): PreGameConfigurationFlowError {
        const kind = localConflictKind(error);
        if (kind === "ownership") return new PreGameConfigurationFlowError("CONFIGURATION_OWNERSHIP_CONFLICT");
        if (kind === "revision" || kind === "state") return new PreGameConfigurationFlowError("CONFIGURATION_CONFLICT");
        return error instanceof PreGameConfigurationFlowError ? error : new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    }
}

export function preGameConfigurationErrorCode(error: unknown): PreGameConfigurationErrorCode { return error instanceof PreGameConfigurationFlowError ? error.code : "CONFIGURATION_INVALID"; }
