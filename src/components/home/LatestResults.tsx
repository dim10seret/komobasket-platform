import Link from "next/link";
import { finalFour2025 } from "@/data/postseason-2025-26";

export default function LatestResults() {
  const games = finalFour2025
    .filter((game) => game.homeScore !== undefined && game.awayScore !== undefined)
    .slice(-3)
    .reverse();

  return <section className="bg-zinc-100 py-20"><div className="mx-auto max-w-7xl px-6"><div className="mb-12 text-center"><h2 className="text-4xl font-black">Τελευταία Αποτελέσματα</h2><p className="mt-3 text-lg text-zinc-600">Οι πιο πρόσφατοι αγώνες ημερολογιακά - Final Four KomoBasket League 2025-26</p></div><div className="grid gap-8 md:grid-cols-3">{games.map(game=><article key={game.id} className="rounded-2xl bg-white p-6 shadow-lg"><p className="mb-5 text-sm font-bold uppercase tracking-wide text-orange-600">{game.stage}</p><div className="grid grid-cols-[1fr_auto] gap-4 text-lg font-bold"><span>{game.homeTeam}</span><strong className="text-3xl text-orange-600">{game.homeScore}</strong><span>{game.awayTeam}</span><strong className="text-3xl">{game.awayScore}</strong></div></article>)}</div><div className="mt-8 text-center"><Link href="/results" className="inline-flex rounded-xl bg-zinc-900 px-6 py-3 font-bold text-white">Όλα τα αποτελέσματα</Link></div></div></section>;
}
