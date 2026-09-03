import HistoricalArchive from "@/components/history/HistoricalArchive";
import Header from "@/components/layout/Header";

export default function HistoryPage() {
  return <><Header /><main className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top,_#fed7aa,_#f4f4f5_42%,_#ffffff_78%)] py-8 sm:py-12"><section className="mx-auto max-w-7xl px-4 sm:px-6"><p className="text-sm font-black uppercase tracking-[0.18em] text-orange-700">KomoBasket Archive</p><h1 className="mt-2 text-4xl font-black tracking-tight text-zinc-950 sm:text-5xl">ΙΣΤΟΡΙΚΟ KOMOBASKET</h1><p className="mt-3 max-w-3xl text-base leading-7 text-zinc-600">Παλιότερες σεζόν, αποτελέσματα, βαθμολογίες και ομάδες.</p><HistoricalArchive /></section></main></>;
}
