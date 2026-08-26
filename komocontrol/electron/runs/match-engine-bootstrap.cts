import { createHash } from "node:crypto";
import type { MatchSetup, MatchSetupTeam } from "../games/match-setup.cjs";
import type { StoredLocalGameRun, StoredLocalGameRunConfiguration } from "../persistence/local-database.cjs";

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

interface RuntimeMatchEngine {
    getState(): unknown;
}

interface RuntimeMatchEngineConstructor {
    new(options: unknown): RuntimeMatchEngine;
}

interface RuntimePlayerFactory {
    (options: { playerId: string; displayName: string; shirtNumber: string; team: "HOME" | "AWAY"; onCourt: boolean }): unknown;
}

interface ConfigurationPlayer {
    playerId: string;
    participating: boolean;
    gameShirtNumber: string | null;
}

interface ConfigurationTeam {
    side: "HOME" | "AWAY";
    teamId: string;
    players: ConfigurationPlayer[];
    captainPlayerId: string | null;
    starterPlayerIds: string[];
    gameColor: string | null;
}

interface ConfigurationV1 {
    schemaVersion: 1;
    runId: string;
    gameId: string;
    teams: [ConfigurationTeam, ConfigurationTeam];
}

export interface MatchEngineBootstrapResult {
    initialState: JsonObject;
    initialStateJson: string;
    initialStateHash: string;
}

export const MATCH_START_READINESS_CODES = [
    "START_PARTICIPANT_COUNT_BELOW_MINIMUM",
    "START_PARTICIPANT_COUNT_ABOVE_MAXIMUM",
    "START_SHIRT_NUMBER_MISSING",
    "START_SHIRT_NUMBER_INVALID",
    "START_SHIRT_NUMBER_DUPLICATE",
    "START_CAPTAIN_MISSING",
    "START_CAPTAIN_NOT_PARTICIPATING",
    "START_STARTER_COUNT_INVALID",
    "START_STARTER_NOT_PARTICIPATING",
    "START_TEAM_COLOR_MISSING",
    "START_TEAM_COLOR_INVALID",
] as const;
export type MatchStartReadinessCode = (typeof MATCH_START_READINESS_CODES)[number];
export interface MatchStartReadinessPlayer { playerId: string; displayName: string; }
export interface MatchStartReadinessIssue {
    code: MatchStartReadinessCode;
    message: string;
    teamSide: "HOME" | "AWAY";
    affectedPlayers: MatchStartReadinessPlayer[];
}

export class MatchEngineBootstrapError extends Error {
    constructor() {
        super("MATCH_ENGINE_BOOTSTRAP_INVALID");
        this.name = "MatchEngineBootstrapError";
    }
}

const MATCH_ENGINE_MODULE = "../shared/match-engine/engine/match-engine.js";
const PLAYER_MODULE = "../shared/match-engine/models/player.js";

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function text(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value : null;
}

function isJsonValue(value: unknown): value is JsonValue {
    if (value === null || typeof value === "boolean" || typeof value === "string") return true;
    if (typeof value === "number") return Number.isFinite(value);
    if (Array.isArray(value)) return value.every(isJsonValue);
    const object = record(value);
    return object !== null && Object.values(object).every(isJsonValue);
}

