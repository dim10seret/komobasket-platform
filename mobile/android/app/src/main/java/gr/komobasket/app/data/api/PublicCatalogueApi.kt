package gr.komobasket.app.data.api

import kotlinx.serialization.Serializable
import retrofit2.http.GET
import retrofit2.http.Query

@Serializable
data class CatalogueEnvelope<T>(val data: List<T>)

@Serializable
data class SeasonDto(
    val id: String,
    val name: String,
    val slug: String,
    val startDate: String,
    val endDate: String? = null,
)

@Serializable
data class OrganizationDto(
    val id: String,
    val slug: String,
    val name: String,
    val logoUrl: String? = null,
)

@Serializable
data class CompetitionDto(
    val id: String,
    val organizationId: String,
    val seasonId: String,
    val slug: String,
    val name: String,
    val type: String,
    val logoUrl: String? = null,
)

interface PublicCatalogueApi {
    @GET("api/public/v1/seasons")
    suspend fun seasons(): CatalogueEnvelope<SeasonDto>

    @GET("api/public/v1/organizations")
    suspend fun organizations(@Query("seasonId") seasonId: String): CatalogueEnvelope<OrganizationDto>

    @GET("api/public/v1/competitions")
    suspend fun competitions(
        @Query("seasonId") seasonId: String,
        @Query("organizationId") organizationId: String,
    ): CatalogueEnvelope<CompetitionDto>
}
