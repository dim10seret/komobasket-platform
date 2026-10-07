package gr.komobasket.app.data

import gr.komobasket.app.data.api.PublicCatalogueApi
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory
import java.util.concurrent.TimeUnit

/** Run explicitly with RUN_LIVE_CATALOGUE_TEST=1. The normal unit suite stays offline. */
class ProductionCatalogueConnectivityTest {
    @Test
    fun publicA1SelectionPathDecodesThroughApplicationDtos() = runBlocking {
        assumeTrue(System.getenv("RUN_LIVE_CATALOGUE_TEST") == "1")
        val api = Retrofit.Builder()
            .baseUrl("https://komobasket.gr/")
            .client(OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build())
            .addConverterFactory(Json { ignoreUnknownKeys = true }
                .asConverterFactory("application/json".toMediaType()))
            .build()
            .create(PublicCatalogueApi::class.java)

        val season = api.seasons().data.first()
        assertTrue(season.id.isNotBlank())
        val organization = api.organizations(season.id).data.first()
        assertTrue(organization.id.isNotBlank())
        val competition = api.competitions(season.id, organization.id).data.first()
        assertEquals(season.id, competition.seasonId)
        assertEquals(organization.id, competition.organizationId)
    }
}
