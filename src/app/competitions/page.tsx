import Link from "next/link";

import Header from "@/components/layout/Header";
import { getPublicCompetitionContext, type PublicGame, type PublicPhase, type PublicStandingRow } from "@/services/public-competition.service";

type PageProps = { searchParams: Promise<{ season?: string; competition?: string; phase?: string; round?: string; view?: string }> };

function href(season: string, competition?: string, phase?: string, round?: number, all?: boolean) {
  const params = new URLSearchParams({ season });
  if (competition) params.set("competition", competition);
  if (phase) params.set("phase", phase);
  if (round) params.set("round", String(round));
  if (all) params.set("view", "all");
  return `/competitions?${params}`;
}

function summary(phase: PublicPhase) {
  const values = phase.format === "standings"
    ? [phase.participantCount && `${phase.participantCount} ομάδες`, phase.roundCount && `${phase.roundCount} αγωνιστικές`]
    : phase.format === "series"
      ? [phase.participantCount && `${phase.participantCount} ομάδες`, phase.winsRequired && `${phase.winsRequired} νίκες για πρόκριση`]
      : [];
  return values.filter(Boolean).join(" · ") || (phase.format === "series" ? "Σειρά αγώνων" : "Φάση διοργάνωσης");
}

function dateText(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return year && month && day ? new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "long", year: "numeric" }).format(new Date(year, month - 1, day)) : value;
}

function Team({ game, side }: { game: PublicGame; side: "home" | "away" }) {
  const team = side === "home" ? game.homeTeam : game.awayTeam;
  const score = side === "home" ? game.homeScore : game.awayScore;
  const opposite = side === "home" ? game.awayScore : game.homeScore;
  const winner = score !== null && opposite !== null && score > opposite;
  const name = <span className={`min-w-0 text-sm leading-5 sm:text-base ${winner ? "font-black text-zinc-950" : "font-bold text-zinc-700"}`}>{team.name}</span>;
  const logo = team.logoUrl && <img src={team.logoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border border-zinc-200 bg-white object-contain p-1" />;
  return <div className={`flex min-w-0 items-center gap-2.5 ${side === "away" ? "justify-end text-right" : ""}`}>{side === "away" && name}{logo}{side === "home" && name}</div>;
}

function GameCard({ game }: { game: PublicGame }) {
  const hasResult = game.homeScore !== null && game.awayScore !== null;
  const details = [game.scheduledDate && dateText(game.scheduledDate), game.scheduledTime, game.venue].filter(Boolean);
  return <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-5"><div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-5"><Team game={game} side="home" /><div className={`min-w-16 rounded-xl px-3 py-2 text-center text-lg tabular-nums sm:min-w-20 sm:text-xl ${hasResult ? "bg-zinc-950 font-black text-white" : "bg-orange-50 font-bold text-orange-800"}`}>{hasResult ? `${game.homeScore} – ${game.awayScore}` : "vs"}</div><Team game={game} side="away" /></div>{(details.length > 0 || game.videoUrl) && <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 border-t border-zinc-100 pt-3 text-xs font-bold uppercase tracking-wide text-zinc-500">{details.length > 0 && <span>{details.join(" · ")}</span>}{game.videoUrl && <a href={game.videoUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-orange-100 px-3 py-1.5 text-orange-800 hover:bg-orange-200">▶ Βίντεο</a>}</div>}</article>;
}

function zone(rank: number, phase: PublicPhase) {
  if (phase.standingsPresentation.directQualification.includes(rank)) return "border-emerald-200 bg-emerald-50";
  if (phase.standingsPresentation.playOut.includes(rank)) return "border-amber-200 bg-amber-50";
  if (phase.standingsPresentation.eliminated.includes(rank)) return "border-rose-200 bg-rose-50";
  return "border-zinc-200 bg-white";
}

