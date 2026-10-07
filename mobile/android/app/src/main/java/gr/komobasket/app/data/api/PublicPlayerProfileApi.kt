package gr.komobasket.app.data.api

import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

@Serializable
data class PlayerProfileEnvelope(val data: PlayerProfileDto)

@Serializable
data class PlayerProfileDto(
    val id: String,
    val name: String,
    val photoUrl: String?,
    val competitionId: String,
    val seasonId: String,
    val currentTeam: PlayerTeamDto?,
    @Serializable(with = JerseyNumberCompatSerializer::class)
    val jerseyNumber: String?,
    val phaseIds: List<String>,
    val gamesPlayed: Int,
    val totals: PlayerTotalsDto,
    val perGame: PlayerAveragesDto,
    val shooting: PlayerShootingDto,
    val recentGames: List<PlayerRecentGameDto>,
)

@Serializable
data class PlayerTeamDto(val id: String, val name: String, val logoUrl: String? = null)

@Serializable
data class PlayerGameTeamDto(val id: String, val name: String)

@Serializable
data class PlayerTotalsDto(
    val points: Double,
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
    val efficiency: Double,
)

@Serializable
data class PlayerAveragesDto(
    val points: Double?,
    val rebounds: Double?,
    val assists: Double?,
    val steals: Double?,
    val blocks: Double?,
    val turnovers: Double?,
    val fouls: Double?,
    val efficiency: Double?,
)

@Serializable
data class PlayerShootingDto(
    val twoPoint: PlayerShotDto,
    val threePoint: PlayerShotDto,
    val freeThrow: PlayerShotDto,
)

@Serializable
data class PlayerShotDto(val made: Int, val attempted: Int, val percentage: Double?)

@Serializable
data class PlayerRecentGameDto(
    val gameId: String,
    val phaseId: String,
    val round: Int?,
    val roundLabel: String?,
    val scheduledDate: String?,
    val scheduledTime: String?,
    val playerTeam: PlayerGameTeamDto,
    val opponentTeam: PlayerGameTeamDto,
    val teamScore: Int,
    val opponentScore: Int,
    val outcome: String,
    val points: Int,
    val rebounds: Int,
    val assists: Int,
    val efficiency: Int,
)

interface PublicPlayerProfileApi {
    @GET("api/public/v1/competitions/{competitionId}/players/{playerId}")
    suspend fun profile(
        @Path("competitionId") competitionId: String,
        @Path("playerId") playerId: String,
        @Query("phaseIds") phaseIds: String,
    ): PlayerProfileEnvelope
}
