package gr.komobasket.app.data.api

import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Path
import retrofit2.http.Query

@Serializable
data class OfficialMvpEnvelope(val data: OfficialMvpDto?)

@Serializable
data class OfficialMvpDto(
    val id: String,
    val competitionId: String,
    val phaseId: String,
    val round: Int,
    val gameId: String,
    val player: OfficialMvpPlayerDto,
    val team: OfficialMvpTeamDto?,
    val performance: OfficialMvpPerformanceDto?,
    val selectedAt: String,
)

@Serializable
data class OfficialMvpPlayerDto(val id: String, val name: String, val photoUrl: String?)

@Serializable
data class OfficialMvpTeamDto(val id: String, val name: String, val logoUrl: String?)

@Serializable
data class OfficialMvpPerformanceDto(
    val points: Int, val rebounds: Int, val assists: Int, val efficiency: Int,
)

interface PublicOfficialMvpApi {
    @GET("api/public/v1/competitions/{competitionId}/mvp")
    suspend fun current(
        @Path("competitionId") competitionId: String,
        @Query("phaseId") phaseId: String,
        @Query("round") round: Int,
    ): OfficialMvpEnvelope
}
