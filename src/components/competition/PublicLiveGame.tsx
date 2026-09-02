"use client";

import { useEffect, useRef, useState } from "react";
import type { PublicLiveGame, PublicLivePlayByPlayItem, PublicLiveTeam, PublicTeamSide } from "@/services/public-live-game-core";

export function formatPublicClock(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(safe / 60)).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

export function interpolatedPublicClock(clock: PublicLiveGame["clock"], nowMs: number): number {
  return Math.max(0, clock.remainingSeconds - (clock.running ? Math.floor(Math.max(0, nowMs - clock.asOfMs) / 1000) : 0));
}

export function publicLivePollDelay(hidden: boolean): number {
  return hidden ? 10_000 : 2_000;
}

export function mergePolledPublicGame(current: PublicLiveGame, incoming: PublicLiveGame): PublicLiveGame {
  return current.revision === incoming.revision && current.status === incoming.status ? current : incoming;
}

function periodLabel(period: PublicLiveGame["period"]): string {
  return period.kind === "REGULATION" ? `Q${period.index}` : `OT${period.index}`;
}

function PlayerFouls({ total }: { total: number }) {
  return <span className="flex shrink-0 gap-1" aria-label={`${total} φάουλ`}>{Array.from({ length: 5 }, (_, index) => <i key={index} className={`h-2.5 w-2.5 rounded-full border ${total > index ? index === 4 ? "border-red-500 bg-red-500" : "border-amber-400 bg-amber-400" : "border-slate-500"}`} />)}</span>;
}

