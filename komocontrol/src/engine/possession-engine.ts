import type { MatchState } from "../types/match-state";
import type { TeamSide } from "../types/team-side";

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
    state.possession = state.possession === "HOME" ? "AWAY" : "HOME";
  }
}
