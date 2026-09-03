"use client";

import { useState } from "react";
import { teams } from "@/data/teams";
import { players } from "@/data/players";
import TeamCard from "./TeamCard";

export default function TeamsGrid({ archiveSeason }: { archiveSeason?: string } = {}) {
  const [selectedSeason, setSelectedSeason] = useState("2025-26");
  const season = archiveSeason ?? selectedSeason;
  const seasonTeams = teams.filter((team) => team.season === season);
  return <section className="bg-zinc-100 py-10"><div className="mx-auto max-w-7xl px-6">
    {!archiveSeason && <div className="mb-8 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"><label className="mb-2 block text-sm font-bold text-zinc-700">Σεζόν</label><select value={season} onChange={(event) => setSelectedSeason(event.target.value)} className="w-48 rounded-xl border border-zinc-300 bg-white px-4 py-3"><option>2025-26</option><option>2024-25</option><option>2023-24</option><option>2022-23</option><option>2021-22</option><option>2020-21</option><option>2019-20</option></select></div>}
    {season === "2020-21" ? <div className="rounded-2xl border border-amber-200 bg-amber-50 p-8 text-center"><h2 className="text-xl font-black text-zinc-900">Η διοργάνωση δεν πραγματοποιήθηκε</h2><p className="mt-2 text-zinc-700">Το πρωτάθλημα της σεζόν 2020-21 δεν διεξήχθη λόγω της πανδημίας COVID-19.</p></div> : <div className="grid gap-8 md:grid-cols-2 xl:grid-cols-4">{seasonTeams.map((team) => <TeamCard key={team.slug} slug={team.slug} team={team.name} season={team.season} players={players.filter((player) => player.teamSlug === team.slug && player.season === team.season).length} logo={team.logo} />)}</div>}
  </div></section>;
}
