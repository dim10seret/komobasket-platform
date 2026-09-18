import { createHash, randomUUID } from "node:crypto";
import type { DesktopAuthState } from "../auth/auth-contracts.cjs";
import type { MatchSetup, MatchSetupManager, MatchSetupPlayer, MatchSetupStaffMember, MatchSetupTeam } from "../games/match-setup.cjs";
import type {
    CreateLocalGameRunConfigurationInput,
    LocalGameRunConfigurationStoreResult,
    SaveLiveLocalGameRunConfigurationInput,
    SaveLocalGameRunConfigurationInput,
    StoredLocalGameRun,
    StoredLocalGameRunConfiguration,
    StoredLocalMatchEngineSnapshot,
    StoredLocalMatchEvent,
} from "../persistence/local-database.cjs";
import { deterministicJson, parseDeterministicJson, sha256JsonBytes } from "./match-engine-bootstrap.cjs";

export const PRE_GAME_CONFIGURATION_ERROR_CODES = [
    "CONFIGURATION_UNAVAILABLE",
    "CONFIGURATION_INVALID",
    "CONFIGURATION_CONFLICT",
    "CONFIGURATION_OWNERSHIP_CONFLICT",
] as const;
export type PreGameConfigurationErrorCode = (typeof PRE_GAME_CONFIGURATION_ERROR_CODES)[number];
export type PreGameConfigurationStatus = "draft" | "ready";
export type TeamSide = "HOME" | "AWAY";
export type PreGameConfigurationLifecycle = "pre-start" | "live";
export const EXTRA_BENCH_ROLES = ["coach", "assistant_coach", "team_manager", "physiotherapist", "doctor", "other"] as const;
export type ExtraBenchRole = (typeof EXTRA_BENCH_ROLES)[number];
export const LIVE_CONFIGURATION_VALIDATION_CODES = [
    "LIVE_PARTICIPANT_REMOVAL_NOT_ALLOWED",
    "LIVE_SHIRT_NUMBER_REQUIRED",
    "LIVE_SHIRT_NUMBER_INVALID",
    "LIVE_SHIRT_NUMBER_DUPLICATE",
    "LIVE_PARTICIPANT_COUNT_ABOVE_MAXIMUM",
    "LIVE_TEAM_COLOR_REQUIRED",
    "LIVE_TEAM_COLOR_INVALID",
    "LIVE_LOCKED_FIELD_CHANGE",
] as const;
export type LiveConfigurationValidationCode = (typeof LIVE_CONFIGURATION_VALIDATION_CODES)[number];
export interface LiveConfigurationValidationIssue {
    code: LiveConfigurationValidationCode;
    message: string;
    teamSide: TeamSide;
    affectedPlayers: Array<{ playerId: string; displayName: string }>;
}
export interface ExtraBenchEntryV1 { entryId: string; name: string; role: ExtraBenchRole; }

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
    gameColor: string | null;
    extraBench: ExtraBenchEntryV1[];
}
export interface PreGameConfigurationPresentationV1 { leftSide: TeamSide; }
export interface PreGameConfigurationOfficialsV1 { referees: { a: string | null; b: string | null; c: string | null }; table: { timer: string | null; shotClock: string | null; scoresheet: string | null; commissioner: string | null }; }
export interface PreGameConfigurationV1 {
    schemaVersion: 1;
    runId: string;
    gameId: string;
    teams: [PreGameConfigurationTeamV1, PreGameConfigurationTeamV1];
    presentation: PreGameConfigurationPresentationV1;
    officials: PreGameConfigurationOfficialsV1;
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
    gameColor: string | null;
    extraBench: ExtraBenchEntryV1[];
}
export interface SafePreGameConfiguration {
    runId: string;
    gameId: string;
    packageId: string;
    packageVersion: number;
    configurationSchemaVersion: 1;
    revision: number;
    status: PreGameConfigurationStatus;
    lifecycle: PreGameConfigurationLifecycle;
    teams: [SafePreGameConfigurationTeam, SafePreGameConfigurationTeam];
    presentation: PreGameConfigurationPresentationV1;
    officials: PreGameConfigurationOfficialsV1;
    settings: { minPlayers: number; maxPlayers: number; startingPlayers: number; };
    createdAtUtc: string;
    updatedAtUtc: string;
}
export interface PreGameConfigurationPlayerDraft {
    playerId: string;
    participating: boolean;
    gameShirtNumber: string | null;
}
export interface PreGameConfigurationStaffDraft { staffId: string; participating: boolean; }
export interface PreGameConfigurationTeamDraft {
    side: TeamSide;
    players: PreGameConfigurationPlayerDraft[];
    staff: PreGameConfigurationStaffDraft[];
    captainPlayerId: string | null;
    starterPlayerIds: string[];
    gameColor: string | null;
    extraBench: ExtraBenchEntryV1[];
}
export interface PreGameConfigurationPresentationDraft { leftSide: TeamSide; }
export interface PreGameConfigurationSaveDraftInput {
    gameId: string;
    expectedRevision: number;
    teams: [PreGameConfigurationTeamDraft, PreGameConfigurationTeamDraft];
    presentation: PreGameConfigurationPresentationDraft;
    officials?: PreGameConfigurationOfficialsV1;
}
export type PreGameConfigurationOperationResult =
    | { ok: true; outcome: "created" | "existing" | "saved"; configuration: SafePreGameConfiguration; state: DesktopAuthState }
    | { ok: false; errorCode: PreGameConfigurationErrorCode | "SESSION_INVALID" | "OFFLINE_OPERATION_DENIED"; validation?: LiveConfigurationValidationIssue; state: DesktopAuthState };

