import { selectPublicProgramResultsNavigation } from "@/components/hosted/HostedOrganizationHomeData";
import Link from "next/link";
import type { ReactNode } from "react";

import CompetitionBracket from "@/components/public/CompetitionBracket";
import PublicCompactSelector from "@/components/public/PublicCompactSelector";
import VenueDetails from "@/components/public/VenueDetails";

import PublicTeamStatisticsPanel from "@/components/competition/PublicTeamStatistics";
import PublicTeamRosterButton from "@/components/competition/PublicTeamRosterButton";
import { getPublicTeamRoster, type PublicTeamRoster, type PublicTeamRosterScope } from "@/services/public-team-roster.service";
import PublicGameResult from "@/components/competition/PublicGameResult";
import PublicCompetitionLatestMovements from "@/components/competition/PublicCompetitionLatestMovements";
import {
  getPublicCompetitionContextForOrganization,
  listPublicCompetitionMovementsForOrganization,
  type PublicCompetitionContext,
  type PublicGame,
  type PublicPhase,
  type PublicStandingRow,
  type PublicTeamGame,
  type PublicTeamView,
} from "@/services/public-competition.service";

export type PublicCompetitionsViewProps = {
  organizationId: string;
  basePath: string;
  pageHero?: ReactNode;
  searchParams: Promise<{
    season?: string;
    competition?: string;
    phase?: string;
    round?: string;
    view?: string;
    team?: string;
    programBlock?: string;
  }>;
};

function competitionHref(basePath: string, season: string, competition?: string, phase?: string, round?: number, all?: boolean, team?: string) {
  const params = new URLSearchParams({ season });
  if (competition) params.set("competition", competition);
  if (phase) params.set("phase", phase);
  if (round) params.set("round", String(round));
  if (all) params.set("view", "all");
  if (team) params.set("team", team);
  return `${basePath}?${params}`;
}

