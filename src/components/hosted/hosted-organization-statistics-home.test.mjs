import fs from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import HostedOrganizationHomeData, { PublicHomeCompetitiveBlocks, selectHostedHomePhaseContext, selectHostedLatestResultsBlock, selectHostedNextCompetitiveBlock } from "./HostedOrganizationHomeData";

const source = (relativePath) => fs.readFileSync(path.resolve(import.meta.dirname, relativePath), "utf8");
const statisticsService = source("../../services/public-competition-statistics.service.ts");
const publicCompetitionService = source("../../services/public-competition.service.ts");
const statisticsComponent = source("../competition/PublicCompetitionStatistics.tsx");
const hostedStatistics = source("../../app/(hosted)/[organizationSlug]/statistics/page.tsx");
const hostedHome = source("../../app/(hosted)/[organizationSlug]/page.tsx");
const homeData = source("HostedOrganizationHomeData.tsx");
const centralStats = source("../../app/(central)/stats/page.tsx");
const centralHome = source("../../app/(central)/page.tsx");

const fixtureTeam = (id, name) => ({ id, name, logoUrl: null });
const fixtureGame = (id, roundNumber, publicStatus, options = {}) => ({
  id,
  roundNumber,
  gameOrder: options.gameOrder ?? 1,
  roundLabel: options.roundLabel ?? `${roundNumber}η Αγωνιστική`,
  scheduledDate: options.scheduledDate ?? "2026-09-10",
  scheduledTime: options.scheduledTime ?? "18:00",
  venue: options.venue ?? null,
  homeScore: publicStatus === "completed" ? options.homeScore ?? 70 : null,
  awayScore: publicStatus === "completed" ? options.awayScore ?? 60 : null,
  publicStatus,
  liveAvailable: publicStatus === "live",
  finalizedStatisticsAvailable: publicStatus === "completed",
  videoUrl: null,
  homeTeam: fixtureTeam(`${id}-home`, `${id} HOME`),
  awayTeam: fixtureTeam(`${id}-away`, `${id} AWAY`),
});
const fixtureContext = (format, games, seriesHistory = [], phase = {}) => ({
  seasons: [], competitions: [], phases: [], games, standings: [], seriesHistory, bracket: null, teamView: null,
  selectedSeason: { id: "season-run", slug: "2026-27", name: "2026-27" },
  selectedCompetition: { id: "competition-run", slug: "run-cup", name: "RUN CUP", type: "league", lifecycleStatus: "online", gameMode: "FULL" },
  selectedPhase: { id: "phase-run", slug: "phase", name: "Phase", phaseOrder: phase.phaseOrder ?? 1, lifecycleStatus: phase.lifecycleStatus ?? "active", format, phaseType: format, participantCount: 8, roundCount: 8, winsRequired: format === "series" ? 2 : null, directAdvancements: [], standingsPresentation: { directQualification: [], playOut: [], eliminated: [] }, ...phase },
});

