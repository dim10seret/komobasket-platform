package gr.komobasket.app.data

import gr.komobasket.app.data.api.PublicCatalogueApi
import gr.komobasket.app.data.api.PublicHomeApi
import gr.komobasket.app.data.api.PublicPhasesApi
import gr.komobasket.app.data.api.PublicTeamProfileApi
import gr.komobasket.app.data.api.PublicTeamsApi
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

/** Opt-in, read-only F5.5.3B check against deployed public tournament contracts. */
class ProductionTournamentConnectivityTest {
    @Test fun leagueAndCupGroupsHomeAndTeamGamesUseCanonicalRootScope() = runBlocking {
        assumeTrue(System.getenv("RUN_LIVE_TOURNAMENT_TEST") == "1")
        val retrofit = Retrofit.Builder().baseUrl("https://komobasket.gr/")
            .client(OkHttpClient.Builder().callTimeout(30, TimeUnit.SECONDS).build())
            .addConverterFactory(Json { ignoreUnknownKeys = true }
                .asConverterFactory("application/json".toMediaType()))
            .build()
        val catalogue = retrofit.create(PublicCatalogueApi::class.java)
        val phases = retrofit.create(PublicPhasesApi::class.java)
        val homes = retrofit.create(PublicHomeApi::class.java)
        val teams = retrofit.create(PublicTeamsApi::class.java)
        val profiles = retrofit.create(PublicTeamProfileApi::class.java)
        var selected: gr.komobasket.app.core.model.CompetitionPhases? = null
        for (season in catalogue.seasons().data) {
            for (organization in catalogue.organizations(season.id).data) {
                for (competition in catalogue.competitions(season.id, organization.id).data) {
                    val detail = phases.competition(competition.id).data.toPhasesModel()
                    if (detail.tournamentGroups.map { it.name }.containsAll(
                            listOf("KomoBasket League", "Komo Cup"))) {
                        selected = detail
                        break
                    }
                }
                if (selected != null) break
            }
            if (selected != null) break
        }
        val detail = requireNotNull(selected) { "Public League/Cup competition not found" }
        val competitionId = detail.competition.id
        assertEquals(2, detail.tournamentGroups.size)
        val teamId = teams.teams(competitionId).data.first().id
        for (group in detail.tournamentGroups) {
            assertEquals(group.phaseIds, detail.forTournament(group.id)?.phases?.map { it.id })
            val home = homes.home(competitionId, group.id).data
            assertEquals(competitionId, home.competition.id)
            assertEquals(group.currentPhaseId, home.currentPhaseId)
            val team = profiles.detail(competitionId, teamId, group.id).data
            assertEquals(teamId, team.id)
            assertTrue(team.overview.currentPhaseId == null ||
                team.overview.currentPhaseId in group.phaseIds)
            val games = profiles.games(competitionId, teamId, "scheduled", "asc", 5, group.id).data
            assertTrue(games.all { it.phaseId in group.phaseIds })
        }
    }
}
