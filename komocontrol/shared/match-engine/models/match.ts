import { PeriodKind, regulationPeriod, type MatchPeriod } from "../types/period.js";
import type { MatchRulesV1 } from "../types/rules.js";
import { TeamSide } from "../types/team-side.js";
import type { Match } from "../types/match.js";
import type { MatchState } from "../types/match-state.js";
import type { Player } from "../types/player.js";
import { createMatchRules } from "../engine/rules-engine.js";
import { isShirtNumber } from "./player.js";
import { createTeam } from "./team.js";

export interface CreateMatchOptions {
  id: string;
  rules: MatchRulesV1;
  homeTeam: { id: string; name: string; players: Player[] };
  awayTeam: { id: string; name: string; players: Player[] };
}

export function createMatch(options: CreateMatchOptions): Match {
  const rules = createMatchRules(options.rules);
  assertTeamInputs(options.homeTeam, options.awayTeam, rules);

  const state: MatchState = {
    id: options.id,
    rules,
    period: regulationPeriod(1),
    clock: rules.regulationPeriodSeconds,
    clockRunning: false,
    started: false,
    home: createTeam(options.homeTeam.id, options.homeTeam.name, TeamSide.HOME, structuredClone(options.homeTeam.players)),
    away: createTeam(options.awayTeam.id, options.awayTeam.name, TeamSide.AWAY, structuredClone(options.awayTeam.players)),
    possession: TeamSide.HOME,
    alternatingPossession: TeamSide.AWAY,
    finished: false,
    lastProcessedSequence: 0,
  };
  return { state, events: [] };
}

export function cloneMatchState(state: MatchState): MatchState {
  assertMatchState(state);
  return { ...structuredClone(state), rules: createMatchRules(state.rules) };
}

export function assertMatchState(state: MatchState): void {
  const rules = createMatchRules(state.rules);
  assertTeamInputs(
    { id: state.home.id, name: state.home.name, players: state.home.players },
    { id: state.away.id, name: state.away.name, players: state.away.players },
    rules,
  );
  if (state.home.side !== TeamSide.HOME || state.away.side !== TeamSide.AWAY) {
    throw new Error("Match teams must preserve explicit HOME and AWAY authority.");
  }
  if (!isValidStatePeriod(state.period, rules)) throw new Error("Match state contains an invalid period.");
  const maximum = state.period.kind === PeriodKind.REGULATION
    ? rules.regulationPeriodSeconds
    : rules.overtimeSeconds;
  if (!Number.isInteger(state.clock) || state.clock < 0 || state.clock > maximum) {
    throw new Error("Match state contains an invalid clock value.");
  }
}

function assertTeamInputs(
  home: CreateMatchOptions["homeTeam"],
  away: CreateMatchOptions["awayTeam"],
  rules: MatchRulesV1,
): void {
  if (home.id.trim().length === 0 || away.id.trim().length === 0 || home.id === away.id) {
    throw new Error("HOME and AWAY must have distinct non-empty team IDs.");
  }
  if (home.name.trim().length === 0 || away.name.trim().length === 0) throw new Error("Team name is required.");
  assertRoster(home.players, TeamSide.HOME, rules);
  assertRoster(away.players, TeamSide.AWAY, rules);
  const ids = [...home.players, ...away.players].map((player) => player.playerId);
  if (new Set(ids).size !== ids.length) throw new Error("Player IDs must be globally unique within a match.");
}

function assertRoster(players: Player[], expectedSide: TeamSide, rules: MatchRulesV1): void {
  if (players.length < rules.minPlayers || players.length > rules.maxPlayers) {
    throw new Error("Team roster does not satisfy the resolved minimum/maximum player rules.");
  }
  for (const player of players) {
    if (player.playerId.trim().length === 0 || player.displayName.trim().length === 0) {
      throw new Error("Every MatchEngine player requires immutable identity and display name.");
    }
    if (player.team !== expectedSide) throw new Error("Player team membership does not match authoritative HOME/AWAY ownership.");
    if (!isShirtNumber(player.shirtNumber)) throw new Error("Player contains an invalid shirt number.");
  }
}

function isValidStatePeriod(period: MatchPeriod, rules: MatchRulesV1): boolean {
  return Number.isInteger(period.index)
    && period.index >= 1
    && (period.kind === PeriodKind.OVERTIME
      || (period.kind === PeriodKind.REGULATION && period.index <= rules.regulationPeriods));
}
