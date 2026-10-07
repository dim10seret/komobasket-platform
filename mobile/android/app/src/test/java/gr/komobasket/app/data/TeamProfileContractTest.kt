package gr.komobasket.app.data

import gr.komobasket.app.data.api.PublicTeamProfileApi
import gr.komobasket.app.data.api.TeamDetailEnvelope
import gr.komobasket.app.data.api.TeamStatisticsEnvelope
import gr.komobasket.app.data.mapper.toTeamProfile
import gr.komobasket.app.data.mapper.toTeamStatistics
import gr.komobasket.app.data.repository.HttpTeamProfileRepository
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

class TeamProfileContractTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val detail = """{"data":{"id":"team-a","name":"Alpha","logoUrl":"/a.png",\
        "organizationId":"org","competitionId":"competition-a","seasonId":"season",\
        "overview":{"currentPhaseId":"phase-a","standings":{"phaseId":"phase-a",\
        "rank":2,"gamesPlayed":3,"wins":2,"losses":1}},"roster":[\
        {"playerId":"player-z","playerName":"Zeta","photoUrl":"/z.png","jerseyNumber":12},\
        {"playerId":"player-a","playerName":"Alpha","photoUrl":null,"jerseyNumber":null}]}}"""
        .replace("\\", "")
    private val line = """{"pointsScored":20,"pointsAllowed":18,"twoPointMade":3,"twoPointAttempts":6,\
        "threePointMade":2,"threePointAttempts":5,"freeThrowMade":1,"freeThrowAttempts":2,\
        "offensiveRebounds":4,"defensiveRebounds":8,"rebounds":12,"assists":5,"steals":2,\
        "blocks":1,"turnovers":3,"fouls":4}""".replace("\\", "")
    private fun statistics(phases: String, games: Int, shotPercentage: String = "50.0") =
        """{"data":{"teamId":"team-a","competitionId":"competition-a","phaseIds":$phases,\
        "gamesPlayed":$games,"totals":$line,"perGame":$line,"shooting":{\
        "twoPoint":{"made":3,"attempted":6,"percentage":$shotPercentage},\
        "threePoint":{"made":0,"attempted":0,"percentage":null},\
        "freeThrow":{"made":1,"attempted":2,"percentage":50.0}}}}""".replace("\\", "")

    @Test fun detailPreservesIdentityOverviewRosterFieldsAndServerOrder() {
        val model = json.decodeFromString<TeamDetailEnvelope>(detail)
            .data.toTeamProfile("competition-a", "team-a")
        assertEquals("team-a", model.id)
        assertEquals("Alpha", model.name)
        assertEquals("/a.png", model.logoUrl)
        assertEquals("phase-a", model.currentPhaseId)
        assertEquals(2, model.standing?.rank)
        assertEquals(3, model.standing?.gamesPlayed)
        assertEquals(listOf("player-z", "player-a"), model.roster.map { it.playerId })
        assertEquals("/z.png", model.roster.first().photoUrl)
        assertEquals("12", model.roster.first().jerseyNumber)
        assertNull(model.roster.last().photoUrl)
        assertNull(model.roster.last().jerseyNumber)
    }

    private fun jerseyFromDetail(raw: String): String? =
        json.decodeFromString<TeamDetailEnvelope>(
            detail.replace("\"jerseyNumber\":12", "\"jerseyNumber\":$raw")
        ).data.roster.first().jerseyNumber

    @Test fun teamRosterAcceptsLegacyAndTextualJerseysWithoutCollapsingDoubleZero() {
        for ((raw, expected) in listOf(
            "23" to "23", "0" to "0", "null" to null,
            "\"23\"" to "23", "\"0\"" to "0", "\"00\"" to "00",
        )) {
            assertEquals(expected, jerseyFromDetail(raw))
        }
        assertTrue(jerseyFromDetail("\"0\"") != jerseyFromDetail("\"00\""))
    }

    @Test fun teamRosterRejectsInvalidJerseyJson() {
        for (raw in listOf(
            "\"01\"", "\"000\"", "\"001\"", "\"100\"", "\"-1\"", "\"1.0\"", "\"letters\"",
            "100", "-1", "1.5", "true", "{}", "[]",
        )) {
            assertThrows(SerializationException::class.java) { jerseyFromDetail(raw) }
        }
    }

    @Test fun nullStandingAndEmptyRosterAreValid() {
        val empty = """{"data":{"id":"team-a","name":"Alpha","logoUrl":null,
            "organizationId":"org","competitionId":"competition-a","seasonId":"season",
            "overview":{"currentPhaseId":null,"standings":null},"roster":[]}}"""
        val model = json.decodeFromString<TeamDetailEnvelope>(empty)
            .data.toTeamProfile("competition-a", "team-a")
        assertNull(model.standing)
        assertTrue(model.roster.isEmpty())
        assertThrows(IllegalArgumentException::class.java) {
            json.decodeFromString<TeamDetailEnvelope>(detail)
                .data.toTeamProfile("competition-a", "team-other")
        }
    }

    @Test fun singleMultiAndZeroStatisticsMapSuppliedValuesWithoutAggregation() {
        val single = json.decodeFromString<TeamStatisticsEnvelope>(statistics("[\"phase-a\"]", 3))
            .data.toTeamStatistics("competition-a", "team-a", listOf("phase-a"))
        assertEquals(3, single.gamesPlayed)
        assertEquals(20.0, single.totals.pointsScored, 0.0)
        assertEquals(20.0, single.perGame.pointsScored, 0.0)
        assertEquals(50.0, single.shooting.twoPoint.percentage!!, 0.0)
        assertNull(single.shooting.threePoint.percentage)
        val multiple = json.decodeFromString<TeamStatisticsEnvelope>(
            statistics("[\"phase-a\",\"phase-b\"]", 4))
            .data.toTeamStatistics("competition-a", "team-a", listOf("phase-b", "phase-a"))
        assertEquals(listOf("phase-a", "phase-b"), multiple.phaseIds)
        assertEquals(4, multiple.gamesPlayed)
        val zero = json.decodeFromString<TeamStatisticsEnvelope>(statistics("[\"phase-a\"]", 0, "null"))
            .data.toTeamStatistics("competition-a", "team-a", listOf("phase-a"))
        assertEquals(0, zero.gamesPlayed)
        assertNull(zero.shooting.twoPoint.percentage)
    }

    @Test fun repositoryEncodesStatsScopeAndUsesBoundedDirectionalGamesRequests() = runBlocking {
        val urls = mutableListOf<okhttp3.HttpUrl>()
        val game = """{"id":"game-a","competitionId":"competition-a","phaseId":"phase-a",\
            "round":1,"roundLabel":"Round 1","scheduledDate":"2026-10-25",\
            "scheduledTime":"15:45","venue":null,\
            "homeTeam":{"id":"team-a","name":"Alpha","logoUrl":null},\
            "awayTeam":{"id":"team-b","name":"Beta","logoUrl":null},\
            "status":"STATUS","homeScore":null,"awayScore":null,"webLiveUrl":null}"""
            .replace("\\", "")
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val url = chain.request().url
            urls += url
            val body = if (url.encodedPath.endsWith("/statistics")) {
                statistics("[\"phase-a\",\"phase-b\"]", 0)
            } else {
                """{"data":[${game.replace("STATUS", url.queryParameter("status")!!)}],\
                    "meta":{"hasMore":false,"nextCursor":null}}""".replace("\\", "")
            }
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK").body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val api = Retrofit.Builder().baseUrl("https://komobasket.gr/").client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build().create(PublicTeamProfileApi::class.java)
        val repository = HttpTeamProfileRepository(api)
        repository.statistics("competition-a", "team-a", listOf("phase-b", "phase-a"))
        val upcoming = repository.upcoming("competition-a", "team-a", "root-a")
        val recent = repository.recent("competition-a", "team-a", "root-a")
        assertEquals("phase-b,phase-a", urls[0].queryParameter("phaseIds"))
        assertEquals("scheduled", urls[1].queryParameter("status"))
        assertEquals("asc", urls[1].queryParameter("order"))
        assertEquals("5", urls[1].queryParameter("limit"))
        assertEquals("team-a", urls[1].queryParameter("teamId"))
        assertEquals("root-a", urls[1].queryParameter("rootPhaseId"))
        assertEquals("completed", urls[2].queryParameter("status"))
        assertEquals("desc", urls[2].queryParameter("order"))
        assertEquals("5", urls[2].queryParameter("limit"))
        assertEquals("root-a", urls[2].queryParameter("rootPhaseId"))
        assertEquals("2026-10-25", upcoming.single().scheduledDate)
        assertEquals("15:45", upcoming.single().scheduledTime)
        assertEquals("completed", recent.single().status)
    }

    @Test fun teamDetailRepositorySendsSelectedRootPhase() = runBlocking {
        var requestedRoot: String? = null
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            requestedRoot = chain.request().url.queryParameter("rootPhaseId")
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK")
                .body(detail.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val api = Retrofit.Builder().baseUrl("https://komobasket.gr/").client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build().create(PublicTeamProfileApi::class.java)
        HttpTeamProfileRepository(api).detail("competition-a", "team-a", "cup-root")
        assertEquals("cup-root", requestedRoot)
    }
}