function Standings({ phase, rows }: { phase: PublicPhase; rows: PublicStandingRow[] }) {
  const legends = [[phase.standingsPresentation.directQualification, "Απευθείας πρόκριση", "bg-emerald-500"], [phase.standingsPresentation.playOut, "Play Out", "bg-amber-500"], [phase.standingsPresentation.eliminated, "Εκτός συνέχειας", "bg-rose-500"]] as const;
  const labels = (positions: readonly number[]) => positions.length === 1 ? `Θέση ${positions[0]}` : `Θέσεις ${positions.join("–")}`;
  if (!rows.length) return null;
  return <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7"><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Επίσημη κατάταξη</p><h2 className="mt-2 text-2xl font-black text-zinc-950">Βαθμολογία</h2><div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-zinc-700">{legends.filter(([positions]) => positions.length).map(([positions, text, dot]) => <span key={text} className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5"><i className={`h-2 w-2 rounded-full ${dot}`} />{labels(positions)} — {text}</span>)}</div><div className="mt-5 hidden overflow-x-auto sm:block"><div className="min-w-[620px] overflow-hidden rounded-2xl border border-zinc-200"><div className="grid grid-cols-[2.75rem_minmax(10rem,1fr)_repeat(6,minmax(3.25rem,0.45fr))] bg-zinc-950 px-3 py-3 text-xs font-black uppercase tracking-wide text-zinc-300"><span className="text-center">Θ</span><span>Ομάδα</span><span className="text-center">ΑΓ</span><span className="text-center">Ν</span><span className="text-center">Η</span><span className="text-center">ΥΠ</span><span className="text-center">Δ</span><span className="text-center">Β</span></div>{rows.map((row) => <div key={row.team.id} className={`grid grid-cols-[2.75rem_minmax(10rem,1fr)_repeat(6,minmax(3.25rem,0.45fr))] items-center border-t px-3 py-3 text-sm ${zone(row.rank, phase)}`}><span className="text-center font-black">{row.rank}</span><span className="flex min-w-0 items-center gap-2 font-black text-zinc-950">{row.team.logoUrl && <img src={row.team.logoUrl} alt="" className="h-7 w-7 rounded-full object-contain" />}{row.team.name}</span><span className="text-center">{row.gamesPlayed}</span><span className="text-center">{row.wins}</span><span className="text-center">{row.losses}</span><span className="text-center">{row.pointsFor}–{row.pointsAgainst}</span><span className="text-center">{row.pointDifference > 0 ? `+${row.pointDifference}` : row.pointDifference}</span><span className="text-center font-black">{row.standingsPoints}</span></div>)}</div></div><div className="mt-5 space-y-2 sm:hidden">{rows.map((row) => <article key={row.team.id} className={`rounded-2xl border p-3 ${zone(row.rank, phase)}`}><div className="flex justify-between gap-3"><b>{row.rank}. {row.team.name}</b><b>{row.standingsPoints} β.</b></div><p className="mt-2 text-xs font-bold text-zinc-600">Αγ. {row.gamesPlayed} · Ν {row.wins} · Η {row.losses} · Υπέρ/Κατά {row.pointsFor}–{row.pointsAgainst} · Δ {row.pointDifference > 0 ? `+${row.pointDifference}` : row.pointDifference}</p></article>)}</div></section>;
}

export default async function CompetitionsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  let context: Awaited<ReturnType<typeof getPublicCompetitionContext>> | null = null;
  try { context = await getPublicCompetitionContext({ seasonSlug: query.season, competitionSlug: query.competition, phaseSlug: query.phase }); } catch {}
  const phase = context?.selectedPhase ?? null;
  const seriesRounds = phase?.format === "series" ? [...new Set((context?.seriesHistory ?? []).flatMap((history) => history.rounds.map((round) => round.roundNumber)))].sort((a, b) => a - b) : [];
  const gameRounds = [...new Set((context?.games ?? []).map((game) => game.roundNumber))].sort((a, b) => a - b);
  const rounds = phase?.format === "series" ? seriesRounds : gameRounds;
  const requested = Number.parseInt(query.round ?? "", 10);
  const round = rounds.includes(requested) ? requested : rounds[0] ?? null;
  const all = phase?.format === "series" || (query.view === "all" && rounds.length > 1);
  const visibleRounds = all ? rounds : round === null ? [] : [round];
  const roundLabel = phase?.format === "standings" ? "Αγωνιστική" : "Γύρος";
  const nav = (target: number) => href(context!.selectedSeason!.slug, context!.selectedCompetition!.slug, phase!.slug, target);

  return <><Header /><main className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top,_#fed7aa,_#f4f4f5_42%,_#ffffff_78%)] py-8 sm:py-12"><section className="mx-auto max-w-6xl px-4 sm:px-6"><p className="text-sm font-black uppercase tracking-[0.18em] text-orange-700">KomoBasket League</p><h1 className="mt-2 text-4xl font-black tracking-tight text-zinc-950 sm:text-5xl">Διοργανώσεις</h1><p className="mt-3 max-w-2xl text-base leading-7 text-zinc-600">Επιλέξτε σεζόν, διοργάνωση και φάση για να παρακολουθήσετε την επίσημη αγωνιστική εικόνα.</p>{!context?.selectedSeason ? <div className="mt-8 rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm"><p className="text-lg font-black">Δεν υπάρχει διαθέσιμη διοργάνωση αυτή τη στιγμή.</p></div> : <div className="mt-8 space-y-5"><section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm"><div className="grid gap-5 lg:grid-cols-[0.7fr_1fr_1.5fr]"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Σεζόν</p><div className="mt-2 flex flex-wrap gap-2">{context.seasons.map((season) => <Link key={season.id} href={href(season.slug)} className={`rounded-xl px-3 py-2 text-sm font-black ${season.id === context.selectedSeason?.id ? "bg-zinc-950 text-white" : "bg-zinc-100 text-zinc-700"}`}>{season.name}</Link>)}</div></div><div><p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Διοργάνωση</p><div className="mt-2 flex flex-wrap gap-2">{context.competitions.map((competition) => <Link key={competition.id} href={href(context.selectedSeason!.slug, competition.slug)} className={`rounded-xl border px-3 py-2 text-sm font-black ${competition.id === context.selectedCompetition?.id ? "border-orange-500 bg-orange-50" : "border-zinc-200 text-zinc-700"}`}>{competition.name}</Link>)}</div></div><div><p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Φάση</p><div className="mt-2 flex flex-wrap gap-2">{context.phases.map((item) => <Link key={item.id} href={href(context.selectedSeason!.slug, context.selectedCompetition!.slug, item.slug)} className={`rounded-xl border px-3 py-2 text-sm font-black ${item.id === phase?.id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 text-zinc-700"}`}>{item.name}</Link>)}</div></div></div></section>{phase && <p className="px-1 text-sm font-bold text-zinc-700"><strong className="text-zinc-950">{phase.name}</strong> · {summary(phase)}</p>}{phase?.format === "standings" && <Standings phase={phase} rows={context.standings} />}{phase && <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Επίσημη αγωνιστική εικόνα</p><h2 className="mt-2 text-2xl font-black">Πρόγραμμα &amp; Αποτελέσματα</h2></div>{phase.format !== "series" && rounds.length > 1 && <Link href={href(context.selectedSeason!.slug, context.selectedCompetition!.slug, phase.slug, undefined, !all)} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-black">{all ? "Τρέχων γύρος" : "Εμφάνιση όλων"}</Link>}</div>{phase.directAdvancements.length > 0 && <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-emerald-800">Πρόκριση χωρίς αγώνα</p>{phase.directAdvancements.map((entry) => <p key={entry.matchupId} className="mt-1 text-sm font-bold text-zinc-800">{entry.label}</p>)}</div>}{rounds.length === 0 ? <p className="mt-6 rounded-2xl bg-zinc-50 p-5 text-sm font-bold text-zinc-600">Το πρόγραμμα της φάσης δεν έχει ανακοινωθεί ακόμη.</p> : <>{!all && rounds.length > 1 && round !== null && <nav className="mt-6 flex items-center justify-between gap-2 rounded-2xl bg-zinc-950 p-2 text-white">{rounds.indexOf(round) > 0 ? <Link href={nav(rounds[rounds.indexOf(round) - 1])} className="rounded-xl px-3 py-2 text-sm font-black">Προηγούμενη</Link> : <span className="px-3 py-2 text-sm font-black text-zinc-600">Προηγούμενη</span>}<b className="text-sm text-orange-400">{roundLabel} {round}</b>{rounds.indexOf(round) < rounds.length - 1 ? <Link href={nav(rounds[rounds.indexOf(round) + 1])} className="rounded-xl px-3 py-2 text-sm font-black">Επόμενη</Link> : <span className="px-3 py-2 text-sm font-black text-zinc-600">Επόμενη</span>}</nav>}<div className="mt-6 space-y-7">{visibleRounds.map((number) => <div key={number}><h3 className="text-sm font-black uppercase tracking-[0.14em] text-zinc-500">{roundLabel} {number}</h3><div className="mt-3 space-y-3">{phase.format === "series" ? context.seriesHistory.flatMap((history) => history.rounds.filter((entry) => entry.roundNumber === number).map((entry) => <div key={`${history.matchupId}-${entry.roundNumber}`} className="space-y-2">{context.seriesHistory.length > 1 && <p className="text-xs font-black text-zinc-500">{history.label}</p>}{entry.kind === "not_needed" ? <p className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-bold text-zinc-600">Δεν χρειάστηκε.</p> : <>{entry.kind === "transferred" && <p className="text-xs font-black uppercase tracking-wide text-orange-700">Μεταφορά από {entry.sourcePhaseName ?? "προηγούμενη φάση"}</p>}{entry.game && <GameCard game={entry.game} />}</>}</div>)) : context.games.filter((game) => game.roundNumber === number).map((game) => <GameCard key={game.id} game={game} />)}</div></div>)}</div></>}</section>}</div>}</section></main></>;
}
