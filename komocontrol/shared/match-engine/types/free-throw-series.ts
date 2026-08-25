import type { TeamSide } from "./team-side.js";

export type FreeThrowPossessionOutcome = "LIVE_BALL" | "SHOOTING_TEAM" | "UNCHANGED";

export interface FreeThrowSeries {
  shootingTeam: TeamSide;
  shooterId: string;
  remainingAttempts: number;
  totalAttempts: number;
  possessionAfter: FreeThrowPossessionOutcome;
}
