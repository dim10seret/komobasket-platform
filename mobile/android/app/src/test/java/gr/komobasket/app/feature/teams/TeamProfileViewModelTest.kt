package gr.komobasket.app.feature.teams

import androidx.lifecycle.SavedStateHandle
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.AppSettings
import gr.komobasket.app.core.model.Competition
import gr.komobasket.app.core.model.CompetitionContext
import gr.komobasket.app.core.model.CompetitionPhases
import gr.komobasket.app.core.model.Phase
import gr.komobasket.app.core.model.PhaseGame
import gr.komobasket.app.core.model.StandingRow
import gr.komobasket.app.core.model.TeamProfile
import gr.komobasket.app.core.model.TeamRosterPlayer
import gr.komobasket.app.core.model.TeamStatistics
import gr.komobasket.app.core.model.TeamStatisticsLine
import gr.komobasket.app.core.model.TeamShooting
import gr.komobasket.app.core.model.TeamShot
import gr.komobasket.app.data.repository.PhasesRepository
import gr.komobasket.app.data.repository.TeamProfileRepository
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
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
class TeamProfileViewModelTest {
    @get:Rule val mainDispatcher = object : TestWatcher() {
        override fun starting(description: Description) { Dispatchers.setMain(StandardTestDispatcher()) }
        override fun finished(description: Description) { Dispatchers.resetMain() }
    }

    private fun viewModel(context: FakeContext = FakeContext("competition-a"),
        repo: FakeProfile = FakeProfile(), phases: FakePhases = FakePhases(),
        teamId: String = "team-a") = TeamProfileViewModel(
        SavedStateHandle(mapOf("teamId" to teamId)), context, phases, repo)

    @Test fun initialDetailLoadsOnlyDetailAndPreservesEmptyRosterAndNullStanding() = runTest {
        val repo = FakeProfile()
        val vm = viewModel(repo = repo)
        advanceUntilIdle()
        assertEquals("team-a", vm.state.value.detail?.id)
        assertTrue(vm.state.value.detail!!.roster.isEmpty())
        assertNull(vm.state.value.detail!!.standing)
        assertEquals(listOf("detail"), repo.calls)
        assertEquals(TeamProfileSection.Overview, vm.state.value.section)
    }

    @Test fun tournamentChangeInvalidatesOpenTeamProfile() = runTest {
        val context = FakeContext("competition-a")
        val vm = viewModel(context = context)
        advanceUntilIdle()
        assertEquals("team-a", vm.state.value.detail?.id)
        context.setTournament("cup")
        advanceUntilIdle()
        assertTrue(vm.state.value.contextChanged)
        assertNull(vm.state.value.detail)
    }

    @Test fun detailFailureRetriesWithoutLoadingSections() = runTest {
        val repo = FakeProfile().apply { detailFailure = IOException("private") }
        val vm = viewModel(repo = repo)
        advanceUntilIdle()
        assertEquals(TeamProfileFailure.NoNetwork, vm.state.value.detailFailure)
        repo.detailFailure = null
        vm.retryDetail()
        advanceUntilIdle()
        assertEquals("team-a", vm.state.value.detail?.id)
        assertEquals(listOf("detail", "detail"), repo.calls)
    }

    @Test fun statsLazyLoadsPhasesThenCurrentPhaseAndSupportsMultiplePhases() = runTest {
        val repo = FakeProfile()
        val phases = FakePhases()
        val vm = viewModel(repo = repo, phases = phases)
        advanceUntilIdle()
        assertEquals(listOf("detail"), repo.calls)
        assertEquals(0, phases.calls)
        vm.selectSection(TeamProfileSection.Stats)
        advanceUntilIdle()
        assertEquals(1, phases.calls)
        assertEquals(listOf("phase-b"), vm.state.value.selectedPhaseIds)
        assertEquals(listOf("phase-b"), repo.scopes.single())
        vm.togglePhase("phase-a")
        advanceUntilIdle()
        assertEquals(listOf("phase-a", "phase-b"), vm.state.value.selectedPhaseIds)
        assertEquals(listOf("phase-a", "phase-b"), repo.scopes.last())
        vm.togglePhase("phase-a")
        vm.togglePhase("phase-b")
        advanceUntilIdle()
        assertEquals(listOf("phase-b"), vm.state.value.selectedPhaseIds)
        assertFalse(vm.state.value.loadingStatistics)
    }

