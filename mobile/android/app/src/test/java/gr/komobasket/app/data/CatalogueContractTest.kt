package gr.komobasket.app.data

import gr.komobasket.app.data.api.CatalogueEnvelope
import gr.komobasket.app.data.api.CompetitionDto
import gr.komobasket.app.data.api.OrganizationDto
import gr.komobasket.app.data.api.SeasonDto
import gr.komobasket.app.data.mapper.toModel
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class CatalogueContractTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun seasonEnvelopeDecodesAndMaps() {
        val body = """{"data":[{"id":"season_test_1","name":"Example Season","slug":"example-season","startDate":"2026-10-01","endDate":"2027-07-30"}]}"""
        val envelope = json.decodeFromString<CatalogueEnvelope<SeasonDto>>(body)
        val season = envelope.data.single().toModel()

        assertEquals("season_test_1", season.id)
        assertEquals("Example Season", season.name)
        assertEquals("2026-10-01", season.startDate)
        assertEquals("2027-07-30", season.endDate)
    }

    @Test
    fun optionalEndDateAndPublicContextFieldsMap() {
        val season = json.decodeFromString<SeasonDto>(
            """{"id":"s","name":"Season 2027–28","slug":"future","startDate":"2027-09-01"}""",
        ).toModel()
        assertNull(season.endDate)

        val organization = json.decodeFromString<CatalogueEnvelope<OrganizationDto>>(
            """{"data":[{"id":"organization_test_1","slug":"organization-alpha","name":"Organization Alpha","logoUrl":null}]}""",
        ).data.single().toModel()
        assertEquals("Organization Alpha", organization.name)

        val competition = json.decodeFromString<CatalogueEnvelope<CompetitionDto>>(
            """{"data":[{"id":"c","organizationId":"organization_test_1","seasonId":"s","slug":"league","name":"League","type":"league"}]}""",
        ).data.single().toModel()
        assertEquals("s", competition.seasonId)
        assertEquals(organization.id, competition.organizationId)
    }
}
