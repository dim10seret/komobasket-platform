import fs from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { calculateSeriesProgression } from "../../lib/series-progression";
import HostedOrganizationHomeData from "./HostedOrganizationHomeData";

const teamA = { id: "a", name: "TEAM ALPHA" };
const teamB = { id: "b", name: "TEAM BETA" };
const game = (round, homeScore = null, awayScore = null, status = "scheduled", reverse = false) => ({
  gameId: `game-${round}`, seriesRoundNumber: round, homeTeamId: reverse ? "b" : "a", awayTeamId: reverse ? "a" : "b", homeScore, awayScore, status,
});
const history = (id, winsRequired, materializedGames, transferredGames = []) => {
  const progression = calculateSeriesProgression({ matchupId: id, teamA, teamB, winsRequired, materializedGames, transferredGames });
  return {
    matchupId: id, label: `${teamA.name} – ${teamB.name}`, maximumSeriesRounds: progression.maximumSeriesRounds,
    summary: progression,
    rounds: progression.rounds.map((round) => ({
      roundNumber: round.seriesRoundNumber,
      kind: round.rowState === "qualified" ? "not_needed" : round.rowState === "transferred" ? "transferred" : "game",
      sourcePhaseName: round.rowState === "transferred" ? "PREVIOUS PHASE" : null,
      game: round.homeTeamId ? {
        id: round.realGameId ?? round.sourceGameId, roundNumber: round.seriesRoundNumber, gameOrder: 1,
        roundLabel: `ΓΥΡΟΣ ${round.seriesRoundNumber}`, publicStatus: round.winnerTeamId ? "completed" : "scheduled",
        homeScore: round.homeScore, awayScore: round.awayScore,
        homeTeam: { id: round.homeTeamId, name: round.homeTeamName, logoUrl: null },
        awayTeam: { id: round.awayTeamId, name: round.awayTeamName, logoUrl: null },
        scheduledDate: null, scheduledTime: null, venue: null, liveAvailable: false, finalizedStatisticsAvailable: false, videoUrl: null,
      } : null,
    })),
  };
};
const active = (winsRequired = 2) => history("active", winsRequired, [game(1)]);
const context = (seriesHistory) => ({
  seasons: [], competitions: [], phases: [], games: [], standings: [], seriesHistory, bracket: null, teamView: null,
  selectedSeason: { id: "s", name: "2026-27", slug: "2026-27" },
  selectedCompetition: { id: "c", name: "EXAMPLE COMPETITION", slug: "example", type: "cup", lifecycleStatus: "online", gameMode: "FULL" },
  selectedPhase: { id: "p", name: "Φάση Κυπέλλου", slug: "cup-phase", format: "series", phaseType: "series", phaseOrder: 1, lifecycleStatus: "active", winsRequired: seriesHistory[0]?.summary.winsRequired, participantCount: 4, roundCount: 3, directAdvancements: [], standingsPresentation: { directQualification: [], playOut: [], eliminated: [] } },
});
const render = (value, organizationSlug = "example-org") => renderToStaticMarkup(createElement(HostedOrganizationHomeData, { organizationSlug, context: value }));
const summaryTable = (html) => html.match(/<div[^>]*aria-label="Σύνοψη σειρών τρέχουσας φάσης">([\s\S]*?)<\/table>/)?.[1];