function canonicalValue(value: unknown): JsonValue {
    if (value === null || typeof value === "boolean" || typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
    const object = record(value);
    if (object) {
        const entries = Object.keys(object).sort().filter((key) => object[key] !== undefined).map((key) => [key, canonicalValue(object[key])]);
        return Object.fromEntries(entries) as JsonObject;
    }
    throw new MatchEngineBootstrapError();
}

export function deterministicJson(value: unknown): string {
    return JSON.stringify(canonicalValue(value));
}

export function sha256JsonBytes(value: string): string {
    return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}

export function parseDeterministicJson(value: string): JsonValue {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { throw new MatchEngineBootstrapError(); }
    if (!isJsonValue(parsed) || deterministicJson(parsed) !== value) throw new MatchEngineBootstrapError();
    return parsed;
}

function parsePlayer(value: unknown): ConfigurationPlayer {
    const item = record(value);
    const playerId = text(item?.playerId);
    if (!item || !playerId || typeof item.participating !== "boolean" || (item.gameShirtNumber !== null && typeof item.gameShirtNumber !== "string")) throw new MatchEngineBootstrapError();
    return { playerId, participating: item.participating, gameShirtNumber: item.gameShirtNumber };
}

function parseTeam(value: unknown): ConfigurationTeam {
    const item = record(value);
    if (!item || (item.side !== "HOME" && item.side !== "AWAY") || !text(item.teamId) || !Array.isArray(item.players) || !Array.isArray(item.starterPlayerIds)) throw new MatchEngineBootstrapError();
    const captainPlayerId = item.captainPlayerId === null ? null : text(item.captainPlayerId);
    const starterPlayerIds = item.starterPlayerIds.map(text);
    if (captainPlayerId === null && item.captainPlayerId !== null || starterPlayerIds.some((id) => id === null)) throw new MatchEngineBootstrapError();
    return {
        side: item.side,
        teamId: item.teamId as string,
        players: item.players.map(parsePlayer),
        captainPlayerId,
        starterPlayerIds: starterPlayerIds as string[],
        gameColor: item.gameColor === null ? null : text(item.gameColor),
    };
}

function parseConfiguration(stored: StoredLocalGameRunConfiguration): ConfigurationV1 {
    if (sha256JsonBytes(stored.configurationJson) !== stored.configurationHash) throw new MatchEngineBootstrapError();
    let parsed: unknown;
    try { parsed = JSON.parse(stored.configurationJson); } catch { throw new MatchEngineBootstrapError(); }
    const item = record(parsed);
    if (!item || item.schemaVersion !== 1 || !text(item.runId) || !text(item.gameId) || !Array.isArray(item.teams) || item.teams.length !== 2) throw new MatchEngineBootstrapError();
    const teams = item.teams.map(parseTeam).sort((left, right) => left.side === "HOME" ? -1 : right.side === "HOME" ? 1 : 0);
    if (teams[0]?.side !== "HOME" || teams[1]?.side !== "AWAY") throw new MatchEngineBootstrapError();
    return { schemaVersion: 1, runId: item.runId as string, gameId: item.gameId as string, teams: [teams[0], teams[1]] };
}

function verifiedSourcePlayers(configuration: ConfigurationTeam, source: MatchSetupTeam): Map<string, MatchSetupTeam["players"][number]> {
    if (configuration.side !== source.side || configuration.teamId !== source.teamId) throw new MatchEngineBootstrapError();
    const sourceById = new Map(source.players.map((player) => [player.playerId, player]));
    if (sourceById.size !== source.players.length || configuration.players.length !== source.players.length || new Set(configuration.players.map((player) => player.playerId)).size !== configuration.players.length || configuration.players.some((player) => !sourceById.has(player.playerId))) throw new MatchEngineBootstrapError();
    if (configuration.captainPlayerId !== null && !sourceById.has(configuration.captainPlayerId)) throw new MatchEngineBootstrapError();
    if (configuration.starterPlayerIds.some((playerId) => !sourceById.has(playerId))) throw new MatchEngineBootstrapError();
    return sourceById;
}

function affectedPlayers(players: ConfigurationPlayer[], sourceById: Map<string, MatchSetupTeam["players"][number]>): MatchStartReadinessPlayer[] {
    return players.map((player) => {
        const source = sourceById.get(player.playerId);
        if (!source) throw new MatchEngineBootstrapError();
        return { playerId: player.playerId, displayName: source.displayName };
    });
}

function playerMessage(message: string, players: MatchStartReadinessPlayer[]): string {
    return players.length > 0 ? `${message} Παίκτες: ${players.map((player) => player.displayName).join(", ")}.` : message;
}

function teamReadiness(configuration: ConfigurationTeam, source: MatchSetupTeam, setup: MatchSetup): MatchStartReadinessIssue | null {
    const sourceById = verifiedSourcePlayers(configuration, source);
    const participating = configuration.players.filter((player) => player.participating);
    const team = `${source.teamName} (${configuration.side})`;
    const issue = (code: MatchStartReadinessCode, message: string, players: ConfigurationPlayer[] = []): MatchStartReadinessIssue => {
        const affected = affectedPlayers(players, sourceById);
        return { code, message: playerMessage(message, affected), teamSide: configuration.side, affectedPlayers: affected };
    };
    if (participating.length < setup.settings.minPlayers) return issue("START_PARTICIPANT_COUNT_BELOW_MINIMUM", `Η ομάδα ${team} χρειάζεται τουλάχιστον ${setup.settings.minPlayers} συμμετέχοντες παίκτες.`);
    if (participating.length > setup.settings.maxPlayers) return issue("START_PARTICIPANT_COUNT_ABOVE_MAXIMUM", `Η ομάδα ${team} επιτρέπεται να έχει έως ${setup.settings.maxPlayers} συμμετέχοντες παίκτες.`);
    const missingNumbers = participating.filter((player) => player.gameShirtNumber === null || !player.gameShirtNumber.trim());
    if (missingNumbers.length > 0) return issue("START_SHIRT_NUMBER_MISSING", "Δεν έχουν δηλωθεί αριθμοί φανέλας σε όλους τους συμμετέχοντες παίκτες.", missingNumbers);
    const invalidNumbers = participating.filter((player) => player.gameShirtNumber !== null && !/^(?:0|00|[1-9][0-9]?)$/.test(player.gameShirtNumber));
    if (invalidNumbers.length > 0) return issue("START_SHIRT_NUMBER_INVALID", "Υπάρχουν μη έγκυροι αριθμοί φανέλας στους συμμετέχοντες παίκτες.", invalidNumbers);
    const numberCounts = new Map<string, number>();
    for (const player of participating) numberCounts.set(player.gameShirtNumber!, (numberCounts.get(player.gameShirtNumber!) ?? 0) + 1);
    const duplicateNumbers = participating.filter((player) => (numberCounts.get(player.gameShirtNumber!) ?? 0) > 1);
    if (duplicateNumbers.length > 0) return issue("START_SHIRT_NUMBER_DUPLICATE", `Υπάρχουν διπλοί αριθμοί φανέλας στην ομάδα ${team}.`, duplicateNumbers);
    const participatingIds = new Set(participating.map((player) => player.playerId));
    if (configuration.captainPlayerId === null) return issue("START_CAPTAIN_MISSING", `Πρέπει να επιλεγεί αρχηγός για την ομάδα ${team}.`);
    if (!participatingIds.has(configuration.captainPlayerId)) return issue("START_CAPTAIN_NOT_PARTICIPATING", "Ο αρχηγός πρέπει να είναι συμμετέχων παίκτης.", configuration.players.filter((player) => player.playerId === configuration.captainPlayerId));
    const nonParticipatingStarters = configuration.players.filter((player) => configuration.starterPlayerIds.includes(player.playerId) && !player.participating);
    if (nonParticipatingStarters.length > 0) return issue("START_STARTER_NOT_PARTICIPATING", "Όλοι οι βασικοί παίκτες πρέπει να συμμετέχουν στον αγώνα.", nonParticipatingStarters);
    if (new Set(configuration.starterPlayerIds).size !== configuration.starterPlayerIds.length || configuration.starterPlayerIds.length !== setup.settings.startingPlayers) return issue("START_STARTER_COUNT_INVALID", `Πρέπει να επιλεγούν ακριβώς ${setup.settings.startingPlayers} βασικοί παίκτες για την ομάδα ${team}.`);
    if (configuration.gameColor === null) return issue("START_TEAM_COLOR_MISSING", `Πρέπει να επιλεγεί χρώμα ομάδας για την ομάδα ${team}.`);
    if (!/^#[0-9A-Fa-f]{6}$/.test(configuration.gameColor)) return issue("START_TEAM_COLOR_INVALID", `Το επιλεγμένο χρώμα ομάδας για την ομάδα ${team} δεν είναι έγκυρο.`);
    return null;
}

function verifiedConfiguration(run: StoredLocalGameRun, storedConfiguration: StoredLocalGameRunConfiguration, setup: MatchSetup): ConfigurationV1 {
    if (run.status !== "active" || run.startedAtUtc !== null || run.lastAcceptedSequence !== 0 || run.gameId !== setup.gameId || run.packageId !== setup.packageId || run.packageVersion !== setup.packageVersion || run.packageSchemaVersion !== 1) throw new MatchEngineBootstrapError();
    const configuration = parseConfiguration(storedConfiguration);
    if (configuration.runId !== run.runId || configuration.gameId !== run.gameId) throw new MatchEngineBootstrapError();
    const homeConfiguration = configuration.teams.find((team) => team.side === "HOME");
    const awayConfiguration = configuration.teams.find((team) => team.side === "AWAY");
    if (!homeConfiguration || !awayConfiguration) throw new MatchEngineBootstrapError();
    verifiedSourcePlayers(homeConfiguration, setup.home);
    verifiedSourcePlayers(awayConfiguration, setup.away);
    return configuration;
}

export function validateMatchStartReadiness(run: StoredLocalGameRun, storedConfiguration: StoredLocalGameRunConfiguration, setup: MatchSetup): MatchStartReadinessIssue | null {
    const configuration = verifiedConfiguration(run, storedConfiguration, setup);
    return teamReadiness(configuration.teams[0], setup.home, setup) ?? teamReadiness(configuration.teams[1], setup.away, setup);
}

function validateAndMapTeam(configuration: ConfigurationTeam, source: MatchSetupTeam, setup: MatchSetup, createPlayer: RuntimePlayerFactory): unknown[] {
    const sourceById = verifiedSourcePlayers(configuration, source);
    if (teamReadiness(configuration, source, setup) !== null) throw new MatchEngineBootstrapError();
    const participating = configuration.players.filter((player) => player.participating);
    const starters = new Set(configuration.starterPlayerIds);
    return participating.map((player) => {
        const sourcePlayer = sourceById.get(player.playerId);
        if (!sourcePlayer || player.gameShirtNumber === null) throw new MatchEngineBootstrapError();
        return createPlayer({ playerId: player.playerId, displayName: sourcePlayer.displayName, shirtNumber: player.gameShirtNumber, team: configuration.side, onCourt: starters.has(player.playerId) });
    });
}

function resultPolicy(settings: MatchSetup["settings"]): "ALLOW_TIE" | "REQUIRE_WINNER" {
    if (settings.tieAllowed === true && settings.winnerRequired === false) return "ALLOW_TIE";
    if (settings.tieAllowed === false && settings.winnerRequired === true) return "REQUIRE_WINNER";
    throw new MatchEngineBootstrapError();
}

async function loadSharedEngine(): Promise<{ MatchEngine: RuntimeMatchEngineConstructor; createPlayer: RuntimePlayerFactory }> {
    const [engineModule, playerModule] = await Promise.all([import(MATCH_ENGINE_MODULE), import(PLAYER_MODULE)]) as unknown[];
    const engine = record(engineModule);
    const player = record(playerModule);
    if (typeof engine?.MatchEngine !== "function" || typeof player?.createPlayer !== "function") throw new MatchEngineBootstrapError();
    return { MatchEngine: engine.MatchEngine as RuntimeMatchEngineConstructor, createPlayer: player.createPlayer as RuntimePlayerFactory };
}

export async function buildMatchEngineInitialSnapshot(run: StoredLocalGameRun, storedConfiguration: StoredLocalGameRunConfiguration, setup: MatchSetup): Promise<MatchEngineBootstrapResult> {
    const configuration = verifiedConfiguration(run, storedConfiguration, setup);
    if (validateMatchStartReadiness(run, storedConfiguration, setup) !== null) throw new MatchEngineBootstrapError();
    const { MatchEngine, createPlayer } = await loadSharedEngine();
    const homeConfiguration = configuration.teams.find((team) => team.side === "HOME");
    const awayConfiguration = configuration.teams.find((team) => team.side === "AWAY");
    if (!homeConfiguration || !awayConfiguration) throw new MatchEngineBootstrapError();
    const homePlayers = validateAndMapTeam(homeConfiguration, setup.home, setup, createPlayer);
    const awayPlayers = validateAndMapTeam(awayConfiguration, setup.away, setup, createPlayer);
    const engine = new MatchEngine({
        id: run.runId,
        rules: {
            schemaVersion: 1,
            rulesEdition: "FIBA_2026",
            minPlayers: setup.settings.minPlayers,
            maxPlayers: setup.settings.maxPlayers,
            startingPlayers: setup.settings.startingPlayers,
            regulationPeriods: setup.settings.regulationPeriods,
            regulationPeriodSeconds: setup.settings.regulationPeriodSeconds,
            overtimeSeconds: setup.settings.overtimeSeconds,
            resultPolicy: resultPolicy(setup.settings),
            teamFoulPenaltyThreshold: 5,
            overtimeTeamFoulPolicy: "CARRY_FROM_FINAL_REGULATION",
        },
        homeTeam: { id: setup.home.teamId, name: setup.home.teamName, players: homePlayers },
        awayTeam: { id: setup.away.teamId, name: setup.away.teamName, players: awayPlayers },
    });
    const rawState = engine.getState();
    const state = record(rawState);
    if (!state || state.id !== run.runId || state.started !== false || state.lastProcessedSequence !== 0) throw new MatchEngineBootstrapError();
    const initialState = { ...state, possession: null };
    if (!isJsonValue(initialState)) throw new MatchEngineBootstrapError();
    const initialStateJson = deterministicJson(initialState);
    return { initialState, initialStateJson, initialStateHash: sha256JsonBytes(initialStateJson) };
}
