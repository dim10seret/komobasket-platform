import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { PublicGame } from "@/services/public-competition.service";
import { publicFinalizedGameHref } from "./PublicGameResult";

const game = (overrides: Partial<PublicGame> = {}): PublicGame => ({ id: "game-reference", roundNumber: 1, gameOrder: 1, roundLabel: "1η Αγωνιστική", scheduledDate: "2026-09-02", scheduledTime: "18:30", venue: null, homeScore: 14, awayScore: 7, publicStatus: "completed", liveAvailable: false, finalizedStatisticsAvailable: true, videoUrl: null, homeTeam: { id: "home", name: "ΛΕΚΑΒΕΞ", logoUrl: null }, awayTeam: { id: "away", name: "JUGOPIASTIKA", logoUrl: null }, ...overrides });
const component = readFileSync(new URL("./PublicFinalizedGame.tsx", import.meta.url), "utf8");
const resultComponent = readFileSync(new URL("./PublicGameResult.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/(central)/competitions/games/[gameId]/page.tsx", import.meta.url), "utf8");
const competitionPage = readFileSync(new URL("./PublicCompetitionsView.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../services/public-finalized-game.service.ts", import.meta.url), "utf8");
const dto = readFileSync(new URL("../../lib/public-finalized-game.ts", import.meta.url), "utf8");

describe("public finalized game presentation", () => {
  it("links an authoritative finalized score", () => expect(publicFinalizedGameHref(game())).toBe("/competitions/games/game-reference"));
  it("encodes the game id in the link", () => expect(publicFinalizedGameHref(game({ id: "game / id" }))).toBe("/competitions/games/game%20%2F%20id"));
  it("does not link a scheduled game", () => expect(publicFinalizedGameHref(game({ publicStatus: "scheduled", homeScore: null, awayScore: null }))).toBeNull());
  it("does not replace LIVE navigation", () => expect(publicFinalizedGameHref(game({ publicStatus: "live", liveAvailable: true }))).toBeNull());
  it("does not link a manual or legacy completed score", () => expect(publicFinalizedGameHref(game({ finalizedStatisticsAvailable: false }))).toBeNull());
  it("fails closed when either score is missing", () => expect(publicFinalizedGameHref(game({ awayScore: null }))).toBeNull());
  it("reuses one result component on compact and full cards", () => expect(competitionPage.match(/<PublicGameResult game=\{game\}/g)).toHaveLength(2));
  it("keeps the existing LIVE control", () => expect(competitionPage).toContain("game.liveAvailable"));
  it("provides a touch-sized accessible score link", () => { expect(resultComponent).toContain("min-h-10"); expect(resultComponent).toContain("aria-label"); });
  it("loads only through the finalized report service", () => { expect(service).toContain("readPlatformMatchReport"); expect(service).toContain("projectPublicFinalizedGame"); });
  it("uses the established public organization scope", () => expect(service).toContain("PUBLIC_KOMOBASKET_ORGANIZATION_ID"));
  it("renders the dedicated dynamic route", () => { expect(page).toContain("readPublicFinalizedGame"); expect(page).toContain('dynamic = "force-dynamic"'); });
  it("fails closed with an unavailable state", () => expect(page).toContain("Δεν υπάρχουν διαθέσιμα στατιστικά αγώνα"));
  it("shows a final game header", () => { expect(component).toContain("ΤΕΛΙΚΟ"); expect(component).toContain("detail.game.finalScore.home"); expect(component).toContain("detail.game.finalScore.away"); });
  it("renders competition, season, phase, round, date, time, and venue metadata", () => expect(component).toContain("detail.game.competition, detail.game.season, detail.game.phase, detail.game.round"));
  it("renders dynamic regulation and overtime period labels", () => { expect(component).toContain('period.kind === "OVERTIME"'); expect(component).toContain("detail.game.periodScores.map"); });
  it("renders both finalized team tables", () => { expect(component).toContain('side="HOME"'); expect(component).toContain('side="AWAY"'); });
  it("renders every approved statistics column", () => { for (const column of ["PTS", "2PT", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "F", "EFF"]) expect(component).toContain(`"${column}"`); });
  it("renders made-attempted shooting values", () => { expect(component).toContain("statistics.twoPointMade"); expect(component).toContain("statistics.threePointAttempts"); expect(component).toContain("statistics.freeThrowMade"); });
  it("renders authoritative team totals", () => { expect(component).toContain("team.totals"); expect(component).toContain("ΣΥΝΟΛΟ"); });
  it("keeps wide statistics touch-scrollable without page overflow", () => { expect(component).toContain("overflow-x-auto"); expect(component).toContain('tabIndex={0}'); expect(component).toContain("min-w-[1120px]"); });
  it("keeps player identity columns sticky", () => { expect(component).toContain("sticky left-0"); expect(component).toContain("sticky left-12"); });
  it("keeps team names and score responsive", () => { expect(component).toContain("break-words"); expect(component).toContain("sm:text-5xl"); expect(component).toContain("flex flex-wrap"); });
  it("offers a competition return action", () => expect(page).toContain("← Επιστροφή στη διοργάνωση"));
  it("does not render incident or internal metadata", () => { expect(component).not.toMatch(/incidentReport|historyHash|finalizationHash|scorerId|deviceId|runId/); expect(dto.slice(dto.indexOf("export type PublicFinalizedGameDetail"))).not.toMatch(/incidentReport|historyHash|finalizationHash|scorerId|deviceId|runId/); });
});
