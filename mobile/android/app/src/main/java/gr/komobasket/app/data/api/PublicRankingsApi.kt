package gr.komobasket.app.data.api

import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

@Serializable
data class RankingsEnvelope(val data: List<RankingRowDto>, val meta: RankingsMetaDto)

@Serializable
data class RankingsMetaDto(
    val competitionId: String,
    val phaseIds: List<String>,
    val category: String,
    val nextCursor: String?,
    val hasMore: Boolean,
)

@Serializable
data class RankingRowDto(
    val rank: Int,
    val playerId: String,
    val playerName: String,
    val playerPhotoUrl: String?,
    val teamId: String,
    val teamName: String,
    val teamLogoUrl: String?,
    val gamesPlayed: Int,
    val total: Double? = null,
    val perGameAverage: Double? = null,
    val made: Int? = null,
    val attempted: Int? = null,
    val percentage: Double? = null,
)

interface PublicRankingsApi {
    @GET("api/public/v1/competitions/{competitionId}/rankings")
    suspend fun rankings(
        @Path("competitionId") competitionId: String,
        @Query("phaseIds") phaseIds: String,
        @Query("category") category: String,
        @Query("cursor") cursor: String?,
        @Query("limit") limit: Int,
    ): RankingsEnvelope
}
