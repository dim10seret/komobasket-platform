import Link from "next/link";
import PublicGameResult from "@/components/competition/PublicGameResult";
import { hostedCompetitionGamePath, hostedOrganizationPath } from "@/lib/hosted-organization-routes";
import { formatPublicDate } from "@/lib/public-date";
import type { PublicCompetitionContext, PublicGame } from "@/services/public-competition.service";

export type HostedNextCompetitiveBlock = {
  kind: "matchday" | "series";
  label: string;
  games: PublicGame[];
};

const isUnresolvedPublicGame = (game: PublicGame) => game.publicStatus === "scheduled" || game.publicStatus === "live";
const byCanonicalGameOrder = (left: PublicGame, right: PublicGame) => (left.gameOrder ?? Number.MAX_SAFE_INTEGER) - (right.gameOrder ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id);

export function selectHostedNextCompetitiveBlock(context: PublicCompetitionContext | null): HostedNextCompetitiveBlock | null {
  if (!context?.selectedPhase) return null;
  if (context.selectedPhase.format === "series") {
    const unresolved = context.seriesHistory
      .flatMap((matchup) => matchup.rounds
        .flatMap((round) => round.kind === "game" && round.game && isUnresolvedPublicGame(round.game) ? [round.game] : []))
      .sort((left, right) => left.roundNumber - right.roundNumber || byCanonicalGameOrder(left, right));
    const roundNumber = unresolved[0]?.roundNumber;
    if (roundNumber === undefined) return null;
    const games = unresolved.filter((game) => game.roundNumber === roundNumber);
    const canonicalLabel = games.find((game) => game.roundLabel?.trim())?.roundLabel;
    return { kind: "series", label: canonicalLabel ?? `ΓΥΡΟΣ ${roundNumber}`, games };
  }

  const unresolved = context.games.filter(isUnresolvedPublicGame).sort((left, right) => left.roundNumber - right.roundNumber || byCanonicalGameOrder(left, right));
  const roundNumber = unresolved[0]?.roundNumber;
  if (roundNumber === undefined) return null;
  const games = unresolved.filter((game) => game.roundNumber === roundNumber);
  const canonicalLabel = context.games.find((game) => game.roundNumber === roundNumber && game.roundLabel?.trim())?.roundLabel;
  return {
    kind: "matchday",
    label: canonicalLabel ?? (context.selectedPhase.format === "standings" ? `${roundNumber}η Αγωνιστική` : `Γύρος ${roundNumber}`),
    games,
  };
}

const completedPhaseLifecycleStatuses = new Set(["complete", "completed", "finalized"]);

export function selectHostedHomePhaseContext(contexts: PublicCompetitionContext[]): PublicCompetitionContext | null {
  return [...contexts]
    .sort((left, right) => (left.selectedPhase?.phaseOrder ?? Number.MAX_SAFE_INTEGER) - (right.selectedPhase?.phaseOrder ?? Number.MAX_SAFE_INTEGER))
    .find((context) => {
      const phase = context.selectedPhase;
      return phase !== null
        && !completedPhaseLifecycleStatuses.has(phase.lifecycleStatus ?? "")
        && selectHostedNextCompetitiveBlock(context) !== null;
    }) ?? null;
}

export function selectHostedLatestResultsBlock(contexts: PublicCompetitionContext[]): HostedNextCompetitiveBlock | null {
  const competitionId = contexts.find((context) => context.selectedCompetition)?.selectedCompetition?.id;
  if (!competitionId) return null;

  const scopedContexts = contexts
    .filter((context) => context.selectedCompetition?.id === competitionId)
    .sort((left, right) => (right.selectedPhase?.phaseOrder ?? Number.MIN_SAFE_INTEGER) - (left.selectedPhase?.phaseOrder ?? Number.MIN_SAFE_INTEGER));

  for (const context of scopedContexts) {
    if (!context.selectedPhase) continue;
    const completed = (context.selectedPhase.format === "series"
      ? context.seriesHistory.flatMap((matchup) => matchup.rounds
        .flatMap((round) => round.kind === "game" && round.game?.publicStatus === "completed" ? [round.game] : []))
      : context.games.filter((game) => game.publicStatus === "completed"))
      .sort((left, right) => right.roundNumber - left.roundNumber || byCanonicalGameOrder(left, right));
    const roundNumber = completed[0]?.roundNumber;
    if (roundNumber === undefined) continue;
    const games = completed.filter((game) => game.roundNumber === roundNumber).sort(byCanonicalGameOrder);
    const canonicalLabel = games.find((game) => game.roundLabel?.trim())?.roundLabel;
    return {
      kind: context.selectedPhase.format === "series" ? "series" : "matchday",
      label: canonicalLabel ?? (context.selectedPhase.format === "standings" ? `${roundNumber}η Αγωνιστική` : `ΓΥΡΟΣ ${roundNumber}`),
      games,
    };
  }

  return null;
}

