import type { Lineup } from "../types/lineup.js";

export function createLineup(playerIds: string[] = []): Lineup {
  return { players: [...playerIds] };
}
