package gr.komobasket.app.data

import gr.komobasket.app.data.api.PublicCatalogueApi
import gr.komobasket.app.data.api.PublicPhasesApi
import gr.komobasket.app.data.api.PublicPlayerProfileApi
import gr.komobasket.app.data.api.PublicRankingsApi
import gr.komobasket.app.data.api.PublicTeamProfileApi
import gr.komobasket.app.data.api.PublicTeamsApi
import gr.komobasket.app.data.mapper.toPlayerProfile
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

/** Opt-in read-only A1 → B2 roster/B1 ranking → B3 decoder check. */
class ProductionPlayerProfileConnectivityTest {
    @Test fun publicPlayerProfileSingleAndAvailableMultiPhaseDecode() = runBlocking {
        assumeTrue(System.getenv("RUN_LIVE_PLAYER_PROFILE_TEST") == "1")
        val retrofit = Retrofit.Builder().baseUrl("https://komobasket.gr/")
            .client(OkHttpClient.Builder().callTimeout(25, TimeUnit.SECONDS).build())
            .addConverterFactory(Json { ignoreUnknownKeys = true }
                .asConverterFactory("application/json".toMediaType()))
            .build()
        val catalogue = retrofit.create(PublicCatalogueApi::class.java)
        val teams = retrofit.create(PublicTeamsApi::class.java)
        val teamProfile = retrofit.create(PublicTeamProfileApi::class.java)
        val phasesApi = retrofit.create(PublicPhasesApi::class.java)
        val rankingApi = retrofit.create(PublicRankingsApi::class.java)
        val playerApi = retrofit.create(PublicPlayerProfileApi::class.java)
        var rosterCandidate: Triple<String, String, List<String>>? = null
        var populatedCandidate: Triple<String, String, List<String>>? = null
        search@ for (season in catalogue.seasons().data) {
            for (organization in catalogue.organizations(season.id).data) {
                for (competition in catalogue.competitions(season.id, organization.id).data) {
                    val phaseIds = phasesApi.competition(competition.id).data.phases.map { it.id }
                    if (phaseIds.isEmpty()) continue
                    if (rosterCandidate == null) {
                        val rosterPlayer = teams.teams(competition.id).data.firstNotNullOfOrNull { team ->
                            teamProfile.detail(competition.id, team.id).data.roster.firstOrNull()?.playerId
                        }
                        if (rosterPlayer != null) rosterCandidate =
                            Triple(competition.id, rosterPlayer, phaseIds)
                    }
                    for (phaseId in phaseIds) {
                        val rankedPlayer = rankingApi.rankings(competition.id, phaseId,
                            "points", null, 1).data.firstOrNull()?.playerId
                        if (rankedPlayer != null) {
                            populatedCandidate = Triple(competition.id, rankedPlayer,
                                listOf(phaseId) + phaseIds.filterNot { it == phaseId })
                            break@search
                        }
                    }
                }
            }
        }
        val (competitionId, playerId, phaseIds) = requireNotNull(populatedCandidate ?: rosterCandidate) {
            "No public competition with a ranking or roster player"
        }
        val single = playerApi.profile(competitionId, playerId, phaseIds.first()).data
            .toPlayerProfile(competitionId, playerId, phaseIds.take(1))
        assertEquals(playerId, single.id)
        assertTrue(single.name.isNotBlank())
        assertTrue(single.gamesPlayed >= 0)
        assertTrue(single.recentGames.size <= 5)
        println("F52_LIVE_SINGLE=PASS gamesPlayed=${single.gamesPlayed}")
        if (phaseIds.size >= 2) {
            val two = phaseIds.take(2)
            val multi = playerApi.profile(competitionId, playerId, two.joinToString(",")).data
                .toPlayerProfile(competitionId, playerId, two)
            assertEquals(two.toSet(), multi.phaseIds.toSet())
            println("F52_LIVE_MULTI=PASS gamesPlayed=${multi.gamesPlayed}")
        } else println("F52_LIVE_MULTI=NOT_EXERCISED")
        if (populatedCandidate != null) {
            assertTrue(single.gamesPlayed > 0)
            println("F52_LIVE_POPULATED=PASS")
        } else println("F52_LIVE_POPULATED=NOT_EXERCISED")
        val invalid = try {
            playerApi.profile(competitionId, "player-f52-invalid-000000", phaseIds.first())
            null
        } catch (error: HttpException) { error.code() }
        assertEquals(404, invalid)
        println("F52_LIVE_INVALID_404=PASS")
    }
}
