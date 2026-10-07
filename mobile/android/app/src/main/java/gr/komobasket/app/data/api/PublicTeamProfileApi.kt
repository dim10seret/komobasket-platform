package gr.komobasket.app.data.api

import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

@Serializable
data class TeamDetailEnvelope(val data: TeamDetailDto)

@Serializable
data class TeamDetailDto(
    val id: String,
    val name: String,
    val logoUrl: String?,
    val organizationId: String,
    val competitionId: String,
    val seasonId: String,
    val overview: TeamOverviewDto,
    val roster: List<RosterPlayerDto>,
)

@Serializable
data class TeamOverviewDto(val currentPhaseId: String?, val standings: TeamStandingDto?)

@Serializable
data class TeamStandingDto(
    val phaseId: String,
    val rank: Int,
    val gamesPlayed: Int,
    val wins: Int,
    val losses: Int,
)

@Serializable
data class RosterPlayerDto(
    val playerId: String,
    val playerName: String,
    val photoUrl: String?,
    @Serializable(with = JerseyNumberCompatSerializer::class)
    val jerseyNumber: String?,
)

@Serializable
data class TeamStatisticsEnvelope(val data: TeamStatisticsDto)

@Serializable
data class TeamStatisticsDto(
    val teamId: String,
    val competitionId: String,
    val phaseIds: List<String>,
    val gamesPlayed: Int,
    val totals: TeamStatisticsLineDto,
    val perGame: TeamStatisticsLineDto,
    val shooting: TeamShootingDto,
)

@Serializable
data class TeamStatisticsLineDto(
    val pointsScored: Double,
    val pointsAllowed: Double,
    val twoPointMade: Double,
    val twoPointAttempts: Double,
    val threePointMade: Double,
    val threePointAttempts: Double,
    val freeThrowMade: Double,
    val freeThrowAttempts: Double,
    val offensiveRebounds: Double,
    val defensiveRebounds: Double,
    val rebounds: Double,
    val assists: Double,
    val steals: Double,
    val blocks: Double,
    val turnovers: Double,
    val fouls: Double,
)

@Serializable
data class TeamShootingDto(
    val twoPoint: TeamShotDto,
    val threePoint: TeamShotDto,
    val freeThrow: TeamShotDto,
)

@Serializable
data class TeamShotDto(val made: Int, val attempted: Int, val percentage: Double?)

interface PublicTeamProfileApi {
    @GET("api/public/v1/competitions/{competitionId}/teams/{teamId}")
    suspend fun detail(
        @Path("competitionId") competitionId: String,
        @Path("teamId") teamId: String,
        @Query("rootPhaseId") rootPhaseId: String? = null,
    ): TeamDetailEnvelope

    @GET("api/public/v1/competitions/{competitionId}/teams/{teamId}/statistics")
    suspend fun statistics(
        @Path("competitionId") competitionId: String,
        @Path("teamId") teamId: String,
        @Query("phaseIds") phaseIds: String,
    ): TeamStatisticsEnvelope

    @GET("api/public/v1/competitions/{competitionId}/games")
    suspend fun games(
        @Path("competitionId") competitionId: String,
        @Query("teamId") teamId: String,
        @Query("status") status: String,
        @Query("order") order: String,
        @Query("limit") limit: Int,
        @Query("rootPhaseId") rootPhaseId: String? = null,
    ): GamesEnvelope
}
