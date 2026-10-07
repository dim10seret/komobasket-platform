package gr.komobasket.app.feature.phases

import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.AppSettings
import gr.komobasket.app.core.model.Competition
import gr.komobasket.app.core.model.CompetitionContext
import gr.komobasket.app.core.model.CompetitionPhases
import gr.komobasket.app.core.model.HomeTeam
import gr.komobasket.app.core.model.Phase
import gr.komobasket.app.core.model.PhaseGame
import gr.komobasket.app.core.model.PhaseGamesPage
import gr.komobasket.app.core.model.PhaseView
import gr.komobasket.app.core.model.StandingRow
import gr.komobasket.app.data.repository.PhasesRepository
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestWatcher
import org.junit.runner.Description

@OptIn(ExperimentalCoroutinesApi::class)
class PhasesViewModelTest {
    @get:Rule val mainDispatcher = object : TestWatcher() {
        override fun starting(description: Description) { Dispatchers.setMain(StandardTestDispatcher()) }
        override fun finished(description: Description) { Dispatchers.resetMain() }
    }

    @Test fun persistedContextLoadsCurrentOrderedPhaseAndSchedule() = runTest {
        val repository = FakeRepository()
        val viewModel = PhasesViewModel(FakeContext("competition-a"), repository)
        advanceUntilIdle()
        val state = viewModel.state.value
        assertEquals("second", state.selectedPhaseId)
        assertEquals(listOf("first", "second"), state.detail!!.phases.map { it.id })
        assertTrue("second" in state.detail.activePhaseIds)
        assertEquals(PhaseView.Schedule, state.selectedView)
        assertEquals(listOf("competition-a"), repository.detailCalls)
        assertEquals(listOf("second:asc:null:null"), repository.gameCalls)
        assertEquals(listOf("scheduled"), state.games.map { it.status })
    }

    @Test fun tournamentChangeWithinCompetitionReplacesPhaseAndGamesState() = runTest {
        val context = FakeContext("competition-a")
        val repository = FakeRepository().apply {
            groups = listOf(
                gr.komobasket.app.core.model.TournamentGroup("root", "League", listOf("first"), "first"),
                gr.komobasket.app.core.model.TournamentGroup("cup", "Cup", listOf("second"), "second"),
            )
        }
        val viewModel = PhasesViewModel(context, repository)
        advanceUntilIdle()
        assertEquals(listOf("first"), viewModel.state.value.detail?.phases?.map { it.id })
        context.setTournament("cup")
        advanceUntilIdle()
        assertEquals(listOf("second"), viewModel.state.value.detail?.phases?.map { it.id })
        assertEquals("second", viewModel.state.value.selectedPhaseId)
        assertEquals(listOf("second"), viewModel.state.value.games.map { it.phaseId })
    }

    @Test fun fallbackPhaseSwitchViewSwitchAndUnsupportedStandingsGuard() = runTest {
        val repository = FakeRepository().apply { currentPhaseId = null }
        val viewModel = PhasesViewModel(FakeContext("competition-a"), repository)
        advanceUntilIdle()
        assertEquals("first", viewModel.state.value.selectedPhaseId)
        viewModel.selectPhase("second")
        advanceUntilIdle()
        assertEquals("second", viewModel.state.value.selectedPhaseId)
        assertTrue(viewModel.state.value.games.all { it.phaseId == "second" })
        viewModel.selectView(PhaseView.Standings)
        advanceUntilIdle()
        assertEquals(listOf("second"), repository.standingsCalls)
        assertEquals(1, viewModel.state.value.standings.size)
        viewModel.selectPhase("first")
        advanceUntilIdle()
        assertTrue(viewModel.state.value.standings.isEmpty())
        viewModel.selectView(PhaseView.Standings)
        advanceUntilIdle()
        assertEquals(PhaseView.Schedule, viewModel.state.value.selectedView)
        assertEquals(listOf("second"), repository.standingsCalls)
        viewModel.selectView(PhaseView.Results)
        advanceUntilIdle()
        assertEquals("first:desc:completed:null", repository.gameCalls.last())
        assertEquals(listOf("completed"), viewModel.state.value.games.map { it.status })
    }

