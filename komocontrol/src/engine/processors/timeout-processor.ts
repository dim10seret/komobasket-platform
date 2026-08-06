import type { MatchEvent } from "../../types/event";
import { EventType } from "../../types/event-type";
import type { MatchState } from "../../types/match-state";
import { TimeoutEngine } from "../timeout-engine";

export class TimeoutProcessor {
  private readonly timeout: TimeoutEngine;

  constructor(timeout = new TimeoutEngine()) {
    this.timeout = timeout;
  }

  process(state: MatchState, event: Extract<MatchEvent, { type: typeof EventType.TIMEOUT }>): void {
    const team = event.team === "HOME" ? state.home : state.away;
    if (!this.timeout.use(team)) throw new Error("Validated team had no timeouts remaining.");
  }
}
