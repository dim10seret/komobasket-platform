package gr.komobasket.app.core.model

enum class RankingCategory(val apiValue: String, val isShooting: Boolean = false) {
    Points("points"), Rebounds("rebounds"), Assists("assists"),
    Efficiency("efficiency"), TwoPoint("2pt", true), ThreePoint("3pt", true),
    FreeThrows("ft", true);
}

sealed interface RankingMetric {
    data class Counting(val total: Double, val perGameAverage: Double) : RankingMetric
    data class Shooting(val made: Int, val attempted: Int, val percentage: Double?) : RankingMetric
}

data class RankingEntry(
    val rank: Int,
    val playerId: String,
    val playerName: String,
    val playerPhotoUrl: String?,
    val teamId: String,
    val teamName: String,
    val teamLogoUrl: String?,
    val gamesPlayed: Int,
    val metric: RankingMetric,
)

data class RankingsPage(val rows: List<RankingEntry>, val nextCursor: String?)