interface PreGameConfigurationStore {
    getActiveLocalGameRun(gameId: string): StoredLocalGameRun | null;
    readLocalGameRunConfiguration(runId: string): StoredLocalGameRunConfiguration | null;
    createOrOpenLocalGameRunConfiguration(input: CreateLocalGameRunConfigurationInput): LocalGameRunConfigurationStoreResult;
    saveLocalGameRunConfiguration(input: SaveLocalGameRunConfigurationInput): StoredLocalGameRunConfiguration;
    saveLiveLocalGameRunConfiguration(input: SaveLiveLocalGameRunConfigurationInput): StoredLocalGameRunConfiguration;
    readLocalMatchEngineSnapshot(runId: string): StoredLocalMatchEngineSnapshot | null;
    readLocalMatchEvents(runId: string): StoredLocalMatchEvent[];
}

export class PreGameConfigurationFlowError extends Error {
    constructor(readonly code: PreGameConfigurationErrorCode, readonly validation?: LiveConfigurationValidationIssue) { super(code); this.name = "PreGameConfigurationFlowError"; }
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
function gameColor(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return value.toUpperCase();
}
function extraBenchEntryFromUnknown(value: unknown): ExtraBenchEntryV1 {
    const item = record(value);
    const entryId = typeof item?.entryId === "string" ? item.entryId : "";
    const name = typeof item?.name === "string" ? item.name.trim() : "";
    if (!item || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(entryId) || name.length < 2 || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name) || !EXTRA_BENCH_ROLES.includes(item.role as ExtraBenchRole)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return { entryId: entryId.toLowerCase(), name, role: item.role as ExtraBenchRole };
}
function extraBenchFromUnknown(value: unknown): ExtraBenchEntryV1[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.length > 10) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    const entries = value.map(extraBenchEntryFromUnknown);
    if (!uniqueById(entries, (entry) => entry.entryId)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return entries;
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
    return { side: item.side, teamId, players: item.players.map(playerFromUnknown), staff: item.staff.map(staffFromUnknown), captainPlayerId: item.captainPlayerId, starterPlayerIds: [...item.starterPlayerIds], gameColor: gameColor(item.gameColor), extraBench: extraBenchFromUnknown(item.extraBench) };
}
function presentationFromUnknown(value: unknown): PreGameConfigurationPresentationV1 {
    if (value === undefined) return { leftSide: "HOME" };
    const item = record(value);
    if (!item || (item.leftSide !== "HOME" && item.leftSide !== "AWAY")) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return { leftSide: item.leftSide };
}
function officialName(value: unknown): string | null { if (value === null || value === undefined || value === "") return null; if (typeof value !== "string") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID"); const normalized = value.trim(); if (!normalized) return null; if (normalized.length > 120 || /[\u0000-\u001f\u007f]/.test(normalized)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID"); return normalized; }
export function preGameOfficialsFromUnknown(value: unknown): PreGameConfigurationOfficialsV1 {
    if (value === undefined) return { referees: { a: null, b: null, c: null }, table: { timer: null, shotClock: null, scoresheet: null, commissioner: null } };
    const item = record(value); const referees = record(item?.referees); const table = record(item?.table); if (!item || !referees || !table) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return { referees: { a: officialName(referees.a), b: officialName(referees.b), c: officialName(referees.c) }, table: { timer: officialName(table.timer), shotClock: officialName(table.shotClock), scoresheet: officialName(table.scoresheet), commissioner: officialName(table.commissioner) } };
}
function parseConfiguration(json: string): PreGameConfigurationV1 {
    let value: unknown;
    try { value = JSON.parse(json); } catch { throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID"); }
    const item = record(value); const runId = text(item?.runId); const gameId = text(item?.gameId);
    if (!item || item.schemaVersion !== 1 || !runId || !gameId || !Array.isArray(item.teams) || item.teams.length !== 2) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    const teams = item.teams.map(teamFromUnknown).sort((left, right) => sideOrder(left.side) - sideOrder(right.side));
    if (teams[0]?.side !== "HOME" || teams[1]?.side !== "AWAY") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return { schemaVersion: 1, runId, gameId, teams: [teams[0], teams[1]], presentation: presentationFromUnknown(item.presentation), officials: preGameOfficialsFromUnknown(item.officials) };
}
export function parseStoredPreGameConfiguration(stored: StoredLocalGameRunConfiguration): PreGameConfigurationV1 {
    if (stored.configurationSchemaVersion !== 1 || !Number.isInteger(stored.revision) || stored.revision < 1 || configurationHash(stored.configurationJson) !== stored.configurationHash) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return parseConfiguration(stored.configurationJson);
}
function uniqueById<T>(values: T[], id: (value: T) => string): boolean { return new Set(values.map(id)).size === values.length; }
function safeAffectedPlayers(source: MatchSetupTeam, playerIds: string[]): Array<{ playerId: string; displayName: string }> {
    const ids = new Set(playerIds);
    return source.players.filter((player) => ids.has(player.playerId)).map((player) => ({ playerId: player.playerId, displayName: player.displayName }));
}
function playerNames(players: Array<{ displayName: string }>): string { return players.map((player) => player.displayName).join(", "); }
function liveValidation(source: MatchSetupTeam, code: LiveConfigurationValidationCode, message: string, playerIds: string[] = []): PreGameConfigurationFlowError {
    const affectedPlayers = safeAffectedPlayers(source, playerIds);
    const suffix = affectedPlayers.length > 0 ? ` Παίκτες: ${playerNames(affectedPlayers)}.` : "";
    return new PreGameConfigurationFlowError("CONFIGURATION_INVALID", { code, message: `${message}${suffix}`, teamSide: source.side, affectedPlayers });
}
function liveShirtNumber(value: unknown, source: MatchSetupTeam, playerId: string): string | null {
    try { return shirtNumber(value); }
    catch { throw liveValidation(source, "LIVE_SHIRT_NUMBER_INVALID", "Ο αριθμός φανέλας πρέπει να είναι 0, 00 ή από 1 έως 99.", [playerId]); }
}
function liveGameColor(value: unknown, source: MatchSetupTeam): string | null {
    try { return gameColor(value); }
    catch { throw liveValidation(source, "LIVE_TEAM_COLOR_INVALID", `Το επιλεγμένο χρώμα για την ομάδα ${source.teamName} (${source.side}) δεν είναι έγκυρο.`); }
}
function validateTeam(configuration: PreGameConfigurationTeamV1, source: MatchSetupTeam, status: PreGameConfigurationStatus, settings: MatchSetup["settings"]): void {
    if (configuration.teamId !== source.teamId || configuration.players.length !== source.players.length || configuration.staff.length !== source.staff.length || !uniqueById(configuration.players, (player) => player.playerId) || !uniqueById(configuration.staff, (staff) => staff.staffId)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    const sourcePlayerIds = new Set(source.players.map((player) => player.playerId)); const sourceStaffIds = new Set(source.staff.map((staff) => staff.staffId));
    if (configuration.players.some((player) => !sourcePlayerIds.has(player.playerId)) || configuration.staff.some((staff) => !sourceStaffIds.has(staff.staffId))) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    const participating = configuration.players.filter((player) => player.participating);
    if (participating.length > settings.maxPlayers) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    const assigned = participating.map((player) => player.gameShirtNumber).filter((number): number is string => number !== null);
    if (new Set(assigned).size !== assigned.length) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    const participatingIds = new Set(participating.map((player) => player.playerId));
    if (configuration.captainPlayerId !== null && !participatingIds.has(configuration.captainPlayerId)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    if (!uniqueById(configuration.starterPlayerIds, (id) => id) || configuration.starterPlayerIds.some((id) => !participatingIds.has(id)) || configuration.starterPlayerIds.length > settings.startingPlayers) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    if (status === "ready" && (configuration.captainPlayerId === null || configuration.starterPlayerIds.length !== settings.startingPlayers)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
}
function validateConfiguration(configuration: PreGameConfigurationV1, run: StoredLocalGameRun, setup: MatchSetup, status: PreGameConfigurationStatus): void {
    if (configuration.runId !== run.runId || configuration.gameId !== run.gameId || configuration.teams[0].side !== "HOME" || configuration.teams[1].side !== "AWAY") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    validateTeam(configuration.teams[0], setup.home, status, setup.settings);
    validateTeam(configuration.teams[1], setup.away, status, setup.settings);
    if (!uniqueById(configuration.teams.flatMap((team) => team.extraBench), (entry) => entry.entryId)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
}
function defaultPlayers(players: MatchSetupPlayer[]): PreGameConfigurationPlayerV1[] { return players.map((player) => ({ playerId: player.playerId, participating: false, gameShirtNumber: player.shirtNumber === null ? null : String(player.shirtNumber) })); }
function defaultStaff(staff: MatchSetupStaffMember[]): PreGameConfigurationStaffV1[] { return staff.map((member) => ({ staffId: member.staffId, participating: false })); }
function defaultTeam(team: MatchSetupTeam): PreGameConfigurationTeamV1 { return { side: team.side, teamId: team.teamId, players: defaultPlayers(team.players), staff: defaultStaff(team.staff), captainPlayerId: null, starterPlayerIds: [], gameColor: null, extraBench: [] }; }
function defaultConfiguration(run: StoredLocalGameRun, setup: MatchSetup): PreGameConfigurationV1 { return { schemaVersion: 1, runId: run.runId, gameId: run.gameId, teams: [defaultTeam(setup.home), defaultTeam(setup.away)], presentation: { leftSide: "HOME" }, officials: { referees: { a: setup.officials.referees.a?.displayName ?? null, b: setup.officials.referees.b?.displayName ?? null, c: setup.officials.referees.c?.displayName ?? null }, table: { timer: setup.officials.table.timer?.displayName ?? null, shotClock: setup.officials.table.shotClock?.displayName ?? null, scoresheet: setup.officials.table.scoresheet?.displayName ?? null, commissioner: setup.officials.table.commissioner?.displayName ?? null } } }; }

function canonicalTeamDraft(value: PreGameConfigurationTeamDraft, current: PreGameConfigurationTeamV1, source: MatchSetupTeam, lifecycle: PreGameConfigurationLifecycle): PreGameConfigurationTeamV1 {
    if (value.side !== source.side || value.players.length !== source.players.length || value.staff.length !== source.staff.length || !uniqueById(value.players, (player) => player.playerId) || !uniqueById(value.staff, (staff) => staff.staffId) || !(value.captainPlayerId === null || (typeof value.captainPlayerId === "string" && value.captainPlayerId.trim())) || !Array.isArray(value.starterPlayerIds) || !value.starterPlayerIds.every((id) => typeof id === "string" && id.trim()) || !uniqueById(value.starterPlayerIds, (id) => id)) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    if (lifecycle === "live" && (JSON.stringify(value.staff) !== JSON.stringify(current.staff)
        || value.captainPlayerId !== current.captainPlayerId
        || JSON.stringify(value.starterPlayerIds) !== JSON.stringify(current.starterPlayerIds))) {
        throw liveValidation(source, "LIVE_LOCKED_FIELD_CHANGE", "Κατά τη διάρκεια του αγώνα επιτρέπονται μόνο προσθήκη παίκτη, διαχείριση Run-only πρόσθετου πάγκου και διόρθωση αριθμού φανέλας, χρώματος ομάδας ή πλευρών.");
    }
    const drafts = new Map(value.players.map((player) => [player.playerId, player]));
    const players = source.players.map((sourcePlayer) => {
        const player = drafts.get(sourcePlayer.playerId);
        if (!player || typeof player.participating !== "boolean") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        return { playerId: sourcePlayer.playerId, participating: player.participating, gameShirtNumber: lifecycle === "live" ? liveShirtNumber(player.gameShirtNumber, source, sourcePlayer.playerId) : shirtNumber(player.gameShirtNumber) };
    });
    const staffDrafts = new Map(value.staff.map((staff) => [staff.staffId, staff]));
    const staff = source.staff.map((sourceStaff) => {
        const member = staffDrafts.get(sourceStaff.staffId);
        if (!member || typeof member.participating !== "boolean") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        return { staffId: sourceStaff.staffId, participating: member.participating };
    });
    const starterIds = new Set(value.starterPlayerIds);
    const starterPlayerIds = source.players.filter((player) => starterIds.has(player.playerId)).map((player) => player.playerId);
    if (starterPlayerIds.length !== value.starterPlayerIds.length) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return { ...current, players, staff, captainPlayerId: value.captainPlayerId, starterPlayerIds, gameColor: lifecycle === "live" ? liveGameColor(value.gameColor, source) : gameColor(value.gameColor), extraBench: extraBenchFromUnknown(value.extraBench) };
}
function validateLiveCorrection(current: PreGameConfigurationV1, next: PreGameConfigurationV1, setup: MatchSetup): void {
    for (const source of [setup.home, setup.away]) {
        const index = source.side === "HOME" ? 0 : 1;
        const previousTeam = current.teams[index];
        const nextTeam = next.teams[index];
        const previousPlayers = new Map(previousTeam.players.map((player) => [player.playerId, player]));
        const removed = nextTeam.players.filter((player) => previousPlayers.get(player.playerId)?.participating && !player.participating).map((player) => player.playerId);
        if (removed.length > 0) throw liveValidation(source, "LIVE_PARTICIPANT_REMOVAL_NOT_ALLOWED", "Δεν μπορείτε να αφαιρέσετε συμμετέχοντα παίκτη αφού έχει ξεκινήσει ο αγώνας.", removed);
        const changedInactive = nextTeam.players.filter((player) => {
            const previous = previousPlayers.get(player.playerId);
            return previous && !previous.participating && !player.participating && previous.gameShirtNumber !== player.gameShirtNumber;
        }).map((player) => player.playerId);
        if (changedInactive.length > 0) throw liveValidation(source, "LIVE_LOCKED_FIELD_CHANGE", "Ο αριθμός φανέλας μπορεί να διορθωθεί μόνο για συμμετέχοντα παίκτη.", changedInactive);
        const participating = nextTeam.players.filter((player) => player.participating);
        const missing = participating.filter((player) => player.gameShirtNumber === null).map((player) => player.playerId);
        if (missing.length > 0) throw liveValidation(source, "LIVE_SHIRT_NUMBER_REQUIRED", "Δηλώστε αριθμό φανέλας για όλους τους συμμετέχοντες παίκτες.", missing);
        const numberOwners = new Map<string, string[]>();
        for (const player of participating) numberOwners.set(player.gameShirtNumber!, [...(numberOwners.get(player.gameShirtNumber!) ?? []), player.playerId]);
        const duplicates = [...numberOwners.values()].filter((ids) => ids.length > 1).flat();
        if (duplicates.length > 0) throw liveValidation(source, "LIVE_SHIRT_NUMBER_DUPLICATE", `Οι αριθμοί φανέλας πρέπει να είναι μοναδικοί μέσα στην ομάδα ${source.teamName} (${source.side}).`, duplicates);
        if (participating.length > setup.settings.maxPlayers) throw liveValidation(source, "LIVE_PARTICIPANT_COUNT_ABOVE_MAXIMUM", `Η ομάδα ${source.teamName} (${source.side}) επιτρέπεται να έχει έως ${setup.settings.maxPlayers} συμμετέχοντες παίκτες.`);
        if (nextTeam.gameColor === null) throw liveValidation(source, "LIVE_TEAM_COLOR_REQUIRED", `Το χρώμα της ομάδας ${source.teamName} (${source.side}) δεν μπορεί να αφαιρεθεί ενώ ο αγώνας είναι LIVE.`);
    }
}
function safeTeam(configuration: PreGameConfigurationTeamV1, source: MatchSetupTeam): SafePreGameConfigurationTeam {
    const players = new Map(configuration.players.map((player) => [player.playerId, player])); const staff = new Map(configuration.staff.map((member) => [member.staffId, member]));
    return {
        side: source.side, teamId: source.teamId, teamName: source.teamName,
        players: source.players.map((sourcePlayer) => { const player = players.get(sourcePlayer.playerId); if (!player) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID"); return { playerId: sourcePlayer.playerId, displayName: sourcePlayer.displayName, packageShirtNumber: sourcePlayer.shirtNumber, gameShirtNumber: player.gameShirtNumber, participating: player.participating }; }),
        staff: source.staff.map((sourceStaff) => { const member = staff.get(sourceStaff.staffId); if (!member) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID"); return { staffId: sourceStaff.staffId, displayName: sourceStaff.displayName, role: sourceStaff.role, roleLabel: sourceStaff.roleLabel, participating: member.participating }; }),
        captainPlayerId: configuration.captainPlayerId, starterPlayerIds: [...configuration.starterPlayerIds], gameColor: configuration.gameColor, extraBench: configuration.extraBench.map((entry) => ({ ...entry })),
    };
}
function localConflictKind(error: unknown): "ownership" | "state" | "revision" | null {
    if (error === null || typeof error !== "object" || !("name" in error) || error.name !== "LocalGameRunConfigurationConflictError" || !("kind" in error)) return null;
    return error.kind === "ownership" || error.kind === "state" || error.kind === "revision" ? error.kind : null;
}

interface RuntimeMatchEngine {
    process(event: unknown): { accepted: boolean };
}
interface RuntimeMatchEngineConstructor {
    fromInitialState(initialState: unknown): RuntimeMatchEngine;
}
function runtimeMatchEngine(initialState: unknown): RuntimeMatchEngine {
    const loaded = require("../shared/match-engine/engine/match-engine.js") as Record<string, unknown>;
    const constructor = loaded.MatchEngine as RuntimeMatchEngineConstructor | undefined;
    if (!constructor || typeof constructor.fromInitialState !== "function") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    return constructor.fromInitialState(initialState);
}

export class PreGameConfigurationManager {
    constructor(
        private readonly setup: MatchSetupManager,
        private readonly store: PreGameConfigurationStore,
        private readonly deviceId: string,
        private readonly now: () => Date = () => new Date(),
        private readonly id: () => string = () => randomUUID(),
    ) {}

    getOrCreate(gameId: string, owner: PreGameConfigurationOwner): { outcome: "created" | "existing"; configuration: SafePreGameConfiguration } {
        const { run, setup, lifecycle } = this.verifiedContext(gameId, owner);
        if (lifecycle === "live") {
            const stored = this.store.readLocalGameRunConfiguration(run.runId);
            if (!stored) throw new PreGameConfigurationFlowError("CONFIGURATION_UNAVAILABLE");
            return { outcome: "existing", configuration: this.verifyStored(stored, run, setup, lifecycle) };
        }
        const initial = defaultConfiguration(run, setup); const configurationJson = JSON.stringify(initial);
        let result: LocalGameRunConfigurationStoreResult;
        try {
            result = this.store.createOrOpenLocalGameRunConfiguration({ runId: run.runId, organizationId: owner.organizationId, scorerId: owner.scorerId, deviceId: this.deviceId, configurationSchemaVersion: 1, configurationJson, configurationHash: configurationHash(configurationJson) });
        } catch (error) { throw this.mapStoreError(error); }
        return { outcome: result.outcome, configuration: this.verifyStored(result.configuration, run, setup, lifecycle) };
    }

    recover(gameId: string, owner: PreGameConfigurationOwner): { outcome: "existing"; configuration: SafePreGameConfiguration } {
        const { run, setup, lifecycle } = this.verifiedContext(gameId, owner);
        const stored = this.store.readLocalGameRunConfiguration(run.runId);
        if (!stored) throw new PreGameConfigurationFlowError("CONFIGURATION_UNAVAILABLE");
        return { outcome: "existing", configuration: this.verifyStored(stored, run, setup, lifecycle) };
    }

    saveDraft(input: PreGameConfigurationSaveDraftInput, owner: PreGameConfigurationOwner): SafePreGameConfiguration {
        if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1 || input.teams.length !== 2) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        const { run, setup, lifecycle } = this.verifiedContext(input.gameId, owner); const stored = this.store.readLocalGameRunConfiguration(run.runId);
        if (!stored) throw new PreGameConfigurationFlowError("CONFIGURATION_UNAVAILABLE");
        const current = this.verifyStoredConfiguration(stored, run, setup);
        const drafts = [...input.teams].sort((left, right) => sideOrder(left.side) - sideOrder(right.side));
        if (drafts[0]?.side !== "HOME" || drafts[1]?.side !== "AWAY") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        if (input.presentation.leftSide !== "HOME" && input.presentation.leftSide !== "AWAY") throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        const next: PreGameConfigurationV1 = { ...current, teams: [canonicalTeamDraft(drafts[0], current.teams[0], setup.home, lifecycle), canonicalTeamDraft(drafts[1], current.teams[1], setup.away, lifecycle)], presentation: { leftSide: input.presentation.leftSide }, officials: input.officials === undefined ? current.officials : preGameOfficialsFromUnknown(input.officials) };
        if (lifecycle === "live") validateLiveCorrection(current, next, setup);
        validateConfiguration(next, run, setup, "draft"); const configurationJson = JSON.stringify(next);
        let saved: StoredLocalGameRunConfiguration;
        try {
            if (lifecycle === "live") {
                const amendments = this.prepareLiveRosterAmendments(run, current, next, setup);
                saved = this.store.saveLiveLocalGameRunConfiguration({
                    runId: run.runId,
                    organizationId: owner.organizationId,
                    scorerId: owner.scorerId,
                    deviceId: this.deviceId,
                    expectedRevision: input.expectedRevision,
                    expectedHistoryRevision: amendments.expectedHistoryRevision,
                    expectedLastAcceptedSequence: amendments.expectedLastAcceptedSequence,
                    events: amendments.events,
                    configurationJson,
                    configurationHash: configurationHash(configurationJson),
                    updatedAtUtc: amendments.updatedAtUtc,
                });
            } else {
                saved = this.store.saveLocalGameRunConfiguration({ runId: run.runId, organizationId: owner.organizationId, scorerId: owner.scorerId, deviceId: this.deviceId, expectedRevision: input.expectedRevision, configurationJson, configurationHash: configurationHash(configurationJson) });
            }
        }
        catch (error) { throw this.mapStoreError(error); }
        return this.verifyStored(saved, run, setup, lifecycle);
    }

    private prepareLiveRosterAmendments(
        run: StoredLocalGameRun,
        current: PreGameConfigurationV1,
        next: PreGameConfigurationV1,
        setup: MatchSetup,
    ): Pick<SaveLiveLocalGameRunConfigurationInput, "expectedHistoryRevision" | "expectedLastAcceptedSequence" | "events" | "updatedAtUtc"> {
        const snapshot = this.store.readLocalMatchEngineSnapshot(run.runId);
        if (!snapshot || snapshot.snapshotSchemaVersion !== 1 || snapshot.matchEventSchemaVersion !== 2 || sha256JsonBytes(snapshot.initialStateJson) !== snapshot.initialStateHash) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        const additions = next.teams.flatMap((team, teamIndex) => {
            const previous = new Map(current.teams[teamIndex].players.map((player) => [player.playerId, player]));
            const source = team.side === "HOME" ? setup.home : setup.away;
            return team.players.filter((player) => player.participating && !previous.get(player.playerId)?.participating).map((player) => {
                const sourcePlayer = source.players.find((candidate) => candidate.playerId === player.playerId);
                if (!sourcePlayer || player.gameShirtNumber === null) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
                return { team: team.side, player, sourcePlayer };
            });
        });
        const occurredAt = this.now().getTime();
        const updatedAtUtc = new Date(occurredAt).toISOString();
        if (additions.length === 0) {
            return { expectedHistoryRevision: snapshot.eventHistoryRevision, expectedLastAcceptedSequence: run.lastAcceptedSequence, events: [], updatedAtUtc };
        }

        let initialState: unknown;
        try { initialState = parseDeterministicJson(snapshot.initialStateJson); }
        catch { throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID"); }
        const engine = runtimeMatchEngine(initialState);
        const rows = this.store.readLocalMatchEvents(run.runId);
        let previousSequence = 0;
        for (const row of rows) {
            if (row.eventSchemaVersion !== 2 || row.sequence <= previousSequence || sha256JsonBytes(row.eventJson) !== row.eventHash) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
            let event: unknown;
            try { event = parseDeterministicJson(row.eventJson); } catch { throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID"); }
            if (!engine.process(event).accepted) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
            previousSequence = row.sequence;
        }
        if (rows.length === 0 || JSON.parse(rows[0].eventJson).type !== "MATCH_START" || previousSequence > run.lastAcceptedSequence) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");

        let sequence = run.lastAcceptedSequence;
        const events = additions.map(({ team, player, sourcePlayer }) => {
            sequence += 1;
            const event = {
                schemaVersion: 2 as const,
                id: this.id(),
                occurredAt,
                sequence,
                type: "ROSTER_PLAYER_ADDED" as const,
                team,
                playerId: player.playerId,
                displayName: sourcePlayer.displayName,
                shirtNumber: player.gameShirtNumber!,
            };
            if (!engine.process(event).accepted) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
            const eventJson = deterministicJson(event);
            return { eventId: event.id, sequence, eventSchemaVersion: 2 as const, eventJson, eventHash: sha256JsonBytes(eventJson), persistedAtUtc: updatedAtUtc };
        });
        return { expectedHistoryRevision: snapshot.eventHistoryRevision, expectedLastAcceptedSequence: run.lastAcceptedSequence, events, updatedAtUtc };
    }

    private verifiedContext(gameId: string, owner: PreGameConfigurationOwner): { run: StoredLocalGameRun; setup: MatchSetup; lifecycle: PreGameConfigurationLifecycle } {
        const normalized = gameId.trim(); if (!normalized) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        const run = this.store.getActiveLocalGameRun(normalized); if (!run) throw new PreGameConfigurationFlowError("CONFIGURATION_UNAVAILABLE");
        if (run.organizationId !== owner.organizationId || run.scorerId !== owner.scorerId || run.deviceId !== this.deviceId) throw new PreGameConfigurationFlowError("CONFIGURATION_OWNERSHIP_CONFLICT");
        if (run.status !== "active") throw new PreGameConfigurationFlowError("CONFIGURATION_CONFLICT");
        const lifecycle: PreGameConfigurationLifecycle = run.startedAtUtc === null && run.lastAcceptedSequence === 0
            ? "pre-start"
            : run.startedAtUtc !== null && run.lastAcceptedSequence >= 1
                ? "live"
                : (() => { throw new PreGameConfigurationFlowError("CONFIGURATION_CONFLICT"); })();
        const source = this.setup.getVerifiedPackageMatchSetup(run.packageId);
        if (source.setup.gameId !== run.gameId || source.setup.packageId !== run.packageId || source.setup.packageVersion !== run.packageVersion || source.packageSchemaVersion !== run.packageSchemaVersion || source.packageHash !== run.packageHash || JSON.stringify(source.setup) !== run.setupSnapshotJson) throw new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
        return { run, setup: source.setup, lifecycle };
    }
    private verifyStoredConfiguration(stored: StoredLocalGameRunConfiguration, run: StoredLocalGameRun, setup: MatchSetup): PreGameConfigurationV1 {
        const configuration = parseStoredPreGameConfiguration(stored); validateConfiguration(configuration, run, setup, stored.status); return configuration;
    }
    private verifyStored(stored: StoredLocalGameRunConfiguration, run: StoredLocalGameRun, setup: MatchSetup, lifecycle: PreGameConfigurationLifecycle): SafePreGameConfiguration {
        const configuration = this.verifyStoredConfiguration(stored, run, setup);
        return { runId: run.runId, gameId: run.gameId, packageId: run.packageId, packageVersion: run.packageVersion, configurationSchemaVersion: 1, revision: stored.revision, status: stored.status, lifecycle, teams: [safeTeam(configuration.teams[0], setup.home), safeTeam(configuration.teams[1], setup.away)], presentation: configuration.presentation, officials: configuration.officials, settings: { minPlayers: setup.settings.minPlayers, maxPlayers: setup.settings.maxPlayers, startingPlayers: setup.settings.startingPlayers }, createdAtUtc: stored.createdAtUtc, updatedAtUtc: stored.updatedAtUtc };
    }
    private mapStoreError(error: unknown): PreGameConfigurationFlowError {
        const kind = localConflictKind(error);
        if (kind === "ownership") return new PreGameConfigurationFlowError("CONFIGURATION_OWNERSHIP_CONFLICT");
        if (kind === "revision" || kind === "state") return new PreGameConfigurationFlowError("CONFIGURATION_CONFLICT");
        return error instanceof PreGameConfigurationFlowError ? error : new PreGameConfigurationFlowError("CONFIGURATION_INVALID");
    }
}

export function preGameConfigurationErrorCode(error: unknown): PreGameConfigurationErrorCode { return error instanceof PreGameConfigurationFlowError ? error.code : "CONFIGURATION_INVALID"; }
export function preGameConfigurationValidation(error: unknown): LiveConfigurationValidationIssue | undefined { return error instanceof PreGameConfigurationFlowError ? error.validation : undefined; }
