import PublicCompetitionStatisticsView from "@/components/competition/PublicCompetitionStatistics";
import Header from "@/components/layout/Header";
import { readPublicCompetitionStatistics } from "@/services/public-competition-statistics.service";

export const dynamic = "force-dynamic";

export default async function PublicStatisticsPage({ searchParams }: { searchParams: Promise<{ season?: string; competition?: string }> }) {
  const query = await searchParams;
  let data: Awaited<ReturnType<typeof readPublicCompetitionStatistics>> | null = null;
  try { data = await readPublicCompetitionStatistics({ seasonSlug: query.season, competitionSlug: query.competition }); } catch {}
  return <><Header /><main className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top,_#fed7aa,_#f4f4f5_42%,_#ffffff_78%)] py-8 sm:py-12"><section className="mx-auto max-w-7xl px-4 sm:px-6"><p className="text-sm font-black uppercase tracking-[0.18em] text-orange-700">KomoBasket Leaders</p><h1 className="mt-2 text-4xl font-black tracking-tight text-zinc-950 sm:text-5xl">ΣΤΑΤΙΣΤΙΚΑ &amp; MVP</h1><p className="mt-3 max-w-3xl text-base leading-7 text-zinc-600">Κορυφαίες επιδόσεις και στατιστικά της διοργάνωσης.</p>{data ? <PublicCompetitionStatisticsView data={data} /> : <p className="mt-8 rounded-3xl border border-zinc-200 bg-white p-8 font-bold text-zinc-600">Τα στατιστικά δεν είναι διαθέσιμα αυτή τη στιγμή.</p>}</section></main></>;
}
