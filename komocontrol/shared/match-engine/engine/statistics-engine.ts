import { EventType } from "../types/event-type.js";
import type { FoulEvent } from "../types/event.js";
import type { Player } from "../types/player.js";
import type { TeamStatistics } from "../types/statistics.js";
import type { Team } from "../types/team.js";

export class StatisticsEngine {
  recordTwoPoint(team: Team, player: Player): void {
    team.score += 2;
    team.statistics.twoPointAttempts += 1;
    team.statistics.twoPointMade += 1;
    player.statistics.points += 2;
    player.statistics.twoPointAttempts += 1;
    player.statistics.twoPointMade += 1;
  }

  recordMissedTwoPoint(team: Team, player: Player): void {
    team.statistics.twoPointAttempts += 1;
    player.statistics.twoPointAttempts += 1;
  }

  recordThreePoint(team: Team, player: Player): void {
    team.score += 3;
    team.statistics.threePointAttempts += 1;
    team.statistics.threePointMade += 1;
    player.statistics.points += 3;
    player.statistics.threePointAttempts += 1;
    player.statistics.threePointMade += 1;
  }

  recordMissedThreePoint(team: Team, player: Player): void {
    team.statistics.threePointAttempts += 1;
    player.statistics.threePointAttempts += 1;
  }

  recordTurnover(team: Team, player: Player): void {
    team.statistics.turnovers += 1;
    player.statistics.turnovers += 1;
  }

  recordFoul(team: Team, player: Player | undefined, type: FoulEvent["type"]): void {
    switch (type) {
      case EventType.PERSONAL_FOUL:
        team.statistics.personalFouls += 1;
        if (player) player.statistics.personalFouls += 1;
        return;
      case EventType.TECHNICAL_FOUL:
        team.statistics.technicalFouls += 1;
        if (player) player.statistics.technicalFouls += 1;
        return;
      case EventType.DISRUPTIVE_FOUL:
        team.statistics.disruptiveFouls += 1;
        if (player) player.statistics.disruptiveFouls += 1;
        return;
      case EventType.FLAGRANT_FOUL:
        team.statistics.flagrantFouls += 1;
        if (player) player.statistics.flagrantFouls += 1;
        return;
      case EventType.DISQUALIFYING_FOUL:
        team.statistics.disqualifyingFouls += 1;
        if (player) player.statistics.disqualifyingFouls += 1;
        return;
    }
  }

  recordFreeThrow(team: Team, player: Player, made: boolean): void {
    team.statistics.freeThrowAttempts += 1;
    player.statistics.freeThrowAttempts += 1;
    if (!made) return;

    team.score += 1;
    team.statistics.freeThrowMade += 1;
    player.statistics.points += 1;
    player.statistics.freeThrowMade += 1;
  }

  recordRebound(team: Team, player: Player, offensive: boolean): void {
    if (offensive) {
      team.statistics.offensiveRebounds += 1;
      player.statistics.offensiveRebounds += 1;
      return;
    }
    team.statistics.defensiveRebounds += 1;
    player.statistics.defensiveRebounds += 1;
  }

  recordTeamRebound(team: Team, offensive: boolean): void {
    if (offensive) team.statistics.offensiveRebounds += 1;
    else team.statistics.defensiveRebounds += 1;
  }

  recordAssist(team: Team, player: Player): void {
    team.statistics.assists += 1;
    player.statistics.assists += 1;
  }

  recordSteal(team: Team, player: Player): void {
    team.statistics.steals += 1;
    player.statistics.steals += 1;
  }

  recordBlock(team: Team, player: Player): void {
    team.statistics.blocks += 1;
    player.statistics.blocks += 1;
  }

  snapshot(team: Team): TeamStatistics {
    return { ...team.statistics };
  }
}
