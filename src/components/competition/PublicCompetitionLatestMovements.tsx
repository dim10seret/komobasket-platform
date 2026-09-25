"use client";

import { useState } from "react";

import { formatPublicDate } from "@/lib/public-date";
import type { PublicCompetitionMovement } from "@/services/public-competition.service";

const movementLabels: Record<PublicCompetitionMovement["movementType"], string> = {
  addition: "ΠΡΟΣΘΗΚΗ",
  departure: "ΑΠΟΧΩΡΗΣΗ",
  transfer: "ΜΕΤΑΓΡΑΦΗ",
};

export default function PublicCompetitionLatestMovements({
  seasonName,
  competitionName,
  movements,
}: {
  seasonName: string;
  competitionName: string;
  movements: PublicCompetitionMovement[];
}) {
  const [open, setOpen] = useState(false);

  return <>
    <div className="flex items-end">
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-orange-300 bg-orange-50 px-4 py-2 text-sm font-black text-orange-900 transition hover:bg-orange-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 lg:w-auto"
      >
        Μεταγραφές - Προσθήκες
      </button>
    </div>
    {open && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
        <section role="dialog" aria-modal="true" aria-labelledby="public-latest-movements-title" className="flex max-h-[calc(100vh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-2xl">
          <header className="flex items-start justify-between gap-4 border-b border-zinc-200 p-5 sm:p-6">
            <div>
              <h2 id="public-latest-movements-title" className="text-2xl font-black text-zinc-950">Τελευταίες Κινήσεις</h2>
              <p className="mt-1 text-sm font-bold text-zinc-600">{seasonName} · {competitionName}</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} className="rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-700 transition hover:border-zinc-950">Κλείσιμο</button>
          </header>
          <div className="overflow-y-auto p-5 sm:p-6">
            {movements.length ? (
              <div className="space-y-3">
                {movements.map((movement) => (
                  <article key={movement.id} className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-black tracking-[0.14em] text-orange-700">{movementLabels[movement.movementType]}</p>
                        <h3 className="mt-1 text-base font-black text-zinc-950 sm:text-lg">{movement.playerName}</h3>
                      </div>
                      <time className="text-sm font-black tabular-nums text-zinc-700">{formatPublicDate(movement.effectiveOn)}</time>
                    </div>
                    <p className="mt-3 text-sm font-bold text-zinc-700">
                      {movement.fromTeamName ?? "—"} <span aria-hidden="true" className="px-1 text-orange-700">→</span> {movement.toTeamName ?? "—"}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="rounded-2xl bg-zinc-50 p-4 text-sm font-bold text-zinc-600">Δεν υπάρχουν καταγεγραμμένες κινήσεις για αυτή τη διοργάνωση.</p>
            )}
          </div>
        </section>
      </div>
    )}
  </>;
}
