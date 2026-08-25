import type { MatchState } from "./match-state.js";
import type { MatchEvent } from "./event.js";

export interface Match {
  state: MatchState;
  events: MatchEvent[];
}
