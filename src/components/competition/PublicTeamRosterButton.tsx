"use client";

import { useId, useRef } from "react";
import type { PublicRosterPlayer } from "@/services/public-team-roster.service";

export function PublicTeamRosterTable({ players }: { players: PublicRosterPlayer[] }) {
  return <div className="overflow-x-auto rounded-2xl border border-zinc-200">
    <table className="w-full border-collapse text-sm">
      <thead><tr className="bg-zinc-950 text-left text-xs font-black text-white">
        <th scope="col" className="px-3 py-3">A/A</th>
        <th scope="col" className="px-3 py-3">Ονοματεπώνυμο</th>
        <th scope="col" className="px-3 py-3 text-center">Νο. Φανέλας</th>
      </tr></thead>
      <tbody>{players.map((player, index) => <tr key={player.id} className="border-t border-zinc-200 text-zinc-900 odd:bg-zinc-50">
        <td className="px-3 py-3 tabular-nums">{index + 1}</td>
        <td className="px-3 py-3 font-bold">{player.displayName}</td>
        <td className="px-3 py-3 text-center font-black tabular-nums">{player.shirtNumber ?? "—"}</td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export default function PublicTeamRosterButton({ teamName, players }: { teamName: string; players: PublicRosterPlayer[] | null }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  return <>
    <button type="button" aria-haspopup="dialog" aria-controls={id} onClick={() => dialog.current?.showModal()} className="mt-4 shrink-0 rounded-full border border-zinc-950 bg-zinc-950 px-5 py-2.5 text-sm font-black text-white shadow-sm hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-600 active:bg-zinc-700 sm:ml-auto sm:mt-0">Ρόστερ</button>
    <dialog ref={dialog} id={id} aria-labelledby={`${id}-title`} className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-3xl border border-zinc-200 bg-white p-5 text-zinc-950 shadow-xl backdrop:bg-black/50 sm:p-7">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Ρόστερ</p><h2 id={`${id}-title`} className="mt-2 text-xl font-black">{teamName}</h2></div>
        <button type="button" autoFocus onClick={() => dialog.current?.close()} className="shrink-0 rounded-full border border-zinc-300 bg-white px-3 py-2 text-sm font-bold hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600">Κλείσιμο</button>
      </div>
      {players === null ? <p role="alert" className="text-sm font-bold text-zinc-600">Το ρόστερ δεν είναι διαθέσιμο αυτή τη στιγμή.</p> : players.length === 0 ? <p className="text-sm font-bold text-zinc-600">Δεν υπάρχουν ενεργοί παίκτες στο επιλεγμένο ρόστερ.</p> : <PublicTeamRosterTable players={players} />}
    </dialog>
  </>;
}
