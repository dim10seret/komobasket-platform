package gr.komobasket.app.data.mapper

import gr.komobasket.app.core.model.RankingCategory
import gr.komobasket.app.core.model.RankingEntry
import gr.komobasket.app.core.model.RankingMetric
import gr.komobasket.app.core.model.RankingsPage
import gr.komobasket.app.data.api.RankingsEnvelope

fun RankingsEnvelope.toModel(
    competitionId: String,
    phaseIds: List<String>,
    category: RankingCategory,
): RankingsPage {
    require(meta.competitionId == competitionId && meta.category == category.apiValue)
    require(meta.phaseIds.toSet() == phaseIds.toSet() && meta.phaseIds.size == phaseIds.size)
    require(!meta.hasMore || !meta.nextCursor.isNullOrBlank())
    return RankingsPage(data.map { row ->
        val metric = if (category.isShooting) RankingMetric.Shooting(
            made = requireNotNull(row.made), attempted = requireNotNull(row.attempted),
            percentage = row.percentage,
        ) else RankingMetric.Counting(
            total = requireNotNull(row.total),
            perGameAverage = requireNotNull(row.perGameAverage),
        )
        RankingEntry(
            row.rank, row.playerId, row.playerName, row.playerPhotoUrl,
            row.teamId, row.teamName, row.teamLogoUrl, row.gamesPlayed, metric,
        )
    }, meta.nextCursor.takeIf { meta.hasMore })
}
