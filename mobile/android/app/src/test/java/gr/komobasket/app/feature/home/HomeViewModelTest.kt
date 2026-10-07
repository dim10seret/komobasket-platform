package gr.komobasket.app.feature.home

import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.AppSettings
import gr.komobasket.app.core.model.Competition
import gr.komobasket.app.core.model.CompetitionContext
import gr.komobasket.app.core.model.CompetitionHome
import gr.komobasket.app.core.model.HomePhase
import gr.komobasket.app.core.model.HomeRound
import gr.komobasket.app.core.model.OfficialMvp
import gr.komobasket.app.core.model.OfficialMvpPerformance
import gr.komobasket.app.core.model.OfficialMvpPlayer
import gr.komobasket.app.core.model.OfficialMvpScope
import gr.komobasket.app.core.model.OfficialMvpTeam
import gr.komobasket.app.data.repository.HomeRepository
import gr.komobasket.app.data.repository.OfficialMvpRepository
import java.io.IOException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestWatcher
import org.junit.runner.Description

@OptIn(ExperimentalCoroutinesApi::class)
class HomeViewModelTest {
    @get:Rule val mainDispatcher = object : TestWatcher() {
        override fun starting(description: Description) { Dispatchers.setMain(StandardTestDispatcher()) }
        override fun finished(description: Description) { Dispatchers.resetMain() }
    }

    @Test
    fun initialLoadingBecomesContentFromPersistedCompetition() = runTest {
        val context = FakeContextRepository("competition-a")
        val repository = FakeHomeRepository()
        val viewModel = HomeViewModel(context, repository, FakeMvpRepository())

        assertEquals(HomeUiState.Loading, viewModel.state.value)
        advanceUntilIdle()
        assertEquals("competition-a", (viewModel.state.value as HomeUiState.Content).home.competition.id)
        assertEquals(listOf("competition-a"), repository.calls)
    }

    @Test
    fun networkFailureShowsSafeErrorAndRetryRecovers() = runTest {
        val repository = FakeHomeRepository().apply { failure = IOException("private transport detail") }
        val viewModel = HomeViewModel(FakeContextRepository("competition-a"), repository,
            FakeMvpRepository())

        advanceUntilIdle()
        assertEquals(HomeUiState.NoNetwork, viewModel.state.value)
        repository.failure = null
        viewModel.retry()
        assertEquals(HomeUiState.Loading, viewModel.state.value)
        advanceUntilIdle()
        assertTrue(viewModel.state.value is HomeUiState.Content)
        assertEquals(2, repository.calls.size)
    }

    @Test
    fun emptySectionsRemainValidContent() = runTest {
        val viewModel = HomeViewModel(FakeContextRepository("competition-a"), FakeHomeRepository(),
            FakeMvpRepository())
        advanceUntilIdle()
        val content = viewModel.state.value as HomeUiState.Content
        assertFalse(content.home.hasSportsContent)
        assertEquals(null, content.home.standingsPreview)
    }

    @Test
    fun missingContextCanRecoverWithoutARequest() = runTest {
        val repository = FakeHomeRepository()
        val viewModel = HomeViewModel(FakeContextRepository(null), repository, FakeMvpRepository())
        advanceUntilIdle()
        assertEquals(HomeUiState.NoActiveCompetition, viewModel.state.value)
        viewModel.retry()
        assertEquals(HomeUiState.NoActiveCompetition, viewModel.state.value)
        assertTrue(repository.calls.isEmpty())
    }

    @Test
    fun competitionChangeReplacesHomeAndReloadsOnlyNewId() = runTest {
        val context = FakeContextRepository("competition-a")
        val repository = FakeHomeRepository()
        val viewModel = HomeViewModel(context, repository, FakeMvpRepository())
        advanceUntilIdle()
        context.setCompetition("competition-b")
        advanceUntilIdle()

        assertEquals("competition-b", (viewModel.state.value as HomeUiState.Content).home.competition.id)
        assertEquals(listOf("competition-a", "competition-b"), repository.calls)
    }

    @Test fun tournamentChangeReloadsHomeAndClearsPreviousMvp() = runTest {
        val context = FakeContextRepository("competition-a")
        val home = FakeHomeRepository().apply { phaseId = "phase-a"; round = 3 }
        val mvp = FakeMvpRepository().apply { result = selection("competition-a", "phase-a", 3) }
        val viewModel = HomeViewModel(context, home, mvp)
        advanceUntilIdle()
        assertEquals("player-a", (viewModel.state.value as HomeUiState.Content).officialMvp?.player?.id)
        home.phaseId = null
        context.setTournament("cup")
        advanceUntilIdle()
        assertEquals(listOf("root", "cup"), home.tournamentScopes)
        assertEquals(null, (viewModel.state.value as HomeUiState.Content).officialMvp)
    }

    @Test fun validA3StandingsScopeRequestsOnlyOneC1AndShowsStoredChoice() = runTest {
        val home = FakeHomeRepository().apply { phaseId = "phase-a"; round = 3 }
        val mvp = FakeMvpRepository().apply { result = selection("competition-a", "phase-a", 3) }
        val vm = HomeViewModel(FakeContextRepository("competition-a"), home, mvp)
        advanceUntilIdle()
        assertEquals(listOf(OfficialMvpScope("competition-a", "phase-a", 3)), mvp.calls)
        assertEquals("player-a", (vm.state.value as HomeUiState.Content).officialMvp?.player?.id)
    }