export type PublicProgramResultsSelection = {
  context: PublicCompetitionContext;
  block: HostedNextCompetitiveBlock;
  completedFallback: boolean;
};

const contextContainsGame = (context: PublicCompetitionContext, gameId: string) =>
  context.games.some((game) => game.id === gameId)
  || context.seriesHistory.some((matchup) => matchup.rounds.some((round) => round.game?.id === gameId));

const fullCompetitiveBlock = (context: PublicCompetitionContext, selected: HostedNextCompetitiveBlock): HostedNextCompetitiveBlock => {
  const roundNumber = selected.games[0]?.roundNumber;
  if (roundNumber === undefined) return selected;
  const candidates = context.selectedPhase?.format === "series"
    ? context.seriesHistory.flatMap((matchup) => matchup.rounds.flatMap((round) =>
      round.roundNumber === roundNumber && round.kind !== "not_needed" && round.game ? [round.game] : []))
    : context.games.filter((game) => game.roundNumber === roundNumber);
  const games = [...new Map(candidates.map((game) => [game.id, game])).values()].sort(byCanonicalGameOrder);
  return { ...selected, games };
};

export function selectPublicProgramResultsBlock(contexts: PublicCompetitionContext[]): PublicProgramResultsSelection | null {
  const competitionId = contexts.find((context) => context.selectedCompetition)?.selectedCompetition?.id;
  if (!competitionId) return null;
  const scopedContexts = contexts.filter((context) => context.selectedCompetition?.id === competitionId);
  const currentContext = selectHostedHomePhaseContext(scopedContexts);
  const currentBlock = selectHostedNextCompetitiveBlock(currentContext);
  if (currentContext && currentBlock) {
    return { context: currentContext, block: fullCompetitiveBlock(currentContext, currentBlock), completedFallback: false };
  }
  const latestBlock = selectHostedLatestResultsBlock(scopedContexts);
  const firstLatestGame = latestBlock?.games[0];
  if (!latestBlock || !firstLatestGame) return null;
  const latestContext = scopedContexts.find((context) => contextContainsGame(context, firstLatestGame.id));
  return latestContext ? { context: latestContext, block: latestBlock, completedFallback: true } : null;
}

export type PublicNavigableCompetitiveBlock = PublicProgramResultsSelection & { key: string };

export type PublicProgramResultsNavigation = {
  blocks: PublicNavigableCompetitiveBlock[];
  selected: PublicNavigableCompetitiveBlock | null;
  previous: PublicNavigableCompetitiveBlock | null;
  next: PublicNavigableCompetitiveBlock | null;
};

const navigableBlockKey = (context: PublicCompetitionContext, kind: HostedNextCompetitiveBlock["kind"], roundNumber: number) =>
  `${context.selectedPhase?.id ?? "phase"}:${kind}:${roundNumber}`;

export function listPublicNavigableCompetitiveBlocks(contexts: PublicCompetitionContext[]): PublicNavigableCompetitiveBlock[] {
  const competitionId = contexts.find((context) => context.selectedCompetition)?.selectedCompetition?.id;
  if (!competitionId) return [];
  return contexts
    .filter((context) => context.selectedCompetition?.id === competitionId && context.selectedPhase)
    .sort((left, right) => (left.selectedPhase?.phaseOrder ?? Number.MAX_SAFE_INTEGER) - (right.selectedPhase?.phaseOrder ?? Number.MAX_SAFE_INTEGER))
    .flatMap((context) => {
      const phase = context.selectedPhase!;
      const kind: HostedNextCompetitiveBlock["kind"] = phase.format === "series" ? "series" : "matchday";
      const candidates = phase.format === "series"
        ? context.seriesHistory.flatMap((matchup) => matchup.rounds.flatMap((round) => round.kind !== "not_needed" && round.game ? [round.game] : []))
        : context.games;
      const roundNumbers = [...new Set(candidates.map((game) => game.roundNumber))].sort((left, right) => left - right);
      return roundNumbers.flatMap((roundNumber) => {
        const seed = candidates.find((game) => game.roundNumber === roundNumber);
        if (!seed) return [];
        const canonicalLabel = candidates.find((game) => game.roundNumber === roundNumber && game.roundLabel?.trim())?.roundLabel;
        const label = canonicalLabel ?? (phase.format === "standings" ? `${roundNumber}η Αγωνιστική` : `ΓΥΡΟΣ ${roundNumber}`);
        return [{
          key: navigableBlockKey(context, kind, roundNumber),
          context,
          block: fullCompetitiveBlock(context, { kind, label, games: [seed] }),
          completedFallback: false,
        }];
      });
    });
}