    @Test fun paginationAppendsOnceAndErrorPreservesRowsForRetry() = runTest {
        val repository = FakeRepository().apply { firstPageHasMore = true }
        val viewModel = PhasesViewModel(FakeContext("competition-a"), repository)
        advanceUntilIdle()
        assertEquals("opaque", viewModel.state.value.nextCursor)
        repository.pageFailure = IOException("offline")
        viewModel.loadMore()
        viewModel.loadMore()
        advanceUntilIdle()
        assertEquals(2, repository.gameCalls.size)
        assertEquals(1, viewModel.state.value.games.size)
        assertEquals(PhasesFailure.NoNetwork, viewModel.state.value.paginationFailure)
        repository.pageFailure = null
        viewModel.loadMore()
        advanceUntilIdle()
        assertEquals(2, viewModel.state.value.games.size)
        assertNull(viewModel.state.value.nextCursor)
        viewModel.loadMore()
        advanceUntilIdle()
        assertEquals(3, repository.gameCalls.size)
    }

    @Test fun viewErrorRetryAndContextChangeResetAllPhaseState() = runTest {
        val context = FakeContext("competition-a")
        val repository = FakeRepository().apply { viewFailure = IOException("offline") }
        val viewModel = PhasesViewModel(context, repository)
        advanceUntilIdle()
        assertEquals(PhasesFailure.NoNetwork, viewModel.state.value.viewFailure)
        repository.viewFailure = null
        viewModel.retryView()
        advanceUntilIdle()
        assertEquals(1, viewModel.state.value.games.size)
        viewModel.selectView(PhaseView.Standings)
        advanceUntilIdle()
        context.setCompetition("competition-b")
        advanceUntilIdle()
        assertEquals("competition-b", viewModel.state.value.detail?.competition?.id)
        assertEquals(PhaseView.Schedule, viewModel.state.value.selectedView)
        assertTrue(viewModel.state.value.standings.isEmpty())
        assertEquals(listOf("competition-a", "competition-b"), repository.detailCalls)
        assertEquals("competition-b", repository.competitionIds.last())
    }

    @Test fun standingsFailureRetriesWithoutRequestingOtherViews() = runTest {
        val repository = FakeRepository().apply { standingsFailure = IOException("offline") }
        val viewModel = PhasesViewModel(FakeContext("competition-a"), repository)
        advanceUntilIdle()
        viewModel.selectView(PhaseView.Standings)
        advanceUntilIdle()
        assertEquals(PhasesFailure.NoNetwork, viewModel.state.value.viewFailure)
        assertTrue(viewModel.state.value.standings.isEmpty())
        assertEquals(1, repository.gameCalls.size)
        repository.standingsFailure = null
        viewModel.retryView()
        advanceUntilIdle()
        assertEquals(1, viewModel.state.value.standings.size)
        assertEquals(2, repository.standingsCalls.size)
        assertEquals(1, repository.gameCalls.size)
    }

    @Test fun noCompetitionNoPhasesAndDetailFailureRemainDistinct() = runTest {
        val context = FakeContext(null)
        val repository = FakeRepository()
        val viewModel = PhasesViewModel(context, repository)
        advanceUntilIdle()
        assertTrue(viewModel.state.value.noCompetition)
        assertTrue(repository.detailCalls.isEmpty())
        repository.phases = emptyList()
        context.setCompetition("competition-a")
        advanceUntilIdle()
        assertFalse(viewModel.state.value.loadingDetail)
        assertTrue(viewModel.state.value.detail!!.phases.isEmpty())
        assertNull(viewModel.state.value.selectedPhaseId)
        assertTrue(repository.gameCalls.isEmpty())
        repository.detailFailure = IllegalArgumentException("malformed")
        viewModel.retryDetail()
        advanceUntilIdle()
        assertEquals(PhasesFailure.Malformed, viewModel.state.value.detailFailure)
        repository.detailFailure = null
        viewModel.retryDetail()
        advanceUntilIdle()
        assertTrue(viewModel.state.value.detail!!.phases.isEmpty())
    }

