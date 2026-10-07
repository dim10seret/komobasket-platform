package gr.komobasket.app.core.model

data class Season(
    val id: String,
    val name: String,
    val startDate: String,
    val endDate: String?,
)

data class Organization(
    val id: String,
    val name: String,
    val slug: String,
    val logoUrl: String?,
)

data class Competition(
    val id: String,
    val seasonId: String,
    val organizationId: String,
    val name: String,
    val slug: String,
    val type: String,
    val logoUrl: String?,
)

data class CompetitionContext(
    val seasonId: String? = null,
    val organizationId: String? = null,
    val competitionId: String? = null,
    val tournamentId: String? = null,
) {
    val isComplete: Boolean
        get() = !seasonId.isNullOrBlank() && !organizationId.isNullOrBlank() &&
            !competitionId.isNullOrBlank() && !tournamentId.isNullOrBlank()

    fun withSeason(id: String) = CompetitionContext(seasonId = id)

    fun withOrganization(id: String): CompetitionContext {
        require(!seasonId.isNullOrBlank())
        return CompetitionContext(seasonId = seasonId, organizationId = id)
    }

    fun withCompetition(id: String): CompetitionContext {
        require(!seasonId.isNullOrBlank() && !organizationId.isNullOrBlank())
        return copy(competitionId = id, tournamentId = null)
    }

    fun withTournament(id: String): CompetitionContext {
        require(!competitionId.isNullOrBlank() && id.isNotBlank())
        return copy(tournamentId = id)
    }
}

data class AppSettings(
    val languageTag: String? = null,
    val onboardingComplete: Boolean = false,
    val context: CompetitionContext = CompetitionContext(),
)
