package gr.komobasket.app.feature.stats

import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.AppSettings
import gr.komobasket.app.core.model.Competition
import gr.komobasket.app.core.model.CompetitionContext
import gr.komobasket.app.core.model.CompetitionPhases
import gr.komobasket.app.core.model.Phase
import gr.komobasket.app.core.model.PhaseGamesPage
import gr.komobasket.app.core.model.RankingCategory
import gr.komobasket.app.core.model.RankingEntry
import gr.komobasket.app.core.model.RankingMetric
import gr.komobasket.app.core.model.RankingsPage
import gr.komobasket.app.core.model.StandingRow
import gr.komobasket.app.data.repository.PhasesRepository
import gr.komobasket.app.data.repository.RankingsRepository
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import retrofit2.HttpException
import retrofit2.Response

@OptIn(ExperimentalCoroutinesApi::class)
class StatsViewModelTest {
    @get:Rule val mainDispatcher = object : TestWatcher() {
        override fun starting(description: Description) { Dispatchers.setMain(StandardTestDispatcher()) }
        override fun finished(description: Description) { Dispatchers.resetMain() }
    }

    @Test fun persistedCompetitionSelectsCurrentPhasePointsAndLoadsTopTenScope() = runTest {
        val phases = FakePhasesRepository()
        val rankings = FakeRankingsRepository()
        val viewModel = StatsViewModel(FakeContext("competition-a"), phases, rankings)
        advanceUntilIdle()
        val state = viewModel.state.value
        assertEquals(listOf("second"), state.selectedPhaseIds)
        assertEquals(RankingCategory.Points, state.category)
        assertEquals(listOf("competition-a"), phases.detailCalls)
        assertEquals(listOf("competition-a:second:points:null"), rankings.calls)
        assertEquals(1, state.rows.size)
        assertEquals(RankingMetric.Counting(12.0, 6.0), state.rows.single().metric)
    }

    @Test fun tournamentChangeWithinCompetitionReplacesRankingPhaseScope() = runTest {
        val context = FakeContext("competition-a")
        val phases = FakePhasesRepository().apply {
            groups = listOf(
                gr.komobasket.app.core.model.TournamentGroup("root", "League", listOf("first"), "first"),
                gr.komobasket.app.core.model.TournamentGroup("cup", "Cup", listOf("second"), "second"),
            )
        }
        val rankings = FakeRankingsRepository()
        val viewModel = StatsViewModel(context, phases, rankings)
        advanceUntilIdle()
        assertEquals(listOf("first"), viewModel.state.value.selectedPhaseIds)
        context.setTournament("cup")
        advanceUntilIdle()
        assertEquals(listOf("second"), viewModel.state.value.selectedPhaseIds)
        assertEquals(listOf("second"), viewModel.state.value.detail?.phases?.map { it.id })
        assertEquals("competition-a:second:points:null", rankings.calls.last())
    }

    @Test fun fallbackPhaseMultiSelectAndCategorySwitchResetScope() = runTest {
        val phases = FakePhasesRepository().apply { currentPhaseId = "missing" }
        val rankings = FakeRankingsRepository().apply { firstHasMore = true }
        val viewModel = StatsViewModel(FakeContext("competition-a"), phases, rankings)
        advanceUntilIdle()
        assertEquals(listOf("first"), viewModel.state.value.selectedPhaseIds)
        assertEquals("opaque", viewModel.state.value.nextCursor)
        viewModel.togglePhase("second")
        advanceUntilIdle()
        assertEquals(listOf("first", "second"), viewModel.state.value.selectedPhaseIds)
        assertEquals("competition-a:first,second:points:null", rankings.calls.last())
        viewModel.selectCategory(RankingCategory.TwoPoint)
        advanceUntilIdle()
        assertEquals(listOf("first", "second"), viewModel.state.value.selectedPhaseIds)
        assertEquals("competition-a:first,second:2pt:null", rankings.calls.last())
        assertTrue(viewModel.state.value.rows.single().metric is RankingMetric.Shooting)
        viewModel.togglePhase("first")
        advanceUntilIdle()
        assertEquals(listOf("second"), viewModel.state.value.selectedPhaseIds)
        assertEquals("competition-a:second:2pt:null", rankings.calls.last())
        val calls = rankings.calls.size
        viewModel.togglePhase("second")
        advanceUntilIdle()
        assertEquals(listOf("second"), viewModel.state.value.selectedPhaseIds)
        assertEquals(calls, rankings.calls.size)
    }

