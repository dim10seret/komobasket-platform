import { describe, expect, it } from "vitest";
import { normalizedIncidentReport, platformMatchReportAvailability, type PlatformMatchReportConsistencySource } from "./platform-match-report";

const finalized = (overrides: Partial<PlatformMatchReportConsistencySource> = {}): PlatformMatchReportConsistencySource => ({
  gameId: "game_a5dc049d-9812-486c-8dcc-632eefb20be3", gameStatus: "completed", resultSource: "match_report",
  gameHomeScore: 14, gameAwayScore: 7, claimRunId: "run-1", headLifecycle: "finalized",
  headHistoryRevision: 142, headLastAcceptedSequence: 152, headHistoryHash: "history",
  headFinalizationHash: "finalization", officialResultAppliedAt: "2026-09-02T12:50:48Z",
  finalizedHistoryRevision: 142, finalizedHistoryHash: "history", finalStateHash: "state",
  finalizationHash: "finalization", finalStateJsonValid: true, finalStateRunId: "run-1",
  finalStateFinished: true, finalStateLastProcessedSequence: 152, finalStateHomeScore: 14,
  finalStateAwayScore: 7, finalizationJsonValid: true, manifestRunId: "run-1",
  manifestHistoryRevision: 142, manifestHistoryHash: "history", manifestFinalStateHash: "state",
  incidentReportType: null, incidentReport: null, ...overrides,
});

describe("Platform Match Report availability", () => {
  it("keeps scheduled games unavailable", () => expect(platformMatchReportAvailability(finalized({ gameStatus: "scheduled", claimRunId: null, headLifecycle: null })).unavailableReason).toBe("NOT_FINALIZED"));
  it("keeps live games unavailable", () => expect(platformMatchReportAvailability(finalized({ headLifecycle: "live" })).unavailableReason).toBe("NOT_FINALIZED"));
  it("keeps manual completed games unavailable", () => expect(platformMatchReportAvailability(finalized({ claimRunId: null, headLifecycle: null, resultSource: "manual" })).unavailableReason).toBe("LEGACY_RESULT"));
  it("keeps legacy score-only results unavailable", () => expect(platformMatchReportAvailability(finalized({ claimRunId: null, headLifecycle: null })).available).toBe(false));
  it("enables a consistent finalized report without incident", () => expect(platformMatchReportAvailability(finalized())).toEqual({ available: true, hasIncidentReport: false }));
  it("flags a consistent finalized report with incident", () => expect(platformMatchReportAvailability(finalized({ incidentReportType: "text", incidentReport: "ΤΕΣΤ ΑΝΑΦΟΡΑΣ" }))).toEqual({ available: true, hasIncidentReport: true }));
  it("projects the real reference identity as available", () => expect(platformMatchReportAvailability(finalized({ incidentReportType: "text", incidentReport: "ΤΕΣΤ ΑΝΑΦΟΡΑΣ" })).available).toBe(true));
  it("fails closed on a head/finalization hash mismatch", () => expect(platformMatchReportAvailability(finalized({ finalizationHash: "different" })).unavailableReason).toBe("INCONSISTENT_DATA"));
  it("fails closed on score or sequence mismatch", () => {
    expect(platformMatchReportAvailability(finalized({ finalStateAwayScore: 8 })).available).toBe(false);
    expect(platformMatchReportAvailability(finalized({ finalStateLastProcessedSequence: 151 })).available).toBe(false);
  });
  it("preserves exact Greek multiline text and normalizes missing legacy data", () => {
    expect(normalizedIncidentReport("text", "ΤΕΣΤ\nΑΝΑΦΟΡΑΣ")).toBe("ΤΕΣΤ\nΑΝΑΦΟΡΑΣ");
    expect(normalizedIncidentReport(null, null)).toBeNull();
    expect(normalizedIncidentReport("text", "   ")).toBeNull();
  });
});
