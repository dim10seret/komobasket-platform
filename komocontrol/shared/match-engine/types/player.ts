import type { PlayerFoulState } from "./foul.js";
import type { PlayerStatistics } from "./statistics.js";
import type { TeamSide } from "./team-side.js";

type NonZeroDigit = "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";
type Digit = "0" | NonZeroDigit;

export type ShirtNumber = "0" | "00" | NonZeroDigit | `${NonZeroDigit}${Digit}`;

export interface Player {
  playerId: string;
  displayName: string;
  shirtNumber: ShirtNumber;
  team: TeamSide;
  onCourt: boolean;
  foulState: PlayerFoulState;
  statistics: PlayerStatistics;
}
