package gr.komobasket.app.data

import gr.komobasket.app.core.model.RankingCategory
import gr.komobasket.app.core.model.RankingMetric
import gr.komobasket.app.data.api.PublicRankingsApi
import gr.komobasket.app.data.api.RankingsEnvelope
import gr.komobasket.app.data.mapper.toModel
import gr.komobasket.app.data.repository.HttpRankingsRepository
import gr.komobasket.app.feature.stats.formatRankingNumber
import java.util.Locale
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class RankingsContractTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val common = """"rank":1,"playerId":"player-canonical","playerName":"Player One","playerPhotoUrl":null,"teamId":"team-canonical","teamName":"Team A","teamLogoUrl":null,"gamesPlayed":2"""
    private fun envelope(category: String, rows: String, cursor: String = "null", more: Boolean = false) =
        """{"data":$rows,"meta":{"competitionId":"competition-a","phaseIds":["phase-a","phase-b"],"category":"$category","nextCursor":$cursor,"hasMore":$more}}"""

    @Test fun countingCategoriesMapCanonicalIdsGamesTotalsAveragesAndOrder() {
        for (category in RankingCategory.entries.filterNot { it.isShooting }) {
            val rows = """[{${common},"total":20,"perGameAverage":10},{${common.replace("\"rank\":1", "\"rank\":2").replace("player-canonical", "player-second")},"total":8,"perGameAverage":4}]"""
            val page = json.decodeFromString<RankingsEnvelope>(
                envelope(category.apiValue, rows, "\"opaque\"", true),
            ).toModel("competition-a", listOf("phase-b", "phase-a"), category)
            assertEquals(listOf("player-canonical", "player-second"), page.rows.map { it.playerId })
            assertEquals(listOf(1, 2), page.rows.map { it.rank })
            assertEquals("team-canonical", page.rows.first().teamId)
            assertEquals(2, page.rows.first().gamesPlayed)
            assertNull(page.rows.first().playerPhotoUrl)
            assertNull(page.rows.first().teamLogoUrl)
            assertEquals(RankingMetric.Counting(20.0, 10.0), page.rows.first().metric)
            assertEquals("opaque", page.nextCursor)
        }
    }

    @Test fun shootingCategoriesMapMadeAttemptsAndNullablePercentage() {
        for (category in RankingCategory.entries.filter { it.isShooting }) {
            val rows = """[{${common},"made":4,"attempted":6,"percentage":66.66666666666666},{${common.replace("\"rank\":1", "\"rank\":2").replace("player-canonical", "player-zero")},"made":0,"attempted":0,"percentage":null}]"""
            val page = json.decodeFromString<RankingsEnvelope>(
                envelope(category.apiValue, rows),
            ).toModel("competition-a", listOf("phase-a", "phase-b"), category)
            val first = page.rows.first().metric as RankingMetric.Shooting
            assertEquals(4, first.made)
            assertEquals(6, first.attempted)
            assertEquals(66.66666666666666, first.percentage!!, 0.000001)
            assertNull((page.rows.last().metric as RankingMetric.Shooting).percentage)
            assertNull(page.nextCursor)
        }
        assertEquals(listOf("points", "rebounds", "assists", "efficiency", "2pt", "3pt", "ft"),
            RankingCategory.entries.map { it.apiValue })
    }

    @Test fun emptyIsValidButMissingRequiredMetricOrCursorIsMalformed() {
        val empty = json.decodeFromString<RankingsEnvelope>(
            envelope("points", "[]"),
        ).toModel("competition-a", listOf("phase-a", "phase-b"), RankingCategory.Points)
        assertTrue(empty.rows.isEmpty())
        assertFalse(empty.nextCursor != null)
        assertThrows(IllegalArgumentException::class.java) {
            json.decodeFromString<RankingsEnvelope>(
                envelope("points", "[{${common}}]"),
            ).toModel("competition-a", listOf("phase-a", "phase-b"), RankingCategory.Points)
        }
        assertThrows(IllegalArgumentException::class.java) {
            json.decodeFromString<RankingsEnvelope>(
                envelope("points", "[]", more = true),
            ).toModel("competition-a", listOf("phase-a", "phase-b"), RankingCategory.Points)
        }
        assertEquals("66.67", formatRankingNumber(66.66666666666666, Locale.US))
    }

    @Test fun retrofitSendsOneEncodedCommaSeparatedPhaseIdsAndTopTen() = runBlocking {
        var query: okhttp3.HttpUrl? = null
        val responseBody = envelope("points", "[]")
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            query = chain.request().url
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK")
                .body(responseBody.toResponseBody("application/json".toMediaType())).build()
        }.build()
        val api = Retrofit.Builder().baseUrl("https://komobasket.gr/")
            .client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build().create(PublicRankingsApi::class.java)
        val page = HttpRankingsRepository(api).rankings("competition-a",
            listOf("phase-b", "phase-a"), RankingCategory.Points, null)
        assertTrue(page.rows.isEmpty())
        val captured = requireNotNull(query)
        assertEquals(listOf("phase-b,phase-a"), captured.queryParameterValues("phaseIds"))
        assertEquals("points", captured.queryParameter("category"))
        assertEquals("10", captured.queryParameter("limit"))
        assertNull(captured.queryParameter("cursor"))
        assertTrue(captured.encodedQuery!!.contains("phase-b%2Cphase-a"))
    }
}
