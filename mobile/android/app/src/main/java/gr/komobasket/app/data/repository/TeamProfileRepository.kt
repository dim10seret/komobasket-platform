package gr.komobasket.app.data.repository

import gr.komobasket.app.core.model.PhaseGame
import gr.komobasket.app.core.model.TeamProfile
import gr.komobasket.app.core.model.TeamStatistics
import gr.komobasket.app.data.api.PublicTeamProfileApi
import gr.komobasket.app.data.mapper.toTeamGames
import gr.komobasket.app.data.mapper.toTeamProfile
import gr.komobasket.app.data.mapper.toTeamStatistics
import javax.inject.Inject

interface TeamProfileRepository {
    suspend fun detail(competitionId: String, teamId: String, tournamentId: String): TeamProfile
    suspend fun statistics(competitionId: String, teamId: String, phaseIds: List<String>): TeamStatistics
    suspend fun upcoming(competitionId: String, teamId: String, tournamentId: String): List<PhaseGame>
    suspend fun recent(competitionId: String, teamId: String, tournamentId: String): List<PhaseGame>
}

class HttpTeamProfileRepository @Inject constructor(private val api: PublicTeamProfileApi) : TeamProfileRepository {
    override suspend fun detail(competitionId: String, teamId: String, tournamentId: String): TeamProfile =
        api.detail(competitionId, teamId, tournamentId).data.toTeamProfile(competitionId, teamId)

    override suspend fun statistics(competitionId: String, teamId: String,
        phaseIds: List<String>): TeamStatistics {
        require(phaseIds.isNotEmpty() && phaseIds.size <= 12 && phaseIds.distinct().size == phaseIds.size)
        return api.statistics(competitionId, teamId, phaseIds.joinToString(","))
            .data.toTeamStatistics(competitionId, teamId, phaseIds)
    }

    override suspend fun upcoming(competitionId: String, teamId: String, tournamentId: String): List<PhaseGame> =
        api.games(competitionId, teamId, "scheduled", "asc", 5, tournamentId)
            .toTeamGames(competitionId, teamId, "scheduled")

    override suspend fun recent(competitionId: String, teamId: String, tournamentId: String): List<PhaseGame> =
        api.games(competitionId, teamId, "completed", "desc", 5, tournamentId)
            .toTeamGames(competitionId, teamId, "completed")
}
