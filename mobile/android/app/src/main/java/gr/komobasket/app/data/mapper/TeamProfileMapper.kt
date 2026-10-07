package gr.komobasket.app.data.mapper

import gr.komobasket.app.core.model.HomeTeam
import gr.komobasket.app.core.model.PhaseGame
import gr.komobasket.app.core.model.TeamProfile
import gr.komobasket.app.core.model.TeamRosterPlayer
import gr.komobasket.app.core.model.TeamShot
import gr.komobasket.app.core.model.TeamShooting
import gr.komobasket.app.core.model.TeamStanding
import gr.komobasket.app.core.model.TeamStatistics
import gr.komobasket.app.core.model.TeamStatisticsLine
import gr.komobasket.app.data.api.GamesEnvelope
import gr.komobasket.app.data.api.TeamDetailDto
import gr.komobasket.app.data.api.TeamShotDto
import gr.komobasket.app.data.api.TeamStatisticsDto
import gr.komobasket.app.data.api.TeamStatisticsLineDto

fun TeamDetailDto.toTeamProfile(competitionId: String, teamId: String): TeamProfile {
    require(id == teamId && this.competitionId == competitionId && name.isNotBlank())
    require(roster.all { it.playerId.isNotBlank() && it.playerName.isNotBlank() })
    return TeamProfile(id, competitionId, name, logoUrl, overview.currentPhaseId,
        overview.standings?.let { TeamStanding(it.phaseId, it.rank, it.gamesPlayed, it.wins, it.losses) },
        roster.map { TeamRosterPlayer(it.playerId, it.playerName, it.photoUrl, it.jerseyNumber) })
}

fun TeamStatisticsDto.toTeamStatistics(
    competitionId: String, teamId: String, selectedPhaseIds: List<String>,
): TeamStatistics {
    require(this.competitionId == competitionId && this.teamId == teamId)
    require(phaseIds.size == selectedPhaseIds.size && phaseIds.toSet() == selectedPhaseIds.toSet())
    require(gamesPlayed >= 0)
    return TeamStatistics(teamId, competitionId, phaseIds, gamesPlayed,
        totals.toTeamLine(), perGame.toTeamLine(),
        TeamShooting(shooting.twoPoint.toTeamShot(), shooting.threePoint.toTeamShot(),
            shooting.freeThrow.toTeamShot()))
}

private fun TeamStatisticsLineDto.toTeamLine() = TeamStatisticsLine(
    pointsScored, pointsAllowed, twoPointMade, twoPointAttempts, threePointMade,
    threePointAttempts, freeThrowMade, freeThrowAttempts, offensiveRebounds,
    defensiveRebounds, rebounds, assists, steals, blocks, turnovers, fouls,
)

private fun TeamShotDto.toTeamShot() = TeamShot(made, attempted, percentage)

fun GamesEnvelope.toTeamGames(competitionId: String, teamId: String, status: String): List<PhaseGame> {
    require(data.size <= 5 && (!meta.hasMore || !meta.nextCursor.isNullOrBlank()))
    require(data.all { it.competitionId == competitionId && it.status == status &&
        (it.homeTeam.id == teamId || it.awayTeam.id == teamId) })
    return data.map { game ->
        PhaseGame(game.id, game.phaseId, game.round, game.roundLabel,
            game.scheduledDate, game.scheduledTime, game.venue?.name,
            HomeTeam(game.homeTeam.id, game.homeTeam.name, game.homeTeam.logoUrl),
            HomeTeam(game.awayTeam.id, game.awayTeam.name, game.awayTeam.logoUrl),
            game.status, game.homeScore, game.awayScore, game.webLiveUrl)
    }
}
