package gr.komobasket.app.data

import gr.komobasket.app.core.model.PhaseView
import gr.komobasket.app.data.api.CompetitionDetailEnvelope
import gr.komobasket.app.data.api.GamesEnvelope
import gr.komobasket.app.data.api.StandingsEnvelope
import gr.komobasket.app.data.mapper.toModel
import gr.komobasket.app.data.mapper.toPhasesModel
import gr.komobasket.app.feature.home.scheduleLabel
import gr.komobasket.app.feature.home.trustedWebLiveUrl
import gr.komobasket.app.feature.phases.orderFor
import gr.komobasket.app.feature.phases.statusFor
import gr.komobasket.app.feature.phases.visibleGames
import java.util.Locale
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PhasesContractTest {
    private val json = Json { ignoreUnknownKeys = true }
    private val competitionId = "competition_test_1"
    private val phaseId = "phase_test_league"
    private val team = """{"id":"team_test_alpha","name":"Team Alpha","logoUrl":"/logos/a.png"}"""
    private val otherTeam = """{"id":"team_test_beta","name":"Team Beta","logoUrl":null}"""

    private fun phase(id: String, order: Int, views: String, current: Boolean = false) =
        """{"id":"$id","competitionId":"$competitionId","name":"Phase $order","order":$order,"format":"standings","phaseType":"regular_season","lifecycleStatus":"active","rootPhaseId":"$phaseId","previousPhaseId":null,"isCurrent":$current,"availableViews":$views}"""

    private fun game(status: String, id: String = "game-1", score: String = "null", url: String = "null") =
        """{"id":"$id","competitionId":"$competitionId","phaseId":"$phaseId","round":1,"roundLabel":"1η Αγωνιστική","scheduledDate":"2026-10-17","scheduledTime":"15:45","venue":{"name":"Example Arena","address":"Address","mapUrl":null},"homeTeam":$team,"awayTeam":$otherTeam,"status":"$status","homeScore":$score,"awayScore":$score,"webLiveUrl":$url}"""

    @Test fun competitionDetailOrdersPhasesAndMapsCapabilitiesAndCurrentState() {
        val detail = json.decodeFromString<CompetitionDetailEnvelope>(
            """{"data":{"id":"$competitionId","organizationId":"organization_test_1","seasonId":"season-1","slug":"example-competition","name":"Example Competition","type":"league","logoUrl":null,"phases":[${phase("series", 2, "[\"matchups\",\"schedule\",\"results\"]")},${phase(phaseId, 1, "[\"schedule\",\"results\",\"standings\"]", true)}],"currentPhaseId":"$phaseId","activePhaseIds":["$phaseId","series"]}}""",
        ).data.toPhasesModel()
        assertEquals(listOf(phaseId, "series"), detail.phases.map { it.id })
        assertEquals(phaseId, detail.currentPhaseId)
        assertTrue("series" in detail.activePhaseIds)
        assertTrue(detail.phases.first().isCurrent)
        assertEquals(listOf(PhaseView.Schedule, PhaseView.Results, PhaseView.Standings),
            detail.phases.first().supportedViews)
        assertEquals(listOf(PhaseView.Schedule, PhaseView.Results), detail.phases.last().supportedViews)
        assertFalse(PhaseView.Standings in detail.phases.last().supportedViews)
    }

    @Test fun tournamentGroupsDecodeAndLimitPhasesToSelectedRoot() {
        val detail = json.decodeFromString<CompetitionDetailEnvelope>(
            """{"data":{"id":"$competitionId","organizationId":"organization_test_1","seasonId":"season-1","slug":"example-competition","name":"Example Competition","type":"league","logoUrl":null,"phases":[${phase(phaseId, 1, "[\"schedule\"]")},${phase("phase_test_cup", 2, "[\"schedule\"]")}],"currentPhaseId":"$phaseId","activePhaseIds":["$phaseId"],"tournamentGroups":[{"id":"$phaseId","name":"League Event","phaseIds":["$phaseId"],"currentPhaseId":"$phaseId"},{"id":"phase_test_cup","name":"Cup Event","phaseIds":["phase_test_cup"],"currentPhaseId":"phase_test_cup"}]}}""",
        ).data.toPhasesModel()
        assertEquals(listOf("League Event", "Cup Event"), detail.tournamentGroups.map { it.name })
        val cup = requireNotNull(detail.forTournament("phase_test_cup"))
        assertEquals(listOf("phase_test_cup"), cup.phases.map { it.id })
        assertEquals("phase_test_cup", cup.currentPhaseId)
        assertTrue(cup.activePhaseIds.isEmpty())
        assertNull(detail.forTournament("removed-root"))
    }

    @Test fun overlappingTournamentGroupsAreRejected() {
        assertThrows(IllegalArgumentException::class.java) {
            json.decodeFromString<CompetitionDetailEnvelope>(
                """{"data":{"id":"$competitionId","organizationId":"organization_test_1","seasonId":"season-1","slug":"example-competition","name":"Example Competition","type":"league","logoUrl":null,"phases":[${phase(phaseId, 1, "[\"schedule\"]")},${phase("other", 2, "[\"schedule\"]")}],"currentPhaseId":"$phaseId","activePhaseIds":[],"tournamentGroups":[{"id":"$phaseId","name":"League","phaseIds":["$phaseId"],"currentPhaseId":null},{"id":"other","name":"Cup","phaseIds":["other","$phaseId"],"currentPhaseId":null}]}}""",
            ).data.toPhasesModel()
        }
    }

    @Test fun gamesPagePreservesLocalTimeStatusesScoresAndOpaqueCursor() {
        val liveUrl = "https://komobasket.gr/competitions/games/game-3/live"
        val body = """{"data":[${game("scheduled")},${game("completed", "game-2", "72")},${game("live", "game-3", url = "\"$liveUrl\"")},${game("postponed", "game-4")},${game("cancelled", "game-5")}],"meta":{"hasMore":true,"nextCursor":"opaque-page-token"}}"""
        val page = json.decodeFromString<GamesEnvelope>(body).toModel(competitionId, phaseId)
        assertEquals("opaque-page-token", page.nextCursor)
        assertEquals(listOf("scheduled", "completed", "live", "postponed", "cancelled"),
            page.games.map { it.status })
        assertNull(page.games.first().homeScore)
        assertEquals(72, page.games[1].homeScore)
        assertEquals("2026-10-17", page.games.first().scheduledDate)
        assertEquals("15:45", page.games.first().scheduledTime)
        assertTrue(scheduleLabel(page.games.first().scheduledDate,
            page.games.first().scheduledTime, Locale.ENGLISH)!!.endsWith("15:45"))
        assertEquals(liveUrl, trustedWebLiveUrl(page.games[2].status,
            page.games[2].id, page.games[2].webLiveUrl))
        assertEquals(listOf("game-1", "game-3", "game-4", "game-5"),
            visibleGames(PhaseView.Schedule, page.games).map { it.id })
        assertEquals(listOf("game-2"), visibleGames(PhaseView.Results, page.games).map { it.id })
        assertEquals("completed", statusFor(PhaseView.Results))
        assertEquals("desc", orderFor(PhaseView.Results))
        assertEquals("asc", orderFor(PhaseView.Schedule))
    }

    @Test fun standingsMapsAllAuthoritativeFieldsAndBadPageIsRejected() {
        val rows = json.decodeFromString<StandingsEnvelope>(
            """{"data":[{"rank":1,"teamId":"team-a","teamName":"Team Alpha","teamLogoUrl":null,"gamesPlayed":3,"wins":2,"losses":1,"pointsFor":210,"pointsAgainst":200,"pointDifference":10,"standingsPoints":5}]}""",
        ).data.map { it.toModel() }
        assertEquals(5, rows.single().standingsPoints)
        assertEquals(10, rows.single().pointDifference)
        assertEquals(210, rows.single().pointsFor)
        assertThrows(IllegalArgumentException::class.java) {
            json.decodeFromString<GamesEnvelope>(
                """{"data":[],"meta":{"hasMore":true,"nextCursor":null}}""",
            ).toModel(competitionId, phaseId)
        }
    }
}
