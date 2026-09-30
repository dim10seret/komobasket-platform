import { describe, expect, it } from "vitest";
import {
  buildPhaseTournamentGroups,
  getRootPhaseCompetitionTeams,
  isEligibleRootSeriesSlot,
  PhaseLineageError,
  resolvePhasePredecessorId,
  resolvePhaseTournamentGraph,
} from "./phase-root-source";

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

  it("resolves multiple root Tournament trees and effective legacy names in O(n) maps", () => {
    const phases = [
      { id: "league-root", competition_id: "cup", previous_phase_id: null, tournament_name: "KomoBasket League", name: "Regular", phase_order: 1, lifecycle_status: "finalized" },
      { id: "league-finals", competition_id: "cup", previous_phase_id: "league-root", name: "Finals", phase_order: 2, lifecycle_status: "finalized" },
      { id: "cup-root", competition_id: "cup", previous_phase_id: null, tournament_name: null, name: "Komo Cup", phase_order: 3, lifecycle_status: "active" },
    ];
    const graph = resolvePhaseTournamentGraph(phases);
    expect(graph.rootPhaseIdByPhaseId.get("league-finals")).toBe("league-root");
    expect(graph.rootPhaseIdByPhaseId.get("cup-root")).toBe("cup-root");
    expect(graph.descendantPhaseIdsByRootPhaseId.get("league-root")).toEqual(["league-root", "league-finals"]);
    expect(graph.effectiveTournamentNameByRootPhaseId.get("cup-root")).toBe("Komo Cup");
    expect(buildPhaseTournamentGroups(phases).map((group) => [group.tournamentName, group.finalized])).toEqual([
      ["KomoBasket League", true],
      ["Komo Cup", false],
    ]);
  });

  it.each([
    ["missing predecessor", [{ id: "phase", competition_id: "cup", previous_phase_id: "missing" }], "MISSING_PREDECESSOR"],
    ["cross-competition predecessor", [
      { id: "source", competition_id: "league", previous_phase_id: null },
      { id: "target", competition_id: "cup", previous_phase_id: "source" },
    ], "CROSS_COMPETITION_PREDECESSOR"],
    ["cycle", [
      { id: "a", competition_id: "cup", previous_phase_id: "b" },
      { id: "b", competition_id: "cup", previous_phase_id: "a" },
    ], "CYCLE"],
    ["non-unique phase", [
      { id: "same", competition_id: "cup", previous_phase_id: null },
      { id: "same", competition_id: "cup", previous_phase_id: null },
    ], "NON_UNIQUE_PHASE"],
  ])("rejects %s", (_label, phases, code) => {
    expect(() => resolvePhaseTournamentGraph(phases)).toThrow(PhaseLineageError);
    try {
      resolvePhaseTournamentGraph(phases);
    } catch (error) {
      expect((error as PhaseLineageError).code).toBe(code);
    }
  });

  it("does not let a legitimate cross-root carry-over dependency merge Tournament identities", () => {
    const phases = [
      { id: "league", competition_id: "competition", previous_phase_id: null, tournament_name: "League", carry_over_source_phase_id: null, phase_order: 1 },
      { id: "cup", competition_id: "competition", previous_phase_id: null, tournament_name: "Cup", carry_over_source_phase_id: "league", phase_order: 2 },
    ];
    const graph = resolvePhaseTournamentGraph(phases);
    expect(graph.rootPhaseIdByPhaseId.get("league")).toBe("league");
    expect(graph.rootPhaseIdByPhaseId.get("cup")).toBe("cup");
    expect(buildPhaseTournamentGroups(phases).map((group) => group.rootPhaseId)).toEqual(["league", "cup"]);
  });
});
