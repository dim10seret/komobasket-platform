import type { MatchEvent } from "../../types/event.js";
import { EventType } from "../../types/event-type.js";
import type { MatchState } from "../../types/match-state.js";
import { TimeoutEngine } from "../timeout-engine.js";

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
