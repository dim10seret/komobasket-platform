package gr.komobasket.app.core.model

enum class PhaseView(val apiValue: String) {
    Schedule("schedule"), Results("results"), Standings("standings");

    companion object {
        fun fromApi(value: String): PhaseView? = entries.firstOrNull { it.apiValue == value }
    }
}

data class CompetitionPhases(
    val competition: Competition,
    val phases: List<Phase>,
    val currentPhaseId: String?,
    val activePhaseIds: Set<String>,
    val tournamentGroups: List<TournamentGroup> = emptyList(),
) {
    fun forTournament(tournamentId: String): CompetitionPhases? {
        val group = tournamentGroups.firstOrNull { it.id == tournamentId } ?: return null
        val allowed = group.phaseIds.toSet()
        val byId = phases.associateBy { it.id }
        return copy(phases = group.phaseIds.mapNotNull(byId::get),
            currentPhaseId = group.currentPhaseId, activePhaseIds = activePhaseIds.intersect(allowed))
    }
}

data class TournamentGroup(
    val id: String,
    val name: String,
    val phaseIds: List<String>,
    val currentPhaseId: String?,
)

data class Phase(
    val id: String,
    val name: String,
    val order: Int,
    val format: String,
    val phaseType: String,
    val lifecycleStatus: String,
    val isCurrent: Boolean,
    val availableViews: List<String>,
) {
    val supportedViews: List<PhaseView>
        get() = availableViews.mapNotNull(PhaseView::fromApi).distinct()
}

data class PhaseGame(
    val id: String,
    val phaseId: String,
    val round: Int?,
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

data class PhaseGamesPage(val games: List<PhaseGame>, val nextCursor: String?)

data class StandingRow(
    val rank: Int,
    val teamId: String,
    val teamName: String,
    val teamLogoUrl: String?,
    val gamesPlayed: Int,
    val wins: Int,
    val losses: Int,
    val pointsFor: Int,
    val pointsAgainst: Int,
    val pointDifference: Int,
    val standingsPoints: Int,
)
