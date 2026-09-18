import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { selectPublicProgramResultsBlock, selectPublicProgramResultsNavigation } from "../hosted/HostedOrganizationHomeData.tsx";

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
const context = ({ competition = "competition-a", phaseOrder = 1, lifecycleStatus = "active", format = "standings", games = [], seriesHistory = [] } = {}) => ({
  seasons: [{ id: "season-a", slug: "2026-27", name: "2026-27" }],
  competitions: [], phases: [], games, standings: [], seriesHistory, bracket: null, teamView: null,
  selectedSeason: { id: "season-a", slug: "2026-27", name: "2026-27" },
  selectedCompetition: { id: competition, slug: competition, name: competition, type: "league", lifecycleStatus: "online", gameMode: "FULL" },
  selectedPhase: { id: `phase-${phaseOrder}`, slug: `phase-${phaseOrder}`, name: `Phase ${phaseOrder}`, phaseOrder, lifecycleStatus, format, phaseType: format, participantCount: 8, roundCount: 8, winsRequired: format === "series" ? 2 : null, directAdvancements: [], standingsPresentation: { directQualification: [], playOut: [], eliminated: [] } },
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

  it("renders one standalone section with its own Season and Competition selectors and no Phase selector", () => {
    expect((source.match(/<PublicCompetitionProgramResults/g) ?? []).length).toBe(1);
    expect(source).toContain('id="program-results"');
    expect(source).toContain('<PublicCompactSelector label="Σεζόν"');
    expect(source).toContain('<PublicCompactSelector label="Διοργάνωση"');
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