    @Test fun emptyResultIsContentAndErrorsRetryWithoutMetadataReload() = runTest {
        val rankings = FakeRankingsRepository().apply { empty = true }
        val phases = FakePhasesRepository()
        val viewModel = StatsViewModel(FakeContext("competition-a"), phases, rankings)
        advanceUntilIdle()
        assertFalse(viewModel.state.value.loadingRankings)
        assertTrue(viewModel.state.value.rows.isEmpty())
        assertNull(viewModel.state.value.rankingsFailure)
        rankings.empty = false
        rankings.firstFailure = IOException("offline")
        viewModel.refresh()
        advanceUntilIdle()
        assertEquals(StatsFailure.NoNetwork, viewModel.state.value.rankingsFailure)
        rankings.firstFailure = null
        viewModel.retryRankings()
        advanceUntilIdle()
        assertEquals(1, viewModel.state.value.rows.size)
        assertEquals(1, phases.detailCalls.size)
    }

    @Test fun paginationAppendsGuardsDuplicatesAndPreservesRowsOnFailure() = runTest {
        val rankings = FakeRankingsRepository().apply { firstHasMore = true }
        val viewModel = StatsViewModel(FakeContext("competition-a"), FakePhasesRepository(), rankings)
        advanceUntilIdle()
        rankings.pageFailure = IOException("offline")
        viewModel.loadMore()
        viewModel.loadMore()
        advanceUntilIdle()
        assertEquals(2, rankings.calls.size)
        assertEquals(1, viewModel.state.value.rows.size)
        assertEquals(StatsFailure.NoNetwork, viewModel.state.value.paginationFailure)
        rankings.pageFailure = null
        viewModel.loadMore()
        advanceUntilIdle()
        assertEquals(listOf(1, 2), viewModel.state.value.rows.map { it.rank })
        assertNull(viewModel.state.value.nextCursor)
        viewModel.loadMore()
        advanceUntilIdle()
        assertEquals(3, rankings.calls.size)
    }

    @Test fun staleCursorReloadsPageOneOnceAndResetsPagination() = runTest {
        val rankings = FakeRankingsRepository().apply {
            firstHasMore = true
            staleOnce = true
        }
        val viewModel = StatsViewModel(FakeContext("competition-a"), FakePhasesRepository(), rankings)
        advanceUntilIdle()
        viewModel.loadMore()
        advanceUntilIdle()
        assertEquals(listOf("competition-a:second:points:null",
            "competition-a:second:points:opaque", "competition-a:second:points:null"), rankings.calls)
        assertEquals(1, viewModel.state.value.rows.size)
        assertNull(viewModel.state.value.rankingsFailure)
        assertFalse(viewModel.state.value.loadingMore)
    }

    @Test fun competitionChangeNoPhasesAndDetailFailureResetState() = runTest {
        val context = FakeContext("competition-a")
        val phases = FakePhasesRepository()
        val rankings = FakeRankingsRepository()
        val viewModel = StatsViewModel(context, phases, rankings)
        advanceUntilIdle()
        viewModel.togglePhase("first")
        advanceUntilIdle()
        viewModel.selectCategory(RankingCategory.Assists)
        advanceUntilIdle()
        context.setCompetition("competition-b")
        advanceUntilIdle()
        assertEquals("competition-b", viewModel.state.value.detail?.competition?.id)
        assertEquals(listOf("second"), viewModel.state.value.selectedPhaseIds)
        assertEquals(RankingCategory.Points, viewModel.state.value.category)
        assertEquals("competition-b:second:points:null", rankings.calls.last())
        phases.phases = emptyList()
        viewModel.retryDetail()
        advanceUntilIdle()
        assertTrue(viewModel.state.value.detail!!.phases.isEmpty())
        assertTrue(viewModel.state.value.rows.isEmpty())
        assertTrue(viewModel.state.value.selectedPhaseIds.isEmpty())
        phases.failure = IllegalArgumentException("malformed")
        viewModel.retryDetail()
        advanceUntilIdle()
        assertEquals(StatsFailure.Malformed, viewModel.state.value.detailFailure)
    }

