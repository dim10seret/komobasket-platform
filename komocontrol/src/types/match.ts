import type { MatchState } from "./match-state";
import type { MatchEvent } from "./event";

export interface Match {
  state: MatchState;
  events: MatchEvent[];
}