function competitionBracketViewHref(basePath: string, season: string, competition: string, phase: string) {
  const params = new URLSearchParams({ season, competition, phase, view: "bracket" });
  return `${basePath}?${params}`;
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

function CompactGameRow({ game, teamHref, gameBasePath }: { game: PublicGame; teamHref?: (teamId: string) => string; gameBasePath: string }) {
  const hasResult = game.homeScore !== null && game.awayScore !== null;
  return <article className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-xl border border-zinc-200 bg-white px-3 py-2 shadow-sm"><Team game={game} side="home" compact teamHref={teamHref} /><PublicGameResult game={game} gameBasePath={gameBasePath} className={`rounded-lg px-2.5 py-1 text-sm tabular-nums ${hasResult ? "bg-zinc-950 font-black text-white" : "bg-orange-50 font-bold text-orange-800"}`} /><Team game={game} side="away" compact teamHref={teamHref} /></article>;
}

function GameCard({ game, compact = false, teamHref, gameBasePath }: { game: PublicGame; compact?: boolean; teamHref?: (teamId: string) => string; gameBasePath: string }) {
  if (compact) return <CompactGameRow game={game} teamHref={teamHref} gameBasePath={gameBasePath} />;
  const hasResult = game.homeScore !== null && game.awayScore !== null;
  const details = [game.scheduledDate && dateText(game.scheduledDate), game.scheduledTime].filter(Boolean);
  const hasMetadata = details.length > 0 || Boolean(game.venue) || Boolean(game.videoUrl);
  return <article className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm"><div className={`grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 md:gap-4 ${hasMetadata ? "md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_minmax(11rem,auto)]" : "md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"}`}><Team game={game} side="home" teamHref={teamHref} /><div className="flex min-w-14 flex-col items-center gap-1.5 sm:min-w-16"><PublicGameResult game={game} gameBasePath={gameBasePath} className={`w-full rounded-xl px-2.5 py-1.5 text-center text-base tabular-nums sm:text-lg ${hasResult ? "bg-zinc-950 font-black text-white" : "bg-orange-50 font-bold text-orange-800"}`} />{game.liveAvailable ? <Link href={`${gameBasePath}/${encodeURIComponent(game.id)}/live`} className="inline-flex min-h-10 items-center rounded-lg bg-emerald-500 px-4 text-sm font-black tracking-[0.12em] text-emerald-950 shadow-sm transition hover:bg-emerald-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600">LIVE</Link> : null}</div><Team game={game} side="away" teamHref={teamHref} />{hasMetadata && <div className="col-span-3 mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 border-t border-zinc-100 pt-2 text-xs font-bold uppercase tracking-wide text-zinc-500 md:col-span-1 md:col-start-4 md:row-start-1 md:mt-0 md:justify-start md:border-0 md:pt-0">{details.length > 0 && <span>{details.join(" · ")}</span>}{game.venue && <VenueDetails venue={game.venue} />}{game.videoUrl && <a href={game.videoUrl} target="_blank" rel="noopener noreferrer" className="rounded-full bg-orange-100 px-2.5 py-1 text-orange-800 hover:bg-orange-200">▶ Βίντεο</a>}</div>}</div></article>;
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

function TeamGameGroup({ games, teamHref, gameBasePath }: { games: PublicTeamGame[]; teamHref: (teamId: string) => string; gameBasePath: string }) {
  const statusLabel = (status: PublicTeamGame["status"]) => status === "postponed" ? "Αναβλήθηκε" : status === "cancelled" ? "Ακυρώθηκε" : null;
  return <section className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7"><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Αγωνιστική διαδρομή</p><h2 className="mt-2 text-2xl font-black text-zinc-950">Πρόγραμμα &amp; Αποτελέσματα</h2>{games.length === 0 ? <p className="mt-5 rounded-2xl bg-zinc-50 p-4 text-sm font-bold text-zinc-600">Δεν υπάρχουν αγώνες για τη συγκεκριμένη ομάδα.</p> : <div className="mt-5 space-y-5">{games.map((entry) => <div key={entry.game.id}><div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-black uppercase tracking-[0.14em] text-zinc-500"><span>{entry.phaseName}{entry.game.roundNumber !== null ? ` · ${entry.game.roundNumber}ος γύρος` : ""}</span>{statusLabel(entry.status) && <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-zinc-600">{statusLabel(entry.status)}</span>}</div><GameCard game={entry.game} teamHref={teamHref} gameBasePath={gameBasePath} /></div>)}</div>}</section>;
}

async function TeamView({ view, backHref, teamHref, gameBasePath, rosterScope }: { view: PublicTeamView; backHref: string; teamHref: (teamId: string) => string; gameBasePath: string; rosterScope: PublicTeamRosterScope }) {
  let roster: PublicTeamRoster | null = null;
  try { roster = await getPublicTeamRoster(rosterScope); } catch {}
  const logoUrl = roster ? roster.logoUrl : view.team.logoUrl;
  return <main className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top,_#fed7aa,_#f4f4f5_42%,_#ffffff_78%)] py-8 sm:py-12"><section className="mx-auto max-w-6xl px-4 sm:px-6"><Link href={backHref} className="inline-flex rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-black text-zinc-800 shadow-sm hover:border-zinc-950">← Επιστροφή στη διοργάνωση</Link><header className="mt-6 rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:flex sm:items-center sm:gap-5 sm:p-7">{logoUrl && <img src={logoUrl} alt="" className="h-20 w-20 shrink-0 rounded-2xl border border-zinc-200 bg-white object-contain p-2" />}<div className={logoUrl ? "mt-4 min-w-0 sm:mt-0" : "min-w-0"}><p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Ομάδα διοργάνωσης</p><h1 className="mt-2 text-3xl font-black tracking-tight text-zinc-950 sm:text-4xl">{view.team.name}</h1></div><PublicTeamRosterButton teamName={view.team.name} players={roster?.players ?? null} /></header><div className="mt-6 space-y-6"><PublicTeamStatisticsPanel statistics={view.statistics} gameMode={view.gameMode} /><TeamGameGroup games={view.games} teamHref={teamHref} gameBasePath={gameBasePath} /></div></section></main>;
}

async function PublicCompetitionProgramResults({
  context,
  organizationId,
  basePath,
  gameBasePath,
  teamHref,
  manualBlockKey,
}: {
  context: PublicCompetitionContext;
  organizationId: string;
  basePath: string;
  gameBasePath: string;
  teamHref?: (teamId: string) => string;
  manualBlockKey?: string;
}) {
  if (!context.selectedSeason || !context.selectedCompetition) return null;
  const season = context.selectedSeason;
  const competition = context.selectedCompetition;
  const phaseContexts = context.phases.length > 0
    ? await Promise.all(context.phases.map((phase) => getPublicCompetitionContextForOrganization(organizationId, {
      seasonSlug: season.slug,
      competitionSlug: competition.slug,
      phaseSlug: phase.slug,
    })))
    : [context];
  const navigation = selectPublicProgramResultsNavigation(phaseContexts, manualBlockKey);
  const selected = navigation.selected;
  const selectorHref = (seasonSlug: string, competitionSlug?: string) => {
    const params = new URLSearchParams({ season: seasonSlug });
    if (competitionSlug) params.set("competition", competitionSlug);
    return `${basePath}?${params.toString()}#program-results`;
  };
  const blockHref = (blockKey: string) => {
    const params = new URLSearchParams({ season: season.slug, competition: competition.slug, programBlock: blockKey });
    if (context.selectedPhase) params.set("phase", context.selectedPhase.slug);
    return `${basePath}?${params.toString()}#program-results`;
  };
  return <section id="program-results" className="rounded-3xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-7">
    <div>
      <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-700">Επίσημη αγωνιστική εικόνα</p>
      <h2 className="mt-2 text-2xl font-black">Πρόγραμμα &amp; Αποτελέσματα</h2>
    </div>
    <div className="mt-5 grid gap-4 rounded-2xl border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-2">
      <PublicCompactSelector label="Σεζόν" value={season.name} options={context.seasons.map((item) => ({ id: item.id, label: item.name, href: selectorHref(item.slug) }))} />
      <PublicCompactSelector label="Διοργάνωση" value={competition.name} options={context.competitions.map((item) => ({ id: item.id, label: item.name, href: selectorHref(season.slug, item.slug) }))} />
    </div>
    {selected ? <>
      <div className="mt-5 rounded-2xl bg-zinc-950 px-4 py-3 text-white">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-400">{selected.context.selectedPhase?.name}</p>
        <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(9rem,auto)_1fr_minmax(9rem,auto)] sm:items-center">
          {navigation.previous ? <Link href={blockHref(navigation.previous.key)} aria-label={`Προηγούμενο αγωνιστικό block πριν από ${selected.block.label}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 px-4 text-sm font-black transition hover:border-orange-400 hover:text-orange-300">← Προηγούμενη</Link> : <button type="button" disabled aria-label="Δεν υπάρχει προηγούμενο αγωνιστικό block" className="min-h-11 cursor-not-allowed rounded-xl border border-zinc-800 px-4 text-sm font-black text-zinc-600">← Προηγούμενη</button>}
          <h3 className="text-center text-lg font-black">{selected.block.label}</h3>
          {navigation.next ? <Link href={blockHref(navigation.next.key)} aria-label={`Επόμενο αγωνιστικό block μετά από ${selected.block.label}`} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-zinc-700 px-4 text-sm font-black transition hover:border-orange-400 hover:text-orange-300">Επόμενη →</Link> : <button type="button" disabled aria-label="Δεν υπάρχει επόμενο αγωνιστικό block" className="min-h-11 cursor-not-allowed rounded-xl border border-zinc-800 px-4 text-sm font-black text-zinc-600">Επόμενη →</button>}
        </div>
        {selected.completedFallback ? <p className="mt-1 text-xs font-bold text-zinc-400">Τελευταίο ολοκληρωμένο αγωνιστικό block</p> : null}
      </div>
      <div className="mt-5 space-y-3">{selected.block.games.map((game) => <GameCard key={game.id} game={game} teamHref={teamHref} gameBasePath={gameBasePath} />)}</div>
    </> : <p className="mt-5 rounded-2xl bg-zinc-50 p-5 text-sm font-bold text-zinc-600">Το πρόγραμμα της διοργάνωσης δεν έχει ανακοινωθεί ακόμη.</p>}
  </section>;
}
export default async function PublicCompetitionsView({ organizationId, basePath, pageHero, searchParams }: PublicCompetitionsViewProps) {
  const query = await searchParams;
  const href = (season: string, competition?: string, phase?: string, round?: number, all?: boolean, team?: string) => competitionHref(basePath, season, competition, phase, round, all, team);
  const bracketViewHref = (season: string, competition: string, phase: string) => competitionBracketViewHref(basePath, season, competition, phase);
  const gameBasePath = `${basePath}/games`;
  let context: Awaited<ReturnType<typeof getPublicCompetitionContextForOrganization>> | null = null;
  try { context = await getPublicCompetitionContextForOrganization(organizationId, { seasonSlug: query.season, competitionSlug: query.competition, phaseSlug: query.phase, teamId: query.team }); } catch {}
  const latestMovements = context?.selectedSeason && context.selectedCompetition
    ? await listPublicCompetitionMovementsForOrganization(organizationId, context.selectedSeason.id, context.selectedCompetition.id)
    : [];
  const phase = context?.selectedPhase ?? null;
  const bracket = context?.bracket ?? null;
  const teamHref = context?.selectedSeason && context.selectedCompetition && phase ? (teamId: string) => href(context!.selectedSeason!.slug, context!.selectedCompetition!.slug, phase.slug, undefined, false, teamId) : undefined;
  const backHref = context?.selectedSeason && context.selectedCompetition && phase ? href(context.selectedSeason.slug, context.selectedCompetition.slug, phase.slug) : basePath;
  if (context?.teamView && teamHref && context.selectedSeason && context.selectedCompetition) return <>{pageHero}<TeamView view={context.teamView} backHref={backHref} teamHref={teamHref} gameBasePath={gameBasePath} rosterScope={{ organizationId, seasonId: context.selectedSeason.id, competitionId: context.selectedCompetition.id, teamId: context.teamView.team.id }} /></>;
  const bracketView = query.view === "bracket" && bracket?.meaningful === true;
  return <>{pageHero}<main className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_top,_#fed7aa,_#f4f4f5_42%,_#ffffff_78%)] py-8 sm:py-12"><section className="mx-auto max-w-6xl px-4 sm:px-6">{!pageHero && <><p className="text-sm font-black uppercase tracking-[0.18em] text-orange-700">KomoBasket League</p><h1 className="mt-2 text-4xl font-black tracking-tight text-zinc-950 sm:text-5xl">Διοργανώσεις</h1><p className="mt-3 max-w-2xl text-base leading-7 text-zinc-600">Επιλέξτε σεζόν, διοργάνωση και φάση για να παρακολουθήσετε την επίσημη αγωνιστική εικόνα.</p></>}{!context?.selectedSeason ? <div className="mt-8 rounded-3xl border border-zinc-200 bg-white p-7 shadow-sm"><p className="text-lg font-black">Δεν υπάρχει διαθέσιμη διοργάνωση αυτή τη στιγμή.</p></div> : <div className="mt-8 space-y-5"><section className="rounded-3xl border border-zinc-200 bg-white p-4 shadow-sm"><div className="grid gap-5 lg:grid-cols-[0.7fr_1fr_1.5fr_auto] lg:items-end"><PublicCompactSelector label="Σεζόν" value={context.selectedSeason.name} options={context.seasons.map((season) => ({ id: season.id, label: season.name, href: href(season.slug) }))} /><PublicCompactSelector label="Διοργάνωση" value={context.selectedCompetition!.name} options={context.competitions.map((competition) => ({ id: competition.id, label: competition.name, href: href(context.selectedSeason!.slug, competition.slug) }))} /><div><p className="text-xs font-black uppercase tracking-[0.16em] text-zinc-500">Φάση</p><div className="mt-2 flex flex-wrap gap-2">{context.phases.map((item) => <Link key={item.id} href={href(context.selectedSeason!.slug, context.selectedCompetition!.slug, item.slug)} className={`rounded-xl border px-3 py-2 text-sm font-black ${item.id === phase?.id ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 text-zinc-700"}`}>{item.name}</Link>)}</div></div><PublicCompetitionLatestMovements seasonName={context.selectedSeason.name} competitionName={context.selectedCompetition!.name} movements={latestMovements} /></div></section>{phase && <p className="px-1 text-sm font-bold text-zinc-700"><strong className="text-zinc-950">{phase.name}</strong> · {summary(phase)}</p>}{phase && bracket?.meaningful && <nav className="flex flex-wrap gap-2 px-1"><Link href={href(context.selectedSeason!.slug, context.selectedCompetition!.slug, phase.slug)} className={`rounded-full border px-4 py-2 text-sm font-black ${bracketView ? "border-zinc-300 text-zinc-700" : "border-zinc-950 bg-zinc-950 text-white"}`}>Πρόγραμμα &amp; Αποτελέσματα</Link><Link href={bracketViewHref(context.selectedSeason!.slug, context.selectedCompetition!.slug, phase.slug)} className={`rounded-full border px-4 py-2 text-sm font-black ${bracketView ? "border-zinc-950 bg-zinc-950 text-white" : "border-orange-300 bg-orange-50 text-orange-800"}`}>Απεικόνιση Διασταυρώσεων</Link></nav>}{bracketView && bracket ? <CompetitionBracket projection={bracket} /> : <>{phase?.format === "standings" && <Standings phase={phase} rows={context.standings} teamHref={teamHref} />}<PublicCompetitionProgramResults context={context} organizationId={organizationId} basePath={basePath} gameBasePath={gameBasePath} teamHref={teamHref} manualBlockKey={query.programBlock} /></>}</div>}</section></main></>;
}

