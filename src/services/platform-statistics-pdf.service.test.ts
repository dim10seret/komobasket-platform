import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";
import type { PlatformMatchReport, PlatformMatchReportStatisticsLine } from "@/lib/platform-match-report";
vi.mock("server-only", () => ({}));
import { buildStatisticsPdfDocumentModel, generateStatisticsPdf, planStatisticsPdfPages, STATISTICS_PDF_CREATOR, statisticsPdfFilename } from "./platform-statistics-pdf.service";

const pdfSource = readFileSync(new URL("./platform-statistics-pdf.service.ts", import.meta.url), "utf8");

const line: PlatformMatchReportStatisticsLine = { points: 14, twoPointMade: 4, twoPointAttempts: 6, threePointMade: 1, threePointAttempts: 2, freeThrowMade: 3, freeThrowAttempts: 4, offensiveRebounds: 2, defensiveRebounds: 5, rebounds: 7, assists: 4, steals: 3, blocks: 1, turnovers: 2, fouls: 3, efficiency: 24 };
const report = (homeCount = 7, awayCount = 8): PlatformMatchReport => ({ mode: "FULL", availability: { available: true, hasIncidentReport: true }, game: { gameId: "secret-game-id", competition: "TEST C3", season: "2026-27", phase: "ΚΑΝΟΝΙΚΗ ΔΙΑΡΚΕΙΑ", round: "1η Αγωνιστική", scheduledDate: "2026-09-02", scheduledTime: "18:30", venue: "ΚΛΕΙΣΤΟ ΓΥΜΝΑΣΤΗΡΙΟ", homeTeam: { teamId: "secret-home-id", name: "ΛΕΚΑΒΕΞ", logoUrl: null }, awayTeam: { teamId: "secret-away-id", name: "JUGOPIASTIKA", logoUrl: null }, finalScore: { home: 14, away: 7 }, winner: "HOME", periodScores: [{ period: { kind: "REGULATION", index: 1 }, home: 10, away: 5 }, { period: { kind: "REGULATION", index: 2 }, home: 2, away: 2 }, { period: { kind: "REGULATION", index: 3 }, home: 2, away: 0 }, { period: { kind: "REGULATION", index: 4 }, home: 0, away: 0 }, { period: { kind: "OVERTIME", index: 1 }, home: 0, away: 0 }] }, statistics: { home: { players: Array.from({ length: homeCount }, (_, index) => ({ shirtNumber: String(index + 1), displayName: index === 0 ? "ΘΕΟΔΟΣΗΣ ΤΑΒΛΑΡΙΔΗΣ" : `HOME ΠΑΙΚΤΗΣ ${index + 1}`, starter: index < 5, finalStatus: "ELIGIBLE", finalStatusReason: null, statistics: line })), totals: line }, away: { players: Array.from({ length: awayCount }, (_, index) => ({ shirtNumber: String(index + 20), displayName: index === 0 ? "ΑΠΟΣΤΟΛΟΣ ΚΟΥΤΣΟΓΙΑΝΝΗΣ" : `AWAY ΠΑΙΚΤΗΣ ${index + 1}`, starter: index < 5, finalStatus: "ELIGIBLE", finalStatusReason: null, statistics: line })), totals: line } }, incidentReport: "ΤΕΣΤ ΑΝΑΦΟΡΑΣ" });

