interface PlayerStatsProps {
  games: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  threes: number;
  mvp: number;
}

export default function PlayerStats({
  games,
  points,
 rebounds,
  assists,
  steals,
  blocks,
  threes,
  mvp,
}: PlayerStatsProps) {
  const stats = [
    {
      title: "Αγώνες",
      value: games,
      color: "text-white",
    },
    {
      title: "Πόντοι",
      value: points,
      color: "text-orange-500",
    },
    {
      title: "Rebounds",
      value: rebounds,
      color: "text-green-400",
    },
    {
      title: "Assists",
      value: assists,
      color: "text-blue-400",
    },
    {
      title: "Steals",
      value: steals,
      color: "text-yellow-400",
    },
    {
      title: "Blocks",
      value: blocks,
      color: "text-purple-400",
    },
    {
      title: "3PT",
      value: threes,
      color: "text-red-400",
    },
    {
      title: "MVP",
      value: mvp,
      color: "text-amber-400",
    },
  ];

  return (
    <section className="grid gap-6 sm:grid-cols-2 xl:grid-cols-4">
      {stats.map((stat) => (
        <div
          key={stat.title}
          className="rounded-2xl border border-zinc-800 bg-zinc-900 p-6 transition-all duration-300 hover:-translate-y-1 hover:border-orange-500 hover:shadow-lg hover:shadow-orange-500/10"
        >
          <p className="text-sm uppercase tracking-wider text-zinc-400">
            {stat.title}
          </p>

          <h2 className={`mt-4 text-5xl font-black ${stat.color}`}>
            {stat.value}
          </h2>
        </div>
      ))}
    </section>
  );
}