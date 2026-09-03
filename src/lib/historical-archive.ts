import { teams } from "@/data/teams";

export const HISTORICAL_GAME_SEASONS = ["2025-26", "2024-25"] as const;
export const HISTORICAL_TEAM_SEASONS = [...new Set(teams.map((team) => team.season))]
  .sort((left, right) => right.localeCompare(left));
export const HISTORICAL_ARCHIVE_SEASONS = [...new Set([
  ...HISTORICAL_GAME_SEASONS,
  ...HISTORICAL_TEAM_SEASONS,
])].sort((left, right) => right.localeCompare(left));

export type HistoricalArchiveSection = "schedule" | "results" | "standings" | "teams";

export const HISTORICAL_ARCHIVE_SECTIONS: ReadonlyArray<{ id: HistoricalArchiveSection; label: string }> = [
  { id: "schedule", label: "Πρόγραμμα" },
  { id: "results", label: "Αποτελέσματα" },
  { id: "standings", label: "Βαθμολογία" },
  { id: "teams", label: "Ομάδες" },
];

export function historicalSectionHasData(section: HistoricalArchiveSection, season: string): boolean {
  return section === "teams"
    ? HISTORICAL_TEAM_SEASONS.includes(season)
    : (HISTORICAL_GAME_SEASONS as readonly string[]).includes(season);
}
