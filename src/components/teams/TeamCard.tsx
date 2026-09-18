import Image from "next/image";
import Link from "next/link";

type TeamCardProps = {
  slug: string;
  team: string;
  season: string;
  players: number;
  logo: string;
};

export default function TeamCard({ slug, team, season, players, logo }: TeamCardProps) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm transition hover:-translate-y-1 hover:shadow-xl">
      <div className="flex justify-center">
        <div className="relative h-32 w-32 overflow-hidden rounded-full border border-zinc-200 bg-white shadow-sm">
          {logo ? <Image src={logo} alt={`Λογότυπο ${team}`} fill sizes="128px" className="object-contain p-2" /> : null}
        </div>
      </div>

      <h2 className="mt-6 min-h-16 text-center text-2xl font-black text-zinc-900">{team}</h2>

      <div className="mt-6 space-y-2 text-center text-zinc-600">
        <p>KomoBasket League {season}</p>
        <p>
          Παίκτες: <span className="font-bold text-zinc-900">{players}</span>
        </p>
      </div>

      <Link href={`/teams/${slug}`} className="mt-8 block w-full rounded-xl bg-zinc-900 py-3 text-center font-semibold text-white transition hover:bg-orange-600">
        Προφίλ Ομάδας
      </Link>
    </div>
  );
}
