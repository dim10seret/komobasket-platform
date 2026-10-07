package gr.komobasket.app.data.repository

import gr.komobasket.app.core.model.CompetitionHome
import gr.komobasket.app.data.api.PublicHomeApi
import gr.komobasket.app.data.mapper.toModel
import javax.inject.Inject

interface HomeRepository {
    suspend fun home(competitionId: String, tournamentId: String): CompetitionHome
}

class HttpHomeRepository @Inject constructor(
    private val api: PublicHomeApi,
) : HomeRepository {
    override suspend fun home(competitionId: String, tournamentId: String) =
        api.home(competitionId, tournamentId).data.toModel()
}
