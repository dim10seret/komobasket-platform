import rawPlayers2019 from "@/data/players-2019-20.json";
import rawPlayers2021 from "@/data/players-2021-22.json";
import rawPlayers2022 from "@/data/players-2022-23.json";
import rawPlayers2023 from "@/data/players-2023-24.json";
import rawPlayers2024 from "@/data/players-2024-25.json";
import rawPlayers2025 from "@/data/players-2025-26.json";
import { teams } from "@/data/teams";
import { Player } from "@/types/player";

type RawPlayer = { id: number; name: string; team: string; number?: number; age?: number };

function mapPlayers(rows: RawPlayer[], season: string): Player[] {
  return rows.map((player) => ({ id: player.id, name: player.name, teamSlug: teams.find((team) => team.season === season && team.name === player.team)?.slug ?? "", slug: `${season}-player-${player.id}`, season, number: player.number, age: player.age }));
}

export const players: Player[] = [...mapPlayers(rawPlayers2019, "2019-20"), ...mapPlayers(rawPlayers2021, "2021-22"), ...mapPlayers(rawPlayers2022, "2022-23"), ...mapPlayers(rawPlayers2023, "2023-24"), ...mapPlayers(rawPlayers2024, "2024-25"), ...mapPlayers(rawPlayers2025, "2025-26")];
