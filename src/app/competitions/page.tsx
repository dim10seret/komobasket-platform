import Link from "next/link";

import Header from "@/components/layout/Header";
import { getPublicCompetitionContext, type PublicPhase } from "@/services/public-competition.service";

type PageProps = {
  searchParams: Promise<{ season?: string; competition?: string; phase?: string }>;
};

function competitionHref(season: string, competition?: string, phase?: string) {
  const params = new URLSearchParams({ season });
  if (competition) params.set("competition", competition);
  if (phase) params.set("phase", phase);
  return `/competitions?${params.toString()}`;
}

function phaseSummary(phase: PublicPhase) {
  if (phase.format === "standings") {
    const parts = [phase.participantCount ? `${phase.participantCount} ομάδες` : null, phase.roundCount ? `${phase.roundCount} αγωνιστικές` : null].filter(Boolean);
    return parts.join(" · ") || "Βαθμολογική φάση";
  }
  if (phase.format === "series") {
    const parts = [phase.participantCount ? `${phase.participantCount} ομάδες` : null, phase.winsRequired ? `${phase.winsRequired} νίκες για πρόκριση` : null].filter(Boolean);
    return parts.join(" · ") || "Σειρά αγώνων";
  }
  return "Φάση διοργάνωσης";
}

export default async function CompetitionsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  let context;
  try {
    context = await getPublicCompetitionContext({
      seasonSlug: query.season,
      competitionSlug: query.competition,
      phaseSlug: query.phase,
    });
  } catch {
    context = null;
  }

  return <>
    <Header />
    <main className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top,_#fed7aa,_#f4f4f5_42%,_#ffffff_78%)] py-10 sm:py-16">
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-orange-700">KomoBasket League</p>
        <h1 className="mt-3 text-4xl font-black tracking-tight text-zinc-950 sm:text-6xl">Διοργανώσεις</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-zinc-600 sm:text-lg">Επιλέξτε σεζόν, διοργάνωση και φάση για να παρακολουθήσετε την επίσημη αγωνιστική εικόνα.</p>

        {!context || !context.selectedSeason ? <div className="mt-10 rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm sm:p-10">
          <p className="text-lg font-black text-zinc-950">Δεν υπάρχει διαθέσιμη διοργάνωση αυτή τη στιγμή.</p>
          <p className="mt-2 max-w-xl leading-7 text-zinc-600">Οι διοργανώσεις εμφανίζονται εδώ όταν είναι έτοιμες για δημόσια παρουσίαση.</p>
        </div> : <div className="mt-10 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          <aside className="rounded-3xl bg-zinc-950 p-4 text-white shadow-xl">
            <p className="px-3 pb-2 text-xs font-black uppercase tracking-[0.16em] text-orange-400">Σεζόν</p>
            <div className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible">
              {context.seasons.map((season) => <Link key={season.id} href={competitionHref(season.slug)} className={`shrink-0 rounded-2xl px-4 py-3 text-sm font-bold transition ${season.id === context.selectedSeason?.id ? "bg-orange-600 text-white" : "bg-zinc-800 text-zinc-200 hover:bg-zinc-700"}`}>
                {season.name}
              </Link>)}
            </div>
          </aside>

          <div className="min-w-0 space-y-6">
            <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Διοργάνωση</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {context.competitions.map((competition) => <Link key={competition.id} href={competitionHref(context.selectedSeason!.slug, competition.slug)} className={`rounded-2xl border p-4 transition ${competition.id === context.selectedCompetition?.id ? "border-orange-500 bg-orange-50" : "border-zinc-200 hover:border-zinc-400"}`}>
                  <p className="font-black text-zinc-950">{competition.name}</p>
                  <p className="mt-1 text-sm text-zinc-600">{competition.lifecycleStatus === "complete" ? "Ολοκληρωμένη διοργάνωση" : "Σε εξέλιξη"}</p>
                </Link>)}
              </div>
            </section>

            <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Φάση</p>
              <div className="mt-4 grid gap-3">
                {context.phases.map((phase) => <Link key={phase.id} href={competitionHref(context.selectedSeason!.slug, context.selectedCompetition!.slug, phase.slug)} className={`rounded-2xl border p-4 transition sm:flex sm:items-center sm:justify-between sm:gap-6 ${phase.id === context.selectedPhase?.id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 hover:border-zinc-400"}`}>
                  <div><p className="font-black">{phase.name}</p><p className={`mt-1 text-sm ${phase.id === context.selectedPhase?.id ? "text-zinc-300" : "text-zinc-600"}`}>{phaseSummary(phase)}</p></div>
                  <span className={`mt-3 inline-flex rounded-full px-3 py-1 text-xs font-black sm:mt-0 ${phase.id === context.selectedPhase?.id ? "bg-orange-500 text-white" : "bg-zinc-100 text-zinc-700"}`}>{phase.format === "standings" ? "Βαθμολογική" : phase.format === "series" ? "Σειρά αγώνων" : "Φάση"}</span>
                </Link>)}
              </div>
            </section>

            {context.selectedPhase && <section className="rounded-3xl border border-dashed border-orange-300 bg-orange-50 p-5 sm:p-7">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Επιλεγμένη φάση</p>
              <h2 className="mt-2 text-2xl font-black text-zinc-950">{context.selectedPhase.name}</h2>
              <p className="mt-2 text-zinc-700">{phaseSummary(context.selectedPhase)}</p>
              {context.selectedPhase.directAdvancements.length > 0 && <p className="mt-4 text-sm font-bold text-zinc-800">{context.selectedPhase.directAdvancements.length} άμεση πρόκριση χωρίς αγώνα.</p>}
              <p className="mt-5 text-sm leading-6 text-zinc-600">Το πλαίσιο της φάσης φορτώθηκε επιτυχώς. Πρόγραμμα, αποτελέσματα και βαθμολογία θα προστεθούν σε επόμενο στάδιο.</p>
            </section>}
          </div>
        </div>}
      </section>
    </main>
  </>;
}
