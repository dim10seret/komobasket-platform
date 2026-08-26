import { createHash } from "node:crypto";
import { MatchEngine } from "../../komocontrol/shared/match-engine/engine/match-engine";
import type { MatchEvent } from "../../komocontrol/shared/match-engine/types/event";
import type { MatchState } from "../../komocontrol/shared/match-engine/types/match-state";

export type GameplaySyncDecision = "insert" | "replace" | "idempotent";
export type GameplaySyncErrorCode = "SYNC_INVALID" | "SYNC_STALE" | "SYNC_INTEGRITY_CONFLICT" | "SYNC_RUN_CONFLICT";

export class GameplaySyncValidationError extends Error {
  constructor(readonly code: GameplaySyncErrorCode) {
    super(code);
    this.name = "GameplaySyncValidationError";
  }
}

export interface ValidatedGameplaySync {
  schemaVersion: 1;
  runId: string;
  gameId: string;
  packageId: string;
  packageVersion: number;
  packageHash: string;
  organizationId: string;
  scorerId: string;
  deviceId: string;
  startedAtUtc: string;
  configurationRevision: number;
  configurationHash: string;
  currentConfigurationRevision: number;
  currentConfigurationHash: string;
  currentConfigurationJson: string;
  snapshotSchemaVersion: 1;
  matchEventSchemaVersion: 2;
  initialStateJson: string;
  initialStateHash: string;
  eventHistoryRevision: number;
  lastAcceptedSequence: number;
  historyHash: string;
  events: Array<{ eventId: string; sequence: number; eventSchemaVersion: 2; eventJson: string; eventHash: string }>;
  finalization: null | {
    schemaVersion: 1;
    finalizedHistoryRevision: number;
    finalizedHistoryHash: string;
    finalStateJson: string;
    finalStateHash: string;
    finalizationJson: string;
    finalizationHash: string;
    finalizedAtUtc: string;
  };
  finalState: MatchState;
  currentConfiguration: ValidatedCurrentConfiguration;
}

export interface ValidatedCurrentConfigurationPlayer {
  playerId: string;
  participating: boolean;
  gameShirtNumber: string | null;
}
export interface ValidatedCurrentConfigurationTeam {
  side: "HOME" | "AWAY";
  teamId: string;
  players: ValidatedCurrentConfigurationPlayer[];
  gameColor: string;
}
export interface ValidatedCurrentConfiguration {
  schemaVersion: 1;
  runId: string;
  gameId: string;
  teams: [ValidatedCurrentConfigurationTeam, ValidatedCurrentConfigurationTeam];
  presentation: { leftSide: "HOME" | "AWAY" };
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new GameplaySyncValidationError("SYNC_INVALID");
  return value as Record<string, unknown>;
}

function text(value: unknown, maximum = 512): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > maximum) throw new GameplaySyncValidationError("SYNC_INVALID");
  return value;
}

function integer(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) throw new GameplaySyncValidationError("SYNC_INVALID");
  return value;
}

function hash(value: unknown): string {
  const result = text(value, 64);
  if (!/^[a-f0-9]{64}$/.test(result)) throw new GameplaySyncValidationError("SYNC_INVALID");
  return result;
}

function iso(value: unknown): string {
  const result = text(value, 64);
  if (!Number.isFinite(Date.parse(result))) throw new GameplaySyncValidationError("SYNC_INVALID");
  return result;
}

function stable(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const item = object(value);
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stable(item[key])}`).join(",")}}`;
}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function deterministicJson(value: unknown): unknown {
  const source = text(value, 5_000_000);
  let parsed: unknown;
  try { parsed = JSON.parse(source); } catch { throw new GameplaySyncValidationError("SYNC_INVALID"); }
  if (stable(parsed) !== source) throw new GameplaySyncValidationError("SYNC_INVALID");
  return parsed;
}

function shirtNumber(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !/^(?:0|00|[1-9][0-9]?)$/.test(value)) throw new GameplaySyncValidationError("SYNC_INVALID");
  return value;
}

