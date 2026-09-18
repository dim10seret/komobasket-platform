import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyLegacyMovementCompetition,
  getCanonicalMovementCompetitionId,
  getCanonicalMovementCompetitionName,
  movementMatchesCompetition,
} from "@/lib/player-movement-lineage";

const source = (relativePath) => fs.readFileSync(path.resolve(import.meta.dirname, relativePath), "utf8");
const service = source("../../../../services/league-admin.service.ts");
const component = source("MovementsSection.tsx");
const migration = source("../../../../../cloudflare/migrations/0029_player_movement_competition_lineage.sql");

const movement = (competitionId) => ({
  player_id: "player-a",
  season_id: "season-2026",
  competition_id: competitionId,
  from_team_id: "team-x",
  to_team_id: null,
  movement_type: "departure",
  effective_on: "2026-09-05",
});

const membership = (competitionId, status = "departed", leftOn = "2026-09-05") => ({
  player_id: "player-a",
  season_id: "season-2026",
  competition_id: competitionId,
  team_id: "team-x",
  status,
  joined_on: "2026-08-01",
  left_on: leftOn,
});

describe("player movement Competition lineage", () => {
  it("adds a nullable referenced competition column without backfilling legacy data", () => {
    expect(migration).toContain("ADD COLUMN competition_id TEXT REFERENCES league_competitions(id) ON DELETE SET NULL");
    expect(migration).not.toMatch(/\bUPDATE\s+league_player_movements\b/i);
  });

  it("persists Competition lineage for departure, transfer and addition while initial roster setup creates no movement", () => {
    expect(service).toContain("existing.competition_id, existing.team_id");
    expect(service).toContain("competitionId, fromTeamId, toTeamId");
    expect(service).toContain("roster.competition_id, roster.team_id");
    expect(service).toContain("NULL, ?, 'addition'");
    const rosterSetup = service.slice(
      service.indexOf("async function addRosterMembership"),
      service.indexOf("async function getCurrentActiveRosterMembership"),
    );
    expect(rosterSetup).not.toContain("league_player_movements");
  });

  it("projects and filters canonical movements without season/team inference", () => {
    const competitions = [
      { id: "competition-test-c3", name: "TEST C3" },
      { id: "competition-final-test", name: "FINAL TEST" },
    ];
    const testC3 = { competition_id: "competition-test-c3", competition_name: "TEST C3" };
    const finalTest = { competition_id: "competition-final-test", competition_name: "FINAL TEST" };
    expect(getCanonicalMovementCompetitionId(testC3)).toBe("competition-test-c3");
    expect(getCanonicalMovementCompetitionName(testC3, competitions)).toBe("TEST C3");
    expect(getCanonicalMovementCompetitionName(finalTest, competitions)).toBe("FINAL TEST");
    expect(movementMatchesCompetition(testC3, "competition-test-c3")).toBe(true);
    expect(movementMatchesCompetition(finalTest, "competition-test-c3")).toBe(false);
    expect(component).not.toContain("data.participations.find");
  });

  it("keeps ambiguous legacy rows neutral instead of choosing the first Competition", () => {
    const legacy = movement(null);
    const evidence = [
      membership("competition-test-c3"),
      membership("competition-final-test"),
    ];
    expect(getCanonicalMovementCompetitionName(legacy, [
      { id: "competition-test-c3", name: "TEST C3" },
      { id: "competition-final-test", name: "FINAL TEST" },
    ])).toBe("—");
    expect(classifyLegacyMovementCompetition(legacy, evidence)).toEqual({
      classification: "AMBIGUOUS",
      competitionId: null,
      candidateCompetitionIds: ["competition-final-test", "competition-test-c3"],
    });
  });

  it("classifies only unique strong historical evidence as safe to backfill", () => {
    const result = classifyLegacyMovementCompetition(movement(null), [
      membership("competition-test-c3"),
      membership("competition-final-test", "active", null),
    ]);
    expect(result).toEqual({
      classification: "SAFE_TO_BACKFILL",
      competitionId: "competition-test-c3",
      candidateCompetitionIds: ["competition-test-c3"],
    });
  });

  it("classifies missing strong evidence conservatively as unresolved", () => {
    expect(classifyLegacyMovementCompetition(movement(null), [
      membership("competition-test-c3", "active", null),
    ])).toEqual({
      classification: "UNRESOLVED",
      competitionId: null,
      candidateCompetitionIds: ["competition-test-c3"],
    });
  });
});
