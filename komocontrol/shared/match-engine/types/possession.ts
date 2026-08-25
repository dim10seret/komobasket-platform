import type { TeamSide } from "./team-side.js";

export interface Possession {
  team: TeamSide;
  changedAt: number;
}
