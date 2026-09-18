"use client";

import { useState } from "react";
import type { PublicTeamStatistics, PublicTeamStatisticsPlayer } from "@/lib/public-team-statistics";
import type { PlatformMatchReportMode } from "@/lib/platform-match-report";

export function simpleTeamStatisticsSummary(players: PublicTeamStatisticsPlayer[]) {
  return players.reduce((summary, player) => ({
    points: summary.points + player.statistics.points,
    twoPointMade: summary.twoPointMade + player.statistics.twoPointMade,
    threePointMade: summary.threePointMade + player.statistics.threePointMade,
    freeThrowMade: summary.freeThrowMade + player.statistics.freeThrowMade,
    freeThrowAttempts: summary.freeThrowAttempts + player.statistics.freeThrowAttempts,
    fouls: summary.fouls + player.statistics.fouls,
  }), { points: 0, twoPointMade: 0, threePointMade: 0, freeThrowMade: 0, freeThrowAttempts: 0, fouls: 0 });
}

function PlayerRow({ player, total, gameMode }: { player: PublicTeamStatisticsPlayer; total: boolean; gameMode: PlatformMatchReportMode }) {
  const statistics = player.statistics;
  return <tr className="border-t border-zinc-200 bg-white text-sm text-zinc-800 odd:bg-zinc-50/70">
    <td className="sticky left-0 z-10 bg-inherit px-3 py-3 text-center font-black tabular-nums text-orange-700">{player.shirtNumber || "—"}</td>
    <td className="sticky left-12 z-10 min-w-56 bg-inherit px-3 py-3 font-black text-zinc-950">{player.displayName}</td>
    {total ? <td className="px-3 py-3 text-center font-bold tabular-nums">{player.gamesPlayed}</td> : null}
    <td className="px-3 py-3 text-center font-black tabular-nums">{statistics.points}</td>
    <td data-stat="two-point" className="px-3 py-3 text-center tabular-nums">{gameMode === "SIMPLE" ? statistics.twoPointMade : `${statistics.twoPointMade}/${statistics.twoPointAttempts}`}</td>
    <td data-stat="three-point" className="px-3 py-3 text-center tabular-nums">{gameMode === "SIMPLE" ? statistics.threePointMade : `${statistics.threePointMade}/${statistics.threePointAttempts}`}</td>
    <td className="px-3 py-3 text-center tabular-nums">{statistics.freeThrowMade}/{statistics.freeThrowAttempts}</td>
    {gameMode === "FULL" ? <>
      <td className="px-3 py-3 text-center tabular-nums">{statistics.offensiveRebounds}</td>
      <td className="px-3 py-3 text-center tabular-nums">{statistics.defensiveRebounds}</td>
      <td className="px-3 py-3 text-center font-bold tabular-nums">{statistics.rebounds}</td>
      <td className="px-3 py-3 text-center tabular-nums">{statistics.assists}</td>
      <td className="px-3 py-3 text-center tabular-nums">{statistics.steals}</td>
      <td className="px-3 py-3 text-center tabular-nums">{statistics.blocks}</td>
      <td className="px-3 py-3 text-center tabular-nums">{statistics.turnovers}</td>
    </> : null}
    <td className="px-3 py-3 text-center tabular-nums">{statistics.fouls}</td>
    {gameMode === "FULL" ? <td className="px-3 py-3 text-center font-black tabular-nums">{statistics.efficiency}</td> : null}
  </tr>;
}

export default function PublicTeamStatisticsPanel({ statistics, gameMode }: { statistics: PublicTeamStatistics; gameMode: PlatformMatchReportMode }) {
  const [selection, setSelection] = useState("TOTAL");
  const selectedGame = statistics.games.find((game) => game.gameId === selection) ?? null;
  const total = selectedGame === null;
  const players = selectedGame?.players ?? statistics.total.players;
  const empty = total && statistics.total.teamGamesPlayed === 0;
  const simpleSummary = simpleTeamStatisticsSummary(players);
  return <section data-recording-mode={gameMode} className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="team-statistics-title">
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
    {gameMode === "SIMPLE" && !empty ? <div aria-label="Σύνοψη SIMPLE στατιστικών" className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
      {[
        ["Πόντοι", simpleSummary.points],
        ["2PT", simpleSummary.twoPointMade],
        ["3PT", simpleSummary.threePointMade],
        ["Βολές", `${simpleSummary.freeThrowMade}/${simpleSummary.freeThrowAttempts}`],
        ["Φάουλ", simpleSummary.fouls],
      ].map(([label, value]) => <div key={label} className="rounded-xl border border-orange-100 bg-orange-50 px-3 py-2 text-center"><p className="text-[0.68rem] font-black uppercase tracking-wide text-orange-700">{label}</p><p className="mt-1 text-lg font-black tabular-nums text-zinc-950">{value}</p></div>)}
    </div> : null}
    {empty ? <p className="mt-5 rounded-2xl bg-zinc-50 p-4 text-sm font-bold text-zinc-600">Δεν υπάρχουν διαθέσιμα στατιστικά αγώνων.</p> : <div className="mt-5 overflow-x-auto rounded-2xl border border-zinc-200" tabIndex={0} aria-label="Πίνακας στατιστικών παικτών">
      <table className={`${gameMode === "SIMPLE" ? "min-w-[640px]" : "min-w-[1120px]"} w-full border-collapse`}>
        <thead><tr className="bg-zinc-950 text-xs font-black uppercase tracking-wide text-zinc-300">
          <th className="sticky left-0 z-20 w-12 bg-zinc-950 px-3 py-3">#</th><th className="sticky left-12 z-20 min-w-56 bg-zinc-950 px-3 py-3 text-left">PLAYER</th>
          {total ? <th className="px-3 py-3">ΑΓ.</th> : null}
          {(gameMode === "SIMPLE" ? ["PTS", "2PT", "3PT", "FT", "PF"] : ["PTS", "2PT", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "F", "EFF"]).map((column) => <th key={column} className="px-3 py-3">{column}</th>)}
        </tr></thead>
        <tbody>{players.map((player) => <PlayerRow key={player.canonicalPlayerId} player={player} total={total} gameMode={gameMode} />)}</tbody>
      </table>
    </div>}
  </section>;
}