    private class FakeRepository : PhasesRepository {
        var currentPhaseId: String? = "second"
        var phases = listOf(
            Phase("first", "First", 1, "series", "play_in", "active", false,
                listOf("matchups", "schedule", "results")),
            Phase("second", "Second", 2, "standings", "regular_season", "active", true,
                listOf("schedule", "results", "standings")),
        )
        var groups: List<gr.komobasket.app.core.model.TournamentGroup>? = null
        var firstPageHasMore = false
        var detailFailure: Exception? = null
        var viewFailure: Exception? = null
        var pageFailure: Exception? = null
        var standingsFailure: Exception? = null
        val detailCalls = mutableListOf<String>()
        val gameCalls = mutableListOf<String>()
        val competitionIds = mutableListOf<String>()
        val standingsCalls = mutableListOf<String>()

        override suspend fun competition(competitionId: String): CompetitionPhases {
            detailCalls += competitionId
            detailFailure?.let { throw it }
            return CompetitionPhases(
                Competition(competitionId, "season", "organization", competitionId,
                    "slug", "league", null), phases, currentPhaseId, setOf("second"),
                groups ?: listOf(gr.komobasket.app.core.model.TournamentGroup("root", "League",
                    phases.map { it.id }, currentPhaseId)),
            )
        }

        override suspend fun games(competitionId: String, phaseId: String, status: String?,
            order: String, cursor: String?): PhaseGamesPage {
            competitionIds += competitionId
            gameCalls += "$phaseId:$order:$status:$cursor"
            if (cursor == null) viewFailure?.let { throw it }
            else pageFailure?.let { throw it }
            val gameStatus = if (status == "completed") "completed" else "scheduled"
            return PhaseGamesPage(listOf(game(phaseId, if (cursor == null) "one" else "two",
                gameStatus)), if (cursor == null && firstPageHasMore) "opaque" else null)
        }

        override suspend fun standings(competitionId: String, phaseId: String): List<StandingRow> {
            standingsCalls += phaseId
            standingsFailure?.let { throw it }
            return listOf(StandingRow(1, "team-a", "Team A", null, 1, 1, 0,
                80, 70, 10, 2))
        }

        private fun game(phaseId: String, id: String, status: String) = PhaseGame(
            id, phaseId, 1, "Round 1", "2026-10-17", "15:45", null,
            HomeTeam("a", "A", null), HomeTeam("b", "B", null), status,
            if (status == "completed") 80 else null,
            if (status == "completed") 70 else null, null,
        )
    }

    private class FakeContext(competitionId: String?) : AppContextRepository {
        private val mutableSettings = MutableStateFlow(settingsFor(competitionId))
        override val settings = mutableSettings
        fun setCompetition(id: String?) { mutableSettings.value = settingsFor(id) }
        fun setTournament(id: String) {
            mutableSettings.value = mutableSettings.value.copy(
                context = mutableSettings.value.context.withTournament(id))
        }
        override suspend fun selectLanguage(tag: String) = Unit
        override suspend fun selectSeason(id: String) = Unit
        override suspend fun selectOrganization(id: String) = Unit
        override suspend fun selectCompetition(id: String) = Unit
        override suspend fun selectTournament(id: String) = Unit
        override suspend fun commitContext(context: CompetitionContext) = false
        override suspend fun completeOnboarding() = Unit
        private fun settingsFor(id: String?) = AppSettings(context = CompetitionContext(
            seasonId = "season", organizationId = "organization", competitionId = id,
            tournamentId = if (id == null) null else "root"))
    }
}
