import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./ProgramGamesSection.tsx", import.meta.url), "utf8");

describe("Program & Games Match Report UI", () => {
  it("renders unavailable reports as grey and disabled", () => { expect(source).toContain("if (!availability?.available)"); expect(source).toContain("disabled: true"); expect(source).toContain("bg-zinc-100 text-zinc-500"); });
  it("renders finalized reports without incidents as green and enabled", () => { expect(source).toContain("disabled: false"); expect(source).toContain("bg-emerald-600 text-white"); });
  it("renders incident reports as red with visible warning meaning", () => { expect(source).toContain("if (availability.hasIncidentReport)"); expect(source).toContain("bg-red-600 text-white"); expect(source).toContain('label: "⚠ MATCH REPORT"'); expect(source).toContain("Υπάρχει Αναφορά Συμβάντων"); });
  it("opens the protected report detail instead of the manual-result editor", () => { expect(source).toContain("openMatchReport(String(realGame.id), matchReportAvailability)"); expect(source).toContain("/api/admin/match-reports/"); expect(source).not.toContain("if (isRealGame && realGame) openResultForm(realGame)"); });
  it("keeps independent manual-result editing", () => { expect(source).toContain("if (realGame) openResultForm(realGame)"); expect(source).toContain('name="action" value="manual-result"'); });
  it("shows identity, enables Statistics PDF, and keeps Game Sheet disabled", () => { expect(source).toContain("matchReportDetail.game.homeTeam.name"); expect(source).toContain("matchReportDetail.game.finalScore.home"); expect(source).toContain('"ΣΤΑΤΙΣΤΙΚΑ PDF"'); expect(source).toContain("ΦΥΛΛΟ ΑΓΩΝΑ PDF · Σύντομα"); });
  it("downloads through the protected Statistics route", () => { expect(source).toContain("downloadStatisticsPdf"); expect(source).toContain("/statistics`"); expect(source).toContain('blob.type !== "application/pdf"'); expect(source).toContain("URL.createObjectURL(blob)"); });
  it("prevents duplicate requests and exposes progress", () => { expect(source).toContain("statisticsPdfLoading"); expect(source).toContain('"ΔΗΜΙΟΥΡΓΙΑ PDF…"'); expect(source).toContain("disabled={statisticsPdfLoading}"); });
  it("keeps the modal open and shows a download error", () => { expect(source).toContain("statisticsPdfError"); expect(source).toContain('role="alert"'); expect(source).toContain("Το PDF στατιστικών δεν δημιουργήθηκε"); });
  it("shows incident action only from authoritative detail", () => { expect(source).toContain("matchReportDetail.availability.hasIncidentReport && matchReportDetail.incidentReport"); expect(source).toContain("⚠ ΑΝΑΦΟΡΑ ΣΥΜΒΑΝΤΩΝ"); });
  it("renders escaped multiline incident text", () => { expect(source).toContain("{matchReportDetail.incidentReport}"); expect(source).toContain("whitespace-pre-wrap"); expect(source).toContain("break-words"); expect(source).not.toContain("dangerouslySetInnerHTML"); });
  it("keeps dialogs responsive", () => { expect(source).toContain("max-h-[92vh]"); expect(source).toContain("overflow-y-auto"); expect(source).toContain("min-h-11"); });
});
