package gr.komobasket.app.data.api

import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

@Serializable
data class HomeEnvelope(val data: HomeDto)

@Serializable
data class HomeDto(
    val competition: CompetitionDto,
    val currentPhaseId: String?,
    val currentPhase: HomePhaseDto?,
    val activePhaseIds: List<String>,
    val currentRound: HomeRoundDto?,
    val liveGames: List<HomeGameDto>,
    val upcomingGames: List<HomeGameDto>,
    val recentResults: List<HomeGameDto>,
    val standingsPreview: List<HomeStandingDto>?,
)

@Serializable
data class HomePhaseDto(val id: String, val name: String, val format: String)

@Serializable
data class HomeRoundDto(val number: Int, val label: String?)

@Serializable
data class HomeTeamDto(val id: String, val name: String, val logoUrl: String?)

@Serializable
data class HomeVenueDto(val name: String)

@Serializable
data class HomeGameDto(
    val id: String,
    val round: Int?,
    val roundLabel: String?,
    val scheduledDate: String?,
    val scheduledTime: String?,
    val venue: HomeVenueDto?,
    val homeTeam: HomeTeamDto,
    val awayTeam: HomeTeamDto,
    val status: String,
    val homeScore: Int?,
    val awayScore: Int?,
    val webLiveUrl: String?,
)

@Serializable
data class HomeStandingDto(
    val rank: Int,
    val teamId: String,
    val teamName: String,
    val teamLogoUrl: String?,
    val gamesPlayed: Int,
    val wins: Int,
    val losses: Int,
    val standingsPoints: Int,
)

interface PublicHomeApi {
    @GET("api/public/v1/competitions/{competitionId}/home")
    suspend fun home(@Path("competitionId") competitionId: String,
        @Query("rootPhaseId") rootPhaseId: String? = null): HomeEnvelope
}
