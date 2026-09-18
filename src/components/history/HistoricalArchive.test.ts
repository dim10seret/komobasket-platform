import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const header = readFileSync(new URL("../layout/Header.tsx", import.meta.url), "utf8");
const archive = readFileSync(new URL("./HistoricalArchive.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../../app/(central)/history/page.tsx", import.meta.url), "utf8");
const schedulePage = readFileSync(new URL("../../app/(central)/schedule/page.tsx", import.meta.url), "utf8");
const resultsPage = readFileSync(new URL("../../app/(central)/results/page.tsx", import.meta.url), "utf8");
const standingsPage = readFileSync(new URL("../../app/(central)/standings/page.tsx", import.meta.url), "utf8");
const teamsPage = readFileSync(new URL("../../app/(central)/teams/page.tsx", import.meta.url), "utf8");
const videosPage = readFileSync(new URL("../../app/(central)/videos/page.tsx", import.meta.url), "utf8");
const galleryPage = readFileSync(new URL("../../app/(central)/gallery/page.tsx", import.meta.url), "utf8");
const schedule = readFileSync(new URL("../schedule/ScheduleGrid.tsx", import.meta.url), "utf8");
const results = readFileSync(new URL("../results/ResultsGrid.tsx", import.meta.url), "utf8");

const primaryNavigation = header.slice(header.indexOf("const navigation"), header.indexOf("const socialLinks"));

describe("public history navigation and presentation", () => {
  it("removes Πρόγραμμα from primary navigation", () => expect(primaryNavigation).not.toContain('label: "Πρόγραμμα"'));
  it("removes Αποτελέσματα from primary navigation", () => expect(primaryNavigation).not.toContain('label: "Αποτελέσματα"'));
  it("removes Βαθμολογία from primary navigation", () => expect(primaryNavigation).not.toContain('label: "Βαθμολογία"'));
  it("removes Ομάδες from primary navigation", () => expect(primaryNavigation).not.toContain('label: "Ομάδες"'));
  it("hides Βίντεο from desktop navigation", () => expect(primaryNavigation).not.toContain('{ href: "/videos", label: "Βίντεο" }'));
  it("hides Gallery from desktop navigation", () => expect(primaryNavigation).not.toContain('{ href: "/gallery", label: "Gallery" }'));
  it("hides Βίντεο from the shared mobile navigation", () => { expect(header.match(/navigation\.map/g)).toHaveLength(2); expect(primaryNavigation).not.toContain('label: "Βίντεο"'); });
  it("hides Gallery from the shared mobile navigation", () => { expect(header.match(/navigation\.map/g)).toHaveLength(2); expect(primaryNavigation).not.toContain('label: "Gallery"'); });
  it("keeps the remaining primary navigation order unchanged", () => {
    expect([...primaryNavigation.matchAll(/\{ href: "([^"]+)", label: "([^"]+)" \}/g)].map((match) => [match[1], match[2]])).toEqual([
      ["/", "Αρχική"],
      ["/competitions", "Διοργανώσεις"],
      ["/stats", "Στατιστικά & MVP"],
      ["/news", "Νέα"],
      ["/supporters", "Υποστηρικτές"],
      ["/history", "Ιστορικό"],
      ["/contact", "Επικοινωνία"],
    ]);
  });
  it("adds one Ιστορικό primary entry", () => expect(primaryNavigation.match(/label: "Ιστορικό"/g)).toHaveLength(1));
  it("keeps Statistics & MVP in primary navigation", () => expect(primaryNavigation).toContain('{ href: "/stats", label: "Στατιστικά & MVP" }'));
  it("uses the same navigation array on desktop and mobile", () => expect(header.match(/navigation\.map/g)).toHaveLength(2));
  it("marks the active navigation item semantically", () => { expect(header).toContain("usePathname"); expect(header).toContain("aria-current"); });
  it("renders the public history route", () => { expect(page).toContain("ΙΣΤΟΡΙΚΟ KOMOBASKET"); expect(page).toContain("<HistoricalArchive />"); });
  it("renders an actual season selector", () => { expect(archive).toContain("HISTORICAL_ARCHIVE_SEASONS.map"); expect(archive).toContain("<select"); });
  it("defaults through the first descending archive season", () => expect(archive).toContain("useState(HISTORICAL_ARCHIVE_SEASONS[0])"));
  it("renders Πρόγραμμα through the existing ScheduleGrid", () => expect(archive).toContain("<ScheduleGrid archiveSeason={season} />"));
  it("renders Αποτελέσματα through the existing ResultsGrid", () => expect(archive).toContain("<ResultsGrid archiveSeason={season} />"));
  it("renders Βαθμολογία through the existing StandingsTable", () => expect(archive).toContain("<StandingsTable archiveSeason={season} />"));
  it("renders Ομάδες through the existing TeamsGrid", () => expect(archive).toContain("<TeamsGrid archiveSeason={season} />"));
  it("uses semantic pressed buttons for archive sections", () => { expect(archive).toContain("<button"); expect(archive).toContain("aria-pressed"); });
  it("keeps season and archive controls touch sized", () => expect(archive.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2));
  it("keeps controls responsive", () => { expect(archive).toContain("grid-cols-2"); expect(archive).toContain("sm:flex"); });
  it("keeps legacy schedule route working", () => expect(schedulePage).toContain("<ScheduleGrid />"));
  it("keeps legacy results route working", () => expect(resultsPage).toContain("<ResultsGrid />"));
  it("keeps legacy standings route working", () => expect(standingsPage).toContain("<StandingsTable />"));
  it("keeps legacy teams route working", () => expect(teamsPage).toContain("<TeamsGrid />"));
  it("keeps the direct video route available", () => { expect(videosPage).toContain("export default function VideosPage"); expect(videosPage).toContain("Βίντεο αγώνων"); });
  it("keeps the direct gallery route available", () => { expect(galleryPage).toContain("export default function GalleryPage"); expect(galleryPage).toContain("Η gallery βρίσκεται υπό κατασκευή."); });
  it("does not fabricate game data for unsupported seasons", () => { expect(schedule).toContain("Δεν υπάρχει διαθέσιμο ιστορικό πρόγραμμα"); expect(results).toContain("Δεν υπάρχουν διαθέσιμα ιστορικά αποτελέσματα"); });
  it("does not add Match Report links to legacy games", () => { expect(schedule).not.toContain("PublicGameResult"); expect(results).not.toContain("PublicGameResult"); });
  it("leaves current canonical competitions in their own primary entry", () => expect(primaryNavigation).toContain('{ href: "/competitions", label: "Διοργανώσεις" }'));
});
