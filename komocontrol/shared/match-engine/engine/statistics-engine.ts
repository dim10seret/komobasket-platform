import type { Player } from "../types/player.js";
import type { Team } from "../types/team.js";
import type { TeamStatistics } from "../types/statistics.js";

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

  recordPersonalFoul(team: Team, player: Player): void {
    team.teamFouls += 1;
    team.statistics.personalFouls += 1;
    player.fouls += 1;
    this.disqualifyWhenRequired(player, player.fouls >= 5);
  }

  recordShootingFoul(team: Team, player: Player): void {
    team.teamFouls += 1;
    team.statistics.shootingFouls += 1;
    player.fouls += 1;
    player.statistics.shootingFouls += 1;
    this.disqualifyWhenRequired(player, player.fouls >= 5);
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

  recordTechnicalFoul(team: Team, player?: Player): void {
    team.statistics.technicalFouls += 1;
    if (!player) return;

    player.statistics.technicalFouls += 1;
    this.disqualifyWhenRequired(player, player.statistics.technicalFouls + player.statistics.unsportsmanlikeFouls >= 2);
  }

  recordUnsportsmanlikeFoul(team: Team, player: Player): void {
    team.teamFouls += 1;
    team.statistics.unsportsmanlikeFouls += 1;
    player.fouls += 1;
    player.statistics.unsportsmanlikeFouls += 1;
    this.disqualifyWhenRequired(player, player.statistics.technicalFouls + player.statistics.unsportsmanlikeFouls >= 2 || player.fouls >= 5);
  }

  recordDisqualifyingFoul(team: Team, player: Player): void {
    team.teamFouls += 1;
    team.statistics.disqualifyingFouls += 1;
    player.fouls += 1;
    player.statistics.disqualifyingFouls += 1;
    player.disqualified = true;
    player.onCourt = false;
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

  private disqualifyWhenRequired(player: Player, shouldDisqualify: boolean): void {
    if (!shouldDisqualify) return;
    player.disqualified = true;
    player.onCourt = false;
  }
}
