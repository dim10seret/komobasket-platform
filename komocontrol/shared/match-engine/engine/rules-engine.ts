import { EventType } from "../types/event-type.js";
import type { EventType as EventTypeValue } from "../types/event-type.js";
import {
  OvertimeTeamFoulPolicy,
  ResultPolicy,
  RulesEdition,
  type MatchRulesV1,
} from "../types/rules.js";

const SUPPORTED_EVENTS: ReadonlySet<EventTypeValue> = new Set([
  EventType.MATCH_START, EventType.MATCH_END, EventType.ROSTER_PLAYER_ADDED, EventType.PERIOD_START,
  EventType.LINEUP_SET, EventType.PERIOD_END, EventType.JUMP_BALL,
  EventType.CLOCK_START, EventType.CLOCK_STOP, EventType.CLOCK_SET,
  EventType.ALTERNATING_POSSESSION, EventType.REBOUND, EventType.STEAL,
  EventType.BLOCK, EventType.TWO_POINT, EventType.THREE_POINT,
  EventType.TWO_POINT_MISSED, EventType.THREE_POINT_MISSED, EventType.TURNOVER,
  EventType.PERSONAL_FOUL, EventType.DISRUPTIVE_FOUL, EventType.FLAGRANT_FOUL,
  EventType.FREE_THROW, EventType.PENALTY_ADMINISTRATION_ENDED,
  EventType.SUBSTITUTION, EventType.TIMEOUT, EventType.TECHNICAL_FOUL,
  EventType.DISQUALIFYING_FOUL,
]);

export class RulesEngine {
  supports(type: EventTypeValue): boolean {
    return SUPPORTED_EVENTS.has(type);
  }
}

export function resolveResultPolicy(tieAllowed: boolean, winnerRequired: boolean): ResultPolicy {
  if (tieAllowed === winnerRequired) throw new Error("Result policy requires exactly one of tieAllowed or winnerRequired.");
  return tieAllowed ? ResultPolicy.ALLOW_TIE : ResultPolicy.REQUIRE_WINNER;
}

export function createMatchRules(input: MatchRulesV1): MatchRulesV1 {
  assertValidMatchRules(input);
  return Object.freeze({ ...input });
}

export function assertValidMatchRules(rules: MatchRulesV1): void {
  if (rules.schemaVersion !== 1 || rules.rulesEdition !== RulesEdition.FIBA_2026) {
    throw new Error("Unsupported MatchRules version or rules edition.");
  }
  assertPositiveInteger(rules.startingPlayers, "startingPlayers");
  assertPositiveInteger(rules.minPlayers, "minPlayers");
  assertPositiveInteger(rules.maxPlayers, "maxPlayers");
  if (rules.startingPlayers > rules.minPlayers || rules.minPlayers > rules.maxPlayers) {
    throw new Error("MatchRules player limits are incoherent.");
  }
  assertPositiveInteger(rules.regulationPeriods, "regulationPeriods");
  assertPositiveInteger(rules.regulationPeriodSeconds, "regulationPeriodSeconds");
  assertPositiveInteger(rules.overtimeSeconds, "overtimeSeconds");
  assertPositiveInteger(rules.teamFoulPenaltyThreshold, "teamFoulPenaltyThreshold");
  if (rules.resultPolicy !== ResultPolicy.ALLOW_TIE && rules.resultPolicy !== ResultPolicy.REQUIRE_WINNER) {
    throw new Error("Unsupported result policy.");
  }
  if (rules.overtimeTeamFoulPolicy !== OvertimeTeamFoulPolicy.CARRY_FROM_FINAL_REGULATION) {
    throw new Error("Unsupported overtime team-foul policy.");
  }
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1) throw new Error(field + " must be a positive integer.");
}
