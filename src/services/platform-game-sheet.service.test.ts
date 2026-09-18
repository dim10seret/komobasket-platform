import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import type { PlatformGameSheet } from "@/lib/platform-game-sheet";
import { renderPlatformGameSheetHtml } from "./platform-game-sheet.service";

const sheet = { mode: "FULL", game: { gameId: "game-1", competition: "TEST C3", season: "2026-27", phase: "Phase", round: "Round", scheduledDate: "2026-09-05", scheduledTime: "18:30", venue: "<Arena>", homeTeam: { teamId: "home", name: "HOME", logoUrl: null }, awayTeam: { teamId: "away", name: "AWAY", logoUrl: null }, finalScore: { home: 1, away: 0 }, winner: "HOME", periodScores: [] }, home: { side: "HOME", designation: "Ομάδα Α", teamId: "home", name: "HOME", players: [], timeouts: [], teamFouls: [], headCoach: "", assistantCoach: "", extraBench: [{ name: "Άτομο", role: "Ιατρός" }] }, away: { side: "AWAY", designation: "Ομάδα Β", teamId: "away", name: "AWAY", players: [], timeouts: [], teamFouls: [], headCoach: "", assistantCoach: "", extraBench: [] }, officials: { referees: { a: "", b: "", c: "" }, table: { timer: "", shotClock: "", scoresheet: "", commissioner: "" } }, runningScore: Array.from({ length: 160 }, (_, index) => ({ score: index + 1, home: null, away: null })), periodScores: [], winner: "HOME" } satisfies PlatformGameSheet;

describe("printable official Game Sheet", () => {
  const html = renderPlatformGameSheetHtml(sheet, "nonce123");
  it("uses A4 portrait print CSS and the classic 1-160 running-score grid", () => { expect(html).toContain("size:A4 portrait"); expect(html).toContain("ΔΙΑΚΥΜΑΝΣΗ ΣΚΟΡ"); expect(html).toContain(">160<"); });
  it("provides print controls outside the sheet and hides them when printed", () => { expect(html).toContain("Εκτύπωση / Αποθήκευση PDF"); expect(html).toContain(".toolbar{display:none}"); expect(html).toContain('nonce="nonce123"'); });
  it("creates page two only for Extra Bench and escapes stored text", () => { expect(html).toContain("ΠΡΟΣΘΕΤΑ ΣΤΟΙΧΕΙΑ ΑΓΩΝΑ"); expect(html).toContain("&lt;Arena&gt;"); });
  it("stays one page without Extra Bench", () => { const htmlWithoutBench = renderPlatformGameSheetHtml({ ...sheet, home: { ...sheet.home, extraBench: [] } }, "nonce123"); expect(htmlWithoutBench).not.toContain("ΠΡΟΣΘΕΤΑ ΣΤΟΙΧΕΙΑ ΑΓΩΝΑ"); });
});