    @Test fun teamCurrentPhaseWinsAndMissingCurrentFallsBackToFirstPublicPhase() = runTest {
        val repo = FakeProfile().apply { currentPhaseId = "phase-a" }
        val vm = viewModel(repo = repo)
        advanceUntilIdle()
        vm.selectSection(TeamProfileSection.Stats)
        advanceUntilIdle()
        assertEquals(listOf("phase-a"), vm.state.value.selectedPhaseIds)
        val fallback = viewModel(repo = FakeProfile().apply { currentPhaseId = "unknown" },
            phases = FakePhases().apply { currentPhaseId = null })
        advanceUntilIdle()
        fallback.selectSection(TeamProfileSection.Stats)
        advanceUntilIdle()
        assertEquals(listOf("phase-a"), fallback.state.value.selectedPhaseIds)
    }

    @Test fun statsFailureDoesNotDestroyDetailAndRetryRecovers() = runTest {
        val repo = FakeProfile().apply { statsFailure = IOException("private") }
        val vm = viewModel(repo = repo)
        advanceUntilIdle()
        vm.selectSection(TeamProfileSection.Stats)
        advanceUntilIdle()
        assertEquals(TeamProfileFailure.NoNetwork, vm.state.value.statisticsFailure)
        assertEquals("team-a", vm.state.value.detail?.id)
        repo.statsFailure = null
        vm.retryStatistics()
        advanceUntilIdle()
        assertEquals(0, vm.state.value.statistics?.gamesPlayed)
    }

    @Test fun gamesLoadIndependentlyAndOneFailureDoesNotClearOther() = runTest {
        val repo = FakeProfile().apply { recentFailure = IOException("private") }
        val vm = viewModel(repo = repo)
        advanceUntilIdle()
        vm.selectSection(TeamProfileSection.Games)
        advanceUntilIdle()
        assertTrue(vm.state.value.upcomingLoaded)
        assertEquals(1, vm.state.value.upcoming.size)
        assertEquals(TeamProfileFailure.NoNetwork, vm.state.value.recentFailure)
        assertEquals("team-a", vm.state.value.detail?.id)
        repo.recentFailure = null
        vm.retryRecent()
        advanceUntilIdle()
        assertTrue(vm.state.value.recentLoaded)
        assertEquals(1, vm.state.value.recent.size)
        assertEquals(listOf("detail", "upcoming", "recent", "recent"), repo.calls)
    }

    @Test fun missingOrInvalidSelectionNeverRequestsProfile() = runTest {
        val repo = FakeProfile()
        val noCompetition = viewModel(context = FakeContext(null), repo = repo)
        advanceUntilIdle()
        assertTrue(noCompetition.state.value.noCompetition)
        val invalidTeam = viewModel(repo = repo, teamId = "bad/id")
        advanceUntilIdle()
        assertTrue(invalidTeam.state.value.invalidTeam)
        assertTrue(repo.calls.isEmpty())
    }

    @Test fun competitionChangeInvalidatesProfileAndCancelsOldWork() = runTest {
        val context = FakeContext("competition-a")
        val repo = FakeProfile()
        val vm = viewModel(context = context, repo = repo)
        advanceUntilIdle()
        val pending = CompletableDeferred<TeamStatistics>()
        repo.pendingStats = pending
        vm.selectSection(TeamProfileSection.Stats)
        runCurrent()
        context.set("competition-b")
        runCurrent()
        assertTrue(vm.state.value.contextChanged)
        assertNull(vm.state.value.detail)
        pending.complete(repo.stats("competition-a", "team-a", listOf("phase-b")))
        advanceUntilIdle()
        assertTrue(vm.state.value.contextChanged)
        vm.retryDetail()
        vm.selectSection(TeamProfileSection.Games)
        advanceUntilIdle()
        assertEquals(listOf("detail"), repo.calls.filter { it == "detail" })
    }

