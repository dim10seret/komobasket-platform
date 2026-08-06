import Image from "next/image";

type TeamHeroProps = {
  team: string;
  season: string;
  playerCount: number;
  logo: string;
};

export default function TeamHero({ team, season, playerCount, logo }: TeamHeroProps) {
  return (
    <section className="overflow-hidden rounded-2xl bg-gradient-to-r from-zinc-900 via-zinc-800 to-zinc-900 text-white shadow-xl">
      <div className="mx-auto max-w-7xl px-8 py-10">
        <div className="flex flex-col items-center gap-8 lg:flex-row">
          <div className="relative h-40 w-40 overflow-hidden rounded-full bg-white shadow-lg">
            <Image src={logo} alt={`Λογότυπο ${team}`} fill sizes="160px" className="object-contain p-3" priority />
          </div>

          <div className="flex-1 text-center lg:text-left">
            <h1 className="text-4xl font-black sm:text-5xl">{team}</h1>
            <p className="mt-2 text-zinc-300">KomoBasket League {season}</p>

            <div className="mt-8 inline-flex rounded-xl bg-white/10 px-8 py-4 text-center">
              <div>
                <p className="text-sm text-zinc-300">Ρόστερ</p>
                <p className="text-3xl font-black">{playerCount} παίκτες</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
