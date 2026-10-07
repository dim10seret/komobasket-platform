package gr.komobasket.app.data

import gr.komobasket.app.core.common.playerProfileRoute
import gr.komobasket.app.core.common.teamProfileRoute
import gr.komobasket.app.core.model.currentOfficialMvpScope
import gr.komobasket.app.data.api.PublicCatalogueApi
import gr.komobasket.app.data.api.PublicHomeApi
import gr.komobasket.app.data.api.PublicOfficialMvpApi
import gr.komobasket.app.data.mapper.toModel
import gr.komobasket.app.data.repository.HttpOfficialMvpRepository
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assume.assumeTrue
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/** Opt-in read-only A1 → A3 current standings context → C1 decoder check. */
class ProductionOfficialMvpConnectivityTest {
    @Test fun currentPublicOfficialSelectionOrNullDecodes() = runBlocking {
        assumeTrue(System.getenv("RUN_LIVE_OFFICIAL_MVP_TEST") == "1")
        val retrofit = Retrofit.Builder().baseUrl("https://komobasket.gr/")
            .client(OkHttpClient.Builder().callTimeout(25, TimeUnit.SECONDS).build())
            .addConverterFactory(Json { ignoreUnknownKeys = true }
                .asConverterFactory("application/json".toMediaType()))
            .build()
        val catalogue = retrofit.create(PublicCatalogueApi::class.java)
        val homeApi = retrofit.create(PublicHomeApi::class.java)
        val repository = HttpOfficialMvpRepository(retrofit.create(PublicOfficialMvpApi::class.java))
        var found = false
        search@ for (season in catalogue.seasons().data) {
            for (organization in catalogue.organizations(season.id).data) {
                for (competition in catalogue.competitions(season.id, organization.id).data) {
                    val home = homeApi.home(competition.id).data.toModel()
                    (home.liveGames + home.upcomingGames + home.recentResults).forEach { game ->
                        assertNotNull(teamProfileRoute(game.homeTeam.id))
                        assertNotNull(teamProfileRoute(game.awayTeam.id))
                    }
                    val scope = home.currentOfficialMvpScope() ?: continue
                    assertEquals(competition.id, scope.competitionId)
                    assertNotNull(home.currentPhaseId)
                    val mvp = repository.current(scope)
                    if (mvp == null) println("F53_LIVE_NO_SELECTION=PASS")
                    else {
                        assertEquals(scope.competitionId, mvp.competitionId)
                        assertEquals(scope.phaseId, mvp.phaseId)
                        assertEquals(scope.round, mvp.round)
                        assertNotNull(playerProfileRoute(mvp.player.id))
                        mvp.team?.let { assertNotNull(teamProfileRoute(it.id)) }
                        println("F53_LIVE_POPULATED=PASS")
                    }
                    found = true
                    break@search
                }
            }
        }
        if (!found) println("F53_LIVE_SCOPE=NOT_EXERCISED")
    }
}
