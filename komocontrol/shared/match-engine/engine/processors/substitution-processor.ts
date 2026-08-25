import type { MatchEvent } from "../../types/event.js";
import { EventType } from "../../types/event-type.js";
import type { MatchState } from "../../types/match-state.js";
import { LineupEngine } from "../lineup-engine.js";

export class SubstitutionProcessor {
  private readonly lineup: LineupEngine;

  constructor(lineup = new LineupEngine()) {
    this.lineup = lineup;
  }

  process(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.SUBSTITUTION }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    this.lineup.substitute(team.players, event.playerOutId, event.playerInId);
  }
}
