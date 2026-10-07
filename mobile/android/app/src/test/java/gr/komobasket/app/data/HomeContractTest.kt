package gr.komobasket.app.data

import gr.komobasket.app.data.api.HomeEnvelope
import gr.komobasket.app.data.api.PublicHomeApi
import gr.komobasket.app.data.mapper.toModel
import gr.komobasket.app.data.repository.HttpHomeRepository
import gr.komobasket.app.feature.home.scheduleLabel
import gr.komobasket.app.feature.home.publicLogoUrl
import gr.komobasket.app.feature.home.trustedWebLiveUrl
import java.util.Locale
import kotlinx.serialization.json.Json
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class HomeContractTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val competition = """{"id":"competition_test_1","organizationId":"organization_test_1","seasonId":"season_test_1","slug":"example-competition","name":"Example Competition","type":"league","logoUrl":"/api/team/logos/example.png"}"""
    private val phase = """{"id":"phase_test_league","competitionId":"competition_test_1","name":"Regular Phase","order":1,"format":"standings","phaseType":"regular_season","lifecycleStatus":"active","rootPhaseId":"phase_test_league","previousPhaseId":null,"isCurrent":true,"availableViews":["schedule","results","standings"]}"""
    private val upcoming = """{"id":"game_test_1","competitionId":"competition_test_1","phaseId":"phase_test_league","round":1,"roundLabel":"1η Αγωνιστική","scheduledDate":"2026-10-17","scheduledTime":"15:45","venue":{"name":"Example Arena","address":null,"mapUrl":null},"homeTeam":{"id":"team_test_alpha","name":"Team Alpha","logoUrl":"/api/team/logos/team-logos/team_test_alpha/example.png"},"awayTeam":{"id":"team_test_beta","name":"Team Beta","logoUrl":null},"status":"scheduled","homeScore":null,"awayScore":null,"webLiveUrl":null}"""
    private val standing = """{"rank":1,"teamId":"team_test_gamma","teamName":"Team Gamma","teamLogoUrl":"/logos/teams/2024-25/example.jpg","gamesPlayed":0,"wins":0,"losses":0,"pointsFor":0,"pointsAgainst":0,"pointDifference":0,"standingsPoints":0}"""

    private fun envelope(
        live: String = "[]",
        upcomingGames: String = "[]",
        recent: String = "[]",
        standings: String = "null",
        currentPhase: String = phase,
        currentRound: String = """{"number":1,"label":"1η Αγωνιστική"}""",
    ) = """{"data":{"competition":$competition,"currentPhaseId":"phase_test_league","currentPhase":$currentPhase,"activePhaseIds":["phase_test_league"],"currentRound":$currentRound,"liveGames":$live,"upcomingGames":$upcomingGames,"recentResults":$recent,"standingsPreview":$standings}}"""

    @Test
    fun homeShapeDecodesAndMapsUpcomingAndStandings() {
        val home = json.decodeFromString<HomeEnvelope>(
            envelope(upcomingGames = "[$upcoming]", standings = "[$standing]"),
        ).data.toModel()

        assertEquals("Example Competition", home.competition.name)
        assertEquals("Regular Phase", home.currentPhase?.name)
        assertEquals("1η Αγωνιστική", home.currentRound?.label)
        assertTrue(home.liveGames.isEmpty())
        assertEquals("2026-10-17", home.upcomingGames.single().scheduledDate)
        assertEquals("15:45", home.upcomingGames.single().scheduledTime)
        assertEquals("Example Arena", home.upcomingGames.single().venueName)
        assertEquals("https://komobasket.gr/api/team/logos/team-logos/team_test_alpha/example.png",
            publicLogoUrl(home.upcomingGames.single().homeTeam.logoUrl))
        assertEquals("Team Gamma", home.standingsPreview?.single()?.teamName)
        assertEquals("/logos/teams/2024-25/example.jpg", home.standingsPreview?.single()?.teamLogoUrl)
        assertEquals(0, home.standingsPreview?.single()?.standingsPoints)
        assertTrue(home.hasSportsContent)
    }

    @Test
    fun nullStandingsAndEmptyGamesAreLegitimatePartialHome() {
        val home = json.decodeFromString<HomeEnvelope>(
            envelope(currentPhase = "null", currentRound = "null"),
        ).data.toModel()

        assertNull(home.currentPhase)
        assertNull(home.currentRound)
        assertNull(home.standingsPreview)
        assertFalse(home.hasSportsContent)
    }

    @Test
    fun liveAndRecentGamesMapScoresAndTrustedWebAction() {
        val live = upcoming.replace("\"scheduled\"", "\"live\"")
            .replace("\"webLiveUrl\":null", "\"webLiveUrl\":\"https://komobasket.gr/competitions/games/game_test_1/live\"")
        val recent = upcoming.replace("\"scheduled\"", "\"completed\"")
            .replace("\"homeScore\":null", "\"homeScore\":80")
            .replace("\"awayScore\":null", "\"awayScore\":70")
        val home = json.decodeFromString<HomeEnvelope>(
            envelope(live = "[$live]", recent = "[$recent]"),
        ).data.toModel()

        assertEquals("live", home.liveGames.single().status)
        assertEquals("https://komobasket.gr/competitions/games/${home.liveGames.single().id}/live",
            trustedWebLiveUrl(home.liveGames.single()))
        assertEquals(80, home.recentResults.single().homeScore)
        assertEquals(70, home.recentResults.single().awayScore)
        assertNull(trustedWebLiveUrl(home.liveGames.single().copy(
            webLiveUrl = "https://komobasket.gr.evil.test/competitions/games/${home.liveGames.single().id}/live")))
        assertEquals("https://komobasket.gr/hosted/competitions/games/${home.liveGames.single().id}/live",
            trustedWebLiveUrl(home.liveGames.single().copy(
                webLiveUrl = "https://komobasket.gr/hosted/competitions/games/${home.liveGames.single().id}/live")))
        assertNull(publicLogoUrl("//evil.test/logo.png"))
    }

    @Test
    fun scheduleFormattingKeepsTheBackendWallClock() {
        val formatted = scheduleLabel("2026-10-17", "15:45", Locale.ENGLISH)
        assertTrue(formatted!!.contains("15:45"))
        assertEquals("15:45", scheduleLabel(null, "15:45", Locale.ENGLISH))
    }

    @Test
    fun homeRepositorySendsSelectedRootPhase() = runBlocking {
        var requestedRoot: String? = null
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            requestedRoot = chain.request().url.queryParameter("rootPhaseId")
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK")
                .body(envelope().toResponseBody("application/json".toMediaType())).build()
        }.build()
        val api = Retrofit.Builder().baseUrl("https://komobasket.gr/").client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build().create(PublicHomeApi::class.java)
        HttpHomeRepository(api).home("competition-a", "cup-root")
        assertEquals("cup-root", requestedRoot)
    }
}
