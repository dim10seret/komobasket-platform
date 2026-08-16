"use client";

import { Panel, SimpleTable, Snapshot } from "../shared/admin-core";

export function Overview({ data }: { data: Snapshot }) {
  return <>
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {[["Σεζόν", data.counts.seasons], ["Διοργανώσεις", data.counts.competitions], ["Ομάδες", data.counts.teams], ["Παίκτες", data.counts.players]].map(([label, value]) => (
        <div key={String(label)} className="rounded-2xl bg-zinc-950 p-5 text-white shadow-sm">
          <p className="text-sm text-zinc-400">{label}</p>
          <p className="mt-2 text-4xl font-black text-orange-500">{value}</p>
        </div>
      ))}
    </div>
    <Panel title="Τελευταίες κινήσεις" description="Μεταγραφές, εγγραφές και αποχωρήσεις παραμένουν στο ιστορικό.">
      <SimpleTable
        rows={data.movements.slice(0, 8)}
        columns={[
          ["effective_on", "Ημερομηνία"],
          ["player_name", "Παίκτης"],
          ["movement_type", "Κίνηση"],
          ["from_team_name", "Από"],
          ["to_team_name", "Προς"],
        ]}
      />
    </Panel>
  </>;
}
