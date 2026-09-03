import Link from "next/link";

import PublicFinalizedGame from "@/components/competition/PublicFinalizedGame";
import Header from "@/components/layout/Header";
import { readPublicFinalizedGame } from "@/services/public-finalized-game.service";

export const dynamic = "force-dynamic";

export default async function PublicFinalizedGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  try {
    const result = await readPublicFinalizedGame(gameId);
    if (result.kind === "game") return <><Header /><main className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top,_#fed7aa,_#f4f4f5_42%,_#ffffff_78%)] px-4 py-8 sm:px-6 sm:py-12"><div className="mx-auto max-w-7xl"><Link href="/competitions" className="mb-6 inline-flex min-h-11 items-center rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-black text-zinc-800 shadow-sm hover:border-zinc-950">← Επιστροφή στη διοργάνωση</Link><PublicFinalizedGame detail={result.game} /></div></main></>;
  } catch {}
  return <><Header /><main className="min-h-[calc(100vh-5rem)] bg-zinc-100 px-4 py-16"><section className="mx-auto max-w-xl rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-black">Δεν υπάρχουν διαθέσιμα στατιστικά αγώνα</h1><p className="mt-3 text-zinc-600">Η δημόσια αναφορά εμφανίζεται μόνο μετά από έγκυρη authoritative ολοκλήρωση KomoControl.</p><Link href="/competitions" className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-zinc-950 px-5 py-3 font-bold text-white">Επιστροφή</Link></section></main></>;
}
