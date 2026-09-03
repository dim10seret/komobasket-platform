import { describe, expect, it } from "vitest";

import { HISTORICAL_ARCHIVE_SEASONS, HISTORICAL_ARCHIVE_SECTIONS, HISTORICAL_GAME_SEASONS, HISTORICAL_TEAM_SEASONS, historicalSectionHasData } from "./historical-archive";

describe("historical archive source contract", () => {
  it("defaults to the latest real historical season", () => expect(HISTORICAL_ARCHIVE_SEASONS[0]).toBe("2025-26"));
  it("uses only seasons represented by legacy data", () => expect(HISTORICAL_ARCHIVE_SEASONS).toEqual(["2025-26", "2024-25", "2023-24", "2022-23", "2021-22", "2019-20"]));
  it("does not invent the current Platform season", () => expect(HISTORICAL_ARCHIVE_SEASONS).not.toContain("2026-27"));
  it("does not invent the non-played 2020-21 season as a data archive", () => expect(HISTORICAL_ARCHIVE_SEASONS).not.toContain("2020-21"));
  it("derives team seasons from the legacy team source", () => expect(HISTORICAL_TEAM_SEASONS).toContain("2019-20"));
  it("recognizes both actual game-data seasons", () => expect(HISTORICAL_GAME_SEASONS).toEqual(["2025-26", "2024-25"]));
  it("provides all four archive areas", () => expect(HISTORICAL_ARCHIVE_SECTIONS.map((item) => item.label)).toEqual(["Πρόγραμμα", "Αποτελέσματα", "Βαθμολογία", "Ομάδες"]));
  it("allows program only where game datasets exist", () => { expect(historicalSectionHasData("schedule", "2025-26")).toBe(true); expect(historicalSectionHasData("schedule", "2023-24")).toBe(false); });
  it("allows results only where game datasets exist", () => { expect(historicalSectionHasData("results", "2024-25")).toBe(true); expect(historicalSectionHasData("results", "2022-23")).toBe(false); });
  it("allows standings only where standings datasets exist", () => { expect(historicalSectionHasData("standings", "2025-26")).toBe(true); expect(historicalSectionHasData("standings", "2021-22")).toBe(false); });
  it("allows teams for every represented roster season", () => { expect(historicalSectionHasData("teams", "2019-20")).toBe(true); expect(historicalSectionHasData("teams", "2026-27")).toBe(false); });
});