export function selectPublicProgramResultsNavigation(contexts: PublicCompetitionContext[], manualBlockKey?: string): PublicProgramResultsNavigation {
  const blocks = listPublicNavigableCompetitiveBlocks(contexts);
  const automatic = selectPublicProgramResultsBlock(contexts);
  const automaticRound = automatic?.block.games[0]?.roundNumber;
  const automaticKey = automatic && automaticRound !== undefined
    ? navigableBlockKey(automatic.context, automatic.block.kind, automaticRound)
    : null;
  const manualIndex = manualBlockKey ? blocks.findIndex((block) => block.key === manualBlockKey) : -1;
  const automaticIndex = automaticKey ? blocks.findIndex((block) => block.key === automaticKey) : -1;
  const selectedIndex = manualIndex >= 0 ? manualIndex : automaticIndex;
  const baseSelection = selectedIndex >= 0 ? blocks[selectedIndex] : null;
  const selected = baseSelection
    ? { ...baseSelection, completedFallback: manualIndex < 0 && automatic?.completedFallback === true }
    : null;
  return {
    blocks,
    selected,
    previous: selectedIndex > 0 ? blocks[selectedIndex - 1] : null,
    next: selectedIndex >= 0 && selectedIndex < blocks.length - 1 ? blocks[selectedIndex + 1] : null,
  };
}

function GameRow({ game, gameBasePath, liveGameHref }: { game: PublicGame; gameBasePath: string; liveGameHref: (gameId: string) => string }) {
  const metadata = [game.scheduledDate ? formatPublicDate(game.scheduledDate) : null, game.scheduledTime, game.venue?.name].filter(Boolean).join(" · ");
  return <article className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
      <strong className="min-w-0 break-words text-sm sm:text-base">{game.homeTeam.name}</strong>
      <div className="min-w-16 text-center"><PublicGameResult game={game} gameBasePath={gameBasePath} className="w-full rounded-xl bg-zinc-950 px-3 py-2 font-black tabular-nums text-white" />{game.liveAvailable ? <Link href={liveGameHref(game.id)} className="mt-2 inline-flex min-h-10 items-center rounded-lg bg-emerald-500 px-3 text-xs font-black tracking-wider text-emerald-950">LIVE</Link> : null}</div>
      <strong className="min-w-0 break-words text-right text-sm sm:text-base">{game.awayTeam.name}</strong>
    </div>
    {metadata ? <p className="mt-3 text-center text-xs font-bold text-zinc-500">{metadata}</p> : null}
  </article>;
}

export function PublicHomeCompetitiveBlocks({ context, phaseContexts = [], gameBasePath, liveGameHref }: { context: PublicCompetitionContext | null; phaseContexts?: PublicCompetitionContext[]; gameBasePath: string; liveGameHref: (gameId: string) => string }) {
  const nextBlock = selectHostedNextCompetitiveBlock(context);
  const latestBlock = selectHostedLatestResultsBlock(phaseContexts.length > 0 ? phaseContexts : context ? [context] : []);
  return <div className="grid gap-8 lg:grid-cols-2">
    <section><p className="text-xs font-black uppercase tracking-[.18em] text-orange-600">Πρόγραμμα</p><h2 className="mt-2 text-2xl font-black">ΕΠΟΜΕΝΟΙ ΑΓΩΝΕΣ</h2>{nextBlock ? <><div className="mt-4 rounded-2xl bg-zinc-950 px-4 py-3 text-white"><p className="text-[0.68rem] font-black uppercase tracking-[.18em] text-orange-400">Επόμενο αγωνιστικό block</p><h3 className="mt-1 text-lg font-black">{nextBlock.label}</h3></div><div className="mt-3 space-y-3">{nextBlock.games.map((game) => <GameRow key={game.id} game={game} gameBasePath={gameBasePath} liveGameHref={liveGameHref} />)}</div></> : <p className="mt-4 rounded-2xl border border-zinc-200 bg-white p-6 font-bold text-zinc-600">Δεν υπάρχουν ακόμη προγραμματισμένοι αγώνες.</p>}</section>
    <section><p className="text-xs font-black uppercase tracking-[.18em] text-orange-600">Επίσημα δεδομένα</p><h2 className="mt-2 text-2xl font-black">ΤΕΛΕΥΤΑΙΑ ΑΠΟΤΕΛΕΣΜΑΤΑ</h2>{latestBlock ? <><div className="mt-4 rounded-2xl bg-zinc-950 px-4 py-3 text-white"><p className="text-[0.68rem] font-black uppercase tracking-[.18em] text-orange-400">Τελευταίο αγωνιστικό block</p><h3 className="mt-1 text-lg font-black">{latestBlock.label}</h3></div><div className="mt-3 space-y-3">{latestBlock.games.map((game) => <GameRow key={game.id} game={game} gameBasePath={gameBasePath} liveGameHref={liveGameHref} />)}</div></> : <p className="mt-4 rounded-2xl border border-zinc-200 bg-white p-6 font-bold text-zinc-600">Δεν υπάρχουν ακόμη ολοκληρωμένοι αγώνες.</p>}</section>
  </div>;
}