    @Test fun missingPhaseRoundOrStandingsFormatNeverCallsC1() = runTest {
        val mvp = FakeMvpRepository()
        val noPhase = FakeHomeRepository().apply { round = 3 }
        HomeViewModel(FakeContextRepository("competition-a"), noPhase, mvp)
        advanceUntilIdle()
        val noRound = FakeHomeRepository().apply { phaseId = "phase-a" }
        HomeViewModel(FakeContextRepository("competition-a"), noRound, mvp)
        advanceUntilIdle()
        val series = FakeHomeRepository().apply { phaseId = "phase-a"; round = 3; format = "series" }
        HomeViewModel(FakeContextRepository("competition-a"), series, mvp)
        advanceUntilIdle()
        assertTrue(mvp.calls.isEmpty())
    }

    @Test fun nullSelectionOmitsCardAndC1FailureLeavesHomeUsable() = runTest {
        val home = FakeHomeRepository().apply { phaseId = "phase-a"; round = 3 }
        val mvp = FakeMvpRepository()
        val vm = HomeViewModel(FakeContextRepository("competition-a"), home, mvp)
        advanceUntilIdle()
        assertEquals(null, (vm.state.value as HomeUiState.Content).officialMvp)
        mvp.failure = IOException("private")
        vm.retry()
        advanceUntilIdle()
        assertTrue(vm.state.value is HomeUiState.Content)
        assertEquals(null, (vm.state.value as HomeUiState.Content).officialMvp)
    }

    @Test fun refreshRequeriesSameScopeAndDropsOldSelectionWhenRoundChanges() = runTest {
        val home = FakeHomeRepository().apply { phaseId = "phase-a"; round = 3 }
        val mvp = FakeMvpRepository().apply { result = selection("competition-a", "phase-a", 3) }
        val vm = HomeViewModel(FakeContextRepository("competition-a"), home, mvp)
        advanceUntilIdle()
        vm.retry()
        advanceUntilIdle()
        assertEquals(listOf(3, 3), mvp.calls.map { it.round })
        home.round = 4
        mvp.result = null
        vm.retry()
        advanceUntilIdle()
        assertEquals(listOf(3, 3, 4), mvp.calls.map { it.round })
        assertEquals(null, (vm.state.value as HomeUiState.Content).officialMvp)
    }

    @Test fun competitionChangeClearsOldMvpAndObsoleteC1CannotRestoreIt() = runTest {
        val context = FakeContextRepository("competition-a")
        val home = FakeHomeRepository().apply { phaseId = "phase-a"; round = 3 }
        val mvp = FakeMvpRepository().apply { result = selection("competition-a", "phase-a", 3) }
        val vm = HomeViewModel(context, home, mvp)
        advanceUntilIdle()
        val pending = CompletableDeferred<OfficialMvp?>()
        mvp.pending = pending
        vm.retry()
        runCurrent()
        context.setCompetition("competition-b")
        mvp.pending = null
        mvp.result = null
        runCurrent()
        pending.complete(selection("competition-a", "phase-a", 3))
        advanceUntilIdle()
        val content = vm.state.value as HomeUiState.Content
        assertEquals("competition-b", content.home.competition.id)
        assertEquals(null, content.officialMvp)
        assertEquals("competition-b", mvp.calls.last().competitionId)
    }

    private fun selection(competitionId: String, phaseId: String, round: Int) = OfficialMvp(
        "selection-a", "2027-10-03T11:00:00Z", competitionId, phaseId, round,
        "game-a", OfficialMvpPlayer("player-a", "Player", null),
        OfficialMvpTeam("team-a", "Team", null), OfficialMvpPerformance(12, 5, 3, 14))

    private class FakeHomeRepository : HomeRepository {
        val calls = mutableListOf<String>()
        val tournamentScopes = mutableListOf<String>()
        var failure: IOException? = null
        var phaseId: String? = null
        var round: Int? = null
        var format = "standings"
        override suspend fun home(competitionId: String, tournamentId: String): CompetitionHome {
            calls += competitionId
            tournamentScopes += tournamentId
            failure?.let { throw it }
            return CompetitionHome(
                competition = Competition(competitionId, "season", "organization", competitionId,
                    "slug", "league", null),
                currentPhase = phaseId?.let { HomePhase(it, "Phase", format) },
                currentRound = round?.let { HomeRound(it, "Round") },
                liveGames = emptyList(),
                upcomingGames = emptyList(),
                recentResults = emptyList(),
                standingsPreview = null,
                currentPhaseId = phaseId,
            )
        }
    }

    private class FakeMvpRepository : OfficialMvpRepository {
        val calls = mutableListOf<OfficialMvpScope>()
        var result: OfficialMvp? = null
        var failure: Exception? = null
        var pending: CompletableDeferred<OfficialMvp?>? = null
        override suspend fun current(scope: OfficialMvpScope): OfficialMvp? {
            calls += scope
            failure?.let { throw it }
            return pending?.await() ?: result
        }
    }

    private class FakeContextRepository(competitionId: String?) : AppContextRepository {
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
