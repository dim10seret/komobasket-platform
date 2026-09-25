import { describe, expect, it } from "vitest";

import { calculateStandings, type StandingsGameInput } from "./standings-calculator";

const teams = [{ id: "home", name: "Home" }, { id: "away", name: "Away" }];
const game = (overrides: Partial<StandingsGameInput> = {}): StandingsGameInput => ({
  id: "game-1", phaseId: "phase-1", homeTeamId: "home", awayTeamId: "away",
  homeScore: 70, awayScore: 60, status: "completed", resultSource: "administrative", ...overrides,
});
const standings = (games: StandingsGameInput[]) => calculateStandings({
  phaseId: "phase-1", teams, games, rules: { pointsForWin: 2, pointsForLoss: 1 },
  tieBreakers: ["head_to_head", "overall_point_diff", "alphabetical"],
});

describe("administrative standings-point overrides", () => {
  it("distinguishes explicit zero from an unset automatic award", () => {
    const result = standings([game({ homeStandingsPointsOverride: 0, awayStandingsPointsOverride: null })]);
    expect(result.rows.find((row) => row.teamId === "home")?.standingsPoints).toBe(0);
    expect(result.rows.find((row) => row.teamId === "away")?.standingsPoints).toBe(1);
  });

  it("reverses wins, losses and score aggregates while applying independent point awards", () => {
    const result = standings([game({ homeScore: 55, awayScore: 65, homeStandingsPointsOverride: 4, awayStandingsPointsOverride: 0 })]);
    expect(result.rows.find((row) => row.teamId === "home")).toMatchObject({ wins: 0, losses: 1, standingsPoints: 4, pointsFor: 55, pointsAgainst: 65 });
    expect(result.rows.find((row) => row.teamId === "away")).toMatchObject({ wins: 1, losses: 0, standingsPoints: 0, pointsFor: 65, pointsAgainst: 55 });
  });

  it("keeps normal phase rules and tie-breakers when overrides are absent", () => {
    const result = standings([game()]);
    expect(result.rows.find((row) => row.teamId === "home")?.standingsPoints).toBe(2);
    expect(result.rows.find((row) => row.teamId === "away")?.standingsPoints).toBe(1);
    expect(result.orderedRows.map((row) => row.teamId)).toEqual(["home", "away"]);
  });
});
