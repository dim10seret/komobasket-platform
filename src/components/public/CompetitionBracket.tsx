"use client";

import { useEffect, useRef, useState } from "react";

import type { CompetitionBracketProjection, PublicBracketMatchup, PublicBracketParticipant, PublicBracketStage } from "@/services/public-competition.service";

function nodeId(phaseId: string, matchupId: string) {
  return `${phaseId}:${matchupId}`;
}

function ParticipantRow({ participant, winnerTeamId, showWinner = true }: { participant: PublicBracketParticipant; winnerTeamId: string | null; showWinner?: boolean }) {
  const winner = participant.team?.id === winnerTeamId;
  const seed = participant.originLabel?.startsWith("#") ? participant.originLabel : null;
  return <div data-bracket-slot={participant.slot} className={`flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 ${showWinner && winner ? "bg-orange-50 text-zinc-950" : "text-zinc-700"}`}>
    {seed && <span className="shrink-0 text-xs font-black text-orange-700">{seed}</span>}
    {participant.team?.logoUrl ? <img src={participant.team.logoUrl} alt="" className="h-7 w-7 shrink-0 rounded-full border border-zinc-200 bg-white object-contain p-0.5" /> : <span className="h-7 w-7 shrink-0 rounded-full bg-zinc-100" />}
    <span className={`min-w-0 flex-1 truncate text-sm ${showWinner && winner ? "font-black" : "font-bold"}`}>{participant.team?.name ?? "Σε αναμονή ομάδας"}</span>
    {showWinner && winner && <span className="text-sm font-black text-orange-700">✓</span>}
  </div>;
}

function MatchupCard({ stage, matchup }: { stage: PublicBracketStage; matchup: PublicBracketMatchup }) {
  return <article data-bracket-node={nodeId(stage.phaseId, matchup.matchupId)} className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm">
    <div className="space-y-1">{matchup.participants.map((participant) => <ParticipantRow key={participant.slot} participant={participant} winnerTeamId={matchup.winnerTeamId} />)}</div>
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2 text-xs font-black uppercase tracking-wide">
      {matchup.directAdvancement ? <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-emerald-800">Πρόκριση χωρίς αγώνα</span> : matchup.seriesScore ? <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-white">Σειρά {matchup.seriesScore.winsA}–{matchup.seriesScore.winsB}</span> : <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-zinc-600">Σειρά</span>}
    </div>
  </article>;
}

function Stage({ stage, matchups }: { stage: PublicBracketStage; matchups: PublicBracketMatchup[] }) {
  return <section className="min-w-[15rem] flex-1">
    <div className="mb-3 rounded-xl bg-zinc-950 px-3 py-2 text-center text-xs font-black uppercase tracking-[0.14em] text-white">{stage.label}</div>
    <div className="space-y-4">{matchups.map((matchup) => <MatchupCard key={matchup.matchupId} stage={stage} matchup={matchup} />)}</div>
  </section>;
}

export default function CompetitionBracket({ projection }: { projection: CompetitionBracketProjection }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Array<{ id: string; d: string }>>([]);
  const [mobileStage, setMobileStage] = useState(0);

  useEffect(() => {
    const updateLines = () => {
      const root = rootRef.current;
      if (!root) return;
      const rootRect = root.getBoundingClientRect();
      const nodes = new Map(Array.from(root.querySelectorAll<HTMLElement>("[data-bracket-node]")).map((element) => [element.dataset.bracketNode ?? "", element]));
      setLines(projection.edges.flatMap((edge) => {
        const from = nodes.get(nodeId(edge.from.phaseId, edge.from.matchupId));
        const to = root.querySelector<HTMLElement>(`[data-bracket-node="${nodeId(edge.to.phaseId, edge.to.matchupId)}"] [data-bracket-slot="${edge.to.slot}"]`) ?? nodes.get(nodeId(edge.to.phaseId, edge.to.matchupId));
        if (!from || !to) return [];
        const fromRect = from.getBoundingClientRect();
        const toRect = to.getBoundingClientRect();
        const x1 = fromRect.right - rootRect.left;
        const y1 = fromRect.top - rootRect.top + fromRect.height / 2;
        const x2 = toRect.left - rootRect.left;
        const y2 = toRect.top - rootRect.top + toRect.height / 2;
        const bend = Math.max(20, (x2 - x1) / 2);
        return [{ id: edge.id, d: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}` }];
      }));
    };
    updateLines();
    const observer = new ResizeObserver(updateLines);
    if (rootRef.current) observer.observe(rootRef.current);
    window.addEventListener("resize", updateLines);
    return () => { observer.disconnect(); window.removeEventListener("resize", updateLines); };
  }, [projection]);

  const visibleStages = projection.stages.filter((item) => item.kind !== "standings_origin");
  const stage = visibleStages[mobileStage] ?? visibleStages[0];
  return <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
    <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Διαδρομή πρόκρισης</p>
    <h2 className="mt-2 text-2xl font-black text-zinc-950">Απεικόνιση Διασταυρώσεων</h2>
    <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">Οι διασυνδέσεις προέρχονται από τις επίσημες πηγές συμμετοχής και τις οριστικές αγωνιστικές εξελίξεις.</p>
    <div className="mt-6 lg:hidden">
      {stage && <Stage stage={stage} matchups={stage.matchups} />}
      {visibleStages.length > 1 && <nav className="mt-5 flex items-center justify-between gap-3"><button type="button" onClick={() => setMobileStage((value) => Math.max(0, value - 1))} disabled={mobileStage === 0} className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40">Προηγούμενο στάδιο</button><span className="text-xs font-black text-zinc-500">{mobileStage + 1} / {visibleStages.length}</span><button type="button" onClick={() => setMobileStage((value) => Math.min(visibleStages.length - 1, value + 1))} disabled={mobileStage === visibleStages.length - 1} className="rounded-xl border border-zinc-300 px-3 py-2 text-sm font-black disabled:cursor-not-allowed disabled:opacity-40">Επόμενο στάδιο</button></nav>}
    </div>
    <div ref={rootRef} className="relative mt-6 hidden overflow-x-auto pb-2 lg:block">
      <svg aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none">{lines.map((line) => <path key={line.id} d={line.d} fill="none" stroke="#f97316" strokeWidth="2" strokeLinecap="round" />)}</svg>
      <div className="relative grid min-w-[32rem] grid-flow-col auto-cols-[minmax(15rem,1fr)] gap-10 px-2 py-1">{visibleStages.map((item) => <Stage key={item.phaseId} stage={item} matchups={item.matchups} />)}</div>
    </div>
  </section>;
}