    @Test fun obsoleteCategoryRequestIsCancelledAndCannotReplaceNewCategory() = runTest {
        val rankings = FakeRankingsRepository()
        val viewModel = StatsViewModel(FakeContext("competition-a"), FakePhasesRepository(), rankings)
        advanceUntilIdle()
        val gate = CompletableDeferred<Unit>()
        rankings.blockedCategory = RankingCategory.Rebounds
        rankings.gate = gate
        viewModel.selectCategory(RankingCategory.Rebounds)
        advanceUntilIdle()
        viewModel.selectCategory(RankingCategory.Assists)
        advanceUntilIdle()
        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(RankingCategory.Assists, viewModel.state.value.category)
        assertEquals("assists", rankings.calls.last().split(':')[2])
        assertEquals(1, viewModel.state.value.rows.size)
    }

    @Test fun noCompetitionMakesNoRequestsAndSelectionRespectsBackendPhaseLimit() = runTest {
        val context = FakeContext(null)
        val phases = FakePhasesRepository().apply {
            this.phases = (1..13).map { index ->
                Phase("phase-$index", "Phase $index", index, "standings",
                    "regular_season", "active", index == 1, listOf("schedule", "results"))
            }
            currentPhaseId = "phase-1"
        }
        val rankings = FakeRankingsRepository()
        val viewModel = StatsViewModel(context, phases, rankings)
        advanceUntilIdle()
        assertTrue(viewModel.state.value.noCompetition)
        assertTrue(phases.detailCalls.isEmpty())
        context.setCompetition("competition-a")
        advanceUntilIdle()
        (2..12).forEach { viewModel.togglePhase("phase-$it") }
        advanceUntilIdle()
        assertEquals(12, viewModel.state.value.selectedPhaseIds.size)
        val calls = rankings.calls.size
        viewModel.togglePhase("phase-13")
        advanceUntilIdle()
        assertEquals(12, viewModel.state.value.selectedPhaseIds.size)
        assertEquals(calls, rankings.calls.size)
    }

    private class FakePhasesRepository : PhasesRepository {
        val detailCalls = mutableListOf<String>()
        var currentPhaseId: String? = "second"
        var phases = listOf(
            Phase("first", "First", 1, "series", "play_in", "active", false,
                listOf("schedule", "results")),
            Phase("second", "Second", 2, "standings", "regular_season", "active", true,
                listOf("schedule", "results", "standings")),
        )
        var groups: List<gr.komobasket.app.core.model.TournamentGroup>? = null
        var failure: Exception? = null
        override suspend fun competition(competitionId: String): CompetitionPhases {
            detailCalls += competitionId
            failure?.let { throw it }
            return CompetitionPhases(Competition(competitionId, "season", "organization",
                competitionId, "slug", "league", null), phases, currentPhaseId, setOf("second"),
                groups ?: listOf(gr.komobasket.app.core.model.TournamentGroup("root", "League",
                    phases.map { it.id }, currentPhaseId)))
        }
        override suspend fun games(competitionId: String, phaseId: String, status: String?,
            order: String, cursor: String?): PhaseGamesPage = error("Not called")
        override suspend fun standings(competitionId: String, phaseId: String): List<StandingRow> =
            error("Not called")
    }

    private class FakeRankingsRepository : RankingsRepository {
        val calls = mutableListOf<String>()
        var firstHasMore = false
        var empty = false
        var firstFailure: Exception? = null
        var pageFailure: Exception? = null
        var staleOnce = false
        var blockedCategory: RankingCategory? = null
        var gate: CompletableDeferred<Unit>? = null
        override suspend fun rankings(competitionId: String, phaseIds: List<String>,
            category: RankingCategory, cursor: String?): RankingsPage {
            calls += "$competitionId:${phaseIds.joinToString(",")}:${category.apiValue}:$cursor"
            if (category == blockedCategory) gate?.await()
            if (cursor == null) firstFailure?.let { throw it }
            else {
                if (staleOnce) {
                    staleOnce = false
                    throw HttpException(Response.error<Any>(409, "{}".toResponseBody()))
                }
                pageFailure?.let { throw it }
            }
            if (empty) return RankingsPage(emptyList(), null)
            val row = RankingEntry(if (cursor == null) 1 else 2,
                if (cursor == null) "player-one" else "player-two", "Player", null,
                "team", "Team", null, 2,
                if (category.isShooting) RankingMetric.Shooting(4, 6, 66.66666666666666)
                else RankingMetric.Counting(12.0, 6.0))
            return RankingsPage(listOf(row),
                if (cursor == null && firstHasMore) "opaque" else null)
        }
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
