import Link from "next/link";

import CompetitionBracket from "@/components/public/CompetitionBracket";
import PublicCompactSelector from "@/components/public/PublicCompactSelector";
import VenueDetails from "@/components/public/VenueDetails";
import Header from "@/components/layout/Header";
import {
  getPublicCompetitionContext,
  type PublicGame,
  type PublicPhase,
  type PublicStandingRow,
  type PublicTeamGame,
  type PublicTeamView,
} from "@/services/public-competition.service";

type PageProps = {
  searchParams: Promise<{
    season?: string;
    competition?: string;
    phase?: string;
    round?: string;
    view?: string;
    team?: string;
  }>;
};

function href(season: string, competition?: string, phase?: string, round?: number, all?: boolean, team?: string) {
  const params = new URLSearchParams({ season });
  if (competition) params.set("competition", competition);
  if (phase) params.set("phase", phase);
  if (round) params.set("round", String(round));
  if (all) params.set("view", "all");
  if (team) params.set("team", team);
  return `/competitions?${params}`;
}

function bracketViewHref(season: string, competition: string, phase: string) {
  const params = new URLSearchParams({ season, competition, phase, view: "bracket" });
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
  return year && month && day ? new Intl.DateTimeFormat("el-GR", { day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(year, month - 1, day)) : value;
}

function Team({ game, side, teamHref, compact = false }: { game: PublicGame; side: "home" | "away"; teamHref?: (teamId: string) => string; compact?: boolean }) {
  const team = side === "home" ? game.homeTeam : game.awayTeam;
  const score = side === "home" ? game.homeScore : game.awayScore;
  const opposite = side === "home" ? game.awayScore : game.homeScore;
  const winner = score !== null && opposite !== null && score > opposite;
  const name = <span className={`min-w-0 ${compact ? "truncate text-sm" : "text-sm leading-5 sm:text-base"} ${winner ? "font-black text-zinc-950" : "font-bold text-zinc-700"}`}>{team.name}</span>;
  const logo = team.logoUrl && <img src={team.logoUrl} alt="" className={`${compact ? "h-6 w-6" : "h-9 w-9"} shrink-0 rounded-full border border-zinc-200 bg-white object-contain p-1`} />;
  const content = <>{side === "away" && name}{logo}{side === "home" && name}</>;
  const className = `flex min-w-0 items-center gap-2 ${side === "away" ? "justify-end text-right" : ""}`;
  return teamHref ? <Link href={teamHref(team.id)} className={`${className} rounded-md outline-offset-2 hover:text-orange-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-600`}>{content}</Link> : <div className={className}>{content}</div>;
}

function CompactGameRow({ game, teamHref }: { game: PublicGame; teamHref?: (teamId: string) => string }) {
  const hasResult = game.homeScore !== null && game.awayScore !== null;
  const score = hasResult ? `${game.homeScore} – ${game.awayScore}` : "vs";
  return <article className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-sm"><Team game={game} side="home" compact teamHref={teamHref} /><span className={`rounded-lg px-2.5 py-1 text-sm tabular-nums ${hasResult ? "bg-zinc-950 font-black text-white" : "bg-orange-50 font-bold text-orange-800"}`}>{score}</span><Team game={game} side="away" compact teamHref={teamHref} /></article>;
}

function GameCard({ game, compact = false, teamHref }: { game: PublicGame; compact?: boolean; teamHref?: (teamId: string) => string }) {
  if (compact) return <CompactGameRow game={game} teamHref={teamHref} />;
  const hasResult = game.homeScore !== null && game.awayScore !== null;
  const details = [game.scheduledDate && dateText(game.scheduledDate), game.scheduledTime].filter(Boolean);
  const hasMetadata = details.length > 0 || Boolean(game.venue) || Boolean(game.videoUrl);
  return <article className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm"><div className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 md:gap-4 ${hasMetadata ? "md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(11rem,auto)]" : "md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"}`}><Team game={game} side="home" teamHref={teamHref} /><div className="flex min-w-14 flex-col items-center gap-1.5 sm:min-w-16"><div className={`w-full rounded-xl px-2.5 py-1.5 text-center text-base tabular-nums sm:text-lg ${hasResult ? "bg-zinc-950 font-black text-white" : "bg-orange-50 font-bold text-orange-800"}`}>{hasResult ? `${game.homeScore} – ${game.awayScore}` : "vs"}</div>{game.liveAvailable ? <Link href={`/competitions/games/${encodeURIComponent(game.id)}/live`} className="inline-flex min-h-10 items-center rounded-lg bg-emerald-500 px-4 text-sm font-black tracking-[0.12em] text-emerald-950 shadow-sm transition hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">LIVE</Link> : null}</div><Team game={game} side="away" teamHref={teamHref} />{hasMetadata && <div className="col-span-3 mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-zinc-100 pt-2 text-xs font-bold uppercase tracking-wide text-zinc-500 md:col-span-1 md:col-start-4 md:row-start-1 md:mt-0 md:justify-start md:border-0 md:pt-0">{details.length > 0 && <span>{details.join(" · ")}</span>}{game.venue && <VenueDetails venue={game.venue} />}{game.videoUrl && <a href={game.videoUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-orange-100 px-2.5 py-1 text-orange-800 hover:bg-orange-200">▶ Βίντεο</a>}</div>}</div></article>;
}

