import type { MatchState } from "../types/match-state.js";
import type { TeamSide } from "../types/team-side.js";

export class PossessionEngine {
  set(state: MatchState, team: TeamSide): void {
    state.possession = team;
  }

  setOpeningJumpBall(state: MatchState, winner: TeamSide): void {
    state.possession = winner;
    state.alternatingPossession = winner === "HOME" ? "AWAY" : "HOME";
  }

  useAlternatingPossession(state: MatchState): void {
    state.possession = state.alternatingPossession;
    state.alternatingPossession = state.alternatingPossession === "HOME" ? "AWAY" : "HOME";
  }

  switch(state: MatchState): void {
    if (state.possession === null) {
      throw new Error("Cannot switch unresolved live-ball possession.");
    }
    state.possession = state.possession === "HOME" ? "AWAY" : "HOME";
  }
}
