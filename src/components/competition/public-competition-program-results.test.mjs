import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { scopePublicProgramResultsContexts, selectPublicProgramResultsBlock, selectPublicProgramResultsNavigation } from "../hosted/HostedOrganizationHomeData.tsx";

const source = fs.readFileSync(path.resolve(import.meta.dirname, "PublicCompetitionsView.tsx"), "utf8");
const latestMovementsSource = fs.readFileSync(path.resolve(import.meta.dirname, "PublicCompetitionLatestMovements.tsx"), "utf8");
const team = (id) => ({ id, name: id.toUpperCase(), logoUrl: null });
const game = (id, roundNumber, publicStatus, extras = {}) => ({
  id,
  roundNumber,
  gameOrder: extras.gameOrder ?? 1,
  roundLabel: extras.roundLabel ?? null,
  scheduledDate: "2026-09-05",
  scheduledTime: "18:00",
  venue: null,
  homeScore: publicStatus === "completed" ? 70 : null,
  awayScore: publicStatus === "completed" ? 60 : null,
  publicStatus,
  liveAvailable: publicStatus === "live",
  finalizedStatisticsAvailable: publicStatus === "completed",
  videoUrl: null,
  homeTeam: team(`${id}-home`),
  awayTeam: team(`${id}-away`),
});
const provisional = (id, roundNumber, extras = {}) => ({
  kind: "provisional",
  id,
  planningKind: extras.planningKind ?? "round_robin",
  competitionId: "competition-a",
  phaseId: "phase-1",
  scheduleId: "schedule-a",
  roundNumber,
  gameOrder: extras.gameOrder ?? 1,
  scheduledDate: "2026-10-20",
  scheduledTime: "20:00",
  venue: "Arena",
  homeParticipantLabel: extras.homeParticipantLabel ?? "1η θέση · Regular",
  awayParticipantLabel: extras.awayParticipantLabel ?? "2η θέση · Regular",
});
const context = ({ competition = "competition-a", phaseOrder = 1, lifecycleStatus = "active", format = "standings", games = [], seriesHistory = [], bracket = null } = {}) => ({
  seasons: [{ id: "season-a", slug: "2026-27", name: "2026-27" }],
  competitions: [], phases: [], games, standings: [], seriesHistory, bracket, teamView: null,
  selectedSeason: { id: "season-a", slug: "2026-27", name: "2026-27" },
  selectedCompetition: { id: competition, slug: competition, name: competition, type: "league", lifecycleStatus: "online", gameMode: "FULL" },
  selectedPhase: { id: `phase-${phaseOrder}`, slug: `phase-${phaseOrder}`, name: `Phase ${phaseOrder}`, phaseOrder, lifecycleStatus, format, phaseType: format, participantCount: 8, roundCount: 8, winsRequired: format === "series" ? 2 : null, directAdvancements: [], standingsPresentation: { directQualification: [], playOut: [], eliminated: [] } },
});

const projectedSeries = ({ actual = false, meaningful = true } = {}) => ({
  matchupId: "pair-a",
  label: "8η θέση · ΚΑΝΟΝΙΚΗ ΠΕΡΙΟΔΟΣ — 9η θέση · ΚΑΝΟΝΙΚΗ ΠΕΡΙΟΔΟΣ",
  maximumSeriesRounds: 3,
  rounds: [
    actual
      ? { roundNumber: 1, kind: "game", sourcePhaseName: null, game: game("actual-series-game", 1, "scheduled") }
      : { roundNumber: 1, kind: "pending_carry_over", sourcePhaseName: null, game: null },
    { roundNumber: 2, kind: "projected", sourcePhaseName: null, game: null },
  ],
  summary: meaningful ? {
    teamAId: "team-a", teamAName: "8η θέση · ΚΑΝΟΝΙΚΗ ΠΕΡΙΟΔΟΣ",
    teamBId: "team-b", teamBName: "9η θέση · ΚΑΝΟΝΙΚΗ ΠΕΡΙΟΔΟΣ",
    winsRequired: 2, currentWinsA: 0, currentWinsB: 0,
    qualifiedTeamId: null, qualifiedTeamName: null, transferredRoundCount: 0,
  } : undefined,
});

