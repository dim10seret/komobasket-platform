import { notFound } from "next/navigation";

import Header from "@/components/layout/Header";
import PlayerHero from "@/components/player/PlayerHero";
import PlayerStats from "@/components/player/PlayerStats";

import { getPlayerBySlug } from "@/services/player.service";
import { getPlayerStats } from "@/services/player-stats.service";
import { getPlayerCareerBySlug } from "@/services/player-career.service";

type PageProps = {
  params: Promise<{
    slug: string;
  }>;
};

export default async function PlayerPage({ params }: PageProps) {
  const { slug } = await params;

  const player = getPlayerBySlug(slug);

  if (!player) {
    notFound();
  }

  const stats = getPlayerStats(player.slug);
  const career = await getPlayerCareerBySlug(player.slug);

  return (
    <>
      <Header />

      <main className="mx-auto max-w-7xl space-y-10 px-6 py-10">
        <PlayerHero
          name={player.name}
          season={player.season}
        />

        <PlayerStats
          games={career?.totals.games ?? stats?.games ?? 0}
          points={career?.totals.points ?? stats?.points ?? 0}
          rebounds={career?.totals.rebounds ?? stats?.rebounds ?? 0}
          assists={career?.totals.assists ?? stats?.assists ?? 0}
          steals={career?.totals.steals ?? stats?.steals ?? 0}
          blocks={career?.totals.blocks ?? stats?.blocks ?? 0}
          threes={career?.totals.threes ?? stats?.threes ?? 0}
          mvp={stats?.mvp ?? 0}
        />

        <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
          <div className="border-b border-zinc-200 px-6 py-5">
            <p className="text-xs font-bold uppercase tracking-[0.24em] text-orange-600">Ενιαίο μητρώο παίκτη</p>
            <h2 className="mt-2 text-2xl font-black text-zinc-950">Ιστορικό καριέρας</h2>
            <p className="mt-1 text-sm text-zinc-600">Οι ομάδες και οι διοργανώσεις στις οποίες συμμετείχε ανά σεζόν.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-zinc-950 text-xs uppercase tracking-wider text-white">
                <tr><th className="px-5 py-3">Σεζόν</th><th className="px-5 py-3">Ομάδα</th><th className="px-5 py-3">Διοργάνωση</th><th className="px-5 py-3 text-center">Αγώνες</th><th className="px-5 py-3 text-center">Πόντοι</th></tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {career?.seasons.length ? career.seasons.map((season, index) => (
                  <tr key={`${season.season}-${season.team}-${index}`} className="text-zinc-700">
                    <td className="whitespace-nowrap px-5 py-4 font-bold text-zinc-950">{season.season}</td>
                    <td className="whitespace-nowrap px-5 py-4">{season.team}</td>
                    <td className="whitespace-nowrap px-5 py-4">{season.competition}</td>
                    <td className="px-5 py-4 text-center">{season.games || "—"}</td>
                    <td className="px-5 py-4 text-center">{season.points || "—"}</td>
                  </tr>
                )) : <tr><td colSpan={5} className="px-5 py-8 text-center text-zinc-500">Δεν υπάρχουν ακόμη καταχωρισμένες συμμετοχές.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </>
  );
}
