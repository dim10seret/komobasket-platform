package gr.komobasket.app.data

import gr.komobasket.app.data.api.PublicCatalogueApi
import gr.komobasket.app.data.api.PublicHomeApi
import gr.komobasket.app.data.mapper.toModel
import java.util.concurrent.TimeUnit
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

/** Explicit read-only production A1 → A3 check; ordinary unit runs stay offline. */
class ProductionHomeConnectivityTest {
    @Test
    fun a1CompetitionHomeDecodesThroughAndroidDto() = runBlocking {
        assumeTrue(System.getenv("RUN_LIVE_HOME_TEST") == "1")
        val retrofit = Retrofit.Builder()
            .baseUrl("https://komobasket.gr/")
            .client(OkHttpClient.Builder().callTimeout(20, TimeUnit.SECONDS).build())
            .addConverterFactory(Json { ignoreUnknownKeys = true }
                .asConverterFactory("application/json".toMediaType()))
            .build()
        val catalogue = retrofit.create(PublicCatalogueApi::class.java)
        val season = catalogue.seasons().data.first()
        val organization = catalogue.organizations(season.id).data.first()
        val competition = catalogue.competitions(season.id, organization.id).data.first()
        val home = retrofit.create(PublicHomeApi::class.java).home(competition.id).data.toModel()

        assertEquals(competition.id, home.competition.id)
        assertEquals(season.id, home.competition.seasonId)
        assertTrue(home.upcomingGames.all { it.id.isNotBlank() })
    }
}