describe("public standalone Program and Results", () => {
  it("selects the first incomplete Matchday and includes every game in that block", () => {
    const selected = selectPublicProgramResultsBlock([context({ games: [
      game("round-1", 1, "completed"),
      game("round-2-final", 2, "completed"),
      game("round-2-next", 2, "scheduled", { gameOrder: 2 }),
      game("round-3", 3, "scheduled"),
    ] })]);
    expect(selected?.block.games.map((item) => item.id)).toEqual(["round-2-final", "round-2-next"]);
    expect(selected?.completedFallback).toBe(false);
  });

  it("advances to the next Matchday after completion", () => {
    const selected = selectPublicProgramResultsBlock([context({ games: [game("round-2", 2, "completed"), game("round-3", 3, "scheduled")] })]);
    expect(selected?.block.games.map((item) => item.id)).toEqual(["round-3"]);
  });

  it("skips a completed Phase and selects unresolved content in the next Phase", () => {
    const completed = context({ phaseOrder: 1, lifecycleStatus: "finalized", games: [game("phase-1-final", 1, "completed")] });
    const active = context({ phaseOrder: 2, games: [game("phase-2-next", 2, "scheduled")] });
    expect(selectPublicProgramResultsBlock([completed, active])?.context.selectedPhase?.id).toBe("phase-2");
  });

  it("selects all parallel Series games in the earliest unresolved required round and excludes not_needed", () => {
    const series = (id) => ({ matchupId: id, label: id, maximumSeriesRounds: 3, rounds: [
      { roundNumber: 1, kind: "game", sourcePhaseName: null, game: game(`${id}-final`, 1, "completed") },
      { roundNumber: 2, kind: "game", sourcePhaseName: null, game: game(`${id}-next`, 2, "scheduled", { roundLabel: "ΓΥΡΟΣ 2" }) },
      { roundNumber: 3, kind: "not_needed", sourcePhaseName: null, game: null },
    ] });
    const selected = selectPublicProgramResultsBlock([context({ format: "series", seriesHistory: [series("a"), series("b")] })]);
    expect(selected?.block.label).toBe("ΓΥΡΟΣ 2");
    expect(selected?.block.games.map((item) => item.id)).toEqual(["a-next", "b-next"]);
  });

  it("falls back to the latest completed canonical block when the competition is complete", () => {
    const selected = selectPublicProgramResultsBlock([context({ lifecycleStatus: "finalized", games: [game("round-1", 1, "completed"), game("round-2", 2, "completed")] })]);
    expect(selected?.block.games.map((item) => item.id)).toEqual(["round-2"]);
    expect(selected?.completedFallback).toBe(true);
  });

  it("recalculates from only the selected Competition contexts", () => {
    const competitionA = context({ competition: "competition-a", games: [game("a-next", 2, "scheduled")] });
    const competitionB = context({ competition: "competition-b", games: [game("b-next", 4, "scheduled")] });
    expect(selectPublicProgramResultsBlock([competitionA])?.block.games[0]?.id).toBe("a-next");
    expect(selectPublicProgramResultsBlock([competitionB])?.block.games[0]?.id).toBe("b-next");
  });

  it("defaults to the current Matchday and navigates backward and forward", () => {
    const fixture = context({ games: [
      game("round-1-final", 1, "completed"),
      game("round-2-final", 2, "completed"),
      game("round-2-next", 2, "scheduled", { gameOrder: 2 }),
      game("round-3-next", 3, "scheduled"),
    ] });
    const automatic = selectPublicProgramResultsNavigation([fixture]);
    expect(automatic.selected?.block.games.map((item) => item.id)).toEqual(["round-2-final", "round-2-next"]);
    expect(automatic.previous?.block.games.map((item) => item.id)).toEqual(["round-1-final"]);
    expect(automatic.next?.block.games.map((item) => item.id)).toEqual(["round-3-next"]);
    const manual = selectPublicProgramResultsNavigation([fixture], automatic.previous?.key);
    expect(manual.selected?.block.games.map((item) => item.id)).toEqual(["round-1-final"]);
    expect(selectPublicProgramResultsNavigation([fixture], manual.selected?.key).selected?.key).toBe(manual.selected?.key);
  });

  it("navigates bidirectionally across canonical Phase boundaries", () => {
    const phaseOne = context({ phaseOrder: 1, lifecycleStatus: "finalized", games: [game("phase-1-round-3", 3, "completed")] });
    const phaseTwo = context({ phaseOrder: 2, games: [game("phase-2-round-1", 1, "scheduled")] });
    const automatic = selectPublicProgramResultsNavigation([phaseOne, phaseTwo]);
    expect(automatic.selected?.block.games[0]?.id).toBe("phase-2-round-1");
    expect(automatic.previous?.block.games[0]?.id).toBe("phase-1-round-3");
    const previous = selectPublicProgramResultsNavigation([phaseOne, phaseTwo], automatic.previous?.key);
    expect(previous.next?.block.games[0]?.id).toBe("phase-2-round-1");
  });

  it("groups parallel Series by Round and navigates one Round at a time", () => {
    const series = (id) => ({ matchupId: id, label: id, maximumSeriesRounds: 4, rounds: [
      { roundNumber: 1, kind: "game", sourcePhaseName: null, game: game(`${id}-round-1`, 1, "completed") },
      { roundNumber: 2, kind: "game", sourcePhaseName: null, game: game(`${id}-round-2`, 2, "scheduled") },
      { roundNumber: 3, kind: "game", sourcePhaseName: null, game: game(`${id}-round-3`, 3, "scheduled") },
      { roundNumber: 4, kind: "not_needed", sourcePhaseName: null, game: null },
    ] });
    const navigation = selectPublicProgramResultsNavigation([context({ format: "series", seriesHistory: [series("a"), series("b")] })]);
    expect(navigation.selected?.block.games.map((item) => item.id)).toEqual(["a-round-2", "b-round-2"]);
    expect(navigation.previous?.block.games.map((item) => item.id)).toEqual(["a-round-1", "b-round-1"]);
    expect(navigation.next?.block.games.map((item) => item.id)).toEqual(["a-round-3", "b-round-3"]);
    expect(navigation.blocks.flatMap((block) => block.block.games).some((item) => item.roundNumber === 4)).toBe(false);
  });

  it("defaults a completed Competition to its last block with Previous available and Next disabled", () => {
    const navigation = selectPublicProgramResultsNavigation([context({ lifecycleStatus: "finalized", games: [game("round-1", 1, "completed"), game("round-2", 2, "completed")] })]);
    expect(navigation.selected?.block.games[0]?.id).toBe("round-2");
    expect(navigation.previous?.block.games[0]?.id).toBe("round-1");
    expect(navigation.next).toBeNull();
  });

  it("resets an incompatible manual key when Competition changes", () => {
    const competitionA = context({ competition: "competition-a", games: [game("a-old", 1, "completed"), game("a-current", 2, "scheduled")] });
    const manualA = selectPublicProgramResultsNavigation([competitionA]).previous?.key;
    const competitionB = context({ competition: "competition-b", games: [game("b-current", 4, "scheduled")] });
    expect(selectPublicProgramResultsNavigation([competitionB], manualA).selected?.block.games[0]?.id).toBe("b-current");
  });

  it("includes unresolved Round Robin planning in canonical public navigation", () => {
    const selected = selectPublicProgramResultsBlock([context({ games: [
      game("round-1", 1, "completed"),
      provisional("rr:schedule-a:2:1", 2),
    ] })]);
    expect(selected?.block.games).toEqual([expect.objectContaining({
      id: "rr:schedule-a:2:1",
      kind: "provisional",
      homeParticipantLabel: "1η θέση · Regular",
    })]);
  });

  it("includes unresolved Series planning without making it a result or link", () => {
    const selected = selectPublicProgramResultsBlock([context({ format: "series", games: [
      provisional("series:phase-1:pair:1", 1, { planningKind: "series", homeParticipantLabel: "Νικητής A", awayParticipantLabel: "Νικητής B" }),
    ] })]);
    expect(selected?.block.games[0]).toEqual(expect.objectContaining({ kind: "provisional", planningKind: "series" }));
    expect(source).toContain("isPublicProvisionalGame(game)");
    expect(source).toContain("Πρόγραμμα");
  });

  it("scopes a selected Series phase without changing regular-season tournament navigation", () => {
    const regular = context({ phaseOrder: 1 });
    const playOut = context({ phaseOrder: 2, format: "series", seriesHistory: [projectedSeries()] });
    expect(scopePublicProgramResultsContexts(regular, [regular, playOut])).toEqual([regular, playOut]);
    expect(scopePublicProgramResultsContexts(playOut, [regular, playOut])).toEqual([playOut]);
  });

  it("shows canonical projected pairings when a Series phase has no actual games", () => {
    const navigation = selectPublicProgramResultsNavigation([context({ format: "series", seriesHistory: [projectedSeries()] })]);
    expect(navigation.selected?.block.label).toBe("ΓΥΡΟΣ 1");
    expect(navigation.selected?.block.games).toEqual([expect.objectContaining({
      kind: "provisional",
      projectionState: "pending_carry_over",
      homeParticipantLabel: "8η θέση · ΚΑΝΟΝΙΚΗ ΠΕΡΙΟΔΟΣ",
      awayParticipantLabel: "9η θέση · ΚΑΝΟΝΙΚΗ ΠΕΡΙΟΔΟΣ",
      scheduledDate: null,
      scheduledTime: null,
      venue: null,
    })]);
    expect(navigation.next?.block.games[0]).toEqual(expect.objectContaining({ projectionState: "projected" }));
  });

  it("gives actual Series games priority over projected fallback rows", () => {
    const navigation = selectPublicProgramResultsNavigation([context({ format: "series", seriesHistory: [projectedSeries({ actual: true })] })]);
    expect(navigation.selected?.block.games.map((item) => item.id)).toEqual(["actual-series-game"]);
    expect(navigation.blocks.flatMap((block) => block.block.games).some((item) => item.id.startsWith("series-projection:"))).toBe(false);
  });

  it("returns no block when a Series phase has neither games nor meaningful projections", () => {
    expect(selectPublicProgramResultsNavigation([context({ format: "series" })]).selected).toBeNull();
  });

  it("renders distinct projected and empty-state messaging", () => {
    expect(source).toContain("Αναμονή μεταφοράς αποτελέσματος");
    expect(source).toContain("Αναμονή προγράμματος");
    expect(source).toContain("Αναμονή σχεδιασμού");
    expect(source).toContain("Το πρόγραμμα της φάσης δεν έχει ακόμη διαμορφωθεί.");
  });

  it("renders one standalone section with its own Season and Competition selectors and no Phase selector", () => {
    expect((source.match(/<PublicCompetitionProgramResults/g) ?? []).length).toBe(1);
    expect(source).toContain('id="program-results"');
    expect(source).toContain('<PublicCompactSelector label="Σεζόν"');
    expect(source).toContain('<PublicCompactSelector label="Διοργάνωση"');
    expect(source).toContain('<PublicCompactSelector label="Θεσμός"');
    expect(source).toContain("context.selectedTournament?.phaseIds");
    expect(source).toContain('params.set("tournament", context.selectedTournament.slug)');
    expect(source).not.toContain("const visibleRounds");
    expect(source).toContain("programBlock?: string");
    expect(source).toContain("← Προηγούμενη");
    expect(source).toContain("Επόμενη →");
    expect(source).toContain("disabled aria-label=\"Δεν υπάρχει προηγούμενο αγωνιστικό block\"");
    expect(source).toContain("disabled aria-label=\"Δεν υπάρχει επόμενο αγωνιστικό block\"");
    expect(source).toContain('import PublicCompetitionLatestMovements from "@/components/competition/PublicCompetitionLatestMovements"');
    expect(source).toContain("<PublicCompetitionLatestMovements");
    expect(latestMovementsSource).toContain("Μεταγραφές - Προσθήκες");
  });
});
