"use client";

import { useState } from "react";
import games2024 from "@/data/games-2024-25.json";
import games2025 from "@/data/games-2025-26.json";
import { cupGames, playoffGames, playoffSeries } from "@/data/postseason-2024-25";
import { finalFour2025, playoffSeries2025, stratosMylonasCup2025 } from "@/data/postseason-2025-26";

type CardGame = { id?: string; homeTeam: string; awayTeam: string; homeScore?: number; awayScore?: number; venue?: string; date?: string; time?: string; label?: string; note?: string; status?: string };
function GameCard({ game }: { game: CardGame }) { return <article className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm">{game.label && <p className="mb-4 text-xs font-bold uppercase tracking-wide text-orange-600">{game.label}</p>}<div className="grid grid-cols-[1fr_auto] gap-x-5 gap-y-3 text-lg font-bold"><span>{game.homeTeam}</span><strong className="text-2xl text-orange-600">{game.status === "unplayed" ? "—" : game.homeScore ?? "—"}</strong><span>{game.awayTeam}</span><strong className="text-2xl">{game.status === "unplayed" ? "—" : game.awayScore ?? "—"}</strong></div>{game.note && <p className="mt-4 text-sm text-zinc-600">{game.note}</p>}{(game.date || game.time || game.venue) && <p className="mt-5 border-t border-zinc-100 pt-4 text-sm text-zinc-500">{game.date ? new Intl.DateTimeFormat("el-GR",{dateStyle:"long"}).format(new Date(`${game.date}T12:00:00`)) : ""}{game.time ? ` · ${game.time}` : ""}{game.venue ? ` · ${game.venue}` : ""}</p>}</article>; }

export default function ScheduleGrid() {
  const [season, setSeason] = useState("2025-26"); const [competition, setCompetition] = useState("league"); const [phase, setPhase] = useState("1");
  const regular = season === "2025-26" ? games2025 : games2024;
  const cupName = season === "2025-26" ? "Κύπελλο Στράτος Μυλωνάς" : "KomoCup";
  const cup = season === "2025-26" ? stratosMylonasCup2025 : cupGames;
  const cupStages = ["Φάση των 16", "Φάση των 8", "Final4 Κυπέλλου", "Τελικός"];
  const cupStageSource = season === "2024-25"
    ? { "Φάση των 16": "Φάση των 16", "Φάση των 8": "Προημιτελικά", "Final4 Κυπέλλου": "Ημιτελικά", "Τελικός": "Τελικός" }[phase]
    : phase;
  const series = season === "2025-26" ? playoffSeries2025 : playoffSeries;
  const finalFour = season === "2025-26" ? finalFour2025 : playoffGames.filter((game)=>game.stage.startsWith("Final Four"));
  const leaguePhase = Number(phase) <= 15 ? "regular" : phase;
  const selectedGames = competition === "league" && leaguePhase === "regular" ? regular.filter((game)=>game.round===Number(phase)) : competition === "cup" ? cup.filter((game)=>game.stage===cupStageSource) : [];
  const selectedSeries = competition === "league" ? series.filter((item)=>item.stage===phase) : [];
  function changeSeason(value:string){setSeason(value); setCompetition("league"); setPhase("1");}
  function changeCompetition(value:string){setCompetition(value); setPhase(value === "league" ? "1" : cupStages[0]);}
  return <section className="bg-zinc-100 pb-16 pt-8"><div className="mx-auto max-w-7xl px-6">
    <div className="mb-8 flex flex-wrap gap-6 rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"><div><label className="mb-2 block text-sm font-bold">Σεζόν</label><select value={season} onChange={(e)=>changeSeason(e.target.value)} className="w-44 rounded-xl border border-zinc-300 px-4 py-3"><option>2025-26</option><option>2024-25</option></select></div><div><label className="mb-2 block text-sm font-bold">Διοργάνωση</label><select value={competition} onChange={(e)=>changeCompetition(e.target.value)} className="w-64 rounded-xl border border-zinc-300 px-4 py-3"><option value="league">KomoBasket League</option><option value="cup">{cupName}</option></select></div><div><label className="mb-2 block text-sm font-bold">Φάση</label><select value={phase} onChange={(e)=>setPhase(e.target.value)} className="w-64 rounded-xl border border-zinc-300 px-4 py-3">{competition === "league" ? <>{Array.from({length:15},(_,i)=>i+1).map((round)=><option key={round} value={round}>{round}η Αγωνιστική</option>)}<option>Play out 5-12</option><option>Φάση των 8</option><option>Final4 KomoBasket</option></> : cupStages.map((stage)=><option key={stage}>{stage}</option>)}</select></div></div>
    {season === "2025-26" && competition === "cup" && <div className="mb-7 rounded-2xl bg-orange-600 p-6 text-white"><h2 className="text-2xl font-black">Κύπελλο Στράτος Μυλωνάς</h2><p className="mt-2 text-orange-100">Η διοργάνωση φέρει τιμητικά το όνομα του Στράτου Μυλωνά, αθλητή και φίλου του αθλητισμού.</p></div>}
    <p className="mb-2 text-sm font-bold uppercase tracking-[.18em] text-orange-600">{competition === "league" ? "KomoBasket League" : cupName} · {season}</p><h2 className="mb-7 text-3xl font-black">{competition === "league" && leaguePhase === "regular" ? `${phase}η Αγωνιστική` : phase}</h2>
    {selectedGames.length > 0 && <div className="grid gap-5 md:grid-cols-2">{selectedGames.map((game)=><GameCard key={game.id} game={game}/>)}</div>}
    {selectedSeries.length > 0 && <div className="space-y-8">{selectedSeries.map((item)=><section key={item.id}><div className="mb-3 flex flex-wrap justify-between gap-2"><h3 className="text-xl font-black">{item.teamA} – {item.teamB}</h3><span className="rounded-full bg-green-100 px-3 py-1 text-sm font-bold text-green-700">Πρόκριση: {item.winner}</span></div><div className="grid gap-5 md:grid-cols-2">{item.games.map((game,index)=><GameCard key={`${item.id}-${index}`} game={game}/>)}</div></section>)}</div>}
    {competition === "league" && phase === "Final4 KomoBasket" && <div className="grid gap-5 md:grid-cols-2">{finalFour.map((game)=><GameCard key={game.id} game={{...game,label:game.stage.replace("Final Four · ","")}}/>)}</div>}
  </div></section>;
}
