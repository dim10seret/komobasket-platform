package gr.komobasket.app.data.repository

import gr.komobasket.app.core.model.PlayerProfile
import gr.komobasket.app.data.api.PublicPlayerProfileApi
import gr.komobasket.app.data.mapper.toPlayerProfile
import javax.inject.Inject

interface PlayerProfileRepository {
    suspend fun profile(competitionId: String, playerId: String, phaseIds: List<String>): PlayerProfile
}

class HttpPlayerProfileRepository @Inject constructor(
    private val api: PublicPlayerProfileApi,
) : PlayerProfileRepository {
    override suspend fun profile(competitionId: String, playerId: String,
        phaseIds: List<String>): PlayerProfile {
        require(phaseIds.isNotEmpty() && phaseIds.size <= 12 && phaseIds.distinct().size == phaseIds.size)
        return api.profile(competitionId, playerId, phaseIds.joinToString(","))
            .data.toPlayerProfile(competitionId, playerId, phaseIds)
    }
}
