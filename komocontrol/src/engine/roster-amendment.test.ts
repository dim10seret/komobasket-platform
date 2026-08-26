import { describe, expect, it } from "vitest";
import { MatchEngine } from "./match-engine";
import { createPlayer } from "../models/player";
import { TeamSide } from "../types/team-side";

function engine(): MatchEngine {
  return new MatchEngine({
    id: "run-roster-amendment",
    rules: { schemaVersion: 1, rulesEdition: "FIBA_2026", minPlayers: 1, maxPlayers: 12, startingPlayers: 1, regulationPeriods: 4, regulationPeriodSeconds: 600, overtimeSeconds: 300, resultPolicy: "REQUIRE_WINNER", teamFoulPenaltyThreshold: 5, overtimeTeamFoulPolicy: "CARRY_FROM_FINAL_REGULATION" },
    homeTeam: { id: "home", name: "Home", players: [createPlayer({ playerId: "home-1", displayName: "Home One", shirtNumber: "0", team: TeamSide.HOME, onCourt: true })] },
    awayTeam: { id: "away", name: "Away", players: [createPlayer({ playerId: "away-1", displayName: "Away One", shirtNumber: "00", team: TeamSide.AWAY, onCourt: true })] },
  });
}

describe("factual Live roster amendments", () => {
  it("replays an added Package player by playerId while preserving textual shirt identity", () => {
    const match = engine();
    const events = [
      { schemaVersion: 2, id: "start", occurredAt: 1, sequence: 1, type: "MATCH_START" },
      { schemaVersion: 2, id: "add", occurredAt: 2, sequence: 2, type: "ROSTER_PLAYER_ADDED", team: TeamSide.HOME, playerId: "home-2", displayName: "Home Two", shirtNumber: "00" },
      { schemaVersion: 2, id: "sub", occurredAt: 3, sequence: 3, type: "SUBSTITUTION", team: TeamSide.HOME, playerInId: "home-2", playerOutId: "home-1" },
      { schemaVersion: 2, id: "score", occurredAt: 4, sequence: 4, type: "TWO_POINT", team: TeamSide.HOME, playerId: "home-2" },
    ] as const;
    for (const event of events) expect(match.process(event).accepted).toBe(true);
    expect(match.getState().home.players.map((player) => [player.playerId, player.shirtNumber])).toEqual([["home-1", "0"], ["home-2", "00"]]);
    expect(match.getState().home.score).toBe(2);
    const replay = engine();
    for (const event of events) expect(replay.process(event).accepted).toBe(true);
    expect(replay.getState()).toEqual(match.getState());
    expect(match.removeEvent("add").accepted).toBe(false);
    expect(match.removeEvent("add")).toMatchObject({ dependentEventIds: ["sub", "score"] });
  });
});
