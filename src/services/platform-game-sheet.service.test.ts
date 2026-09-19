import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { gameSheetPeriodColor, type PlatformGameSheet } from "@/lib/platform-game-sheet";
import { gameSheetHalftimeSeparatorPoints, gameSheetRegulationPeriods, gameSheetRunningScoreVisual, gameSheetTimeoutSlots, generatePlatformGameSheetPdf, renderPlatformGameSheetHtml } from "./platform-game-sheet.service";

const sheet = { mode: "FULL", regulationPeriods: 4, game: { gameId: "game-1", competition: "TEST C3", season: "2026-27", phase: "Phase", round: "Round", scheduledDate: "2026-09-05", scheduledTime: "18:30", venue: "<Arena>", homeTeam: { teamId: "home", name: "HOME", logoUrl: null }, awayTeam: { teamId: "away", name: "AWAY", logoUrl: null }, finalScore: { home: 1, away: 0 }, winner: "HOME", periodScores: [] }, home: { side: "HOME", designation: "Ομάδα Α", teamId: "home", name: "HOME", players: [], timeouts: [], teamFouls: [], headCoach: "", assistantCoach: "", extraBench: [{ name: "Άτομο", role: "Ιατρός" }] }, away: { side: "AWAY", designation: "Ομάδα Β", teamId: "away", name: "AWAY", players: [], timeouts: [], teamFouls: [], headCoach: "", assistantCoach: "", extraBench: [] }, officials: { referees: { a: "", b: "", c: "" }, table: { timer: "", shotClock: "", scoresheet: "", commissioner: "" } }, runningScore: Array.from({ length: 160 }, (_, index) => ({ score: index + 1, home: null, away: null })), periodScores: [], winner: "HOME" } satisfies PlatformGameSheet;

const visualPeriods = {
  q1: { kind: "REGULATION", index: 1 } as const,
  q2: { kind: "REGULATION", index: 2 } as const,
  q3: { kind: "REGULATION", index: 3 } as const,
  q4: { kind: "REGULATION", index: 4 } as const,
};

function visualRoster(prefix: string): PlatformGameSheet["home"]["players"] {
  const player = (
    index: number,
    entry: PlatformGameSheet["home"]["players"][number]["entry"],
    foulMarks: NonNullable<PlatformGameSheet["home"]["players"][number]["foulMarks"]>,
  ): PlatformGameSheet["home"]["players"][number] => ({
    playerId: `${prefix}-${index}`,
    displayName: `${prefix} PLAYER ${index}`,
    shirtNumber: String(index),
    captain: index === 1,
    starter: entry?.kind === "STARTER",
    entry,
    fouls: foulMarks.map((mark) => mark.code),
    foulMarks,
  });

  return [
    player(1, { kind: "STARTER", period: visualPeriods.q1 }, [{ code: "P", period: visualPeriods.q1 }]),
    player(2, { kind: "STARTER", period: visualPeriods.q1 }, [{ code: "P", period: visualPeriods.q1 }, { code: "P", period: visualPeriods.q2 }]),
    player(3, { kind: "STARTER", period: visualPeriods.q1 }, [{ code: "P", period: visualPeriods.q1 }, { code: "T", period: visualPeriods.q2 }, { code: "DI", period: visualPeriods.q2 }]),
    player(4, { kind: "STARTER", period: visualPeriods.q1 }, [{ code: "FL", period: visualPeriods.q3 }]),
    player(5, { kind: "STARTER", period: visualPeriods.q1 }, []),
    player(6, { kind: "SUBSTITUTE", period: visualPeriods.q1 }, [{ code: "D", period: visualPeriods.q1 }]),
    player(7, { kind: "SUBSTITUTE", period: visualPeriods.q2 }, []),
    player(8, { kind: "SUBSTITUTE", period: visualPeriods.q3 }, []),
  ];
}

const visualMarksSheet = {
  ...sheet,
  game: { ...sheet.game, gameId: "local-roster-marks", finalScore: { home: 0, away: 0 }, winner: null },
  home: { ...sheet.home, players: visualRoster("HOME"), extraBench: [] },
  away: { ...sheet.away, players: visualRoster("AWAY"), extraBench: [] },
  winner: "ΙΣΟΠΑΛΙΑ",
} satisfies PlatformGameSheet;

