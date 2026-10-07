package gr.komobasket.app.data.api

import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

@Serializable
data class CompetitionDetailEnvelope(val data: CompetitionDetailDto)

@Serializable
data class CompetitionDetailDto(
    val id: String,
    val organizationId: String,
    val seasonId: String,
    val slug: String,
    val name: String,
    val type: String,
    val logoUrl: String?,
    val phases: List<PhaseDto>,
    val currentPhaseId: String?,
    val activePhaseIds: List<String>,
    val tournamentGroups: List<TournamentGroupDto> = emptyList(),
)

@Serializable
data class TournamentGroupDto(
    val id: String,
    val name: String,
    val phaseIds: List<String>,
    val currentPhaseId: String?,
)

@Serializable
data class PhaseDto(
    val id: String,
    val competitionId: String,
    val name: String,
    val order: Int,
    val format: String,
    val phaseType: String,
    val lifecycleStatus: String,
    val rootPhaseId: String,
    val previousPhaseId: String?,
    val isCurrent: Boolean,
    val availableViews: List<String>,
)

@Serializable
data class GamesEnvelope(val data: List<PhaseGameDto>, val meta: GamesMetaDto)

@Serializable
data class GamesMetaDto(val nextCursor: String?, val hasMore: Boolean)

@Serializable
data class PhaseGameDto(
    val id: String,
    val competitionId: String,
    val phaseId: String,
    val round: Int?,
    val roundLabel: String?,
    val scheduledDate: String?,
    val scheduledTime: String?,
    val venue: PhaseVenueDto?,
    val homeTeam: HomeTeamDto,
    val awayTeam: HomeTeamDto,
    val status: String,
    val homeScore: Int?,
    val awayScore: Int?,
    val webLiveUrl: String?,
)

@Serializable
data class PhaseVenueDto(val name: String, val address: String?, val mapUrl: String?)

@Serializable
data class StandingsEnvelope(val data: List<StandingRowDto>)

@Serializable
data class StandingRowDto(
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

interface PublicPhasesApi {
    @GET("api/public/v1/competitions/{competitionId}")
    suspend fun competition(@Path("competitionId") competitionId: String): CompetitionDetailEnvelope

    @GET("api/public/v1/competitions/{competitionId}/games")
    suspend fun games(
        @Path("competitionId") competitionId: String,
        @Query("phaseId") phaseId: String,
        @Query("status") status: String?,
        @Query("order") order: String,
        @Query("cursor") cursor: String?,
        @Query("limit") limit: Int,
    ): GamesEnvelope

    @GET("api/public/v1/competitions/{competitionId}/standings")
    suspend fun standings(
        @Path("competitionId") competitionId: String,
        @Query("phaseId") phaseId: String,
    ): StandingsEnvelope
}
