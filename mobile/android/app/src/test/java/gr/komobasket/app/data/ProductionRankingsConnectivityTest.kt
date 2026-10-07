package gr.komobasket.app.data

import gr.komobasket.app.core.model.RankingCategory
import gr.komobasket.app.data.api.PublicCatalogueApi
import gr.komobasket.app.data.api.PublicPhasesApi
import gr.komobasket.app.data.api.PublicRankingsApi
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

/** Opt-in read-only A1 → A2 → B1 check. Empty production rankings are valid. */
class ProductionRankingsConnectivityTest {
    @Test fun singleMultiAndShootingRankingsDecodeThroughAndroidDtos() = runBlocking {
        assumeTrue(System.getenv("RUN_LIVE_RANKINGS_TEST") == "1")
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
        val detail = retrofit.create(PublicPhasesApi::class.java)
            .competition(competition.id).data.toPhasesModel()
        val phases = detail.phases.map { it.id }
        assertTrue(phases.isNotEmpty())
        val api = retrofit.create(PublicRankingsApi::class.java)
        val single = api.rankings(competition.id, phases.first(), "points", null, 10)
            .toModel(competition.id, phases.take(1), RankingCategory.Points)
        assertTrue(single.rows.all { it.playerId.isNotBlank() })
        if (single.nextCursor != null) {
            val next = api.rankings(competition.id, phases.first(), "points", single.nextCursor, 10)
                .toModel(competition.id, phases.take(1), RankingCategory.Points)
            assertTrue(next.rows.none { row -> single.rows.any { it.playerId == row.playerId } })
        }
        if (phases.size >= 2) {
            val selected = phases.take(2)
            val multiple = api.rankings(competition.id, selected.joinToString(","), "points", null, 10)
                .toModel(competition.id, selected, RankingCategory.Points)
            assertTrue(multiple.rows.all { it.teamId.isNotBlank() })
        }
        val shooting = api.rankings(competition.id, phases.first(), "2pt", null, 10)
            .toModel(competition.id, phases.take(1), RankingCategory.TwoPoint)
        assertTrue(shooting.rows.all { it.playerId.isNotBlank() })
        assertEquals(competition.id, detail.competition.id)
    }
}
