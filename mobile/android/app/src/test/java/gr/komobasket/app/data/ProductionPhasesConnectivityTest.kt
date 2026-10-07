package gr.komobasket.app.data

import gr.komobasket.app.data.api.PublicCatalogueApi
import gr.komobasket.app.data.api.PublicPhasesApi
import gr.komobasket.app.data.mapper.toModel
import gr.komobasket.app.data.mapper.toPhasesModel
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

/** Opt-in read-only A1 → A2 contract check. Ordinary unit runs stay offline. */
class ProductionPhasesConnectivityTest {
    @Test fun publicCompetitionPhaseGamesAndSupportedStandingsDecode() = runBlocking {
        assumeTrue(System.getenv("RUN_LIVE_PHASES_TEST") == "1")
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
        val api = retrofit.create(PublicPhasesApi::class.java)
        val detail = api.competition(competition.id).data.toPhasesModel()
        assertEquals(competition.id, detail.competition.id)
        val phase = detail.phases.first()
        val firstPage = api.games(competition.id, phase.id, null, "asc", null, 2)
            .toModel(competition.id, phase.id)
        assertTrue(firstPage.games.all { it.phaseId == phase.id })
        if (firstPage.nextCursor != null) {
            val secondPage = api.games(competition.id, phase.id, null, "asc",
                firstPage.nextCursor, 2).toModel(competition.id, phase.id)
            assertTrue(secondPage.games.none { next -> firstPage.games.any { it.id == next.id } })
        }
        if ("standings" in phase.availableViews) {
            val standings = api.standings(competition.id, phase.id).data.map { it.toModel() }
            assertTrue(standings.all { it.teamId.isNotBlank() })
        }
    }
}
