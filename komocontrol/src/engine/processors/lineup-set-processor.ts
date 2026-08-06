import type { MatchEvent } from "../../types/event";
import { EventType } from "../../types/event-type";
import type { MatchState } from "../../types/match-state";
import { LineupEngine } from "../lineup-engine";

export class LineupSetProcessor {
  private readonly lineup: LineupEngine;

  constructor(lineup = new LineupEngine()) {
    this.lineup = lineup;
  }

  process(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.LINEUP_SET }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    this.lineup.set(team.players, event.playerIds);
  }
}
