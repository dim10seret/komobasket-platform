package gr.komobasket.app.data.repository

import gr.komobasket.app.core.model.CompetitionPhases
import gr.komobasket.app.core.model.PhaseGamesPage
import gr.komobasket.app.core.model.StandingRow
import gr.komobasket.app.data.api.PublicPhasesApi
import gr.komobasket.app.data.mapper.toModel
import gr.komobasket.app.data.mapper.toPhasesModel
import javax.inject.Inject

interface PhasesRepository {
    suspend fun competition(competitionId: String): CompetitionPhases
    suspend fun games(competitionId: String, phaseId: String, status: String?,
        order: String, cursor: String?): PhaseGamesPage
    suspend fun standings(competitionId: String, phaseId: String): List<StandingRow>
}

class HttpPhasesRepository @Inject constructor(private val api: PublicPhasesApi) : PhasesRepository {
    override suspend fun competition(competitionId: String) =
        api.competition(competitionId).data.toPhasesModel()

    override suspend fun games(competitionId: String, phaseId: String, status: String?,
        order: String, cursor: String?) =
        api.games(competitionId, phaseId, status, order, cursor, 20)
            .toModel(competitionId, phaseId)

    override suspend fun standings(competitionId: String, phaseId: String) =
        api.standings(competitionId, phaseId).data.map { it.toModel() }
}