function validateCurrentConfiguration(value: unknown, expectedHash: unknown, runId: string, gameId: string): {
  json: string;
  hash: string;
  configuration: ValidatedCurrentConfiguration;
} {
  const json = text(value, 5_000_000);
  const configurationHash = hash(expectedHash);
  if (sha256(json) !== configurationHash) throw new GameplaySyncValidationError("SYNC_INVALID");
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new GameplaySyncValidationError("SYNC_INVALID"); }
  const item = object(parsed);
  if (item.schemaVersion !== 1 || item.runId !== runId || item.gameId !== gameId || !Array.isArray(item.teams) || item.teams.length !== 2) throw new GameplaySyncValidationError("SYNC_INVALID");
  const teams = item.teams.map((value): ValidatedCurrentConfigurationTeam => {
    const team = object(value);
    const side = team.side;
    if ((side !== "HOME" && side !== "AWAY") || !Array.isArray(team.players) || typeof team.gameColor !== "string" || !/^#[0-9A-F]{6}$/.test(team.gameColor)) throw new GameplaySyncValidationError("SYNC_INVALID");
    const players = team.players.map((value) => {
      const player = object(value);
      if (typeof player.participating !== "boolean") throw new GameplaySyncValidationError("SYNC_INVALID");
      const gameShirtNumber = shirtNumber(player.gameShirtNumber);
      if (player.participating && gameShirtNumber === null) throw new GameplaySyncValidationError("SYNC_INVALID");
      return { playerId: text(player.playerId), participating: player.participating, gameShirtNumber };
    });
    if (new Set(players.map((player) => player.playerId)).size !== players.length) throw new GameplaySyncValidationError("SYNC_INVALID");
    const participatingNumbers = players.filter((player) => player.participating).map((player) => player.gameShirtNumber);
    if (new Set(participatingNumbers).size !== participatingNumbers.length) throw new GameplaySyncValidationError("SYNC_INVALID");
    return { side, teamId: text(team.teamId), players, gameColor: team.gameColor };
  }).sort((left, right) => left.side === right.side ? 0 : left.side === "HOME" ? -1 : 1);
  if (teams[0]?.side !== "HOME" || teams[1]?.side !== "AWAY") throw new GameplaySyncValidationError("SYNC_INVALID");
  const presentation = object(item.presentation);
  if (presentation.leftSide !== "HOME" && presentation.leftSide !== "AWAY") throw new GameplaySyncValidationError("SYNC_INVALID");
  return {
    json,
    hash: configurationHash,
    configuration: {
      schemaVersion: 1,
      runId,
      gameId,
      teams: [teams[0], teams[1]],
      presentation: { leftSide: presentation.leftSide },
    },
  };
}

function optionalFinalization(value: unknown, historyRevision: number, historyHash: string, finalState: MatchState) {
  if (value === null) {
    if (finalState.finished) throw new GameplaySyncValidationError("SYNC_INVALID");
    return null;
  }
  const item = object(value);
  const finalStateJson = text(item.finalStateJson, 5_000_000);
  const finalStateHash = hash(item.finalStateHash);
  const finalizationJson = text(item.finalizationJson, 100_000);
  const finalizationHash = hash(item.finalizationHash);
  const finalizedAtUtc = iso(item.finalizedAtUtc);
  if (item.schemaVersion !== 1 || integer(item.finalizedHistoryRevision, 1) !== historyRevision
    || hash(item.finalizedHistoryHash) !== historyHash || sha256(finalStateJson) !== finalStateHash
    || sha256(finalizationJson) !== finalizationHash || stable(finalState) !== finalStateJson || !finalState.finished) {
    throw new GameplaySyncValidationError("SYNC_INVALID");
  }
  const manifest = object(deterministicJson(finalizationJson));
  if (manifest.schemaVersion !== 1 || manifest.runId === undefined
    || manifest.finalizedHistoryRevision !== historyRevision || manifest.finalizedHistoryHash !== historyHash
    || manifest.finalStateHash !== finalStateHash || manifest.finalizedAtUtc !== finalizedAtUtc) {
    throw new GameplaySyncValidationError("SYNC_INVALID");
  }
  return { schemaVersion: 1 as const, finalizedHistoryRevision: historyRevision, finalizedHistoryHash: historyHash,
    finalStateJson, finalStateHash, finalizationJson, finalizationHash, finalizedAtUtc };
}

