interface PlayerHeroProps {
  name: string;
  season: string;
}

export default function PlayerHero({ name, season }: PlayerHeroProps) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("");

  return (
    <section className="mb-10 overflow-hidden rounded-3xl border border-zinc-800 bg-zinc-900">
      <div className="flex flex-col items-center gap-8 p-8 md:flex-row">
        <div className="flex h-52 w-52 items-center justify-center rounded-full border-4 border-orange-500 bg-zinc-800 text-5xl font-black text-white">
          {initials}
        </div>

        <div className="flex-1 text-center md:text-left">
          <p className="text-lg font-semibold uppercase tracking-widest text-orange-500">
            KomoBasket League {season}
          </p>
          <h1 className="mt-3 text-4xl font-black text-white md:text-5xl">{name}</h1>
        </div>
      </div>
    </section>
  );
}
