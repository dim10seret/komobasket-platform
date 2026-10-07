package gr.komobasket.app.data.repository

import gr.komobasket.app.core.model.CompetitionTeam
import gr.komobasket.app.data.api.PublicTeamsApi
import gr.komobasket.app.data.mapper.toTeamsModel
import javax.inject.Inject

interface TeamsRepository {
    suspend fun teams(competitionId: String): List<CompetitionTeam>
}

class HttpTeamsRepository @Inject constructor(private val api: PublicTeamsApi) : TeamsRepository {
    override suspend fun teams(competitionId: String): List<CompetitionTeam> =
        api.teams(competitionId).toTeamsModel()
}
