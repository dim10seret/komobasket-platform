import type { MatchEvent } from "../../types/event";
import { EventType } from "../../types/event-type";
import type { MatchState } from "../../types/match-state";
import { LineupEngine } from "../lineup-engine";

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
