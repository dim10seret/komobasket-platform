package gr.komobasket.app.data.mapper

import gr.komobasket.app.core.model.PlayerAverages
import gr.komobasket.app.core.model.PlayerGameTeam
import gr.komobasket.app.core.model.PlayerProfile
import gr.komobasket.app.core.model.PlayerRecentGame
import gr.komobasket.app.core.model.PlayerShot
import gr.komobasket.app.core.model.PlayerShooting
import gr.komobasket.app.core.model.PlayerTeam
import gr.komobasket.app.core.model.PlayerTotals
import gr.komobasket.app.data.api.PlayerProfileDto

fun PlayerProfileDto.toPlayerProfile(
    competitionId: String, playerId: String, selectedPhaseIds: List<String>,
): PlayerProfile {
    require(id == playerId && this.competitionId == competitionId && name.isNotBlank())
    require(phaseIds.size == selectedPhaseIds.size && phaseIds.toSet() == selectedPhaseIds.toSet())
    require(gamesPlayed >= 0 && recentGames.size <= 5)
    require(recentGames.all { it.phaseId in selectedPhaseIds && it.gameId.isNotBlank() &&
        it.playerTeam.id.isNotBlank() && it.opponentTeam.id.isNotBlank() &&
        it.outcome in setOf("win", "loss", "tie") })
    return PlayerProfile(
        id = id, name = name, photoUrl = photoUrl, competitionId = competitionId,
        currentTeam = currentTeam?.let { PlayerTeam(it.id, it.name, it.logoUrl) },
        jerseyNumber = jerseyNumber, phaseIds = phaseIds, gamesPlayed = gamesPlayed,
        totals = PlayerTotals(totals.points, totals.twoPointMade, totals.twoPointAttempts,
            totals.threePointMade, totals.threePointAttempts, totals.freeThrowMade,
            totals.freeThrowAttempts, totals.offensiveRebounds, totals.defensiveRebounds,
            totals.rebounds, totals.assists, totals.steals, totals.blocks, totals.turnovers,
            totals.fouls, totals.efficiency),
        perGame = PlayerAverages(perGame.points, perGame.rebounds, perGame.assists,
            perGame.steals, perGame.blocks, perGame.turnovers, perGame.fouls, perGame.efficiency),
        shooting = PlayerShooting(
            PlayerShot(shooting.twoPoint.made, shooting.twoPoint.attempted, shooting.twoPoint.percentage),
            PlayerShot(shooting.threePoint.made, shooting.threePoint.attempted, shooting.threePoint.percentage),
            PlayerShot(shooting.freeThrow.made, shooting.freeThrow.attempted, shooting.freeThrow.percentage),
        ),
        recentGames = recentGames.map { game ->
            PlayerRecentGame(
                gameId = game.gameId, phaseId = game.phaseId, round = game.round,
                roundLabel = game.roundLabel, scheduledDate = game.scheduledDate,
                scheduledTime = game.scheduledTime,
                playerTeam = PlayerGameTeam(game.playerTeam.id, game.playerTeam.name),
                opponentTeam = PlayerGameTeam(game.opponentTeam.id, game.opponentTeam.name),
                teamScore = game.teamScore, opponentScore = game.opponentScore,
                outcome = game.outcome, points = game.points, rebounds = game.rebounds,
                assists = game.assists, efficiency = game.efficiency,
            )
        },
    )
}
