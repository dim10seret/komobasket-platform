import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PublicTeamStatistics } from "@/lib/public-team-statistics";
import PublicTeamStatisticsPanel, { simpleTeamStatisticsSummary } from "./PublicTeamStatistics";

const component = readFileSync(new URL("./PublicTeamStatistics.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("./PublicCompetitionsView.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../services/public-competition.service.ts", import.meta.url), "utf8");
const reportService = readFileSync(new URL("../../services/platform-match-report.service.ts", import.meta.url), "utf8");
const statistics: PublicTeamStatistics = {
  team: { id: "team-1", name: "SIMPLE TEAM" },
  games: [],
  total: {
    teamGamesPlayed: 3,
    players: [{
      canonicalPlayerId: "player-1", displayName: "ΠΑΙΚΤΗΣ SIMPLE", shirtNumber: "4", gamesPlayed: 3,
      statistics: { points: 17, twoPointMade: 4, twoPointAttempts: 4, threePointMade: 2, threePointAttempts: 2, freeThrowMade: 3, freeThrowAttempts: 5, offensiveRebounds: 0, defensiveRebounds: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 2, efficiency: 15 },
    }],
  },
};
const render = (gameMode: "SIMPLE" | "FULL") => renderToStaticMarkup(createElement(PublicTeamStatisticsPanel, { statistics, gameMode }));

describe("public team statistics UI and data boundary", () => {
  it("removes the separate active-roster table from the team page", () => { expect(page).not.toContain("Ενεργοί παίκτες"); expect(page).not.toContain("view.roster.map"); });
  it("uses the combined roster and statistics section title", () => expect(component).toContain("ΡΟΣΤΕΡ - ΑΓΩΝΙΣΤΙΚΑ ΔΕΔΟΜΕΝΑ"));
  it("renders one compact dropdown with TOTAL as default", () => { expect(component).toContain('useState("TOTAL")'); expect(component).toContain("<select"); expect(component).toContain('<option value="TOTAL">TOTAL</option>'); });
  it("does not render horizontal game tabs", () => expect(component).not.toContain('role="tab"'));
  it("shows team games and per-player games only in TOTAL", () => { expect(component).toContain("Αγώνες ομάδας:"); expect(component).toContain("player.gamesPlayed"); expect(component).toContain('{total ? <th className="px-3 py-3">ΑΓ.</th> : null}'); });
  it("renders made-attempted shooting and all supported counters", () => { for (const value of ["twoPointMade", "threePointMade", "freeThrowMade", "offensiveRebounds", "defensiveRebounds", "rebounds", "assists", "steals", "blocks", "turnovers", "fouls", "efficiency"]) expect(component).toContain(value); });
  it("omits unsupported minutes and plus-minus", () => { expect(component).not.toContain(">MIN<"); expect(component).not.toContain(">+/-<"); });
  it("keeps mobile access through a touch-sized selector and controlled horizontal scrolling", () => { expect(component).toContain("min-h-11"); expect(component).toContain("w-full"); expect(component).toContain("overflow-x-auto"); expect(component).toContain('tabIndex={0}'); });
  it("shows the required zero-game empty state", () => expect(component).toContain("Δεν υπάρχουν διαθέσιμα στατιστικά αγώνων."));
  it("keeps schedule/results as an independent existing section", () => { expect(page).toContain("<PublicTeamStatisticsPanel statistics={view.statistics} gameMode={view.gameMode} />"); expect(page).toContain("<TeamGameGroup games={view.games} teamHref={teamHref} gameBasePath={gameBasePath} />"); });
  it("loads finalized candidates and canonical events in batches", () => { expect(service).toContain("readAuthoritativeTeamStatisticalGamesWithDb"); expect(reportService).toContain("Promise.all(["); expect(reportService).toContain("eventsByRun"); expect(reportService).not.toContain("for (const row of candidateResult.results) await"); });
  it("reuses fail-closed Match Report availability and full replay", () => { expect(reportService).toContain("platformMatchReportAvailability(source(row))"); expect(reportService).toContain("projectPublicLiveGame"); expect(reportService).toContain("projectPlatformMatchReportStatistics"); });
  it("uses explicit competition game_mode as the presentation source", () => { expect(service).toContain("league_competition_komocontrol_defaults"); expect(service).toContain("gameMode: selectedCompetition.gameMode"); expect(page).toContain("gameMode={view.gameMode}"); });
  it("renders the simplified columns and hides every FULL-only column", () => {
    const html = render("SIMPLE");
    for (const column of ["PLAYER", "ΑΓ.", "PTS", "2PT", "3PT", "FT", "PF"]) expect(html).toContain(`>${column}<`);
    for (const column of ["OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "EFF"]) expect(html).not.toContain(`>${column}<`);
  });
  it("renders SIMPLE made shots, real FT attempts, fouls and games without made-attempted field goals", () => {
    const html = render("SIMPLE");
    expect(html).toContain('data-stat="two-point"'); expect(html).toContain('data-stat="three-point"');
    expect(html).not.toContain(">4/4<"); expect(html).not.toContain(">2/2<");
    for (const value of [">3<", ">17<", ">4<", ">2<", ">3/5<"]) expect(html).toContain(value);
  });
  it("keeps numeric zero FULL statistics underneath without inferring presentation mode", () => {
    expect(statistics.total.players[0].statistics).toMatchObject({ rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, efficiency: 15 });
    expect(render("SIMPLE")).not.toContain(">EFF<");
    expect(render("FULL")).toContain(">EFF<");
  });
  it("keeps the existing FULL columns and made-attempted values", () => {
    const html = render("FULL");
    for (const column of ["OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "F", "EFF"]) expect(html).toContain(`>${column}<`);
    expect(html).toContain(">4/4<"); expect(html).toContain(">2/2<");
  });
  it("uses competition mode even when identical underlying game statistics are supplied", () => {
    expect(render("FULL")).toContain('data-recording-mode="FULL"');
    expect(render("SIMPLE")).toContain('data-recording-mode="SIMPLE"');
  });
  it("builds SIMPLE summary cards from the visible numeric counters", () => {
    expect(simpleTeamStatisticsSummary(statistics.total.players)).toEqual({ points: 17, twoPointMade: 4, threePointMade: 2, freeThrowMade: 3, freeThrowAttempts: 5, fouls: 2 });
    const html = render("SIMPLE");
    expect(html).toContain('aria-label="Σύνοψη SIMPLE στατιστικών"');
    for (const label of ["Πόντοι", "2PT", "3PT", "Βολές", "Φάουλ"]) expect(html).toContain(`>${label}<`);
  });
});