describe("hosted organization statistics and dynamic home", () => {
  it("parameterizes statistics while preserving the central wrapper", () => { expect(statisticsService).toContain("readPublicCompetitionStatisticsForOrganizationWithDb"); expect(statisticsService).toContain("readAuthoritativeCompetitionStatisticalGamesWithDb(database, selectedCompetitionRow.competition_id, organizationId)"); expect(statisticsService).toContain("readPublicCompetitionStatisticsForOrganization(PUBLIC_KOMOBASKET_ORGANIZATION_ID, input)"); });
  it("uses the resolved organization and hosted canonical route", () => { expect(hostedStatistics).toContain("resolveHostedPublicOrganization"); expect(hostedStatistics).toContain("organization.organizationId"); expect(hostedStatistics).toContain('hostedOrganizationPath(organization.slug, "statistics")'); expect(hostedStatistics).toContain("alternates"); });
  it("keeps statistics navigation under the injected base path", () => { expect(statisticsComponent).toContain('basePath = "/stats"'); expect(statisticsComponent).toContain("router.push(`${basePath}?${params}`)"); expect(hostedStatistics).toContain("basePath={basePath}"); });
  it("loads every canonical Phase for the trusted hosted competition and passes them to both Home block projections", () => { expect(hostedHome).toContain("getPublicCompetitionContextForOrganization(organization.organizationId"); expect(hostedHome).toContain("defaultContext.phases.map"); expect(hostedHome).toContain("phaseSlug: phase.slug"); expect(hostedHome).toContain("selectHostedHomePhaseContext"); expect(hostedHome).toContain("phaseContexts={phaseContexts}"); expect(homeData).toContain("selectHostedLatestResultsBlock"); expect(homeData).not.toContain("organization_komobasket"); });
  it("skips a finalized Phase and selects the next active Phase with unresolved content", () => {
    const finalized = fixtureContext("standings", [fixtureGame("round-1-final", 1, "completed")], [], { id: "phase-1", phaseOrder: 1, lifecycleStatus: "finalized" });
    const active = fixtureContext("series", [], [{ matchupId: "series-active", label: "Series", maximumSeriesRounds: 5, rounds: [
      { roundNumber: 2, kind: "game", sourcePhaseName: null, game: fixtureGame("round-2", 2, "scheduled", { roundLabel: "ΓΥΡΟΣ 2" }) },
      { roundNumber: 3, kind: "game", sourcePhaseName: null, game: fixtureGame("round-3", 3, "scheduled", { roundLabel: "ΓΥΡΟΣ 3" }) },
      { roundNumber: 4, kind: "not_needed", sourcePhaseName: null, game: null },
      { roundNumber: 5, kind: "not_needed", sourcePhaseName: null, game: null },
    ] }], { id: "phase-2", phaseOrder: 2, lifecycleStatus: "active" });
    const selected = selectHostedHomePhaseContext([active, finalized]);
    expect(selected?.selectedPhase.id).toBe("phase-2");
    expect(selectHostedNextCompetitiveBlock(selected)?.games.map((game) => game.id)).toEqual(["round-2"]);
  });
  it("keeps the finalized prior-Phase result while the active Phase supplies the next block", () => {
    const finalized = fixtureContext("standings", [fixtureGame("runbasket-60-55", 1, "completed", { homeScore: 60, awayScore: 55, roundLabel: "ΓΥΡΟΣ 1" })], [], { id: "phase-1", phaseOrder: 1, lifecycleStatus: "finalized" });
    const active = fixtureContext("series", [], [{ matchupId: "series-active", label: "Series", maximumSeriesRounds: 3, rounds: [
      { roundNumber: 2, kind: "game", sourcePhaseName: null, game: fixtureGame("round-2", 2, "scheduled", { roundLabel: "ΓΥΡΟΣ 2" }) },
      { roundNumber: 3, kind: "game", sourcePhaseName: null, game: fixtureGame("round-3", 3, "scheduled", { roundLabel: "ΓΥΡΟΣ 3" }) },
    ] }], { id: "phase-2", phaseOrder: 2, lifecycleStatus: "active" });
    const selected = selectHostedHomePhaseContext([finalized, active]);
    expect(selectHostedLatestResultsBlock([finalized, active])?.games.map((game) => game.id)).toEqual(["runbasket-60-55"]);
    expect(selectHostedNextCompetitiveBlock(selected)?.games.map((game) => game.id)).toEqual(["round-2"]);
  });
  it("selects every unresolved game from the first incomplete canonical matchday", () => {
    const games = [1, 2, 3, 4].map((order) => fixtureGame(`round-5-${order}`, 5, "scheduled", { gameOrder: order, roundLabel: "5η Αγωνιστική" }));
    const block = selectHostedNextCompetitiveBlock(fixtureContext("standings", [...games, fixtureGame("round-6", 6, "scheduled") ]));
    expect(block?.kind).toBe("matchday");
    expect(block?.label).toBe("5η Αγωνιστική");
    expect(block?.games.map((game) => game.id)).toEqual(games.map((game) => game.id));
  });
  it("keeps a partially completed matchday and hides its FINAL games", () => {
    const context = fixtureContext("standings", [
      fixtureGame("final-1", 5, "completed", { gameOrder: 1 }),
      fixtureGame("final-2", 5, "completed", { gameOrder: 2 }),
      fixtureGame("scheduled-5", 5, "scheduled", { gameOrder: 3 }),
      fixtureGame("live-5", 5, "live", { gameOrder: 4 }),
      fixtureGame("scheduled-6", 6, "scheduled", { gameOrder: 1 }),
    ]);
    expect(selectHostedNextCompetitiveBlock(context)?.games.map((game) => game.id)).toEqual(["scheduled-5", "live-5"]);
    expect(selectHostedLatestResultsBlock([context])?.games.map((game) => game.id)).toEqual(["final-1", "final-2"]);
    expect(selectHostedLatestResultsBlock([context])?.label).toBe("5η Αγωνιστική");
  });
  it("advances only after a matchday is complete", () => {
    const context = fixtureContext("standings", [fixtureGame("final-5-a", 5, "completed"), fixtureGame("final-5-b", 5, "completed", { gameOrder: 2 }), fixtureGame("scheduled-6", 6, "scheduled", { roundLabel: "6η Αγωνιστική" })]);
    const block = selectHostedNextCompetitiveBlock(context);
    expect(block?.label).toBe("6η Αγωνιστική");
    expect(block?.games.map((game) => game.id)).toEqual(["scheduled-6"]);
    expect(selectHostedLatestResultsBlock([context])?.games.map((game) => game.id)).toEqual(["final-5-a", "final-5-b"]);
  });
  it("shows only the earliest unresolved required Series round", () => {
    const seriesOne = { matchupId: "series-1", label: "Series A", maximumSeriesRounds: 3, rounds: [
      { roundNumber: 1, kind: "game", sourcePhaseName: null, game: fixtureGame("series-1-final", 1, "completed") },
      { roundNumber: 2, kind: "game", sourcePhaseName: null, game: fixtureGame("series-1-next", 2, "scheduled", { roundLabel: "ΓΥΡΟΣ 2" }) },
      { roundNumber: 3, kind: "game", sourcePhaseName: null, game: fixtureGame("series-1-later", 3, "scheduled", { roundLabel: "ΓΥΡΟΣ 3" }) },
    ] };
    const block = selectHostedNextCompetitiveBlock(fixtureContext("series", [], [seriesOne]));
    expect(block?.kind).toBe("series");
    expect(block?.label).toBe("ΓΥΡΟΣ 2");
    expect(block?.games.map((game) => game.id)).toEqual(["series-1-next"]);
  });
  it("groups every eligible parallel Series game in the earliest unresolved round", () => {
    const series = (id) => ({ matchupId: id, label: id, maximumSeriesRounds: 3, rounds: [
      { roundNumber: 1, kind: "game", sourcePhaseName: null, game: fixtureGame(`${id}-final`, 1, "completed") },
      { roundNumber: 2, kind: "game", sourcePhaseName: null, game: fixtureGame(`${id}-round-2`, 2, "scheduled", { roundLabel: "ΓΥΡΟΣ 2" }) },
      { roundNumber: 3, kind: "game", sourcePhaseName: null, game: fixtureGame(`${id}-round-3`, 3, "scheduled", { roundLabel: "ΓΥΡΟΣ 3" }) },
    ] });
    const block = selectHostedNextCompetitiveBlock(fixtureContext("series", [], [series("series-a"), series("series-b")]));
    expect(block?.label).toBe("ΓΥΡΟΣ 2");
    expect(block?.games.map((game) => game.id)).toEqual(["series-a-round-2", "series-b-round-2"]);
  });
  it("splits a partially completed parallel Series round between Latest and Upcoming", () => {
    const history = [
      { matchupId: "series-a", label: "A", maximumSeriesRounds: 3, rounds: [{ roundNumber: 2, kind: "game", sourcePhaseName: null, game: fixtureGame("series-a-final", 2, "completed", { roundLabel: "ΓΥΡΟΣ 2" }) }] },
      { matchupId: "series-b", label: "B", maximumSeriesRounds: 3, rounds: [{ roundNumber: 2, kind: "game", sourcePhaseName: null, game: fixtureGame("series-b-final", 2, "completed", { roundLabel: "ΓΥΡΟΣ 2" }) }] },
      { matchupId: "series-c", label: "C", maximumSeriesRounds: 3, rounds: [
        { roundNumber: 2, kind: "game", sourcePhaseName: null, game: fixtureGame("series-c-next", 2, "scheduled", { roundLabel: "ΓΥΡΟΣ 2" }) },
        { roundNumber: 3, kind: "game", sourcePhaseName: null, game: fixtureGame("series-c-later", 3, "scheduled", { roundLabel: "ΓΥΡΟΣ 3" }) },
      ] },
    ];
    const context = fixtureContext("series", [], history);
    expect(selectHostedLatestResultsBlock([context])?.games.map((game) => game.id)).toEqual(["series-a-final", "series-b-final"]);
    expect(selectHostedNextCompetitiveBlock(context)?.games.map((game) => game.id)).toEqual(["series-c-next"]);
  });
  it("advances a Series phase only after the current Series round completes", () => {
    const history = [{ matchupId: "series-a", label: "Series A", maximumSeriesRounds: 3, rounds: [
      { roundNumber: 1, kind: "game", sourcePhaseName: null, game: fixtureGame("round-1-final", 1, "completed") },
      { roundNumber: 2, kind: "game", sourcePhaseName: null, game: fixtureGame("round-2-final", 2, "completed") },
      { roundNumber: 3, kind: "game", sourcePhaseName: null, game: fixtureGame("round-3-next", 3, "scheduled", { roundLabel: "ΓΥΡΟΣ 3" }) },
    ] }];
    expect(selectHostedNextCompetitiveBlock(fixtureContext("series", [], history))?.games.map((game) => game.id)).toEqual(["round-3-next"]);
    expect(selectHostedLatestResultsBlock([fixtureContext("series", [], history)])?.games.map((game) => game.id)).toEqual(["round-2-final"]);
  });
  it("skips completed Series and best-of games marked canonically not needed", () => {
    const completed = { matchupId: "series-1", label: "Series A", maximumSeriesRounds: 5, rounds: [
      { roundNumber: 1, kind: "game", sourcePhaseName: null, game: fixtureGame("series-1-final", 1, "completed") },
      { roundNumber: 2, kind: "not_needed", sourcePhaseName: null, game: null },
      { roundNumber: 3, kind: "not_needed", sourcePhaseName: null, game: null },
    ] };
    const active = { matchupId: "series-2", label: "Canonical Series B", maximumSeriesRounds: 3, rounds: [{ roundNumber: 1, kind: "game", sourcePhaseName: null, game: fixtureGame("series-2-next", 1, "live") }] };
    const block = selectHostedNextCompetitiveBlock(fixtureContext("series", [], [completed, active]));
    expect(block?.label).toBe("1η Αγωνιστική");
    expect(block?.games.map((game) => game.id)).toEqual(["series-2-next"]);
    expect(selectHostedLatestResultsBlock([fixtureContext("series", [], [completed, active])])?.games.map((game) => game.id)).toEqual(["series-1-final"]);
  });
  it("does not fabricate a Series before dependencies and participants resolve", () => {
    expect(selectHostedNextCompetitiveBlock(fixtureContext("series", [], []))).toBeNull();
    expect(publicCompetitionService).toContain('matchup.state !== "resolved"');
  });
  it("provides real-data empty states without static KomoBasket fallback", () => { for (const text of ["Δεν υπάρχουν διαθέσιμες διοργανώσεις.", "Δεν υπάρχουν ακόμη προγραμματισμένοι αγώνες.", "Δεν υπάρχουν ακόμη ολοκληρωμένοι αγώνες.", "Δεν υπάρχει διαθέσιμη βαθμολογία"]) expect(homeData).toContain(text); expect(homeData).not.toContain("SVEKKO"); });
  it("never merges standings across competitions", () => { expect(homeData).toContain('context?.selectedPhase?.format === "standings"'); expect(homeData).toContain("context.standings.slice(0, 5)"); expect(homeData).toContain("context?.selectedCompetition?.name"); });
  it("renders every canonical standings field in a table-scoped responsive layout", () => {
    for (const value of ["row.rank", "row.team.name", "row.gamesPlayed", "row.wins", "row.losses", "row.pointsFor", "row.pointsAgainst", "row.pointDifference", "row.standingsPoints"]) expect(homeData).toContain(value);
    for (const value of ["overflow-x-auto", "min-w-[720px]", "whitespace-nowrap", 'aria-label="Βαθμολογία Οργανισμού"']) expect(homeData).toContain(value);
    expect(homeData).not.toMatch(/calculateStandings|standingsPoints\s*[+*/-]/);
  });
  it("keeps all Home links hosted and avoids legacy player/team routes", () => { expect(homeData).toContain("hostedOrganizationPath"); expect(homeData).toContain("hostedCompetitionGamePath"); expect(homeData).not.toContain('href="/competitions'); expect(homeData).not.toContain('href="/stats'); expect(homeData).not.toContain('href="/teams'); expect(homeData).not.toContain('href="/players'); });
  it("keeps central Stats unchanged while central Home uses the shared canonical blocks for KomoBasket", () => {
    expect(centralStats).toContain("readPublicCompetitionStatistics");
    expect(centralStats).not.toContain("readPublicCompetitionStatisticsForOrganization");
    expect(centralHome).toContain("PublicHomeCompetitiveBlocks");
    expect(centralHome).toContain('CENTRAL_KOMOBASKET_ORGANIZATION_ID = "organization_komobasket"');
    expect(centralHome).toContain("getPublicCompetitionContextForOrganization(CENTRAL_KOMOBASKET_ORGANIZATION_ID");
    expect(centralHome).toContain('gameBasePath="/competitions/games"');
    expect(centralHome).not.toContain("<NextGames");
    expect(centralHome).not.toContain("<LatestResults");
    expect(centralHome).not.toContain("<Standings");
    expect(centralHome).not.toContain('href="/schedule"');
    expect(centralHome).not.toContain('href="/standings"');
    expect(centralHome).toContain('href="/identity"');
  });
  it("renders central Upcoming and Latest Results from one partial canonical Matchday", () => {
    const context = fixtureContext("standings", [
      fixtureGame("central-final-a", 4, "completed", { gameOrder: 1 }),
      fixtureGame("central-final-b", 4, "completed", { gameOrder: 2 }),
      fixtureGame("central-next-a", 4, "scheduled", { gameOrder: 3 }),
      fixtureGame("central-next-b", 4, "live", { gameOrder: 4 }),
    ]);
    const html = renderToStaticMarkup(createElement(PublicHomeCompetitiveBlocks, {
      context,
      phaseContexts: [context],
      gameBasePath: "/competitions/games",
      liveGameHref: (gameId) => `/competitions/games/${gameId}/live`,
    }));
    for (const value of ["central-final-a HOME", "central-final-b HOME", "central-next-a HOME", "central-next-b HOME", "/competitions/games/central-next-b/live"]) expect(html).toContain(value);
    expect(html).not.toContain("/runbasket/");
  });
  it("renders only RunBasket competition, games, result and standings fixtures", () => {
    const team = (id, name) => ({ id, name, logoUrl: null });
    const game = (id, status, homeScore, awayScore) => ({ id, roundNumber: 1, gameOrder: 1, roundLabel: "1η", scheduledDate: status === "completed" ? "2026-09-01" : "2026-09-10", scheduledTime: "18:00", venue: null, homeScore, awayScore, publicStatus: status, liveAvailable: status === "live", finalizedStatisticsAvailable: status === "completed", videoUrl: null, homeTeam: team("run-home", "RUN HOME"), awayTeam: team("run-away", "RUN AWAY") });
    const html = renderToStaticMarkup(createElement(HostedOrganizationHomeData, { organizationSlug: "runbasket", context: {
      seasons: [{ id: "season-run", slug: "2026-27", name: "2026-27" }],
      competitions: [{ id: "competition-run", slug: "run-cup", name: "RUN CUP", type: "league", lifecycleStatus: "online", gameMode: "FULL" }],
      phases: [], games: [game("run-next", "scheduled", null, null), game("run-final", "completed", 70, 60)],
      standings: [
        { rank: 1, team: team("run-standing-first", "RUN STANDING FIRST"), gamesPlayed: 4, wins: 3, losses: 1, standingsPoints: 17, pointsFor: 315, pointsAgainst: 290, pointDifference: 25 },
        { rank: 2, team: team("run-standing-second", "RUN STANDING SECOND"), gamesPlayed: 4, wins: 2, losses: 2, standingsPoints: 0, pointsFor: 280, pointsAgainst: 300, pointDifference: -20 },
      ],
      seriesHistory: [], bracket: null, teamView: null,
      selectedSeason: { id: "season-run", slug: "2026-27", name: "2026-27" },
      selectedCompetition: { id: "competition-run", slug: "run-cup", name: "RUN CUP", type: "league", lifecycleStatus: "online", gameMode: "FULL" },
      selectedPhase: { id: "phase-run", slug: "regular", name: "Regular", format: "standings", phaseType: "regular", participantCount: 2, roundCount: 1, winsRequired: null, directAdvancements: [], standingsPresentation: { directQualification: [], playOut: [], eliminated: [] } },
    } }));
    for (const value of ["RUN CUP", "RUN HOME", "RUN AWAY", "RUN STANDING FIRST", "RUN STANDING SECOND", "315–290", "+25", "280–300", "-20", ">17<", ">0<", "10/09/2026", "01/09/2026", "/runbasket/competitions"]) expect(html).toContain(value);
    expect(html.indexOf("RUN STANDING FIRST")).toBeLessThan(html.indexOf("RUN STANDING SECOND"));
    expect(html).not.toContain("KOMOBASKET COMPETITION");
    expect(html).not.toContain("KOMOBASKET MVP");
  });
  it("renders clean no-data states without a central fallback", () => {
    const html = renderToStaticMarkup(createElement(HostedOrganizationHomeData, { organizationSlug: "empty-org", context: null }));
    for (const value of ["Δεν υπάρχουν διαθέσιμες διοργανώσεις.", "Δεν υπάρχουν ακόμη προγραμματισμένοι αγώνες.", "Δεν υπάρχουν ακόμη ολοκληρωμένοι αγώνες."]) expect(html).toContain(value);
    expect(html).not.toContain("KomoBasket League");
  });
});
