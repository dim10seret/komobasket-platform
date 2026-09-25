import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

vi.mock("server-only", () => ({}));
vi.mock("@/services/public-competition.service", () => ({ CANONICAL_PUBLIC_SEASON_START: "2026-01-01", PUBLIC_KOMOBASKET_ORGANIZATION_ID: "organization_komobasket" }));
vi.mock("@/services/platform-match-report.service", () => ({ readAuthoritativeCompetitionStatisticalGamesWithDb: vi.fn(async () => []) }));

const component = readFileSync(new URL("./PublicCompetitionStatistics.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/(central)/stats/page.tsx", import.meta.url), "utf8");
const header = readFileSync(new URL("../layout/Header.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../services/public-competition-statistics.service.ts", import.meta.url), "utf8");
const reportService = readFileSync(new URL("../../services/platform-match-report.service.ts", import.meta.url), "utf8");

describe("public Statistics and MVP V1 presentation", () => {
  it("adds the primary navigation item", () => expect(header).toContain('{ href: "/stats", label: "Στατιστικά & MVP" }'));
  it("inherits desktop and mobile active navigation", () => { expect(header).toContain("usePathname"); expect(header).toContain("aria-current"); });
  it("renders the public route", () => { expect(page).toContain("ΣΤΑΤΙΣΤΙΚΑ &amp; MVP"); expect(page).toContain("readPublicCompetitionStatistics"); });
  it("exposes only competitions belonging to the selected canonical season", async () => {
    const catalogue = [
      { season_id: "season-a", season_name: "2026-27", season_slug: "2026-27", starts_on: "2026-08-01", competition_id: "competition-a", competition_name: "TEST C3", competition_slug: "test-c3" },
      { season_id: "season-b", season_name: "2027-28", season_slug: "2027-28", starts_on: "2027-08-01", competition_id: "competition-b", competition_name: "OTHER", competition_slug: "other" },
    ];
    const database: D1DatabaseBinding = {
      prepare(query) {
        const statement: D1PreparedStatement = {
          bind: () => statement,
          all: async <T,>() => ({ results: (query.includes("FROM league_competitions") ? catalogue : []) as T[] }),
          first: async <T,>() => null as T | null,
          run: async () => ({}),
        };
        return statement;
      },
      batch: async () => [],
    };
    const { readPublicCompetitionStatisticsWithDb } = await import("../../services/public-competition-statistics.service");
    const result = await readPublicCompetitionStatisticsWithDb(database, { seasonSlug: "2026-27" });
    expect(result.selectedSeason?.slug).toBe("2026-27");
    expect(result.competitions).toEqual([{ slug: "test-c3", name: "TEST C3" }]);
    expect(result.competitions).not.toContainEqual({ slug: "other", name: "OTHER" });
  });
  it("loads all authoritative games in one competition batch", () => { expect(service).toContain("readAuthoritativeCompetitionStatisticalGamesWithDb"); expect(reportService).toContain("readAuthoritativeStatisticalGamesWithDb"); });
  it("reuses strong finalized Match Report validation", () => expect(reportService).toContain("platformMatchReportAvailability(source(row))"));
  it("renders five required leader cards", () => { for (const title of ["ΠΡΩΤΟΣ ΣΚΟΡΕΡ", "3PT LEADER", "REB LEADER", "AST LEADER", "EFF LEADER"]) expect(component).toContain(title); });
  it("shows player games played", () => expect(component).toContain("ΑΓ. {player.gamesPlayed}"));
  it("offers every V1 ranking category", () => expect(component).toContain("PUBLIC_LEADER_CATEGORIES.map"));
  it("renders a Top 20 ranking table", () => { expect(component).toContain("Top 20"); expect(component).toContain("ΠΑΙΚΤΗΣ"); expect(component).toContain("ΟΜΑΔΑ"); expect(component).toContain("ΕΠΙΔΟΣΗ"); });
  it("shows made-attempted shooting rankings", () => { expect(component).toContain("threePointMade"); expect(component).toContain("twoPointAttempts"); expect(component).toContain("freeThrowMade"); });
  it("renders the matchday selector", () => { expect(component).toContain("Αγωνιστική"); expect(component).toContain("statistics.matchdays.map"); });
  it("renders Top Performance game statistics", () => { for (const label of ["PTS", "REB", "AST", "STL", "BLK", "EFF"]) expect(component).toContain(`"${label}"`); });
  it("explains that incomplete matchday performance waits for every game", () => expect(component).toContain("Το Top Performance θα ανακοινωθεί μετά την ολοκλήρωση όλων των αγώνων της αγωνιστικής."));
  it("never renders a provisional card in the incomplete branch", () => expect(component).toContain('matchday?.incomplete ? <p className="mt-5'));
  it("shows the safe empty performance state", () => expect(component).toContain("Δεν υπάρχουν διαθέσιμα δεδομένα για Top Performance."));
  it("keeps filters touch friendly and responsive", () => { expect(component.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(3); expect(component).toContain("sm:grid-cols-2"); });
  it("keeps rankings horizontally accessible", () => { expect(component).toContain("overflow-x-auto"); expect(component).toContain('tabIndex={0}'); expect(component).toContain("sticky left-0"); });
  it("renders the selected human MVP as a larger section below Top Performance", () => { expect(component).toContain("MVP ΑΓΩΝΙΣΤΙΚΗΣ"); expect(component.indexOf("MVP ΑΓΩΝΙΣΤΙΚΗΣ")).toBeGreaterThan(component.indexOf("TOP PERFORMANCE")); expect(component).toContain("matchday?.mvp"); });
  it("does not expose admin selection controls publicly", () => expect(component).not.toMatch(/ΑΛΛΟΣ ΠΑΙΚΤΗΣ|matchday-mvp|admin MVP/i));
  it("does not expose incident or sync metadata", () => { expect(component).not.toMatch(/incidentReport|historyHash|finalizationHash|scorerId|deviceId|runId/); expect(service).not.toMatch(/incidentReport|historyHash|finalizationHash|scorerId|deviceId/); });
});
