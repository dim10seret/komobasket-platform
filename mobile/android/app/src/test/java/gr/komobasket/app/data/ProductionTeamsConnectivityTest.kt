package gr.komobasket.app.data

import gr.komobasket.app.data.api.PublicCatalogueApi
import gr.komobasket.app.data.api.PublicTeamsApi
import gr.komobasket.app.data.mapper.toTeamsModel
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

/** Opt-in, read-only A1 → B2 decode check. An empty team list is valid. */
class ProductionTeamsConnectivityTest {
    @Test fun selectedPublicCompetitionTeamsDecodeThroughAndroidDtos() = runBlocking {
        assumeTrue(System.getenv("RUN_LIVE_TEAMS_TEST") == "1")
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
        val api = retrofit.create(PublicTeamsApi::class.java)
        val envelope = api.teams(competition.id)
        val teams = envelope.toTeamsModel()
        assertEquals(envelope.data.map { it.id }, teams.map { it.id })
        assertTrue(teams.all { it.id.isNotBlank() && it.name.isNotBlank() })
    }
}
