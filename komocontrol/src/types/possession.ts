import type { TeamSide } from "./team-side";

export interface Possession {
  team: TeamSide;
  changedAt: number;
}
