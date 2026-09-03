import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("./PublicTeamStatistics.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/competitions/page.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../services/public-competition.service.ts", import.meta.url), "utf8");
const reportService = readFileSync(new URL("../../services/platform-match-report.service.ts", import.meta.url), "utf8");

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
  it("keeps schedule/results as an independent existing section", () => { expect(page).toContain("<PublicTeamStatisticsPanel statistics={view.statistics} />"); expect(page).toContain("<TeamGameGroup games={view.games} teamHref={teamHref} />"); });
  it("loads finalized candidates and canonical events in batches", () => { expect(service).toContain("readAuthoritativeTeamStatisticalGamesWithDb"); expect(reportService).toContain("Promise.all(["); expect(reportService).toContain("eventsByRun"); expect(reportService).not.toContain("for (const row of candidateResult.results) await"); });
  it("reuses fail-closed Match Report availability and full replay", () => { expect(reportService).toContain("platformMatchReportAvailability(source(row))"); expect(reportService).toContain("projectPublicLiveGame"); expect(reportService).toContain("projectPlatformMatchReportStatistics"); });
});