describe("KomoBasket Game Sheet rendering", () => {
  const html = renderPlatformGameSheetHtml(sheet, "nonce123");
  it("uses A4 portrait print CSS and the classic 1-160 running-score grid", () => { expect(html).toContain("size:A4 portrait"); expect(html).toContain("ΔΙΑΚΥΜΑΝΣΗ ΣΚΟΡ"); expect(html).toContain(">160<"); });
  it("provides print controls outside the sheet and hides them when printed", () => { expect(html).toContain("Εκτύπωση / Αποθήκευση PDF"); expect(html).toContain(".toolbar{display:none}"); expect(html).toContain('nonce="nonce123"'); });
  it("creates page two only for Extra Bench and escapes stored text", () => { expect(html).toContain("ΠΡΟΣΘΕΤΑ ΣΤΟΙΧΕΙΑ ΑΓΩΝΑ"); expect(html).toContain("&lt;Arena&gt;"); });
  it("stays one page without Extra Bench", () => { const htmlWithoutBench = renderPlatformGameSheetHtml({ ...sheet, home: { ...sheet.home, extraBench: [] } }, "nonce123"); expect(htmlWithoutBench).not.toContain("ΠΡΟΣΘΕΤΑ ΣΤΟΙΧΕΙΑ ΑΓΩΝΑ"); });
  it("generates a valid PDF with the KomoBasket title", async () => { const bytes = await generatePlatformGameSheetPdf({ ...sheet, home: { ...sheet.home, extraBench: [] } }); expect(new TextDecoder().decode(bytes.slice(0, 8))).toMatch(/^%PDF-/); const pdf = await (await import("pdf-lib")).PDFDocument.load(bytes); expect(pdf.getPageCount()).toBe(1); expect(pdf.getTitle()).toBe("ΦΥΛΛΟ ΑΓΩΝΑ KOMOBASKET"); });
  it("renders exactly four configured regulation periods and continues overtime colour by ordinal", () => { expect(gameSheetRegulationPeriods(4).map((period) => period.index)).toEqual([1, 2, 3, 4]); expect(gameSheetPeriodColor({ kind: "OVERTIME", index: 1 }, 4)).toBe("red"); expect(gameSheetPeriodColor({ kind: "OVERTIME", index: 2 }, 4)).toBe("blue"); });
  it("renders a valid two-period sheet without phantom Q3 or Q4", async () => { expect(gameSheetRegulationPeriods(2).map((period) => `Q${period.index}`)).toEqual(["Q1", "Q2"]); expect(gameSheetPeriodColor({ kind: "OVERTIME", index: 1 }, 2)).toBe("red"); expect(gameSheetPeriodColor({ kind: "OVERTIME", index: 2 }, 2)).toBe("blue"); const bytes = await generatePlatformGameSheetPdf({ ...sheet, regulationPeriods: 2, home: { ...sheet.home, extraBench: [] } }); expect((await (await import("pdf-lib")).PDFDocument.load(bytes)).getPageCount()).toBe(1); });  it("paginates all extended roster players without truncation", async () => { const players = Array.from({ length: 18 }, (_, index) => ({ playerId: `h${index}`, displayName: `Player ${index}`, shirtNumber: String(index), captain: false, starter: index < 5, fouls: [] as [], entry: null })); const extended = { ...sheet, home: { ...sheet.home, players, extraBench: [] }, away: { ...sheet.away, players: players.map((player) => ({ ...player, playerId: `a${player.playerId}` })), extraBench: [] } }; const html = renderPlatformGameSheetHtml(extended, "nonce123"); expect(html).toContain("ΕΚΤΕΤΑΜΕΝΟ ΦΥΛΛΟ ΑΓΩΝΑ"); expect(html).toContain("Player 17"); const bytes = await generatePlatformGameSheetPdf(extended); expect((await (await import("pdf-lib")).PDFDocument.load(bytes)).getPageCount()).toBe(2); });
  it("draws canonical starter, substitute, and foul marks visibly inside their roster rows", async () => {
    const { PDFPage } = await import("pdf-lib");
    const drawText = vi.spyOn(PDFPage.prototype, "drawText");
    const drawEllipse = vi.spyOn(PDFPage.prototype, "drawEllipse");
    try {
      const bytes = await generatePlatformGameSheetPdf(visualMarksSheet);
      expect(new TextDecoder().decode(bytes.slice(0, 8))).toMatch(/^%PDF-/);

      const rosterCalls = drawText.mock.calls
        .map(([value, options]) => ({ value, options }))
        .filter(({ options }) => options.y >= 520 && options.y <= 635);
      const entryCalls = rosterCalls.filter(({ value }) => value === "X");
      const foulCalls = rosterCalls.filter(({ value }) => ["P", "T", "DI", "FL", "D"].includes(value));
      const atY = (calls: typeof rosterCalls, y: number) => calls.filter(({ options }) => options.y === y);
      const colorOf = (call: (typeof rosterCalls)[number]) => call.options.color;

      expect(entryCalls).toHaveLength(16);
      expect(drawEllipse).toHaveBeenCalledTimes(10);
      expect(atY(entryCalls, 629)).toHaveLength(2);
      expect(atY(entryCalls, 569)).toHaveLength(2);
      expect(atY(entryCalls, 554)).toHaveLength(2);
      expect(atY(entryCalls, 539)).toHaveLength(2);
      expect(atY(entryCalls, 524)).toHaveLength(2);

      const starter = atY(entryCalls, 629)[0]!;
      const q1Substitute = atY(entryCalls, 554)[0]!;
      const q2Substitute = atY(entryCalls, 539)[0]!;
      const q3Substitute = atY(entryCalls, 524)[0]!;
      expect(colorOf(starter)).toEqual(colorOf(q2Substitute));
      expect(colorOf(q1Substitute)).toEqual(colorOf(q3Substitute));
      expect(colorOf(q1Substitute)).not.toEqual(colorOf(q2Substitute));
      expect(Math.max(colorOf(starter).red, colorOf(starter).green, colorOf(starter).blue)).toBeGreaterThan(0);
      expect(Math.max(colorOf(q1Substitute).red, colorOf(q1Substitute).green, colorOf(q1Substitute).blue)).toBeGreaterThan(0);

      const starterRows = new Set([629, 614, 599, 584, 569]);
      const starterCalls = entryCalls.filter(({ options }) => starterRows.has(options.y));
      const substituteCalls = entryCalls.filter(({ options }) => !starterRows.has(options.y));
      const circles = drawEllipse.mock.calls.map(([options]) => options);
      const centerFor = (call: (typeof rosterCalls)[number]) => ({ x: call.options.x + 4.2, y: call.options.y + 3.3 });
      const tolerance = 0.25;
      const nearbyCircles = (call: (typeof rosterCalls)[number]) => {
        const center = centerFor(call);
        return circles.filter((circle) => Math.abs(circle.x - center.x) <= tolerance && Math.abs(circle.y - center.y) <= tolerance);
      };
      const nearbyStarters = (circle: (typeof circles)[number]) => starterCalls.filter((call) => {
        const center = centerFor(call);
        return Math.abs(circle.x - center.x) <= tolerance && Math.abs(circle.y - center.y) <= tolerance;
      });

      expect(starterCalls).toHaveLength(10);
      for (const starterCall of starterCalls) {
        const matches = nearbyCircles(starterCall);
        expect(matches).toHaveLength(1);
        expect(matches[0]!.borderWidth).toBeGreaterThan(0);
        expect(matches[0]!.borderColor).toEqual(colorOf(q1Substitute));
      }
      for (const circle of circles) expect(nearbyStarters(circle)).toHaveLength(1);
      for (const substituteCall of substituteCalls) expect(nearbyCircles(substituteCall)).toHaveLength(0);

      expect(foulCalls).toHaveLength(16);
      expect(atY(foulCalls, 629).map(({ value }) => value)).toEqual(["P", "P"]);
      expect(atY(foulCalls, 614).map(({ value }) => value)).toEqual(["P", "P", "P", "P"]);
      expect(atY(foulCalls, 599).map(({ value }) => value)).toEqual(["P", "T", "DI", "P", "T", "DI"]);
      expect(atY(foulCalls, 584).map(({ value }) => value)).toEqual(["FL", "FL"]);
      expect(atY(foulCalls, 554).map(({ value }) => value)).toEqual(["D", "D"]);
      for (const call of foulCalls) {
        expect(call.options.x).toBeGreaterThan(0);
        expect(call.options.y).toBeGreaterThan(0);
        expect(Math.max(call.options.color.red, call.options.color.green, call.options.color.blue)).toBeGreaterThan(0);
      }

      const separator = gameSheetHalftimeSeparatorPoints(visualMarksSheet.home.players, 4, 0, 652);
      expect(separator.length).toBeGreaterThan(0);
      expect(separator.every((point) => ![194, 211, 222, 233, 244, 255].includes(point.x))).toBe(true);
    } finally {
      drawText.mockRestore();
      drawEllipse.mockRestore();
    }
  });
});
