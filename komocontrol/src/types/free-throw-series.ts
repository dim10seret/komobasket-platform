import type { TeamSide } from "./team-side";

export type FreeThrowPossessionOutcome = "LIVE_BALL" | "SHOOTING_TEAM" | "UNCHANGED";

export interface FreeThrowSeries {
  shootingTeam: TeamSide;
  shooterId: string;
  remainingAttempts: number;
  totalAttempts: number;
  possessionAfter: FreeThrowPossessionOutcome;
}