function zone(rank: number, phase: PublicPhase) {
  if (phase.standingsPresentation.directQualification.includes(rank)) return "border-emerald-200 bg-emerald-50";
  if (phase.standingsPresentation.playOut.includes(rank)) return "border-amber-200 bg-amber-50";
  if (phase.standingsPresentation.eliminated.includes(rank)) return "border-rose-200 bg-rose-50";
  return "border-zinc-200 bg-white";
}

function Standings({ phase, rows, teamHref }: { phase: PublicPhase; rows: PublicStandingRow[]; teamHref?: (teamId: string) => string }) {
  const legends = [[phase.standingsPresentation.directQualification, "Απευθείας πρόκριση", "bg-emerald-500"], [phase.standingsPresentation.playOut, "Play Out", "bg-amber-500"], [phase.standingsPresentation.eliminated, "Εκτός συνέχειας", "bg-rose-500"]] as const;
  const labels = (positions: readonly number[]) => positions.length === 1 ? `Θέση ${positions[0]}` : `Θέσεις ${positions.join("–")}`;
  const teamIdentity = (team: PublicStandingRow["team"], mobile = false) => {
    const content = <>{team.logoUrl && <img src={team.logoUrl} alt="" className={`${mobile ? "h-6 w-6" : "h-7 w-7"} shrink-0 rounded-full object-contain`} />}{team.name}</>;
    const classes = "flex min-w-0 items-center gap-2 font-black text-zinc-950 hover:text-orange-700";
    return teamHref ? <Link href={teamHref(team.id)} className={classes}>{content}</Link> : <span className={classes}>{content}</span>;
  };
  if (!rows.length) return null;
  return <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7"><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Επίσημη κατάταξη</p><h2 className="mt-2 text-2xl font-black text-zinc-950">Βαθμολογία</h2><div className="mt-4 flex flex-wrap gap-2 text-xs font-bold text-zinc-700">{legends.filter(([positions]) => positions.length).map(([positions, text, dot]) => <span key={text} className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5"><i className={`h-2 w-2 rounded-full ${dot}`} />{labels(positions)} — {text}</span>)}</div><div className="mt-5 hidden overflow-x-auto sm:block"><div className="min-w-[620px] overflow-hidden rounded-2xl border border-zinc-200"><div className="grid grid-cols-[2.75rem_minmax(9rem,1fr)_repeat(6,minmax(3.4rem,0.5fr))] bg-zinc-950 px-3 py-3 text-xs font-black uppercase tracking-wide text-zinc-300"><span className="text-center">Θ</span><span>Ομάδα</span><span className="text-center">ΑΓ</span><span className="text-center">Ν</span><span className="text-center">Η</span><span className="text-center">ΥΠ</span><span className="text-center">Δ</span><span className="text-center">Β</span></div>{rows.map((row) => <div key={row.team.id} className={`grid grid-cols-[2.75rem_minmax(9rem,1fr)_repeat(6,minmax(3.4rem,0.5fr))] items-center border-t px-3 py-3 text-sm ${zone(row.rank, phase)}`}><span className="text-center font-black">{row.rank}</span>{teamIdentity(row.team)}<span className="text-center">{row.gamesPlayed}</span><span className="text-center">{row.wins}</span><span className="text-center">{row.losses}</span><span className="text-center">{row.pointsFor}–{row.pointsAgainst}</span><span className="text-center">{row.pointDifference > 0 ? `+${row.pointDifference}` : row.pointDifference}</span><span className="text-center font-black">{row.standingsPoints}</span></div>)}</div></div><div className="mt-5 space-y-2 sm:hidden">{rows.map((row) => <article key={row.team.id} className={`rounded-2xl border p-3 ${zone(row.rank, phase)}`}><div className="flex items-center justify-between gap-3"><b className="min-w-0">{teamIdentity(row.team, true)}</b><b className="shrink-0">{row.standingsPoints} β.</b></div><p className="mt-2 text-xs font-bold text-zinc-600">Αγ. {row.gamesPlayed} · Ν {row.wins} · Η {row.losses} · Υπέρ/Κατά {row.pointsFor}–{row.pointsAgainst} · Δ {row.pointDifference > 0 ? `+${row.pointDifference}` : row.pointDifference}</p></article>)}</div></section>;
}

