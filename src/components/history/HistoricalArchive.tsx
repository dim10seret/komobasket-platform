"use client";

import { useState } from "react";

import ResultsGrid from "@/components/results/ResultsGrid";
import ScheduleGrid from "@/components/schedule/ScheduleGrid";
import StandingsTable from "@/components/standings/StandingsTable";
import TeamsGrid from "@/components/teams/TeamsGrid";
import {
  HISTORICAL_ARCHIVE_SEASONS,
  HISTORICAL_ARCHIVE_SECTIONS,
  historicalSectionHasData,
  type HistoricalArchiveSection,
} from "@/lib/historical-archive";

function ArchiveContent({ section, season }: { section: HistoricalArchiveSection; season: string }) {
  if (!historicalSectionHasData(section, season)) return <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 font-bold text-zinc-700">Δεν υπάρχουν διαθέσιμα δεδομένα {HISTORICAL_ARCHIVE_SECTIONS.find((item) => item.id === section)?.label.toLocaleLowerCase("el-GR")} για τη σεζόν {season}.</div>;
  if (section === "schedule") return <ScheduleGrid archiveSeason={season} />;
  if (section === "results") return <ResultsGrid archiveSeason={season} />;
  if (section === "standings") return <StandingsTable archiveSeason={season} />;
  return <TeamsGrid archiveSeason={season} />;
}

export default function HistoricalArchive() {
  const [season, setSeason] = useState(HISTORICAL_ARCHIVE_SEASONS[0]);
  const [section, setSection] = useState<HistoricalArchiveSection>("schedule");
  return <div className="mt-8">
    <div className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <label className="block max-w-xs"><span className="mb-2 block text-xs font-black uppercase tracking-[0.16em] text-zinc-600">Σεζόν</span><select value={season} onChange={(event) => setSeason(event.target.value)} className="min-h-11 w-full rounded-xl border border-zinc-300 bg-white px-4 py-2.5 text-base font-black text-zinc-950">{HISTORICAL_ARCHIVE_SEASONS.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <nav className="mt-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" aria-label="Ενότητες ιστορικού">{HISTORICAL_ARCHIVE_SECTIONS.map((item) => <button key={item.id} type="button" aria-pressed={section === item.id} onClick={() => setSection(item.id)} className={`min-h-11 rounded-xl border px-4 py-2.5 text-sm font-black transition ${section === item.id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-300 bg-white text-zinc-700 hover:border-orange-500 hover:text-orange-700"}`}>{item.label}</button>)}</nav>
    </div>
    <section className="mt-6" aria-live="polite" aria-label={`${HISTORICAL_ARCHIVE_SECTIONS.find((item) => item.id === section)?.label} ${season}`}><ArchiveContent section={section} season={season} /></section>
  </div>;
}