export default function HostedOrganizationHomeData({ organizationSlug, context, phaseContexts = [] }: { organizationSlug: string; context: PublicCompetitionContext | null; phaseContexts?: PublicCompetitionContext[] }) {
  const competitionsPath = hostedOrganizationPath(organizationSlug, "competitions");
  const statisticsPath = hostedOrganizationPath(organizationSlug, "statistics");
  const selectedSeason = context?.selectedSeason ?? null;
  const competitionHref = (competitionSlug: string) => selectedSeason ? `${competitionsPath}?${new URLSearchParams({ season: selectedSeason.slug, competition: competitionSlug })}` : competitionsPath;
  const standings = context?.selectedPhase?.format === "standings" ? context.standings.slice(0, 5) : [];
  return <section className="bg-stone-50 px-5 py-12 sm:px-7 sm:py-16" aria-label="Αγωνιστική εικόνα Οργανισμού">
    <div className="mx-auto max-w-6xl space-y-10">
      <section><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.2em] text-orange-600">Δημόσιες διοργανώσεις</p><h2 className="mt-2 text-3xl font-black">ΔΙΟΡΓΑΝΩΣΕΙΣ</h2></div><Link href={competitionsPath} className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-black text-white">Όλες οι διοργανώσεις</Link></div>{context?.competitions.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{context.competitions.map((competition) => <Link key={competition.id} href={competitionHref(competition.slug)} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-orange-400"><span className="text-xs font-black uppercase tracking-wide text-orange-700">{selectedSeason?.name}</span><strong className="mt-2 block text-xl text-zinc-950">{competition.name}</strong></Link>)}</div> : <p className="mt-5 rounded-2xl border border-zinc-200 bg-white p-6 font-bold text-zinc-600">Δεν υπάρχουν διαθέσιμες διοργανώσεις.</p>}</section>
      <PublicHomeCompetitiveBlocks
        context={context}
        phaseContexts={phaseContexts}
        gameBasePath={`${competitionsPath}/games`}
        liveGameHref={(gameId) => hostedCompetitionGamePath(organizationSlug, gameId, true)}
      />
      <section className="rounded-3xl bg-zinc-950 p-5 text-white shadow-xl sm:p-7"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.18em] text-orange-400">{context?.selectedCompetition?.name ?? "Βαθμολογία"}</p><h2 className="mt-2 text-2xl font-black">ΒΑΘΜΟΛΟΓΙΑ</h2></div><Link href={statisticsPath} className="rounded-full border border-zinc-600 px-5 py-2.5 text-sm font-black hover:border-orange-400">Στατιστικά &amp; MVP</Link></div>{standings.length ? <div className="mt-5 max-w-full overflow-x-auto rounded-2xl border border-zinc-700" tabIndex={0} aria-label="Βαθμολογία Οργανισμού"><table className="w-full min-w-[720px] border-collapse text-sm"><thead><tr className="bg-zinc-900 text-xs font-black uppercase tracking-wide text-zinc-300"><th className="px-3 py-3 text-center">Θ</th><th className="px-3 py-3 text-left">ΟΜΑΔΑ</th><th className="px-3 py-3 text-center">ΑΓ</th><th className="px-3 py-3 text-center">Ν</th><th className="px-3 py-3 text-center">Η</th><th className="px-3 py-3 text-center">ΥΠ</th><th className="px-3 py-3 text-center">Δ</th><th className="px-3 py-3 text-center">Β</th></tr></thead><tbody>{standings.map((row) => <tr key={row.team.id} className="border-t border-zinc-700 bg-zinc-950"><td className="px-3 py-3 text-center font-black text-orange-400">{row.rank}</td><td className="whitespace-nowrap px-3 py-3 font-black">{row.team.name}</td><td className="px-3 py-3 text-center tabular-nums">{row.gamesPlayed}</td><td className="px-3 py-3 text-center tabular-nums">{row.wins}</td><td className="px-3 py-3 text-center tabular-nums">{row.losses}</td><td className="px-3 py-3 text-center tabular-nums">{row.pointsFor}–{row.pointsAgainst}</td><td className="px-3 py-3 text-center tabular-nums">{row.pointDifference > 0 ? `+${row.pointDifference}` : row.pointDifference}</td><td className="px-3 py-3 text-center font-black tabular-nums">{row.standingsPoints}</td></tr>)}</tbody></table></div> : <p className="mt-5 rounded-2xl bg-zinc-900 p-5 font-bold text-zinc-300">Δεν υπάρχει διαθέσιμη βαθμολογία για την επιλεγμένη διοργάνωση και φάση.</p>}</section>
    </div>
  </section>;
}
