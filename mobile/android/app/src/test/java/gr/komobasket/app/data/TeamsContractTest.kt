package gr.komobasket.app.data

import gr.komobasket.app.data.api.PublicTeamsApi
import gr.komobasket.app.data.api.TeamsEnvelope
import gr.komobasket.app.data.mapper.toTeamsModel
import gr.komobasket.app.data.repository.HttpTeamsRepository
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
import org.junit.Assert.assertTrue
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class TeamsContractTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun canonicalIdsNamesNullableLogosAndServerOrderArePreserved() {
        val envelope = json.decodeFromString<TeamsEnvelope>(
            """{"data":[{"id":"team-z","name":"Ζήτα","logoUrl":"/logos/z.png"},""" +
                """{"id":"team-a","name":"Alpha","logoUrl":null},""" +
                """{"id":"team-b","name":"Beta"}]}""",
        )
        val teams = envelope.toTeamsModel()
        assertEquals(listOf("team-z", "team-a", "team-b"), teams.map { it.id })
        assertEquals(listOf("Ζήτα", "Alpha", "Beta"), teams.map { it.name })
        assertEquals("/logos/z.png", teams.first().logoUrl)
        assertNull(teams[1].logoUrl)
        assertNull(teams[2].logoUrl)
    }

    @Test fun emptyListIsValidAndMalformedIdentityIsRejected() {
        assertTrue(json.decodeFromString<TeamsEnvelope>("""{"data":[]}""").toTeamsModel().isEmpty())
        assertThrows(IllegalArgumentException::class.java) {
            json.decodeFromString<TeamsEnvelope>(
                """{"data":[{"id":"","name":"A"}]}""",
            ).toTeamsModel()
        }
    }

    @Test fun retrofitMakesExactlyOneListRequestWithoutQueries() = runBlocking {
        val urls = mutableListOf<String>()
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            urls += chain.request().url.toString()
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1)
                .code(200).message("OK")
                .body("""{"data":[{"id":"team-a","name":"Alpha","logoUrl":null}]}"""
                    .toResponseBody("application/json".toMediaType())).build()
        }.build()
        val api = Retrofit.Builder().baseUrl("https://komobasket.gr/").client(client)
            .addConverterFactory(json.asConverterFactory("application/json".toMediaType()))
            .build().create(PublicTeamsApi::class.java)
        val teams = HttpTeamsRepository(api).teams("competition-a")
        assertEquals(listOf("team-a"), teams.map { it.id })
        assertEquals(listOf("https://komobasket.gr/api/public/v1/competitions/competition-a/teams"), urls)
    }
}
