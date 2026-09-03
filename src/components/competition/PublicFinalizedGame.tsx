import type { PublicFinalizedGameDetail, PublicFinalizedGameTeam } from "@/lib/public-finalized-game";
import type { PlatformMatchReportStatisticsLine } from "@/lib/platform-match-report";

const STAT_COLUMNS = ["PTS", "2PT", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "F", "EFF"] as const;

function periodLabel(period: PublicFinalizedGameDetail["game"]["periodScores"][number]["period"]) {
  return period.kind === "OVERTIME" ? `OT${period.index}` : `Q${period.index}`;
}

function lineValues(statistics: PlatformMatchReportStatisticsLine) {
  return [
    statistics.points,
    `${statistics.twoPointMade}/${statistics.twoPointAttempts}`,
    `${statistics.threePointMade}/${statistics.threePointAttempts}`,
    `${statistics.freeThrowMade}/${statistics.freeThrowAttempts}`,
    statistics.offensiveRebounds,
    statistics.defensiveRebounds,
    statistics.rebounds,
    statistics.assists,
    statistics.steals,
    statistics.blocks,
    statistics.turnovers,
    statistics.fouls,
    statistics.efficiency,
  ];
}

function TeamStatisticsTable({ side, team }: { side: "HOME" | "AWAY"; team: PublicFinalizedGameTeam }) {
  return <section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
    <div className="flex items-center gap-3">
      {team.logoUrl ? <img src={team.logoUrl} alt="" className="h-12 w-12 rounded-xl border border-zinc-200 object-contain p-1" /> : null}
      <div><p className="text-xs font-black tracking-[0.18em] text-orange-700">{side}</p><h2 className="text-2xl font-black text-zinc-950">{team.name}</h2></div>
    </div>
    <div className="mt-5 overflow-x-auto rounded-2xl border border-zinc-200" tabIndex={0} aria-label={`Στατιστικά ${team.name}`}>
      <table className="w-full min-w-[1120px] border-collapse">
        <thead><tr className="bg-zinc-950 text-xs font-black uppercase tracking-wide text-zinc-300"><th className="sticky left-0 z-20 w-12 bg-zinc-950 px-3 py-3">#</th><th className="sticky left-12 z-20 min-w-56 bg-zinc-950 px-3 py-3 text-left">PLAYER</th>{STAT_COLUMNS.map((column) => <th key={column} className="px-3 py-3">{column}</th>)}</tr></thead>
        <tbody>
          {team.players.map((player, index) => <tr key={`${player.shirtNumber}:${player.displayName}:${index}`} className="border-t border-zinc-200 bg-white text-sm text-zinc-800 odd:bg-zinc-50/70">
            <td className="sticky left-0 z-10 bg-inherit px-3 py-3 text-center font-black text-orange-700">{player.shirtNumber || "—"}</td>
            <td className="sticky left-12 z-10 min-w-56 bg-inherit px-3 py-3 font-black text-zinc-950">{player.displayName}{player.starter ? <span className="ml-2 rounded-full bg-orange-100 px-2 py-0.5 text-[10px] text-orange-800">Β</span> : null}</td>
            {lineValues(player.statistics).map((value, valueIndex) => <td key={STAT_COLUMNS[valueIndex]} className={`px-3 py-3 text-center tabular-nums ${valueIndex === 0 || valueIndex === 12 ? "font-black" : ""}`}>{value}</td>)}
          </tr>)}
          <tr className="border-t-2 border-zinc-950 bg-orange-50 text-sm font-black text-zinc-950"><td className="sticky left-0 z-10 bg-orange-50 px-3 py-3" /><td className="sticky left-12 z-10 bg-orange-50 px-3 py-3">ΣΥΝΟΛΟ</td>{lineValues(team.totals).map((value, index) => <td key={STAT_COLUMNS[index]} className="px-3 py-3 text-center tabular-nums">{value}</td>)}</tr>
        </tbody>
      </table>
    </div>
  </section>;
}

export default function PublicFinalizedGame({ detail }: { detail: PublicFinalizedGameDetail }) {
  const metadata = [detail.game.competition, detail.game.season, detail.game.phase, detail.game.round].filter(Boolean);
  const schedule = [detail.game.scheduledDate, detail.game.scheduledTime, detail.game.venue].filter(Boolean);
  return <div className="space-y-6">
    <section className="overflow-hidden rounded-3xl bg-zinc-950 p-5 text-white shadow-xl sm:p-8">
      <div className="text-center"><span className="inline-flex rounded-full bg-orange-500 px-4 py-1.5 text-xs font-black tracking-[0.2em] text-zinc-950">ΤΕΛΙΚΟ</span><p className="mt-3 text-sm font-bold text-zinc-300">{metadata.join(" · ")}</p>{schedule.length ? <p className="mt-1 text-xs font-semibold text-zinc-400">{schedule.join(" · ")}</p> : null}</div>
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-8">
        <div className="min-w-0 text-center sm:text-right"><p className="break-words text-lg font-black sm:text-3xl">{detail.teams.home.name}</p><span className="mt-1 block text-xs font-black tracking-[0.16em] text-zinc-500">HOME</span></div>
        <div className="rounded-2xl border border-zinc-700 bg-black/30 px-4 py-3 text-center font-mono text-3xl font-black tabular-nums text-orange-400 sm:px-8 sm:text-5xl">{detail.game.finalScore.home} – {detail.game.finalScore.away}</div>
        <div className="min-w-0 text-center sm:text-left"><p className="break-words text-lg font-black sm:text-3xl">{detail.teams.away.name}</p><span className="mt-1 block text-xs font-black tracking-[0.16em] text-zinc-500">AWAY</span></div>
      </div>
      <div className="mt-6 flex flex-wrap justify-center gap-2">{detail.game.periodScores.map((score) => <span key={`${score.period.kind}:${score.period.index}`} className="rounded-full border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm font-black tabular-nums"><b className="text-orange-400">{periodLabel(score.period)}</b> {score.home}–{score.away}</span>)}</div>
    </section>
    <TeamStatisticsTable side="HOME" team={detail.teams.home} />
    <TeamStatisticsTable side="AWAY" team={detail.teams.away} />
  </div>;
}
