package gr.komobasket.app.core.model

data class CompetitionHome(
    val competition: Competition,
    val currentPhase: HomePhase?,
    val currentRound: HomeRound?,
    val liveGames: List<HomeGame>,
    val upcomingGames: List<HomeGame>,
    val recentResults: List<HomeGame>,
    val standingsPreview: List<HomeStanding>?,
    val currentPhaseId: String? = null,
) {
    val hasSportsContent: Boolean
        get() = liveGames.isNotEmpty() || upcomingGames.isNotEmpty() ||
            recentResults.isNotEmpty() || !standingsPreview.isNullOrEmpty()
}

data class HomePhase(val id: String, val name: String, val format: String)
data class HomeRound(val number: Int, val label: String?)
data class HomeTeam(val id: String, val name: String, val logoUrl: String?)
data class HomeGame(
    val id: String,
    val roundLabel: String?,
    val scheduledDate: String?,
    val scheduledTime: String?,
    val venueName: String?,
    val homeTeam: HomeTeam,
    val awayTeam: HomeTeam,
    val status: String,
    val homeScore: Int?,
    val awayScore: Int?,
    val webLiveUrl: String?,
)

data class HomeStanding(
    val rank: Int,
    val teamId: String,
    val teamName: String,
    val teamLogoUrl: String?,
    val gamesPlayed: Int,
    val wins: Int,
    val losses: Int,
    val standingsPoints: Int,
)