function TeamGameGroup({ games, teamHref }: { games: PublicTeamGame[]; teamHref: (teamId: string) => string }) {
  const statusLabel = (status: PublicTeamGame["status"]) => status === "postponed" ? "Αναβλήθηκε" : status === "cancelled" ? "Ακυρώθηκε" : null;
  return <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7"><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Αγωνιστική διαδρομή</p><h2 className="mt-2 text-2xl font-black text-zinc-950">Πρόγραμμα &amp; Αποτελέσματα</h2>{games.length === 0 ? <p className="mt-5 rounded-2xl bg-zinc-50 p-4 text-sm font-bold text-zinc-600">Δεν υπάρχουν αγώνες για τη συγκεκριμένη ομάδα.</p> : <div className="mt-5 space-y-5">{games.map((entry) => <div key={entry.game.id}><div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-black uppercase tracking-[0.14em] text-zinc-500"><span>{entry.phaseName}{entry.game.roundNumber !== null ? ` · ${entry.game.roundNumber}ος γύρος` : ""}</span>{statusLabel(entry.status) && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{statusLabel(entry.status)}</span>}</div><GameCard game={entry.game} teamHref={teamHref} /></div>)}</div>}</section>;
}

function TeamView({ view, backHref, teamHref }: { view: PublicTeamView; backHref: string; teamHref: (teamId: string) => string }) {
  return <main className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top,_#fed7aa,_#f4f4f5_42%,_#ffffff_78%)] py-8 sm:py-12"><section className="mx-auto max-w-5xl px-4 sm:px-6"><Link href={backHref} className="inline-flex rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-black text-zinc-800 shadow-sm hover:border-zinc-950">← Επιστροφή στη διοργάνωση</Link><header className="mt-6 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:flex sm:items-center sm:gap-5 sm:p-7">{view.team.logoUrl && <img src={view.team.logoUrl} alt="" className="h-20 w-20 rounded-2xl border border-zinc-200 bg-white object-contain p-2" />}<div className={view.team.logoUrl ? "mt-4 sm:mt-0" : ""}><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Ομάδα διοργάνωσης</p><h1 className="mt-2 text-3xl font-black tracking-tight text-zinc-950 sm:text-4xl">{view.team.name}</h1></div></header><div className="mt-6 space-y-6"><section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7"><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Ρόστερ</p><h2 className="mt-2 text-2xl font-black text-zinc-950">Ενεργοί παίκτες</h2>{view.roster.length === 0 ? <p className="mt-5 rounded-2xl bg-zinc-50 p-4 text-sm font-bold text-zinc-600">Δεν υπάρχουν ενεργοί παίκτες στο ρόστερ αυτής της διοργάνωσης.</p> : <div className="mt-5 overflow-hidden rounded-2xl border border-zinc-200"><div className="grid grid-cols-[3rem_minmax(0,1fr)] bg-zinc-950 px-3 py-2 text-xs font-black uppercase tracking-wide text-zinc-300"><span className="text-center">#</span><span>Παίκτης</span></div><ul className="divide-y divide-zinc-100">{view.roster.map((player) => <li key={player.id} className="grid min-h-14 grid-cols-[3rem_minmax(0,1fr)] items-center px-3 py-2.5"><span className="text-center text-sm font-black tabular-nums text-orange-700">{player.shirtNumber ?? ""}</span><span className="flex min-w-0 items-center gap-3 font-bold text-zinc-800">{player.photoUrl && <img src={player.photoUrl} alt="" className="h-9 w-9 shrink-0 rounded-full border border-zinc-200 object-cover" />}<span className="min-w-0">{player.displayName}</span></span></li>)}</ul></div>}</section><TeamGameGroup games={view.games} teamHref={teamHref} /></div></section></main>;
}

