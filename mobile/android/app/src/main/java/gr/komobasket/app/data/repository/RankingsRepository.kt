package gr.komobasket.app.data.repository

import gr.komobasket.app.core.model.RankingCategory
import gr.komobasket.app.core.model.RankingsPage
import gr.komobasket.app.data.api.PublicRankingsApi
import gr.komobasket.app.data.mapper.toModel
import javax.inject.Inject

interface RankingsRepository {
    suspend fun rankings(competitionId: String, phaseIds: List<String>,
        category: RankingCategory, cursor: String?): RankingsPage
}

class HttpRankingsRepository @Inject constructor(private val api: PublicRankingsApi) : RankingsRepository {
    override suspend fun rankings(competitionId: String, phaseIds: List<String>,
        category: RankingCategory, cursor: String?): RankingsPage {
        require(phaseIds.isNotEmpty() && phaseIds.size <= 12 && phaseIds.distinct().size == phaseIds.size)
        return api.rankings(competitionId, phaseIds.joinToString(","), category.apiValue, cursor, 10)
            .toModel(competitionId, phaseIds, category)
    }
}
