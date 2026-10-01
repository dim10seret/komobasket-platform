import Link from "next/link";
import PublicGameResult from "@/components/competition/PublicGameResult";
import { hostedCompetitionGamePath, hostedOrganizationPath } from "@/lib/hosted-organization-routes";
import { formatPublicDate } from "@/lib/public-date";
import {
  isPublicProvisionalGame,
  type PublicCompetitionContext,
  type PublicGame,
  type PublicScheduleEntry,
} from "@/services/public-competition.service";

export type HostedNextCompetitiveBlock = {
  kind: "matchday" | "series";
  label: string;
  games: PublicScheduleEntry[];
};

const isRealPublicGame = (game: PublicScheduleEntry): game is PublicGame => !isPublicProvisionalGame(game);
const isUnresolvedPublicGame = (game: PublicScheduleEntry) => isPublicProvisionalGame(game) || game.publicStatus === "scheduled" || game.publicStatus === "live";
const byCanonicalGameOrder = (left: PublicScheduleEntry, right: PublicScheduleEntry) => (left.gameOrder ?? Number.MAX_SAFE_INTEGER) - (right.gameOrder ?? Number.MAX_SAFE_INTEGER) || left.id.localeCompare(right.id);
const canonicalRoundLabel = (games: PublicScheduleEntry[], roundNumber: number) =>
  games.find((game): game is PublicGame => game.roundNumber === roundNumber && isRealPublicGame(game) && Boolean(game.roundLabel?.trim()))?.roundLabel;

