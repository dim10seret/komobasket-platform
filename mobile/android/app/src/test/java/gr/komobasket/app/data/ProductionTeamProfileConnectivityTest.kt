package gr.komobasket.app.data

import gr.komobasket.app.data.api.PublicCatalogueApi
import gr.komobasket.app.data.api.PublicPhasesApi
import gr.komobasket.app.data.api.PublicTeamProfileApi
import gr.komobasket.app.data.api.PublicTeamsApi
import gr.komobasket.app.data.mapper.toTeamGames
import gr.komobasket.app.data.mapper.toTeamProfile
import gr.komobasket.app.data.mapper.toTeamStatistics
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

/** Opt-in A1 → B2 Team Detail/Stats → A2 Games read-only contract check. */
class ProductionTeamProfileConnectivityTest {
    @Test fun publicTeamProfileAndBoundedGamesDecode() = runBlocking {
        assumeTrue(System.getenv("RUN_LIVE_TEAM_PROFILE_TEST") == "1")
        val retrofit = Retrofit.Builder().baseUrl("https://komobasket.gr/")
            .client(OkHttpClient.Builder().callTimeout(25, TimeUnit.SECONDS).build())
            .addConverterFactory(Json { ignoreUnknownKeys = true }
                .asConverterFactory("application/json".toMediaType()))
            .build()
        val catalogue = retrofit.create(PublicCatalogueApi::class.java)
        val teamsApi = retrofit.create(PublicTeamsApi::class.java)
        var selected: Pair<String, String>? = null
        for (season in catalogue.seasons().data) {
            for (organization in catalogue.organizations(season.id).data) {
                for (competition in catalogue.competitions(season.id, organization.id).data) {
                    val team = teamsApi.teams(competition.id).data.firstOrNull()
                    if (team != null) {
                        selected = competition.id to team.id
                        break
                    }
                }
                if (selected != null) break
            }
            if (selected != null) break
        }
        val (competitionId, teamId) = requireNotNull(selected) { "No public competition with teams" }
        val profileApi = retrofit.create(PublicTeamProfileApi::class.java)
        val detail = profileApi.detail(competitionId, teamId).data.toTeamProfile(competitionId, teamId)
        assertEquals(teamId, detail.id)
        assertTrue(detail.name.isNotBlank())
        assertTrue(detail.roster.all { it.playerId.isNotBlank() })
        val phases = retrofit.create(PublicPhasesApi::class.java).competition(competitionId).data.phases
        val phaseId = detail.currentPhaseId?.takeIf { current -> phases.any { it.id == current } }
            ?: phases.first().id
        val statistics = profileApi.statistics(competitionId, teamId, phaseId)
            .data.toTeamStatistics(competitionId, teamId, listOf(phaseId))
        assertTrue(statistics.gamesPlayed >= 0)
        val upcoming = profileApi.games(competitionId, teamId, "scheduled", "asc", 5)
            .toTeamGames(competitionId, teamId, "scheduled")
        val recent = profileApi.games(competitionId, teamId, "completed", "desc", 5)
            .toTeamGames(competitionId, teamId, "completed")
        assertTrue(upcoming.size <= 5 && recent.size <= 5)
    }
}
