package gr.komobasket.app.data.mapper

import gr.komobasket.app.core.model.CompetitionHome
import gr.komobasket.app.core.model.HomeGame
import gr.komobasket.app.core.model.HomePhase
import gr.komobasket.app.core.model.HomeRound
import gr.komobasket.app.core.model.HomeStanding
import gr.komobasket.app.core.model.HomeTeam
import gr.komobasket.app.data.api.HomeDto
import gr.komobasket.app.data.api.HomeGameDto

fun HomeDto.toModel() = CompetitionHome(
    competition = competition.toModel(),
    currentPhaseId = currentPhaseId,
    currentPhase = currentPhase?.let { HomePhase(it.id, it.name, it.format) },
    currentRound = currentRound?.let { HomeRound(it.number, it.label) },
    liveGames = liveGames.map { it.toModel() },
    upcomingGames = upcomingGames.map { it.toModel() },
    recentResults = recentResults.map { it.toModel() },
    standingsPreview = standingsPreview?.map {
        HomeStanding(it.rank, it.teamId, it.teamName, it.teamLogoUrl, it.gamesPlayed,
            it.wins, it.losses, it.standingsPoints)
    },
)

private fun HomeGameDto.toModel() = HomeGame(
    id = id,
    roundLabel = roundLabel,
    scheduledDate = scheduledDate,
    scheduledTime = scheduledTime,
    venueName = venue?.name,
    homeTeam = HomeTeam(homeTeam.id, homeTeam.name, homeTeam.logoUrl),
    awayTeam = HomeTeam(awayTeam.id, awayTeam.name, awayTeam.logoUrl),
    status = status,
    homeScore = homeScore,
    awayScore = awayScore,
    webLiveUrl = webLiveUrl,
)