export function selectHostedNextCompetitiveBlock(context: PublicCompetitionContext | null): HostedNextCompetitiveBlock | null {
  if (!context?.selectedPhase) return null;
  if (context.selectedPhase.format === "series") {
    const unresolvedReal = context.seriesHistory
      .flatMap((matchup) => matchup.rounds
        .flatMap((round) => round.kind === "game" && round.game && isUnresolvedPublicGame(round.game) ? [round.game] : []))
    const unresolved = [...unresolvedReal, ...context.games.filter(isPublicProvisionalGame)]
      .sort((left, right) => left.roundNumber - right.roundNumber || byCanonicalGameOrder(left, right));
    const roundNumber = unresolved[0]?.roundNumber;
    if (roundNumber === undefined) return null;
    const games = unresolved.filter((game) => game.roundNumber === roundNumber);
    const canonicalLabel = canonicalRoundLabel(games, roundNumber);
    return { kind: "series", label: canonicalLabel ?? `ΓΥΡΟΣ ${roundNumber}`, games };
  }

  const unresolved = context.games.filter(isUnresolvedPublicGame).sort((left, right) => left.roundNumber - right.roundNumber || byCanonicalGameOrder(left, right));
  const roundNumber = unresolved[0]?.roundNumber;
  if (roundNumber === undefined) return null;
  const games = unresolved.filter((game) => game.roundNumber === roundNumber);
  const canonicalLabel = canonicalRoundLabel(context.games, roundNumber);
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

export type HostedTournamentHomeGroup = {
  rootPhaseId: string;
  tournamentName: string;
  contexts: PublicCompetitionContext[];
  currentContext: PublicCompetitionContext | null;
};

export function selectHostedTournamentHomeGroups(contexts: PublicCompetitionContext[]): HostedTournamentHomeGroup[] {
  const competitionId = contexts.find((context) => context.selectedCompetition)?.selectedCompetition?.id;
  if (!competitionId) return [];
  const groups = new Map<string, { rootPhaseId: string; tournamentName: string; rootPhaseOrder: number; contexts: PublicCompetitionContext[] }>();
  for (const context of contexts) {
    const phase = context.selectedPhase;
    if (!phase || context.selectedCompetition?.id !== competitionId) continue;
    const rootPhaseId = phase.rootPhaseId || context.selectedTournament?.rootPhaseId || phase.id;
    const rootPhase = context.phases.find((candidate) => candidate.id === rootPhaseId);
    const existing = groups.get(rootPhaseId);
    const group = existing ?? {
      rootPhaseId,
      tournamentName: context.selectedTournament?.name || phase.tournamentName || rootPhase?.name || phase.name,
      rootPhaseOrder: rootPhase?.phaseOrder ?? (phase.id === rootPhaseId ? phase.phaseOrder : Number.MAX_SAFE_INTEGER),
      contexts: [],
    };
    group.contexts.push(context);
    groups.set(rootPhaseId, group);
  }
  return [...groups.values()]
    .sort((left, right) => left.rootPhaseOrder - right.rootPhaseOrder || left.rootPhaseId.localeCompare(right.rootPhaseId))
    .map(({ rootPhaseId, tournamentName, contexts: groupContexts }) => ({
      rootPhaseId,
      tournamentName,
      contexts: groupContexts,
      currentContext: selectHostedHomePhaseContext(groupContexts),
    }));
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
      : context.games.filter((game): game is PublicGame => isRealPublicGame(game) && game.publicStatus === "completed"))
      .sort((left, right) => right.roundNumber - left.roundNumber || byCanonicalGameOrder(left, right));
    const roundNumber = completed[0]?.roundNumber;
    if (roundNumber === undefined) continue;
    const games = completed.filter((game) => game.roundNumber === roundNumber).sort(byCanonicalGameOrder);
    const canonicalLabel = canonicalRoundLabel(games, roundNumber);
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
    ? [
      ...context.seriesHistory.flatMap((matchup) => matchup.rounds.flatMap((round) =>
        round.roundNumber === roundNumber && round.kind !== "not_needed" && round.game ? [round.game] : [])),
      ...context.games.filter((game) => isPublicProvisionalGame(game) && game.roundNumber === roundNumber),
    ]
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
        ? [
          ...context.seriesHistory.flatMap((matchup) => matchup.rounds.flatMap((round) => round.kind !== "not_needed" && round.game ? [round.game] : [])),
          ...context.games.filter(isPublicProvisionalGame),
        ]
        : context.games;
      const roundNumbers = [...new Set(candidates.map((game) => game.roundNumber))].sort((left, right) => left - right);
      return roundNumbers.flatMap((roundNumber) => {
        const seed = candidates.find((game) => game.roundNumber === roundNumber);
        if (!seed) return [];
        const canonicalLabel = canonicalRoundLabel(candidates, roundNumber);
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

function GameRow({ game, gameBasePath, liveGameHref }: { game: PublicScheduleEntry; gameBasePath: string; liveGameHref: (gameId: string) => string }) {
  if (isPublicProvisionalGame(game)) {
    const metadata = [game.scheduledDate ? formatPublicDate(game.scheduledDate) : null, game.scheduledTime, game.venue].filter(Boolean).join(" · ");
    return <article className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        <strong className="min-w-0 text-sm leading-5 sm:text-base">{game.homeParticipantLabel}</strong>
        <span className="min-w-20 rounded-xl bg-orange-50 px-3 py-2 text-center text-xs font-black uppercase tracking-wide text-orange-800">Πρόγραμμα</span>
        <strong className="min-w-0 text-right text-sm leading-5 sm:text-base">{game.awayParticipantLabel}</strong>
      </div>
      {metadata ? <p className="mt-3 text-center text-xs font-bold text-zinc-500">{metadata}</p> : null}
    </article>;
  }
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

function HostedCurrentSeriesSummary({ context }: { context: PublicCompetitionContext | null }) {
  if (context?.selectedPhase?.format !== "series") return null;
  const series = context.seriesHistory.flatMap((matchup) => matchup.summary ? [{ ...matchup, summary: matchup.summary }] : []);
  if (!series.length) return null;
  const winsRequired = series[0].summary.winsRequired;
  const roundNumbers = Array.from({ length: Math.max(...series.map((matchup) => matchup.maximumSeriesRounds)) }, (_, index) => index + 1);
  return <div className="mt-5 min-w-0">
    <p className="text-sm font-bold text-zinc-300">{winsRequired === 1 ? "Πρόκριση στη 1 νίκη" : `Πρόκριση στις ${winsRequired} νίκες`}</p>
    <div className="mt-3 max-w-full overflow-x-auto rounded-2xl border border-zinc-700" tabIndex={0} role="region" aria-label="Σύνοψη σειρών τρέχουσας φάσης">
      <table className="w-full min-w-[720px] border-collapse text-sm">
        <caption className="sr-only">Αποτελέσματα στη σειρά των ομάδων Α – Β. Οι μεταφορές επισημαίνονται χωριστά.</caption>
        <thead><tr className="bg-zinc-900 text-xs font-black uppercase tracking-wide text-zinc-300">
          <th scope="col" className="px-3 py-3 text-left">ΑΓΩΝΕΣ</th>
          {roundNumbers.map((roundNumber) => <th scope="col" key={roundNumber} className="whitespace-nowrap px-3 py-3 text-center">ΓΥΡΟΣ {roundNumber}</th>)}
          <th scope="col" className="px-3 py-3 text-center">ΣΕΙΡΑ</th>
          <th scope="col" className="px-3 py-3 text-left">ΚΑΤΑΣΤΑΣΗ</th>
        </tr></thead>
        <tbody>{series.map((matchup) => <tr key={matchup.matchupId} className="border-t border-zinc-700">
          <th scope="row" className="whitespace-nowrap px-3 py-3 text-left font-black">{matchup.summary.teamAName} – {matchup.summary.teamBName}</th>
          {roundNumbers.map((roundNumber) => {
            const round = matchup.rounds.find((entry) => entry.roundNumber === roundNumber);
            const game = round?.kind !== "not_needed" ? round?.game : null;
            const hasResult = game?.publicStatus === "completed" && game.homeScore !== null && game.awayScore !== null;
            // Scores follow the matchup's A/B order, even when the home team alternates.
            const score = hasResult
              ? game.homeTeam.id === matchup.summary.teamAId ? `${game.homeScore}–${game.awayScore}` : `${game.awayScore}–${game.homeScore}`
              : "—";
            return <td key={roundNumber} className="whitespace-nowrap px-3 py-3 text-center tabular-nums" title={hasResult ? `${game.homeTeam.name} ${game.homeScore}–${game.awayScore} ${game.awayTeam.name}` : undefined}>
              {score}
              {round?.kind === "transferred" ? <span className="mt-1 block text-xs font-bold text-orange-400" title={round.sourcePhaseName ?? undefined}>Μεταφορά</span> : null}
            </td>;
          })}
          <td className="whitespace-nowrap px-3 py-3 text-center font-black tabular-nums">
            {matchup.summary.currentWinsA}–{matchup.summary.currentWinsB}
            {matchup.summary.transferredRoundCount > 0 ? <span className="mt-1 block text-xs font-bold text-orange-400">{matchup.summary.transferredRoundCount === 1 ? "1 νίκη από μεταφορά" : `${matchup.summary.transferredRoundCount} νίκες από μεταφορά`}</span> : null}
          </td>
          <td className="whitespace-nowrap px-3 py-3 text-left text-xs font-black text-orange-400">{matchup.summary.qualifiedTeamId ? `ΠΡΟΚΡΙΣΗ ${matchup.summary.qualifiedTeamName}` : "ΣΕ ΕΞΕΛΙΞΗ"}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </div>;
}

function HostedSingleTournamentHomeData({ organizationSlug, context, phaseContexts = [], showCompetitionDirectory = true, tournamentHeading = null, includeTournamentContext = false }: { organizationSlug: string; context: PublicCompetitionContext | null; phaseContexts?: PublicCompetitionContext[]; showCompetitionDirectory?: boolean; tournamentHeading?: string | null; includeTournamentContext?: boolean }) {
  const competitionsPath = hostedOrganizationPath(organizationSlug, "competitions");
  const statisticsBasePath = hostedOrganizationPath(organizationSlug, "statistics");
  const selectedSeason = context?.selectedSeason ?? null;
  const competitionHref = (competitionSlug: string) => selectedSeason ? `${competitionsPath}?${new URLSearchParams({ season: selectedSeason.slug, competition: competitionSlug })}` : competitionsPath;
  const currentContext = selectHostedHomePhaseContext(phaseContexts.length > 0 ? phaseContexts : context ? [context] : []);
  const currentPhase = currentContext?.selectedPhase ?? null;
  const standings = currentContext?.selectedPhase?.format === "standings" ? currentContext.standings.slice(0, 5) : [];
  const currentRound = selectHostedNextCompetitiveBlock(currentContext);
  const tournamentParams = currentContext?.selectedSeason && currentContext.selectedCompetition
    ? new URLSearchParams({ season: currentContext.selectedSeason.slug, competition: currentContext.selectedCompetition.slug })
    : null;
  if (includeTournamentContext && tournamentParams && currentContext?.selectedTournament) tournamentParams.set("tournament", currentContext.selectedTournament.slug);
  const statisticsPath = includeTournamentContext && tournamentParams ? `${statisticsBasePath}?${tournamentParams}` : statisticsBasePath;
  if (currentPhase && tournamentParams) tournamentParams.set("phase", currentPhase.slug);
  const currentPhaseHref = currentContext?.selectedSeason && currentContext.selectedCompetition && currentPhase
    ? `${competitionsPath}?${tournamentParams}#program-results`
    : competitionsPath;
  return <section className="bg-stone-50 px-5 py-12 sm:px-7 sm:py-16" aria-label={tournamentHeading ? `Θεσμός ${tournamentHeading}` : "Αγωνιστική εικόνα Οργανισμού"}>
    <div className="mx-auto max-w-6xl space-y-10">
      {showCompetitionDirectory ? <section><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.2em] text-orange-600">Δημόσιες διοργανώσεις</p><h2 className="mt-2 text-3xl font-black">ΔΙΟΡΓΑΝΩΣΕΙΣ</h2></div><Link href={competitionsPath} className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-black text-white">Όλες οι διοργανώσεις</Link></div>{context?.competitions.length ? <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{context.competitions.map((competition) => <Link key={competition.id} href={competitionHref(competition.slug)} className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition hover:border-orange-400"><span className="text-xs font-black uppercase tracking-wide text-orange-700">{selectedSeason?.name}</span><strong className="mt-2 block text-xl text-zinc-950">{competition.name}</strong></Link>)}</div> : <p className="mt-5 rounded-2xl border border-zinc-200 bg-white p-6 font-bold text-zinc-600">Δεν υπάρχουν διαθέσιμες διοργανώσεις.</p>}</section> : null}
      {tournamentHeading ? <header className="rounded-3xl border border-orange-200 bg-orange-50 px-5 py-4 shadow-sm sm:px-7"><p className="text-xs font-black uppercase tracking-[.2em] text-orange-700">Θεσμός</p><h2 className="mt-1 text-2xl font-black text-zinc-950">{tournamentHeading}</h2></header> : null}
      <PublicHomeCompetitiveBlocks
        context={context}
        phaseContexts={phaseContexts}
        gameBasePath={`${competitionsPath}/games`}
        liveGameHref={(gameId) => hostedCompetitionGamePath(organizationSlug, gameId, true)}
      />
      {currentPhase?.format === "standings" ? <section className="rounded-3xl bg-zinc-950 p-5 text-white shadow-xl sm:p-7"><div className="flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-[.18em] text-orange-400">{tournamentHeading ? currentPhase?.name ?? tournamentHeading : context?.selectedCompetition?.name ?? "Βαθμολογία"}</p><h2 className="mt-2 text-2xl font-black">ΒΑΘΜΟΛΟΓΙΑ</h2></div><Link href={statisticsPath} className="rounded-full border border-zinc-600 px-5 py-2.5 text-sm font-black hover:border-orange-400">Στατιστικά &amp; MVP</Link></div>{standings.length ? <div className="mt-5 max-w-full overflow-x-auto rounded-2xl border border-zinc-700" tabIndex={0} aria-label="Βαθμολογία Οργανισμού"><table className="w-full min-w-[720px] border-collapse text-sm"><thead><tr className="bg-zinc-900 text-xs font-black uppercase tracking-wide text-zinc-300"><th className="px-3 py-3 text-center">Θ</th><th className="px-3 py-3 text-left">ΟΜΑΔΑ</th><th className="px-3 py-3 text-center">ΑΓ</th><th className="px-3 py-3 text-center">Ν</th><th className="px-3 py-3 text-center">Η</th><th className="px-3 py-3 text-center">ΥΠ</th><th className="px-3 py-3 text-center">Δ</th><th className="px-3 py-3 text-center">Β</th></tr></thead><tbody>{standings.map((row) => <tr key={row.team.id} className="border-t border-zinc-700 bg-zinc-950"><td className="px-3 py-3 text-center font-black text-orange-400">{row.rank}</td><td className="whitespace-nowrap px-3 py-3 font-black">{row.team.name}</td><td className="px-3 py-3 text-center tabular-nums">{row.gamesPlayed}</td><td className="px-3 py-3 text-center tabular-nums">{row.wins}</td><td className="px-3 py-3 text-center tabular-nums">{row.losses}</td><td className="px-3 py-3 text-center tabular-nums">{row.pointsFor}–{row.pointsAgainst}</td><td className="px-3 py-3 text-center tabular-nums">{row.pointDifference > 0 ? `+${row.pointDifference}` : row.pointDifference}</td><td className="px-3 py-3 text-center font-black tabular-nums">{row.standingsPoints}</td></tr>)}</tbody></table></div> : <p className="mt-5 rounded-2xl bg-zinc-900 p-5 font-bold text-zinc-300">Δεν υπάρχει διαθέσιμη βαθμολογία για την επιλεγμένη διοργάνωση και φάση.</p>}</section> : <section className="min-w-0 rounded-3xl bg-zinc-950 p-5 text-white shadow-xl sm:p-7" aria-label="Τρέχουσα φάση">
        <h2 className="text-2xl font-black">ΤΡΕΧΟΥΣΑ ΦΑΣΗ</h2>
        {currentPhase ? <>
          <h3 className="mt-4 whitespace-normal break-normal text-xl font-black">{currentPhase.name}</h3>
          {currentRound ? <p className="mt-2 whitespace-normal break-normal text-sm font-bold text-orange-400">{currentRound.label}</p> : null}
          <HostedCurrentSeriesSummary context={currentContext} />
          <Link href={currentPhaseHref} className="mt-5 inline-flex min-h-11 max-w-full items-center rounded-full border border-zinc-600 px-5 py-2.5 text-sm font-black hover:border-orange-400">Πρόγραμμα &amp; Αποτελέσματα</Link>
        </> : <p className="mt-5 rounded-2xl bg-zinc-900 p-5 font-bold text-zinc-300">Δεν υπάρχει διαθέσιμη τρέχουσα φάση.</p>}
      </section>}
    </div>
  </section>;
}

export default function HostedOrganizationHomeData({ organizationSlug, context, phaseContexts = [] }: { organizationSlug: string; context: PublicCompetitionContext | null; phaseContexts?: PublicCompetitionContext[] }) {
  const sourceContexts = phaseContexts.length > 0 ? phaseContexts : context ? [context] : [];
  const tournamentGroups = selectHostedTournamentHomeGroups(sourceContexts);
  if (tournamentGroups.length <= 1) {
    return <HostedSingleTournamentHomeData organizationSlug={organizationSlug} context={context} phaseContexts={phaseContexts} />;
  }
  return <>{tournamentGroups.map((group, index) => <HostedSingleTournamentHomeData
    key={group.rootPhaseId}
    organizationSlug={organizationSlug}
    context={group.currentContext ?? group.contexts[0] ?? context}
    phaseContexts={group.contexts}
    showCompetitionDirectory={index === 0}
    tournamentHeading={group.tournamentName}
    includeTournamentContext
  />)}</>;
}
