import type { Lineup } from "../types/lineup";

export function createLineup(playerIds: string[] = []): Lineup {
  return { players: [...playerIds] };
}