    @Test fun separateTeamDestinationUsesOnlyItsCanonicalId() = runTest {
        val repo = FakeProfile()
        val first = viewModel(repo = repo, teamId = "team-a")
        advanceUntilIdle()
        val second = viewModel(repo = repo, teamId = "team-b")
        advanceUntilIdle()
        assertEquals("team-a", first.state.value.detail?.id)
        assertEquals("team-b", second.state.value.detail?.id)
        assertEquals(listOf("team-a", "team-b"), repo.teamIds)
    }

    private class FakeContext(id: String?) : AppContextRepository {
        private val mutableSettings = MutableStateFlow(settingsFor(id))
        override val settings = mutableSettings
        fun set(id: String?) { mutableSettings.value = settingsFor(id) }
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
            seasonId = "season", organizationId = "org", competitionId = id,
            tournamentId = if (id == null) null else "root"))
    }

    private class FakePhases : PhasesRepository {
        var calls = 0
        var currentPhaseId: String? = "phase-b"
        override suspend fun competition(competitionId: String): CompetitionPhases {
            calls++
            return CompetitionPhases(
                competition = Competition(competitionId, "season", "org", "League", "slug", "league", null),
                phases = listOf(phase("phase-a"), phase("phase-b")),
                currentPhaseId = currentPhaseId, activePhaseIds = setOf("phase-b"),
                tournamentGroups = listOf(gr.komobasket.app.core.model.TournamentGroup(
                    "root", "League", listOf("phase-a", "phase-b"), currentPhaseId)))
        }
        override suspend fun games(competitionId: String, phaseId: String, status: String?,
            order: String, cursor: String?) = error("not called")
        override suspend fun standings(competitionId: String, phaseId: String): List<StandingRow> =
            error("not called")
        private fun phase(id: String) = Phase(id, id, 1, "standings", "regular", "active",
            id == "phase-b", listOf("schedule"))
    }

    private class FakeProfile : TeamProfileRepository {
        val calls = mutableListOf<String>()
        val teamIds = mutableListOf<String>()
        val scopes = mutableListOf<List<String>>()
        var detailFailure: IOException? = null
        var statsFailure: IOException? = null
        var recentFailure: IOException? = null
        var pendingStats: CompletableDeferred<TeamStatistics>? = null
        var currentPhaseId: String? = "phase-b"
        override suspend fun detail(competitionId: String, teamId: String, tournamentId: String): TeamProfile {
            calls += "detail"
            teamIds += teamId
            detailFailure?.let { throw it }
            return TeamProfile(teamId, competitionId, "Team", null, currentPhaseId, null, emptyList())
        }
        override suspend fun statistics(competitionId: String, teamId: String,
            phaseIds: List<String>): TeamStatistics {
            calls += "statistics"
            scopes += phaseIds
            statsFailure?.let { throw it }
            return pendingStats?.await() ?: stats(competitionId, teamId, phaseIds)
        }
        fun stats(competitionId: String, teamId: String, phaseIds: List<String>): TeamStatistics {
            val line = TeamStatisticsLine(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
            return TeamStatistics(teamId, competitionId, phaseIds, 0, line, line,
                TeamShooting(TeamShot(0, 0, null), TeamShot(0, 0, null), TeamShot(0, 0, null)))
        }
        override suspend fun upcoming(competitionId: String, teamId: String, tournamentId: String): List<PhaseGame> {
            calls += "upcoming"
            return listOf(game("scheduled"))
        }
        override suspend fun recent(competitionId: String, teamId: String, tournamentId: String): List<PhaseGame> {
            calls += "recent"
            recentFailure?.let { throw it }
            return listOf(game("completed"))
        }
        private fun game(status: String) = PhaseGame(status, "phase-b", null, null,
            "2026-10-25", "15:45", null,
            gr.komobasket.app.core.model.HomeTeam("team-a", "Team", null),
            gr.komobasket.app.core.model.HomeTeam("team-b", "Other", null),
            status, null, null, null)
    }
}
