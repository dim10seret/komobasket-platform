import type { Lineup } from "../types/lineup.js";
import type { Player } from "../types/player.js";

export class LineupEngine {
  replace(lineup: Lineup, playerOutId: string, playerInId: string): Lineup {
    return { players: lineup.players.map((id) => (id === playerOutId ? playerInId : id)) };
  }

  substitute(players: Player[], playerOutId: string, playerInId: string): void {
    const playerOut = players.find((player) => player.id === playerOutId);
    const playerIn = players.find((player) => player.id === playerInId);
    if (!playerOut || !playerIn) throw new Error("Validated player was not found while processing a substitution.");

    playerOut.onCourt = false;
    playerIn.onCourt = true;
  }

  set(players: Player[], playerIds: string[]): void {
    const selected = new Set(playerIds);
    for (const player of players) player.onCourt = selected.has(player.id);
  }
}