describe("hosted current-phase series summary", () => {
  it.each([1, 2, 3])("uses the canonical %i-win rule and dynamic maximum rounds", (wins) => {
    const html = render(context([active(wins)]));
    expect(html).toContain("ΤΡΕΧΟΥΣΑ ΦΑΣΗ");
    expect(html).toContain("Φάση Κυπέλλου");
    expect(html).toContain(wins === 1 ? "Πρόκριση στη 1 νίκη" : `Πρόκριση στις ${wins} νίκες`);
    const table = summaryTable(html);
    expect([...table.matchAll(/>ΓΥΡΟΣ (\d+)<\/th>/g)].map((entry) => Number(entry[1]))).toEqual(Array.from({ length: wins * 2 - 1 }, (_, index) => index + 1));
    expect(table).toContain("ΣΕ ΕΞΕΛΙΞΗ");
    expect(html).not.toContain("ΒΑΘΜΟΛΟΓΙΑ");
  });
  it("shows multiple matchups, decided status and canonical wins without hiding the still-active series", () => {
    const decided = history("decided", 2, [game(1, 45, 70, "completed"), game(2, 50, 46, "completed", true)]);
    const table = summaryTable(render(context([decided, active()])));
    expect([...table.matchAll(/<th scope="row"/g)]).toHaveLength(2);
    expect(table).toContain("TEAM ALPHA – TEAM BETA");
    for (const score of ["45–70", "46–50", "0–2", "0–0"]) expect(table).toContain(score);
    expect(table).toContain("ΠΡΟΚΡΙΣΗ TEAM BETA");
    expect(table).toContain("ΣΕ ΕΞΕΛΙΞΗ");
    expect(table).toContain("—");
  });
  it("keeps alternating home/away scores in the same A/B order as the matchup column", () => {
    const table = summaryTable(render(context([history("active", 3, [game(1, 80, 70, "completed"), game(2, 90, 85, "completed", true), game(3)])])));
    expect(table).toContain(">85–90</td>");
    expect(table).toContain('title="TEAM BETA 90–85 TEAM ALPHA"');
    expect(table).toContain("1–1");
  });
  it("does not display provisional scores as completed results or count unplayed games", () => {
    const table = summaryTable(render(context([history("active", 2, [game(1, 8, 2)])])));
    expect(table).not.toContain("8–2");
    expect(table).toContain("0–0");
    expect(table).toContain("—");
  });
  it("marks actual transferred results explicitly without fabricating a new played score", () => {
    const transferred = [{ sourceGameId: "source", seriesRoundNumber: 1, homeTeamId: "a", awayTeamId: "b", homeScore: 77, awayScore: 65, status: "completed" }];
    const html = render(context([history("active", 2, [game(2)], transferred)]));
    const table = summaryTable(html);
    expect(table).toContain("77–65");
    expect(table).toContain("Μεταφορά");
    expect(table).toContain("1 νίκη από μεταφορά");
    expect(table).toContain("1–0");
    expect(table).not.toContain("20–0");
    expect(html).toContain("ΓΥΡΟΣ 2");
  });
  it("renders qualification from the projected winner, not a second threshold calculation", () => {
    const entry = active();
    entry.summary = { ...entry.summary, currentWinsA: 2, currentWinsB: 0, qualifiedTeamId: null, qualifiedTeamName: null };
    const table = summaryTable(render(context([entry])));
    expect(table).toContain("ΣΕ ΕΞΕΛΙΞΗ");
    expect(table).not.toContain("ΠΡΟΚΡΙΣΗ TEAM ALPHA");
  });
  it("preserves the canonical link below the summary and organization-scoped paths", () => {
    const html = render(context([active()]), "another-org");
    expect(html).toContain('href="/another-org/competitions?season=2026-27&amp;competition=example&amp;phase=cup-phase#program-results"');
    expect(html.indexOf("Πρόγραμμα &amp; Αποτελέσματα")).toBeGreaterThan(html.indexOf("</table>"));
    expect(html).not.toContain("/example-org/");
  });
  it("does not invent a series for custom or standings formats", () => {
    for (const format of ["custom", "standings"]) {
      const value = context([active()]);
      value.selectedPhase.format = format;
      value.games = [value.seriesHistory[0].rounds[0].game];
      const html = render(value);
      expect(summaryTable(html)).toBeUndefined();
      expect(html).not.toContain("Πρόκριση στις");
      expect(html.includes(">ΒΑΘΜΟΛΟΓΙΑ</h2>")).toBe(format === "standings");
    }
  });
  it("omits the summary when canonical progression metadata is not available", () => {
    const entry = active();
    delete entry.summary;
    const value = context([]);
    value.seriesHistory = [entry];
    expect(summaryTable(render(value))).toBeUndefined();
  });
  it("keeps all round columns inside a keyboard-focusable table scroller without mid-word team wrapping", () => {
    const table = summaryTable(render(context([active(3)])));
    expect(table).toContain("min-w-[720px]");
    expect(table).toContain('scope="row" class="whitespace-nowrap');
    const source = fs.readFileSync(new URL("./HostedOrganizationHomeData.tsx", import.meta.url), "utf8");
    expect(source).toContain('max-w-full overflow-x-auto');
    expect(source).toContain('tabIndex={0} role="region"');
    expect(source).not.toMatch(/Friendly Matches|friendlymatches|calculateSeriesProgression|resolveSeriesCarryOver/);
  });
});
