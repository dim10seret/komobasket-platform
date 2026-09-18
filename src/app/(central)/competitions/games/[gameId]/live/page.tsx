import Link from "next/link";
import Header from "@/components/layout/Header";
import PublicLiveGameView from "@/components/competition/PublicLiveGame";
import { PublicLiveGameServiceError, readPublicLiveGame } from "@/services/public-live-game.service";

export const dynamic = "force-dynamic";

export default async function PublicLiveGamePage({ params }: { params: Promise<{ gameId: string }> }) {
  const { gameId } = await params;
  try {
    const result = await readPublicLiveGame(gameId);
    if (result.kind === "game") return <><Header /><main className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top,_#123047,_#07131d_45%,_#020609)] px-3 py-5 text-white sm:px-6 sm:py-8"><div className="mx-auto max-w-[1500px]"><div className="mb-4 flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.2em] text-cyan-400">KomoBasket Live</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Ζωντανή εξέλιξη αγώνα</h1></div><Link href="/competitions" className="rounded-xl border border-slate-600 px-3 py-2 text-sm font-bold hover:bg-slate-800">Πίσω</Link></div><PublicLiveGameView initialGame={result.game} /></div></main></>;
    return <><Header /><main className="min-h-[calc(100vh-5rem)] bg-zinc-100 px-4 py-16"><section className="mx-auto max-w-xl rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-black">Ο αγώνας δεν είναι LIVE</h1><p className="mt-3 text-zinc-600">Η δημόσια ζωντανή προβολή θα ενεργοποιηθεί όταν ξεκινήσει το authoritative KomoControl Run.</p><Link href="/competitions" className="mt-6 inline-flex rounded-xl bg-zinc-950 px-5 py-3 font-bold text-white">Πρόγραμμα &amp; Αποτελέσματα</Link></section></main></>;
  } catch (error) {
    const unavailable = error instanceof PublicLiveGameServiceError && error.code === "PUBLIC_LIVE_UNAVAILABLE";
    return <><Header /><main className="min-h-[calc(100vh-5rem)] bg-zinc-100 px-4 py-16"><section className="mx-auto max-w-xl rounded-3xl border border-zinc-200 bg-white p-8 text-center shadow-sm"><h1 className="text-2xl font-black">{unavailable ? "Η LIVE υπηρεσία δεν είναι διαθέσιμη" : "Δεν βρέθηκε ο αγώνας"}</h1><Link href="/competitions" className="mt-6 inline-flex rounded-xl bg-zinc-950 px-5 py-3 font-bold text-white">Επιστροφή</Link></section></main></>;
  }
}
