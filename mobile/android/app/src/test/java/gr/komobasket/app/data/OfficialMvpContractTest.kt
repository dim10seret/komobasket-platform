package gr.komobasket.app.data

import gr.komobasket.app.core.common.playerProfileRoute
import gr.komobasket.app.core.common.teamProfileRoute
import gr.komobasket.app.core.model.OfficialMvpScope
import gr.komobasket.app.core.model.Competition
import gr.komobasket.app.core.model.CompetitionHome
import gr.komobasket.app.core.model.HomePhase
import gr.komobasket.app.core.model.HomeRound
import gr.komobasket.app.core.model.currentOfficialMvpScope
import gr.komobasket.app.data.api.OfficialMvpEnvelope
import gr.komobasket.app.data.api.PublicOfficialMvpApi
import gr.komobasket.app.data.mapper.toModel
import gr.komobasket.app.data.repository.HttpOfficialMvpRepository
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class OfficialMvpContractTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val scope = OfficialMvpScope("competition-a", "phase-a", 7)
    private fun fixture(team: String = """{"id":"team-a","name":"Alpha","logoUrl":"/a.png"}""",
        performance: String = """{"points":12,"rebounds":5,"assists":3,"efficiency":14}""",
        photo: String = "\"/p.png\"", round: Int = 7) =
        """{"data":{"id":"official-1","competitionId":"competition-a",
            "phaseId":"phase-a","round":$round,"gameId":"game-a",
            "player":{"id":"player-a","name":"Alex","photoUrl":$photo},
            "team":$team,"performance":$performance,
            "selectedAt":"2027-10-03T11:00:00Z"}}"""

    @Test fun storedSelectionPreservesExactC1IdentityAndPerformance() {
        val result = json.decodeFromString<OfficialMvpEnvelope>(fixture()).data!!.toModel(scope)
        assertEquals("official-1", result.selectionId)
        assertEquals("2027-10-03T11:00:00Z", result.selectedAt)
        assertEquals("competition-a", result.competitionId)
        assertEquals("phase-a", result.phaseId)
        assertEquals(7, result.round)
        assertEquals("game-a", result.gameId)
        assertEquals("player-a", result.player.id)
        assertEquals("Alex", result.player.name)
        assertEquals("/p.png", result.player.photoUrl)
        assertEquals("team-a", result.team?.id)
        assertEquals("/a.png", result.team?.logoUrl)
        assertEquals(12, result.performance?.points)
        assertEquals(5, result.performance?.rebounds)
        assertEquals(3, result.performance?.assists)
        assertEquals(14, result.performance?.efficiency)
        assertEquals("player/player-a", playerProfileRoute(result.player.id))
        assertEquals("team/team-a", teamProfileRoute(result.team!!.id))
    }

    @Test fun noSelectionDoesNotCreateMvpAndNullableDetailKeepsOfficialIdentity() {
        assertNull(json.decodeFromString<OfficialMvpEnvelope>("""{"data":null}""").data)
        val result = json.decodeFromString<OfficialMvpEnvelope>(
            fixture(team = "null", performance = "null", photo = "null")).data!!.toModel(scope)
        assertEquals("official-1", result.selectionId)
        assertEquals("player-a", result.player.id)
        assertNull(result.player.photoUrl)
        assertNull(result.team)
        assertNull(result.performance)
    }

    @Test fun responseCannotCrossCompetitionPhaseOrRound() {
        val dto = json.decodeFromString<OfficialMvpEnvelope>(fixture()).data!!
        for (wrong in listOf(OfficialMvpScope("competition-b", "phase-a", 7),
            OfficialMvpScope("competition-a", "phase-b", 7),
            OfficialMvpScope("competition-a", "phase-a", 8))) {
            assertThrows(IllegalArgumentException::class.java) { dto.toModel(wrong) }
        }
    }

    @Test fun repositoryMakesOneCanonicalQueryAndRejectsInvalidScopeBeforeNetwork() = runBlocking {
        val urls = mutableListOf<okhttp3.HttpUrl>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            urls += chain.request().url
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK")
                .body(fixture().toResponseBody("application/json".toMediaType())).build()
        }.build()
        val api = Retrofit.Builder().baseUrl("https://komobasket.gr/").client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build().create(PublicOfficialMvpApi::class.java)
        val repository = HttpOfficialMvpRepository(api)
        assertEquals("official-1", repository.current(scope)?.selectionId)
        assertEquals(1, urls.size)
        assertEquals("/api/public/v1/competitions/competition-a/mvp", urls.single().encodedPath)
        assertEquals("phase-a", urls.single().queryParameter("phaseId"))
        assertEquals("7", urls.single().queryParameter("round"))
        assertThrows(IllegalArgumentException::class.java) { runBlocking {
            repository.current(OfficialMvpScope("competition-a", "phase-a", 0))
        } }
        assertEquals(1, urls.size)
    }

    @Test fun canonicalRoutesNeverUseDisplayNames() {
        assertEquals("team/team_42", teamProfileRoute("team_42"))
        assertEquals("player/player_42", playerProfileRoute("player_42"))
        assertNull(teamProfileRoute("Alpha Team"))
        assertNull(playerProfileRoute("Alex Player"))
    }

    @Test fun a3RoundBridgeRequiresMatchingStandingsPhaseAndCanonicalNumericRound() {
        val home = CompetitionHome(
            competition = Competition("competition-a", "season", "organization", "League",
                "league", "league", null),
            currentPhase = HomePhase("phase-a", "Display label 7", "standings"),
            currentRound = HomeRound(7, "7η Αγωνιστική"),
            liveGames = emptyList(), upcomingGames = emptyList(), recentResults = emptyList(),
            standingsPreview = null, currentPhaseId = "phase-a")
        assertEquals(scope, home.currentOfficialMvpScope())
        assertNull(home.copy(currentPhaseId = null).currentOfficialMvpScope())
        assertNull(home.copy(currentPhaseId = "phase-b").currentOfficialMvpScope())
        assertNull(home.copy(currentPhase = HomePhase("phase-a", "Series", "series"))
            .currentOfficialMvpScope())
        assertNull(home.copy(currentRound = HomeRound(0, "Round 1"))
            .currentOfficialMvpScope())
        assertNull(home.copy(currentRound = null).currentOfficialMvpScope())
    }
}