export function validateGameplaySync(input: unknown, routeRunId: string): ValidatedGameplaySync {
  const item = object(input);
  const runId = text(item.runId);
  if (item.schemaVersion !== 1 || runId !== routeRunId) throw new GameplaySyncValidationError("SYNC_INVALID");
  const initialStateJson = text(item.initialStateJson, 5_000_000);
  const initialStateHash = hash(item.initialStateHash);
  const initialState = deterministicJson(initialStateJson) as MatchState;
  if (sha256(initialStateJson) !== initialStateHash || object(initialState).id !== runId) throw new GameplaySyncValidationError("SYNC_INVALID");
  const rawEvents = Array.isArray(item.events) ? item.events : null;
  if (!rawEvents || rawEvents.length < 1 || rawEvents.length > 100_000) throw new GameplaySyncValidationError("SYNC_INVALID");
  const events = rawEvents.map((value, index) => {
    const event = object(value);
    const eventJson = text(event.eventJson, 250_000);
    const parsed = object(deterministicJson(eventJson));
    const eventId = text(event.eventId);
    const sequence = integer(event.sequence, 1);
    const eventHash = hash(event.eventHash);
    const previousSequence = index === 0 ? 0 : Number(object(deterministicJson(text(object(rawEvents[index - 1]).eventJson, 250_000))).sequence);
    if (event.eventSchemaVersion !== 2 || parsed.schemaVersion !== 2 || parsed.id !== eventId || parsed.sequence !== sequence
      || (index === 0 ? sequence !== 1 : sequence <= previousSequence) || sha256(eventJson) !== eventHash) throw new GameplaySyncValidationError("SYNC_INVALID");
    return { eventId, sequence, eventSchemaVersion: 2 as const, eventJson, eventHash, parsed: parsed as unknown as MatchEvent };
  });
  if (object(events[0]?.parsed).type !== "MATCH_START") throw new GameplaySyncValidationError("SYNC_INVALID");
  const eventHistoryRevision = integer(item.eventHistoryRevision, 1);
  const lastAcceptedSequence = integer(item.lastAcceptedSequence, 1);
  const historyHash = hash(item.historyHash);
  if (lastAcceptedSequence < events.at(-1)!.sequence || sha256(`[${events.map((event) => event.eventJson).join(",")}]`) !== historyHash) throw new GameplaySyncValidationError("SYNC_INVALID");
  const engine = MatchEngine.fromInitialState(initialState);
  for (const event of events) if (!engine.process(event.parsed).accepted) throw new GameplaySyncValidationError("SYNC_INVALID");
  const finalState = engine.getState();
  const finalization = optionalFinalization(item.finalization, eventHistoryRevision, historyHash, finalState);
  const lastType = object(events.at(-1)?.parsed).type;
  if ((finalization === null && lastType === "MATCH_END") || (finalization !== null && lastType !== "MATCH_END")) throw new GameplaySyncValidationError("SYNC_INVALID");
  if (finalization && object(deterministicJson(finalization.finalizationJson)).runId !== runId) throw new GameplaySyncValidationError("SYNC_INVALID");
  const gameId = text(item.gameId);
  const currentConfiguration = validateCurrentConfiguration(item.currentConfigurationJson, item.currentConfigurationHash, runId, gameId);
  const currentConfigurationRevision = integer(item.currentConfigurationRevision, 1);
  const configurationRevision = integer(item.configurationRevision, 1);
  if (currentConfigurationRevision < configurationRevision) throw new GameplaySyncValidationError("SYNC_INVALID");
  return {
    schemaVersion: 1, runId, gameId, packageId: text(item.packageId), packageVersion: integer(item.packageVersion, 1),
    packageHash: hash(item.packageHash), organizationId: text(item.organizationId), scorerId: text(item.scorerId), deviceId: text(item.deviceId),
    startedAtUtc: iso(item.startedAtUtc), configurationRevision, configurationHash: hash(item.configurationHash),
    currentConfigurationRevision, currentConfigurationHash: currentConfiguration.hash, currentConfigurationJson: currentConfiguration.json,
    snapshotSchemaVersion: item.snapshotSchemaVersion === 1 ? 1 : (() => { throw new GameplaySyncValidationError("SYNC_INVALID"); })(),
    matchEventSchemaVersion: item.matchEventSchemaVersion === 2 ? 2 : (() => { throw new GameplaySyncValidationError("SYNC_INVALID"); })(),
    initialStateJson, initialStateHash, eventHistoryRevision, lastAcceptedSequence, historyHash,
    events: events.map(({ parsed: _parsed, ...event }) => event), finalization, finalState, currentConfiguration: currentConfiguration.configuration,
  };
}

