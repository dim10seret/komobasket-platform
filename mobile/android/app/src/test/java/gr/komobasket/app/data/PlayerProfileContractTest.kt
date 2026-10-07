package gr.komobasket.app.data

import gr.komobasket.app.core.common.playerProfileRoute
import gr.komobasket.app.data.api.PlayerProfileEnvelope
import gr.komobasket.app.data.api.PublicPlayerProfileApi
import gr.komobasket.app.data.mapper.toPlayerProfile
import gr.komobasket.app.data.repository.HttpPlayerProfileRepository
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class PlayerProfileContractTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val totals = """{"points":21,"twoPointMade":4,"twoPointAttempts":7,
        "threePointMade":3,"threePointAttempts":8,"freeThrowMade":4,"freeThrowAttempts":5,
        "offensiveRebounds":2,"defensiveRebounds":5,"rebounds":7,"assists":6,
        "steals":2,"blocks":1,"turnovers":3,"fouls":2,"efficiency":24}"""
    private val averages = """{"points":10.5,"rebounds":3.5,"assists":3.0,
        "steals":1.0,"blocks":0.5,"turnovers":1.5,"fouls":1.0,"efficiency":12.0}"""
    private val shooting = """{"twoPoint":{"made":4,"attempted":7,"percentage":57.14},
        "threePoint":{"made":3,"attempted":8,"percentage":37.5},
        "freeThrow":{"made":4,"attempted":5,"percentage":80.0}}"""
    private val recent = """[{"gameId":"game-new","phaseId":"phase-b","round":2,
        "roundLabel":"Round 2","scheduledDate":"2026-10-06","scheduledTime":"19:30",
        "playerTeam":{"id":"team-new","name":"New Team"},
        "opponentTeam":{"id":"team-rival","name":"Rival"},"teamScore":80,
        "opponentScore":70,"outcome":"win","points":12,"rebounds":4,
        "assists":3,"efficiency":15},
        {"gameId":"game-old","phaseId":"phase-a","round":1,
        "roundLabel":"Round 1","scheduledDate":"2026-09-01","scheduledTime":null,
        "playerTeam":{"id":"team-old","name":"Old Team"},
        "opponentTeam":{"id":"team-rival","name":"Rival"},"teamScore":64,
        "opponentScore":70,"outcome":"loss","points":9,"rebounds":3,
        "assists":3,"efficiency":9}]"""
    private fun fixture(phases: String = "[\"phase-a\",\"phase-b\"]",
        team: String = """{"id":"team-new","name":"New Team","logoUrl":"/new.png"}""",
        photo: String = "\"/player.png\"", jersey: String = "\"11\"",
        games: Int = 2, totalsValue: String = totals, averageValue: String = averages,
        shootingValue: String = shooting, recentValue: String = recent) =
        """{"data":{"id":"player-a","name":"Alex Player","photoUrl":$photo,
            "competitionId":"competition-a","seasonId":"season-a","currentTeam":$team,
            "jerseyNumber":$jersey,"phaseIds":$phases,"gamesPlayed":$games,
            "totals":$totalsValue,"perGame":$averageValue,"shooting":$shootingValue,
            "recentGames":$recentValue}}"""

    @Test fun exactB3FieldsPreserveTransferAndNewestFirstOrder() {
        val profile = json.decodeFromString<PlayerProfileEnvelope>(fixture()).data
            .toPlayerProfile("competition-a", "player-a", listOf("phase-b", "phase-a"))
        assertEquals("player-a", profile.id)
        assertEquals("Alex Player", profile.name)
        assertEquals("/player.png", profile.photoUrl)
        assertEquals("team-new", profile.currentTeam?.id)
        assertEquals("/new.png", profile.currentTeam?.logoUrl)
        assertEquals("11", profile.jerseyNumber)
        assertEquals(2, profile.gamesPlayed)
        assertEquals(21.0, profile.totals.points, 0.0)
        assertEquals(2.0, profile.totals.offensiveRebounds, 0.0)
        assertEquals(24.0, profile.totals.efficiency, 0.0)
        assertEquals(10.5, profile.perGame.points!!, 0.0)
        assertEquals(3.5, profile.perGame.rebounds!!, 0.0)
        assertEquals(57.14, profile.shooting.twoPoint.percentage!!, 0.0)
        assertEquals(37.5, profile.shooting.threePoint.percentage!!, 0.0)
        assertEquals(80.0, profile.shooting.freeThrow.percentage!!, 0.0)
        assertEquals(listOf("game-new", "game-old"), profile.recentGames.map { it.gameId })
        assertEquals("team-old", profile.recentGames.last().playerTeam.id)
        assertEquals("team-new", profile.currentTeam?.id)
        assertEquals("loss", profile.recentGames.last().outcome)
        assertEquals(9, profile.recentGames.last().points)
        assertEquals("19:30", profile.recentGames.first().scheduledTime)
    }

    @Test fun playerProfileAcceptsLegacyAndTextualJerseys() {
        for ((raw, expected) in listOf(
            "23" to "23", "0" to "0", "null" to null,
            "\"23\"" to "23", "\"0\"" to "0", "\"00\"" to "00",
        )) {
            val profile = json.decodeFromString<PlayerProfileEnvelope>(fixture(jersey = raw)).data
            assertEquals(expected, profile.jerseyNumber)
        }
    }

    @Test fun playerProfileRejectsInvalidJerseyJson() {
        for (raw in listOf(
            "\"01\"", "\"000\"", "\"001\"", "\"100\"", "\"-1\"", "\"1.0\"",
            "100", "-1", "1.5", "true", "{}", "[]",
        )) {
            assertThrows(SerializationException::class.java) {
                json.decodeFromString<PlayerProfileEnvelope>(fixture(jersey = raw))
            }
        }
    }

    @Test fun rosteredZeroStatPlayerIsValidAndKeepsSemanticNulls() {
        val nullAverages = """{"points":null,"rebounds":null,"assists":null,
            "steals":null,"blocks":null,"turnovers":null,"fouls":null,"efficiency":null}"""
        val nullShooting = """{"twoPoint":{"made":0,"attempted":0,"percentage":null},
            "threePoint":{"made":0,"attempted":0,"percentage":null},
            "freeThrow":{"made":0,"attempted":0,"percentage":null}}"""
        val zeroTotals = totals.replace(Regex(":\\d+"), ":0")
        val profile = json.decodeFromString<PlayerProfileEnvelope>(fixture(
            phases = "[\"phase-a\"]", photo = "null", jersey = "null", games = 0,
            totalsValue = zeroTotals, averageValue = nullAverages,
            shootingValue = nullShooting, recentValue = "[]")).data
            .toPlayerProfile("competition-a", "player-a", listOf("phase-a"))
        assertNull(profile.photoUrl)
        assertNull(profile.jerseyNumber)
        assertEquals(0, profile.gamesPlayed)
        assertEquals(0.0, profile.totals.points, 0.0)
        assertNull(profile.perGame.points)
        assertNull(profile.shooting.twoPoint.percentage)
        assertNull(profile.shooting.threePoint.percentage)
        assertNull(profile.shooting.freeThrow.percentage)
        assertTrue(profile.recentGames.isEmpty())
    }

    @Test fun nullCurrentTeamIsValidButMismatchedIdentityOrScopeRejected() {
        val data = json.decodeFromString<PlayerProfileEnvelope>(fixture(team = "null")).data
        assertNull(data.toPlayerProfile("competition-a", "player-a",
            listOf("phase-a", "phase-b")).currentTeam)
        assertThrows(IllegalArgumentException::class.java) {
            data.toPlayerProfile("competition-other", "player-a", listOf("phase-a", "phase-b"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            data.toPlayerProfile("competition-a", "player-other", listOf("phase-a", "phase-b"))
        }
        assertThrows(IllegalArgumentException::class.java) {
            data.toPlayerProfile("competition-a", "player-a", listOf("phase-a"))
        }
    }

    @Test fun oneRequestUsesCanonicalPlayerPathAndEncodedPhaseScope() = runBlocking {
        val urls = mutableListOf<okhttp3.HttpUrl>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            urls += chain.request().url
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK")
                .body(fixture().toResponseBody("application/json".toMediaType())).build()
        }.build()
        val api = Retrofit.Builder().baseUrl("https://komobasket.gr/").client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build().create(PublicPlayerProfileApi::class.java)
        val repository = HttpPlayerProfileRepository(api)
        repository.profile("competition-a", "player-a", listOf("phase-b", "phase-a"))
        assertEquals(1, urls.size)
        assertEquals("/api/public/v1/competitions/competition-a/players/player-a",
            urls.single().encodedPath)
        assertEquals("phase-b,phase-a", urls.single().queryParameter("phaseIds"))
        assertThrows(IllegalArgumentException::class.java) { runBlocking {
            repository.profile("competition-a", "player-a", emptyList())
        } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking {
            repository.profile("competition-a", "player-a", listOf("phase-a", "phase-a"))
        } }
        assertThrows(IllegalArgumentException::class.java) { runBlocking {
            repository.profile("competition-a", "player-a", (1..13).map { "phase-$it" })
        } }
        assertEquals(1, urls.size)
    }

    @Test fun routeCarriesOnlyCanonicalId() {
        assertEquals("player/player-123", playerProfileRoute("player-123"))
        assertNull(playerProfileRoute("bad/name"))
        assertNull(playerProfileRoute(""))
    }
}
