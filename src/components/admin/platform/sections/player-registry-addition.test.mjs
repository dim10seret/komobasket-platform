import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { selectEligibleAdditionPlayers } from "../../../../lib/player-movement-addition.ts";

const source = (relativePath) => fs.readFileSync(path.resolve(import.meta.dirname, relativePath), "utf8");

describe("canonical player registry and movement addition", () => {
  it("extends the movement schema without rewriting existing values", () => {
    const migration = source("../../../../../cloudflare/migrations/0030_player_movement_addition_type.sql");
    expect(migration).toContain("'registration','transfer','departure','return','addition'");
    expect(migration).toContain("competition_id TEXT REFERENCES league_competitions(id) ON DELETE SET NULL");
    expect(migration).toContain("INSERT INTO league_player_movements_addition");
    expect(migration).toMatch(/SELECT\s+id, player_id, season_id, from_team_id, to_team_id, movement_type, effective_on, note, created_at, competition_id/);
    expect(migration).toContain("CREATE INDEX idx_player_movements_competition");
    expect(migration).not.toMatch(/UPDATE\s+league_player_movements/i);
  });

  it("creates registry players through the canonical player service only", () => {
    const api = source("../../../../services/platform-league-actions.ts");
    const service = source("../../../../services/league-admin.service.ts");
    const players = source("./PlayersSection.tsx");
    expect(api).toContain('action === "createRegistryPlayer"');
    expect(api).toContain("createAthleteCanonical");
    expect(players).toContain("+ Προσθήκη παίκτη");
    expect(players).toContain('action: "createRegistryPlayer"');
    const canonicalCreate = service.slice(service.indexOf("export async function createAthleteCanonical"), service.indexOf("export async function addExistingAthleteToRoster"));
    expect(canonicalCreate).toContain("INSERT INTO league_players");
    expect(canonicalCreate).not.toContain("league_rosters");
    expect(canonicalCreate).not.toContain("league_player_movements");
  });

  it("keeps initial roster setup free of movement history", () => {
    const service = source("../../../../services/league-admin.service.ts");
    const rosterSetup = service.slice(service.indexOf("async function addRosterMembership"), service.indexOf("async function getCurrentActiveRosterMembership"));
    expect(rosterSetup).toContain("league_roster_memberships");
    expect(rosterSetup).not.toContain("league_player_movements");
  });

  it("filters eligibility by active membership in the selected season and competition", () => {
    const players = [
      { id: "player-a", firstName: "A", lastName: "Registry" },
      { id: "player-b", firstName: "B", lastName: "Selected" },
      { id: "player-c", firstName: "C", lastName: "Other" },
    ];
    const rosters = [
      { player_id: "player-b", season_id: "season-1", competition_id: "competition-a", status: "active" },
      { player_id: "player-c", season_id: "season-1", competition_id: "competition-b", status: "active" },
    ];
    expect(selectEligibleAdditionPlayers(players, rosters, "season-1", "competition-a").map((player) => player.id)).toEqual(["player-a", "player-c"]);
  });

  it("performs the authorized roster and addition movement writes atomically", () => {
    const service = source("../../../../services/league-admin.service.ts");
    const api = source("../../../../services/platform-league-actions.ts");
    const movements = source("./MovementsSection.tsx");
    const addition = service.slice(service.indexOf("export async function addAthleteToCompetitionRosterWithMovement"));
    expect(api).toContain('action === "addAthleteMovement"');
    expect(api).toContain("requireRosterRelationshipAccess");
    expect(addition).toContain("athleteInCompetitionRosterRowExists");
    expect(addition).toContain("Ο αθλητής, η ομάδα και η διοργάνωση δεν ανήκουν στο ίδιο έγκυρο πλαίσιο");
    expect(addition).toContain("Ο αθλητής ανήκει ήδη στην ομάδα");
    expect(addition).toContain("στη συγκεκριμένη διοργάνωση");
    expect(addition).toContain("db.batch([rosterStatement, movementStatement])");
    expect(addition).toContain("NULL, ?, 'addition'");
    expect(movements).toContain('addition: "Προσθήκη"');
    expect(movements).toContain("const ok = await add({");
  });
});
