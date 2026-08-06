import Link from "next/link";
import { Player } from "@/types/player";

interface PlayerCardProps {
  player: Player;
}

export default function PlayerCard({ player }: PlayerCardProps) {
  const initials = player.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");

  return (
    <Link href={`/players/${player.slug}`} className="block">
      <div className="overflow-hidden rounded-2xl border border-zinc-800 bg-zinc-900 transition-all duration-300 hover:-translate-y-1 hover:border-orange-500 hover:shadow-xl hover:shadow-orange-500/10">
        <div className="flex flex-col items-center p-6">
          <div className="flex h-36 w-36 items-center justify-center rounded-full border-4 border-orange-500 bg-zinc-800 text-4xl font-black text-white">
            {initials}
          </div>

          <h3 className="mt-5 min-h-14 text-center text-xl font-bold text-white">{player.name}</h3>
          <p className="mt-2 text-sm font-semibold text-orange-400">Σεζόν {player.season}</p>

          <div className="mt-6 w-full rounded-lg bg-orange-500 py-3 text-center font-semibold text-white transition hover:bg-orange-600">
            Προβολή Προφίλ
          </div>
        </div>
      </div>
    </Link>
  );
}
