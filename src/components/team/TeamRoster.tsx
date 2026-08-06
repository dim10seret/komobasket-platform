import { getPlayersByTeam } from "@/services/player.service";
import PlayerCard from "@/components/player/PlayerCard";

interface TeamRosterProps {
  teamSlug: string;
  season: string;
}

export default function TeamRoster({ teamSlug, season }: TeamRosterProps) {
  const players = getPlayersByTeam(teamSlug, season);

  return (
    <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
      {players.map((player) => (
        <PlayerCard
          key={player.id}
          player={player}
        />
      ))}
    </div>
  );
}
