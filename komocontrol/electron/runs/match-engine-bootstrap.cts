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

function validateAndMapTeam(configuration: ConfigurationTeam, source: MatchSetupTeam, setup: MatchSetup, createPlayer: RuntimePlayerFactory): unknown[] {
    if (configuration.side !== source.side || configuration.teamId !== source.teamId) throw new MatchEngineBootstrapError();
    const sourceById = new Map(source.players.map((player) => [player.playerId, player]));
    if (sourceById.size !== source.players.length || configuration.players.length !== source.players.length || new Set(configuration.players.map((player) => player.playerId)).size !== configuration.players.length || configuration.players.some((player) => !sourceById.has(player.playerId))) throw new MatchEngineBootstrapError();
    const participating = configuration.players.filter((player) => player.participating);
    if (participating.length < setup.settings.minPlayers || participating.length > setup.settings.maxPlayers) throw new MatchEngineBootstrapError();
    const shirtNumbers = participating.map((player) => player.gameShirtNumber);
    if (shirtNumbers.some((number) => number === null || !/^(?:0|00|[1-9][0-9]?)$/.test(number)) || new Set(shirtNumbers).size !== shirtNumbers.length) throw new MatchEngineBootstrapError();
    const participatingIds = new Set(participating.map((player) => player.playerId));
    if (configuration.captainPlayerId === null || !participatingIds.has(configuration.captainPlayerId)) throw new MatchEngineBootstrapError();
    if (new Set(configuration.starterPlayerIds).size !== configuration.starterPlayerIds.length || configuration.starterPlayerIds.length !== setup.settings.startingPlayers || configuration.starterPlayerIds.some((id) => !participatingIds.has(id))) throw new MatchEngineBootstrapError();
    if (configuration.gameColor === null || !/^#[0-9A-Fa-f]{6}$/.test(configuration.gameColor)) throw new MatchEngineBootstrapError();
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
    if (run.status !== "active" || run.startedAtUtc !== null || run.lastAcceptedSequence !== 0 || run.gameId !== setup.gameId || run.packageId !== setup.packageId || run.packageVersion !== setup.packageVersion || run.packageSchemaVersion !== 1) throw new MatchEngineBootstrapError();
    const configuration = parseConfiguration(storedConfiguration);
    if (configuration.runId !== run.runId || configuration.gameId !== run.gameId) throw new MatchEngineBootstrapError();
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
