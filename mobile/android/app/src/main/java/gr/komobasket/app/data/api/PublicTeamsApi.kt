package gr.komobasket.app.data.api

import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Path

@Serializable
data class TeamsEnvelope(val data: List<TeamDto>)

@Serializable
data class TeamDto(
    val id: String,
    val name: String,
    val logoUrl: String? = null,
)

interface PublicTeamsApi {
    @GET("api/public/v1/competitions/{competitionId}/teams")
    suspend fun teams(@Path("competitionId") competitionId: String): TeamsEnvelope
}
