"use client";

import { useState } from "react";
import type { PublicTeamStatistics, PublicTeamStatisticsPlayer } from "@/lib/public-team-statistics";

function PlayerRow({ player, total }: { player: PublicTeamStatisticsPlayer; total: boolean }) {
  const statistics = player.statistics;
  return <tr className="border-t border-zinc-200 bg-white text-sm text-zinc-800 odd:bg-zinc-50/70">
    <td className="sticky left-0 z-10 bg-inherit px-3 py-3 text-center font-black tabular-nums text-orange-700">{player.shirtNumber || "—"}</td>
    <td className="sticky left-12 z-10 min-w-56 bg-inherit px-3 py-3 font-black text-zinc-950">{player.displayName}</td>
    {total ? <td className="px-3 py-3 text-center font-bold tabular-nums">{player.gamesPlayed}</td> : null}
    <td className="px-3 py-3 text-center font-black tabular-nums">{statistics.points}</td>
    <td className="px-3 py-3 text-center tabular-nums">{statistics.twoPointMade}/{statistics.twoPointAttempts}</td>
    <td className="px-3 py-3 text-center tabular-nums">{statistics.threePointMade}/{statistics.threePointAttempts}</td>
    <td className="px-3 py-3 text-center tabular-nums">{statistics.freeThrowMade}/{statistics.freeThrowAttempts}</td>
    <td className="px-3 py-3 text-center tabular-nums">{statistics.offensiveRebounds}</td>
    <td className="px-3 py-3 text-center tabular-nums">{statistics.defensiveRebounds}</td>
    <td className="px-3 py-3 text-center font-bold tabular-nums">{statistics.rebounds}</td>
    <td className="px-3 py-3 text-center tabular-nums">{statistics.assists}</td>
    <td className="px-3 py-3 text-center tabular-nums">{statistics.steals}</td>
    <td className="px-3 py-3 text-center tabular-nums">{statistics.blocks}</td>
    <td className="px-3 py-3 text-center tabular-nums">{statistics.turnovers}</td>
    <td className="px-3 py-3 text-center tabular-nums">{statistics.fouls}</td>
    <td className="px-3 py-3 text-center font-black tabular-nums">{statistics.efficiency}</td>
  </tr>;
}

export default function PublicTeamStatisticsPanel({ statistics }: { statistics: PublicTeamStatistics }) {
  const [selection, setSelection] = useState("TOTAL");
  const selectedGame = statistics.games.find((game) => game.gameId === selection) ?? null;
  const total = selectedGame === null;
  const players = selectedGame?.players ?? statistics.total.players;
  const empty = total && statistics.total.teamGamesPlayed === 0;
  return <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="team-statistics-title">
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">ΡΟΣΤΕΡ - ΑΓΩΝΙΣΤΙΚΑ ΔΕΔΟΜΕΝΑ</p>
        <h2 id="team-statistics-title" className="mt-2 text-2xl font-black text-zinc-950">{total ? "ΣΥΝΟΛΙΚΑ ΣΤΑΤΙΣΤΙΚΑ" : "ΣΤΑΤΙΣΤΙΚΑ ΑΓΩΝΑ"}</h2>
        {total ? <p className="mt-2 text-sm font-bold text-zinc-600">Αγώνες ομάδας: <strong className="text-zinc-950">{statistics.total.teamGamesPlayed}</strong></p> : <p className="mt-2 text-sm font-bold text-zinc-700">{selectedGame?.scheduledDate ?? "—"} · {selectedGame?.matchupLabel}</p>}
      </div>
      <label className="w-full sm:w-auto">
        <span className="mb-1.5 block text-xs font-black uppercase tracking-wide text-zinc-600">Προβολή στατιστικών</span>
        <select value={selection} onChange={(event) => setSelection(event.target.value)} className="min-h-11 w-full rounded-xl border border-zinc-300 bg-white px-3 py-2 text-sm font-black text-zinc-900 shadow-sm sm:min-w-80">
          <option value="TOTAL">TOTAL</option>
          {statistics.games.map((game) => <option key={game.gameId} value={game.gameId}>{game.label}</option>)}
        </select>
      </label>
    </div>
    {empty ? <p className="mt-5 rounded-2xl bg-zinc-50 p-4 text-sm font-bold text-zinc-600">Δεν υπάρχουν διαθέσιμα στατιστικά αγώνων.</p> : <div className="mt-5 overflow-x-auto rounded-2xl border border-zinc-200" tabIndex={0} aria-label="Πίνακας στατιστικών παικτών">
      <table className="min-w-[1120px] w-full border-collapse">
        <thead><tr className="bg-zinc-950 text-xs font-black uppercase tracking-wide text-zinc-300">
          <th className="sticky left-0 z-20 w-12 bg-zinc-950 px-3 py-3">#</th><th className="sticky left-12 z-20 min-w-56 bg-zinc-950 px-3 py-3 text-left">PLAYER</th>
          {total ? <th className="px-3 py-3">ΑΓ.</th> : null}
          {(["PTS", "2PT", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "F", "EFF"] as const).map((column) => <th key={column} className="px-3 py-3">{column}</th>)}
        </tr></thead>
        <tbody>{players.map((player) => <PlayerRow key={player.canonicalPlayerId} player={player} total={total} />)}</tbody>
      </table>
    </div>}
  </section>;
}