function sameIds(left: string[], right: string[]): boolean {
  return left.length === right.length && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

export function assertGameplayPackageLineage(input: ValidatedGameplaySync, packageSnapshotJson: string): void {
  if (sha256(packageSnapshotJson) !== input.packageHash) throw new GameplaySyncValidationError("SYNC_INVALID");
  let parsed: unknown;
  try { parsed = JSON.parse(packageSnapshotJson); } catch { throw new GameplaySyncValidationError("SYNC_INVALID"); }
  const root = object(parsed);
  const game = object(root.game);
  const settings = object(root.settings);
  if (root.schemaVersion !== 1 || game.id !== input.gameId || game.organizationId !== input.organizationId
    || typeof settings.tie_allowed !== "boolean" || typeof settings.winner_required !== "boolean"
    || settings.tie_allowed === settings.winner_required || !Array.isArray(root.teams) || root.teams.length !== 2) {
    throw new GameplaySyncValidationError("SYNC_INVALID");
  }
  const packageTeams = new Map(root.teams.map((value) => {
    const team = object(value);
    if ((team.side !== "HOME" && team.side !== "AWAY") || !Array.isArray(team.players)) throw new GameplaySyncValidationError("SYNC_INVALID");
    const players = new Map(team.players.map((value) => {
      const player = object(value);
      return [text(player.id), { displayName: text(player.displayName) }] as const;
    }));
    return [team.side, { teamId: text(team.id), players }] as const;
  }));
  for (const team of input.currentConfiguration.teams) {
    const packageTeam = packageTeams.get(team.side);
    if (!packageTeam || packageTeam.teamId !== team.teamId || !sameIds([...packageTeam.players.keys()], team.players.map((player) => player.playerId))) throw new GameplaySyncValidationError("SYNC_INVALID");
    const engineTeam = team.side === "HOME" ? input.finalState.home : input.finalState.away;
    const participating = team.players.filter((player) => player.participating).map((player) => player.playerId);
    if (!sameIds(engineTeam.players.map((player) => player.playerId), participating)) throw new GameplaySyncValidationError("SYNC_INVALID");
  }
  for (const row of input.events) {
    const event = object(JSON.parse(row.eventJson));
    if (event.type !== "ROSTER_PLAYER_ADDED") continue;
    if (event.team !== "HOME" && event.team !== "AWAY") throw new GameplaySyncValidationError("SYNC_INVALID");
    const player = packageTeams.get(event.team)?.players.get(text(event.playerId));
    if (!player || player.displayName !== event.displayName) throw new GameplaySyncValidationError("SYNC_INVALID");
  }
}

export function decideGameplaySync(current: null | { eventHistoryRevision: number; historyHash: string; finalizationHash: string | null }, incoming: ValidatedGameplaySync): GameplaySyncDecision {
  if (!current) return "insert";
  if (incoming.eventHistoryRevision < current.eventHistoryRevision) throw new GameplaySyncValidationError("SYNC_STALE");
  if (incoming.eventHistoryRevision === current.eventHistoryRevision) {
    if (incoming.historyHash !== current.historyHash || (incoming.finalization?.finalizationHash ?? null) !== current.finalizationHash) {
      throw new GameplaySyncValidationError("SYNC_INTEGRITY_CONFLICT");
    }
    return "idempotent";
  }
  if (current.finalizationHash !== null) throw new GameplaySyncValidationError("SYNC_INTEGRITY_CONFLICT");
  return "replace";
}

export function decideGameplayConfigurationSync(
  current: null | { configurationRevision: number; configurationHash: string },
  incoming: Pick<ValidatedGameplaySync, "currentConfigurationRevision" | "currentConfigurationHash">,
): GameplaySyncDecision {
  if (!current) return "insert";
  if (incoming.currentConfigurationRevision < current.configurationRevision) throw new GameplaySyncValidationError("SYNC_STALE");
  if (incoming.currentConfigurationRevision === current.configurationRevision) {
    if (incoming.currentConfigurationHash !== current.configurationHash) throw new GameplaySyncValidationError("SYNC_INTEGRITY_CONFLICT");
    return "idempotent";
  }
  return "replace";
}

export function assertGameplaySyncIdentity(
  expected: { scorerId: string; organizationId: string; deviceId: string },
  incoming: Pick<ValidatedGameplaySync, "scorerId" | "organizationId" | "deviceId">,
): void {
  if (incoming.scorerId !== expected.scorerId || incoming.organizationId !== expected.organizationId || incoming.deviceId !== expected.deviceId) {
    throw new GameplaySyncValidationError("SYNC_RUN_CONFLICT");
  }
}