export function PublicLiveLineup({ team }: { team: PublicLiveTeam }) {
  return <section className="rounded-2xl border border-slate-700 bg-slate-950/80 p-3 sm:p-4" style={team.gameColor ? { borderColor: team.gameColor } : undefined}>
    <header className="mb-3 flex items-center gap-3 border-b border-slate-800 pb-3"><span className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">{team.side} · Στο παρκέ</span></header>
    <div className="space-y-2">{team.activeFive.map((player) => <div key={player.key} className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 px-3 py-3"><strong className="text-xl tabular-nums text-white">#{player.shirtNumber}</strong><span className="min-w-0 break-words text-sm font-bold text-slate-100">{player.displayName}</span><PlayerFouls total={player.fouls.total} /></div>)}</div>
  </section>;
}

export function PublicLivePlayByPlay({ items }: { items: PublicLivePlayByPlayItem[] }) {
  return <section className="min-h-80 rounded-2xl border border-slate-700 bg-slate-950/80 p-3 sm:p-4"><header className="mb-3 flex items-center justify-between border-b border-slate-800 pb-3"><h2 className="text-sm font-black uppercase tracking-[0.18em] text-cyan-400">Live εξέλιξη</h2><span className="text-xs text-slate-500">Τελευταίες φάσεις</span></header><div className="max-h-[42rem] space-y-2 overflow-y-auto pr-1" aria-live="polite">{items.length ? items.map((item) => <article key={`${item.sequence}-${item.type}`} className="grid grid-cols-[3.3rem_minmax(0,1fr)_2.5rem] items-center gap-2 rounded-xl border border-slate-800 bg-slate-900/90 px-3 py-2.5"><time className="font-mono text-xs font-bold tabular-nums text-amber-400">{formatPublicClock(item.clockSeconds)}</time><strong className="min-w-0 break-words text-sm text-slate-100">{item.label}</strong><span className="text-right text-[0.65rem] font-black text-slate-500">{periodLabel(item.period)}</span></article>) : <p className="rounded-xl bg-slate-900 p-5 text-center text-sm text-slate-400">Δεν υπάρχουν ακόμη αγωνιστικά γεγονότα.</p>}</div></section>;
}

function TeamStatus({ team }: { team: PublicLiveTeam }) {
  return <div className="mt-3 grid gap-2 text-sm font-bold text-slate-300 sm:grid-cols-2"><span>T.O. <strong className="text-white">{team.timeouts}/{team.timeoutAllowance}</strong></span><span>F <strong className="text-white">{team.teamFouls}</strong>{team.inBonus ? <b className="ml-2 text-amber-400">BONUS</b> : null}</span></div>;
}

export function PublicLiveScoreboard({ game, onTeam }: { game: PublicLiveGame; onTeam?: (side: PublicTeamSide) => void }) {
  const [nowMs, setNowMs] = useState(game.clock.asOfMs);
  useEffect(() => {
    setNowMs(Date.now());
    if (!game.clock.running || game.status !== "live") return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [game.clock, game.status]);
  const clock = interpolatedPublicClock(game.clock, nowMs);
  const teamPanel = (team: PublicLiveTeam) => <button type="button" onClick={() => onTeam?.(team.side)} className="min-w-0 rounded-2xl border bg-slate-950/90 p-4 text-left transition hover:bg-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 sm:p-5" style={team.gameColor ? { borderColor: team.gameColor } : undefined}><small className="font-black tracking-[0.2em] text-slate-400">{team.side}</small><div className="mt-2 flex items-center justify-between gap-3"><strong className="min-w-0 break-words text-lg text-white sm:text-2xl">{team.teamName}</strong><b className="shrink-0 text-4xl tabular-nums text-white sm:text-6xl">{team.score}</b></div><TeamStatus team={team} /></button>;
  return <section className="grid grid-cols-2 gap-2 rounded-3xl border border-slate-700 bg-slate-900/80 p-2 shadow-2xl lg:grid-cols-[1fr_0.72fr_1fr] lg:gap-3 lg:p-3">
    <div className="order-2 lg:order-1">{teamPanel(game.home)}</div>
    <div className="order-1 col-span-2 flex min-h-36 flex-col items-center justify-center rounded-2xl border border-slate-600 bg-[#06131d] px-4 py-3 text-center lg:order-2 lg:col-span-1"><span className={`rounded-full px-3 py-1 text-xs font-black tracking-[0.2em] ${game.status === "live" ? "bg-emerald-500 text-emerald-950" : "bg-slate-200 text-slate-900"}`}>{game.status === "live" ? "LIVE" : "ΟΛΟΚΛΗΡΩΜΕΝΟΣ"}</span><strong className="mt-2 text-lg tracking-[0.16em] text-cyan-300">{periodLabel(game.period)}</strong><time className="font-mono text-5xl font-black leading-none tracking-wider text-amber-400 tabular-nums sm:text-6xl">{formatPublicClock(clock)}</time><span className="mt-2 text-xs font-bold text-slate-400">ΚΑΤΟΧΗ · {game.possession ? (game.possession === "HOME" ? game.home.teamName : game.away.teamName) : "—"}</span></div>
    <div className="order-3">{teamPanel(game.away)}</div>
  </section>;
}

function statusText(player: PublicLiveTeam["players"][number]): string {
  return player.onCourt ? "Στο παρκέ" : player.fouls.status === "ELIGIBLE" ? "Πάγκος" : player.fouls.status;
}

export function PublicLiveStatusPanel({ team, onClose }: { team: PublicLiveTeam; onClose?: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-2 sm:p-6" role="presentation"><section role="dialog" aria-modal="true" aria-label={`Στατιστικά ${team.teamName}`} className="flex max-h-[94vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-600 bg-slate-950 text-white shadow-2xl" style={team.gameColor ? { borderColor: team.gameColor } : undefined}><header className="flex items-center justify-between gap-4 border-b border-slate-800 p-4"><div><small className="font-black tracking-[0.2em] text-cyan-400">{team.side} · STATUS</small><h2 className="mt-1 text-xl font-black sm:text-3xl">{team.teamName}</h2></div><button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-600 px-4 font-bold hover:bg-slate-800">Κλείσιμο</button></header><div className="overflow-auto"><div className="min-w-[980px]"><div className="grid grid-cols-[3rem_minmax(12rem,1fr)_7rem_repeat(11,4rem)] gap-1 bg-slate-900 px-3 py-3 text-center text-xs font-black text-slate-400"><span>#</span><span className="text-left">Παίκτης</span><span>Κατάσταση</span><span>PTS</span><span>2PTS</span><span>3PTS</span><span>1PTS</span><span>REB</span><span>AST</span><span>STL</span><span>BLK</span><span>TO</span><span>F</span><span>EFF</span></div>{team.players.map((player) => { const statistics = player.statistics; return <div key={player.key} className="grid grid-cols-[3rem_minmax(12rem,1fr)_7rem_repeat(11,4rem)] items-center gap-1 border-t border-slate-800 px-3 py-3 text-center text-sm"><b>{player.shirtNumber}</b><strong className="text-left">{player.displayName}</strong><span className="text-xs text-slate-400">{statusText(player)}</span><span>{statistics.points}</span><span>{statistics.twoPointMade}/{statistics.twoPointAttempts}</span><span>{statistics.threePointMade}/{statistics.threePointAttempts}</span><span>{statistics.freeThrowMade}/{statistics.freeThrowAttempts}</span><span>{statistics.rebounds}</span><span>{statistics.assists}</span><span>{statistics.steals}</span><span>{statistics.blocks}</span><span>{statistics.turnovers}</span><span>{player.fouls.total}</span><span>{statistics.efficiency}</span></div>; })}</div></div></section></div>;
}

export default function PublicLiveGameView({ initialGame }: { initialGame: PublicLiveGame }) {
  const [game, setGame] = useState(initialGame);
  const [statusSide, setStatusSide] = useState<PublicTeamSide | null>(null);
  const etag = useRef<string | null>(null);
  useEffect(() => {
    if (game.status !== "live") return;
    let cancelled = false;
    let timer: number | null = null;
    const schedule = () => { if (!cancelled) timer = window.setTimeout(refresh, publicLivePollDelay(document.hidden)); };
    const refresh = async () => {
      try {
        const response = await fetch(`/api/public/v1/games/${encodeURIComponent(game.gameId)}/live`, { headers: etag.current ? { "If-None-Match": etag.current } : undefined, cache: "no-cache" });
        if (response.status !== 304 && response.ok) {
          const payload = await response.json() as { data?: PublicLiveGame };
          if (payload.data) {
            etag.current = response.headers.get("etag");
            if (!cancelled) setGame((current) => mergePolledPublicGame(current, payload.data!));
          }
        }
      } catch { /* retain the last authoritative public snapshot */ }
      schedule();
    };
    const visibility = () => { if (timer !== null) window.clearTimeout(timer); schedule(); };
    document.addEventListener("visibilitychange", visibility);
    schedule();
    return () => { cancelled = true; if (timer !== null) window.clearTimeout(timer); document.removeEventListener("visibilitychange", visibility); };
  }, [game.gameId, game.status]);
  const selectedTeam = statusSide === "HOME" ? game.home : statusSide === "AWAY" ? game.away : null;
  return <div className="space-y-3"><PublicLiveScoreboard game={game} onTeam={setStatusSide} /><div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(22rem,1.4fr)_minmax(15rem,0.8fr)]"><div className="order-1"><PublicLiveLineup team={game.home} /></div><div className="order-3 lg:order-2"><PublicLivePlayByPlay items={game.playByPlay} /></div><div className="order-2 lg:order-3"><PublicLiveLineup team={game.away} /></div></div>{selectedTeam ? <PublicLiveStatusPanel team={selectedTeam} onClose={() => setStatusSide(null)} /> : null}</div>;
}
