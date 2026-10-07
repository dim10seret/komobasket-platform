package gr.komobasket.app.feature.teams

import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.AppSettings
import gr.komobasket.app.core.model.CompetitionContext
import gr.komobasket.app.core.model.CompetitionTeam
import gr.komobasket.app.data.repository.TeamsRepository
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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestWatcher
import org.junit.runner.Description

@OptIn(ExperimentalCoroutinesApi::class)
class TeamsViewModelTest {
    @get:Rule val mainDispatcher = object : TestWatcher() {
        override fun starting(description: Description) { Dispatchers.setMain(StandardTestDispatcher()) }
        override fun finished(description: Description) { Dispatchers.resetMain() }
    }

    @Test fun initialLoadUsesPersistedCompetitionAndPreservesOrder() = runTest {
        val repository = FakeTeamsRepository()
        val viewModel = TeamsViewModel(FakeContextRepository("competition-a"), repository)
        assertEquals(TeamsUiState.Loading, viewModel.state.value)
        advanceUntilIdle()
        assertEquals(listOf("team-z", "team-a"),
            (viewModel.state.value as TeamsUiState.Content).teams.map { it.id })
        assertEquals(listOf("competition-a"), repository.calls)
    }

    @Test fun emptyIsValidAndCanRefresh() = runTest {
        val repository = FakeTeamsRepository().apply { result = emptyList() }
        val viewModel = TeamsViewModel(FakeContextRepository("competition-a"), repository)
        advanceUntilIdle()
        assertEquals(TeamsUiState.Empty, viewModel.state.value)
        repository.result = listOf(CompetitionTeam("team-new", "New", null))
        viewModel.refresh()
        advanceUntilIdle()
        assertEquals("team-new", (viewModel.state.value as TeamsUiState.Content).teams.single().id)
    }

    @Test fun failureAndRetryUseSafeState() = runTest {
        val repository = FakeTeamsRepository().apply { failure = IOException("private transport detail") }
        val viewModel = TeamsViewModel(FakeContextRepository("competition-a"), repository)
        advanceUntilIdle()
        assertEquals(TeamsUiState.NoNetwork, viewModel.state.value)
        repository.failure = null
        viewModel.refresh()
        advanceUntilIdle()
        assertTrue(viewModel.state.value is TeamsUiState.Content)
        assertEquals(2, repository.calls.size)
    }

    @Test fun missingCompetitionMakesNoSportsRequest() = runTest {
        val repository = FakeTeamsRepository()
        val viewModel = TeamsViewModel(FakeContextRepository(null), repository)
        advanceUntilIdle()
        assertEquals(TeamsUiState.NoActiveCompetition, viewModel.state.value)
        viewModel.refresh()
        assertTrue(repository.calls.isEmpty())
    }

    @Test fun competitionChangeClearsOldContentAndIgnoresCancelledResponse() = runTest {
        val context = FakeContextRepository("competition-a")
        val repository = FakeTeamsRepository()
        val viewModel = TeamsViewModel(context, repository)
        advanceUntilIdle()
        val gate = CompletableDeferred<List<CompetitionTeam>>()
        repository.pending = gate
        viewModel.refresh()
        runCurrent()
        assertTrue((viewModel.state.value as TeamsUiState.Content).refreshing)
        repository.pending = null
        context.setCompetition("competition-b")
        runCurrent()
        gate.complete(listOf(CompetitionTeam("stale", "Stale", null)))
        advanceUntilIdle()
        val content = viewModel.state.value as TeamsUiState.Content
        assertEquals(listOf("team-z", "team-a"), content.teams.map { it.id })
        assertEquals(listOf("competition-a", "competition-a", "competition-b"), repository.calls)
    }

    private class FakeTeamsRepository : TeamsRepository {
        val calls = mutableListOf<String>()
        var result = listOf(CompetitionTeam("team-z", "Zeta", null), CompetitionTeam("team-a", "Alpha", null))
        var failure: IOException? = null
        var pending: CompletableDeferred<List<CompetitionTeam>>? = null
        override suspend fun teams(competitionId: String): List<CompetitionTeam> {
            calls += competitionId
            failure?.let { throw it }
            return pending?.await() ?: result
        }
    }

    private class FakeContextRepository(competitionId: String?) : AppContextRepository {
        private val mutableSettings = MutableStateFlow(settingsFor(competitionId))
        override val settings = mutableSettings
        fun setCompetition(id: String?) { mutableSettings.value = settingsFor(id) }
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