describe("Statistics PDF document model", () => {
  const model = buildStatisticsPdfDocumentModel(report());
  it("contains authoritative game identity and final score", () => { expect(model.competition).toBe("TEST C3"); expect(model.score).toBe("ΛΕΚΑΒΕΞ 14 - 7 JUGOPIASTIKA"); });
  it("supports dynamic regulation and overtime periods", () => expect(model.periods.map((item) => item.label)).toEqual(["Q1", "Q2", "Q3", "Q4", "OT1"]));
  it("contains both finalized rosters", () => expect(model.teams.map((team) => team.players.length)).toEqual([7, 8]));
  it("contains made/attempted shooting values", () => expect(model.teams[0].players[0].statistics).toMatchObject({ twoPointMade: 4, twoPointAttempts: 6, threePointMade: 1, threePointAttempts: 2, freeThrowMade: 3, freeThrowAttempts: 4 }));
  it("contains complete rebound and box-score values", () => expect(model.teams[0].players[0].statistics).toMatchObject({ offensiveRebounds: 2, defensiveRebounds: 5, rebounds: 7, assists: 4, steals: 3, blocks: 1, turnovers: 2, fouls: 3, efficiency: 24 }));
  it("contains authoritative team totals", () => expect(model.teams[0].totals).toEqual(line));
  it("omits unsupported minutes and plus-minus columns", () => { expect(model.columns).not.toContain("MIN"); expect(model.columns).not.toContain("+/-"); });
  it("does not project the incident report or internal identifiers", () => { expect(JSON.stringify(model)).not.toContain("ΤΕΣΤ ΑΝΑΦΟΡΑΣ"); expect(JSON.stringify(model)).not.toContain("secret-game-id"); expect(JSON.stringify(model)).not.toContain("secret-home-id"); });
  it("builds a safe Unicode attachment filename", () => expect(statisticsPdfFilename(report())).toBe("komobasket-statistics-ΛΕΚΑΒΕΞ-vs-JUGOPIASTIKA.pdf"));
  it("rejects unavailable reports", () => expect(() => buildStatisticsPdfDocumentModel({ ...report(), availability: { available: false, hasIncidentReport: false } })).toThrow("MATCH_REPORT_UNAVAILABLE"));
  it("starts HOME on page one and AWAY on a fresh page", () => expect(planStatisticsPdfPages(model).map((page) => [page.side, page.continuation])).toEqual([["HOME", false], ["AWAY", false]]));
  it("keeps normal HOME and AWAY rosters unsplit", () => expect(planStatisticsPdfPages(model).map((page) => page.players.length)).toEqual([7, 8]));
  it("keeps totals with each team's final page", () => expect(planStatisticsPdfPages(model).map((page) => page.includeTotals)).toEqual([true, true]));
  it("does not lose or duplicate players in the page plan", () => { const pages = planStatisticsPdfPages(model); expect(pages.flatMap((page) => page.players.map((player) => `${page.side}:${player.shirtNumber}`))).toHaveLength(15); expect(new Set(pages.flatMap((page) => page.players.map((player) => `${page.side}:${player.shirtNumber}`))).size).toBe(15); });
  it("uses the exact creator signature", () => expect(STATISTICS_PDF_CREATOR).toBe("Created by: D. Seretidis"));
  it("draws the standardized creator footer on every generated page", () => {
    const everyPageFooter = pdfSource.slice(pdfSource.indexOf("const pages = document.getPages()"), pdfSource.indexOf("return document.save"));
    expect(everyPageFooter).toContain("pages.forEach");
    expect(everyPageFooter).toContain("drawMixedText(pdfPage, STATISTICS_PDF_CREATOR");
    expect(everyPageFooter).not.toContain("Created by D.Seretidis");
  });
});

describe("Statistics PDF binary generation", () => {
  it("creates a valid two-page PDF with embedded Greek glyphs", async () => { const bytes = await generateStatisticsPdf(report()); expect(new TextDecoder().decode(bytes.slice(0, 8))).toMatch(/^%PDF-/); expect(bytes.length).toBeGreaterThan(10_000); expect((await PDFDocument.load(bytes)).getPageCount()).toBe(2); });
  it("paginates a large roster within the same team before starting AWAY", async () => { const largeModel = buildStatisticsPdfDocumentModel(report(32, 8)); const plan = planStatisticsPdfPages(largeModel); expect(plan.map((page) => [page.side, page.continuation])).toEqual([["HOME", false], ["HOME", true], ["AWAY", false]]); expect(plan.filter((page) => page.side === "HOME").flatMap((page) => page.players)).toHaveLength(32); expect(plan[1].includeTotals).toBe(true); const bytes = await generateStatisticsPdf(report(32, 8)); expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3); });
});
