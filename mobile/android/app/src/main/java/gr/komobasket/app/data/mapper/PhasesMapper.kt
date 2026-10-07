package gr.komobasket.app.data.mapper

import gr.komobasket.app.core.model.CompetitionPhases
import gr.komobasket.app.core.model.HomeTeam
import gr.komobasket.app.core.model.Phase
import gr.komobasket.app.core.model.PhaseGame
import gr.komobasket.app.core.model.PhaseGamesPage
import gr.komobasket.app.core.model.StandingRow
import gr.komobasket.app.core.model.TournamentGroup
import gr.komobasket.app.data.api.CompetitionDetailDto
import gr.komobasket.app.data.api.GamesEnvelope
import gr.komobasket.app.data.api.StandingRowDto

fun CompetitionDetailDto.toPhasesModel(): CompetitionPhases {
    require(phases.all { it.competitionId == id })
    val phaseIds = phases.map { it.id }.toSet()
    require(tournamentGroups.map { it.id }.distinct().size == tournamentGroups.size)
    require(tournamentGroups.all { group ->
        group.id.isNotBlank() && group.name.isNotBlank() && group.id in group.phaseIds &&
            group.phaseIds.isNotEmpty() && group.phaseIds.distinct().size == group.phaseIds.size &&
            group.phaseIds.all { it in phaseIds } &&
            (group.currentPhaseId == null || group.currentPhaseId in group.phaseIds)
    })
    require(tournamentGroups.flatMap { it.phaseIds }.distinct().size == tournamentGroups.sumOf { it.phaseIds.size })
    return CompetitionPhases(
        competition = gr.komobasket.app.data.api.CompetitionDto(
            id, organizationId, seasonId, slug, name, type, logoUrl,
        ).toModel(),
        phases = phases.sortedWith(compareBy({ it.order }, { it.id })).map {
            Phase(it.id, it.name, it.order, it.format, it.phaseType,
                it.lifecycleStatus, it.isCurrent, it.availableViews)
        },
        currentPhaseId = currentPhaseId,
        activePhaseIds = activePhaseIds.toSet(),
        tournamentGroups = tournamentGroups.map {
            TournamentGroup(it.id, it.name, it.phaseIds, it.currentPhaseId)
        },
    )
}

fun GamesEnvelope.toModel(competitionId: String, phaseId: String): PhaseGamesPage {
    require(data.all { it.competitionId == competitionId && it.phaseId == phaseId })
    require(!meta.hasMore || !meta.nextCursor.isNullOrBlank())
    return PhaseGamesPage(
        games = data.map {
            PhaseGame(
                id = it.id, phaseId = it.phaseId, round = it.round,
                roundLabel = it.roundLabel, scheduledDate = it.scheduledDate,
                scheduledTime = it.scheduledTime, venueName = it.venue?.name,
                homeTeam = HomeTeam(it.homeTeam.id, it.homeTeam.name, it.homeTeam.logoUrl),
                awayTeam = HomeTeam(it.awayTeam.id, it.awayTeam.name, it.awayTeam.logoUrl),
                status = it.status, homeScore = it.homeScore, awayScore = it.awayScore,
                webLiveUrl = it.webLiveUrl,
            )
        },
        nextCursor = meta.nextCursor.takeIf { meta.hasMore },
    )
}

fun StandingRowDto.toModel() = StandingRow(
    rank, teamId, teamName, teamLogoUrl, gamesPlayed, wins, losses,
    pointsFor, pointsAgainst, pointDifference, standingsPoints,
)
