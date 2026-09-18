import { describe, expect, it } from "vitest";
import { getRootPhaseCompetitionTeams, isEligibleRootSeriesSlot, resolvePhasePredecessorId } from "./phase-root-source";

const snapshot = {
  organizationContext: { organizationId: "org-a" },
  competitions: [
    { id: "cup", organization_id: "org-a", season_id: "season" },
    { id: "league", organization_id: "org-a", season_id: "season" },
    { id: "foreign-cup", organization_id: "org-b", season_id: "season" },
  ],
  teams: [
    { id: "team-a", organization_id: "org-a", name: "Άλφα" },
    { id: "team-b", organization_id: "org-a", name: "Βήτα" },
    { id: "team-inactive", organization_id: "org-a", name: "Γάμμα" },
    { id: "team-other-comp", organization_id: "org-a", name: "Δέλτα" },
    { id: "team-not-participating", organization_id: "org-a", name: "Έψιλον" },
    { id: "team-foreign", organization_id: "org-b", name: "Ζήτα" },
  ],
  participations: [
    { competition_id: "cup", season_id: "season", team_id: "team-a", status: "active" },
    { competition_id: "cup", season_id: "season", team_id: "team-b", status: "active" },
    { competition_id: "cup", season_id: "season", team_id: "team-a", status: "active" },
    { competition_id: "cup", season_id: "season", team_id: "team-inactive", status: "inactive" },
    { competition_id: "league", season_id: "season", team_id: "team-other-comp", status: "active" },
    { competition_id: "cup", season_id: "season", team_id: "team-foreign", status: "active" },
  ],
};

describe("root phase competition participants", () => {
  it("uses only active canonical teams from the same organization and competition", () => {
    expect(getRootPhaseCompetitionTeams(snapshot, "cup")).toEqual([
      { team_id: "team-a", team_name: "Άλφα" },
      { team_id: "team-b", team_name: "Βήτα" },
    ]);
    expect(getRootPhaseCompetitionTeams(snapshot, "league").map((team) => team.team_id)).toEqual(["team-other-comp"]);
    expect(getRootPhaseCompetitionTeams(snapshot, "foreign-cup")).toEqual([]);
  });

  it("preserves no predecessor across create and edit, but keeps an existing predecessor when omitted", () => {
    expect(resolvePhasePredecessorId({ previousPhaseId: "" })).toBeNull();
    expect(resolvePhasePredecessorId({}, { previous_phase_id: null })).toBeNull();
    expect(resolvePhasePredecessorId({}, { previous_phase_id: "group-phase" })).toBe("group-phase");
    expect(resolvePhasePredecessorId({ previousPhaseId: "" }, { previous_phase_id: "group-phase" })).toBeNull();
  });

  it("accepts only participating Team IDs or a bye as root series slots", () => {
    const activeTeamIds = new Set(getRootPhaseCompetitionTeams(snapshot, "cup").map((team) => team.team_id));
    expect(isEligibleRootSeriesSlot({ type: "manual", teamId: "team-a" }, activeTeamIds)).toBe(true);
    expect(isEligibleRootSeriesSlot({ type: "bye" }, activeTeamIds)).toBe(true);
    for (const teamId of ["team-inactive", "team-other-comp", "team-not-participating", "team-foreign", ""]) {
      expect(isEligibleRootSeriesSlot({ type: "manual", teamId }, activeTeamIds)).toBe(false);
    }
    expect(isEligibleRootSeriesSlot({ type: "standing_position", position: "1" }, activeTeamIds)).toBe(false);
  });
});
