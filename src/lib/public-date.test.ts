import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { formatPublicDate } from "./public-date";

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("public date presentation", () => {
  it("formats canonical and single-digit calendar dates as DD/MM/YYYY", () => {
    expect(formatPublicDate("2026-09-25")).toBe("25/09/2026");
    expect(formatPublicDate("2026-9-5")).toBe("05/09/2026");
  });

  it("uses the calendar prefix of date-time values without timezone conversion", () => {
    expect(formatPublicDate("2026-09-25T23:30:00-11:00")).toBe("25/09/2026");
    expect(formatPublicDate("2026-09-25 01:30:00+14:00")).toBe("25/09/2026");
  });

  it("leaves unsupported or impossible values unchanged", () => {
    expect(formatPublicDate("25 September 2026")).toBe("25 September 2026");
    expect(formatPublicDate("2026-02-30")).toBe("2026-02-30");
    expect(formatPublicDate(null)).toBe("");
  });

  it("covers central, hosted, schedule, finalized, team, Top Performance and MVP renderers", () => {
    for (const relativePath of [
      "../components/hosted/HostedOrganizationHomeData.tsx",
      "../components/competition/PublicCompetitionsView.tsx",
      "../components/competition/PublicCompetitionLatestMovements.tsx",
      "../components/competition/PublicCompetitionStatistics.tsx",
      "../components/competition/PublicTeamStatistics.tsx",
      "../components/competition/PublicFinalizedGame.tsx",
      "../components/schedule/ScheduleGrid.tsx",
    ]) expect(source(relativePath)).toContain("formatPublicDate");
  });

  it("keeps news metadata ISO and confines formatting to user-visible presentation", () => {
    const news = source("../app/(central)/news/[slug]/page.tsx");
    expect(news).toContain("datePublished: article.publishedAt ?? article.createdAt");
    expect(news).toContain("dateModified: article.updatedAt");
    expect(news).not.toContain("formatPublicDate");
    for (const relativePath of [
      "../services/public-competition.service.ts",
      "../services/public-competition-statistics.service.ts",
      "../services/public-finalized-game.service.ts",
    ]) expect(source(relativePath)).not.toContain("formatPublicDate");
  });
});