export default async function CompetitionsPage({ searchParams }: PageProps) {
  const query = await searchParams;
  let context: Awaited<ReturnType<typeof getPublicCompetitionContext>> | null = null;
  try { context = await getPublicCompetitionContext({ seasonSlug: query.season, competitionSlug: query.competition, phaseSlug: query.phase, teamId: query.team }); } catch {}
  const phase = context?.selectedPhase ?? null;
  const bracket = context?.bracket ?? null;
  const teamHref = context?.selectedSeason && context.selectedCompetition && phase ? (teamId: string) => href(context!.selectedSeason!.slug, context!.selectedCompetition!.slug, phase.slug, undefined, false, teamId) : undefined;
  const backHref = context?.selectedSeason && context.selectedCompetition && phase ? href(context.selectedSeason.slug, context.selectedCompetition.slug, phase.slug) : "/competitions";
  if (context?.teamView && teamHref) return <><Header /><TeamView view={context.teamView} backHref={backHref} teamHref={teamHref} /></>;
  const bracketView = query.view === "bracket" && bracket?.meaningful === true;
  const seriesRounds = phase?.format === "series" ? [...new Set((context?.seriesHistory ?? []).flatMap((history) => history.rounds.map((round) => round.roundNumber)))].sort((a, b) => a - b) : [];
  const gameRounds = [...new Set((context?.games ?? []).map((game) => game.roundNumber))].sort((a, b) => a - b);
  const rounds = phase?.format === "series" ? seriesRounds : gameRounds;
  const requested = Number.parseInt(query.round ?? "", 10);
  const round = rounds.includes(requested) ? requested : rounds[0] ?? null;
  const all = phase?.format === "series" || (query.view === "all" && rounds.length > 1);
  const visibleRounds = all ? rounds : round === null ? [] : [round];
  const roundLabel = phase?.format === "standings" ? "Αγωνιστική" : "Γύρος";
  const nav = (target: number) => href(context!.selectedSeason!.slug, context!.selectedCompetition!.slug, phase!.slug, target);

  return <><Header /><main className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top,_#fed7aa,_#f4f4f5_42%,_#ffffff_78%)] py-8 sm:py-12"><section className="mx-auto max-w-6xl px-4 sm:px-6"><p className="text-sm font-black uppercase tracking-[0.18em] text-orange-700">KomoBasket League</p><h1 className="mt-2 text-4xl font-black tracking-tight text-zinc-950 sm:text-5xl">Διοργανώσεις</h1><p className="mt-3 max-w-2xl text-base leading-7 text-zinc-600">Επιλέξτε σεζόν, διοργάνωση και φάση για να παρακολουθήσετε την επίσημη αγωνιστική εικόνα.</p>{!context?.selectedSeason ? <div className="mt-8 rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm"><p className="text-lg font-black">Δεν υπάρχει διαθέσιμη διοργάνωση αυτή τη στιγμή.</p></div> : <div className="mt-8 space-y-5"><section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm"><div className="grid gap-5 lg:grid-cols-[0.7fr_1fr_1.5fr]"><PublicCompactSelector label="Σεζόν" value={context.selectedSeason.name} options={context.seasons.map((season) => ({ id: season.id, label: season.name, href: href(season.slug) }))} /><PublicCompactSelector label="Διοργάνωση" value={context.selectedCompetition!.name} options={context.competitions.map((competition) => ({ id: competition.id, label: competition.name, href: href(context.selectedSeason!.slug, competition.slug) }))} /><div><p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Φάση</p><div className="mt-2 flex flex-wrap gap-2">{context.phases.map((item) => <Link key={item.id} href={href(context.selectedSeason!.slug, context.selectedCompetition!.slug, item.slug)} className={`rounded-xl border px-3 py-2 text-sm font-black ${item.id === phase?.id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 text-zinc-700"}`}>{item.name}</Link>)}</div></div></div></section>{phase && <p className="px-1 text-sm font-bold text-zinc-700"><strong className="text-zinc-950">{phase.name}</strong> · {summary(phase)}</p>}{phase && bracket?.meaningful && <nav className="flex flex-wrap gap-2 px-1"><Link href={href(context.selectedSeason!.slug, context.selectedCompetition!.slug, phase.slug)} className={`rounded-full border px-4 py-2 text-sm font-black ${bracketView ? "border-zinc-300 text-zinc-700" : "border-zinc-950 bg-zinc-950 text-white"}`}>Πρόγραμμα &amp; Αποτελέσματα</Link><Link href={bracketViewHref(context.selectedSeason!.slug, context.selectedCompetition!.slug, phase.slug)} className={`rounded-full border px-4 py-2 text-sm font-black ${bracketView ? "border-zinc-950 bg-zinc-950 text-white" : "border-orange-300 bg-orange-50 text-orange-800"}`}>Απεικόνιση Διασταυρώσεων</Link></nav>}{bracketView && bracket ? <CompetitionBracket projection={bracket} /> : <>{phase?.format === "standings" && <Standings phase={phase} rows={context.standings} teamHref={teamHref} />}{phase && <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Επίσημη αγωνιστική εικόνα</p><h2 className="mt-2 text-2xl font-black">Πρόγραμμα &amp; Αποτελέσματα</h2></div>{phase.format !== "series" && rounds.length > 1 && <Link href={href(context.selectedSeason!.slug, context.selectedCompetition!.slug, phase.slug, undefined, !all)} className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-black">{all ? "Τρέχων γύρος" : "Εμφάνιση όλων"}</Link>}</div>{phase.directAdvancements.length > 0 && <div className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-black uppercase tracking-wide text-emerald-800">Πρόκριση χωρίς αγώνα</p>{phase.directAdvancements.map((entry) => <p key={entry.matchupId} className="mt-1 text-sm font-bold text-zinc-800">{entry.label}</p>)}</div>}{rounds.length === 0 ? <p className="mt-6 rounded-2xl bg-zinc-50 p-5 text-sm font-bold text-zinc-600">Το πρόγραμμα της φάσης δεν έχει ανακοινωθεί ακόμη.</p> : <>{!all && rounds.length > 1 && round !== null && <nav className="mt-6 flex items-center justify-between gap-2 rounded-2xl bg-zinc-950 p-2 text-white">{rounds.indexOf(round) > 0 ? <Link href={nav(rounds[rounds.indexOf(round) - 1])} className="rounded-xl px-3 py-2 text-sm font-black">Προηγούμενη</Link> : <span className="px-3 py-2 text-sm font-black text-zinc-600">Προηγούμενη</span>}<b className="text-sm text-orange-400">{roundLabel} {round}</b>{rounds.indexOf(round) < rounds.length - 1 ? <Link href={nav(rounds[rounds.indexOf(round) + 1])} className="rounded-xl px-3 py-2 text-sm font-black">Επόμενη</Link> : <span className="px-3 py-2 text-sm font-black text-zinc-600">Επόμενη</span>}</nav>}<div className={`mt-6 ${all && phase.format !== "series" ? "space-y-4" : "space-y-7"}`}>{visibleRounds.map((number, index) => <div key={number} className={all && phase.format !== "series" ? `rounded-2xl border p-3 ${index % 2 === 1 ? "border-orange-100 bg-orange-50/70" : "border-zinc-200 bg-white"}` : ""}><h3 className={`text-sm font-black uppercase tracking-[0.14em] ${all && phase.format !== "series" ? "border-l-4 border-orange-500 px-2 text-zinc-800" : "text-zinc-500"}`}>{roundLabel} {number}</h3><div className={`mt-3 ${all && phase.format !== "series" ? "grid gap-2 lg:grid-cols-2" : "space-y-3"}`}>{phase.format === "series" ? context.seriesHistory.flatMap((history) => history.rounds.filter((entry) => entry.roundNumber === number).map((entry) => <div key={`${history.matchupId}-${entry.roundNumber}`} className="space-y-2">{context.seriesHistory.length > 1 && <p className="text-xs font-black text-zinc-500">{history.label}</p>}{entry.kind === "not_needed" ? <p className="rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm font-bold text-zinc-600">Δεν χρειάστηκε.</p> : <>{entry.kind === "transferred" && <p className="text-xs font-black uppercase tracking-wide text-orange-700">Μεταφορά από {entry.sourcePhaseName ?? "προηγούμενη φάση"}</p>}{entry.game && <GameCard game={entry.game} teamHref={teamHref} />}</>}</div>)) : context.games.filter((game) => game.roundNumber === number).map((game) => <GameCard key={game.id} game={game} compact={all} teamHref={teamHref} />)}</div></div>)}</div></>}</section>}</>}</div>}</section></main></>;
}
