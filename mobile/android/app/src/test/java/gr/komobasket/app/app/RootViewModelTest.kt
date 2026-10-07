package gr.komobasket.app.app

import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.AppSettings
import gr.komobasket.app.core.model.Competition
import gr.komobasket.app.core.model.CompetitionContext
import gr.komobasket.app.core.model.CompetitionPhases
import gr.komobasket.app.core.model.PhaseGamesPage
import gr.komobasket.app.core.model.StandingRow
import gr.komobasket.app.core.model.TournamentGroup
import gr.komobasket.app.data.repository.PhasesRepository
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
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestWatcher
import org.junit.runner.Description

@OptIn(ExperimentalCoroutinesApi::class)
class RootViewModelTest {
    @get:Rule val mainDispatcher = object : TestWatcher() {
        override fun starting(description: Description) { Dispatchers.setMain(StandardTestDispatcher()) }
        override fun finished(description: Description) { Dispatchers.resetMain() }
    }

    @Test
    fun serverGroupsShowSelectedNameAndBothSwitchOptions() = runTest {
        val context = FakeContext()
        val phases = FakePhases()
        val viewModel = RootViewModel(context, phases)
        advanceUntilIdle()

        val league = viewModel.tournament.value as TournamentContextState.Ready
        assertEquals("League from server", league.selected.name)
        assertEquals(listOf("League from server", "Cup from server"), league.groups.map { it.name })
        assertEquals(1, phases.calls)

        assertTrue(viewModel.switchTournament("cup"))
        advanceUntilIdle()
        val cup = viewModel.tournament.value as TournamentContextState.Ready
        assertEquals("Cup from server", cup.selected.name)
        assertEquals(listOf("League from server", "Cup from server"), cup.groups.map { it.name })
        assertEquals("season", context.settings.value.context.seasonId)
        assertEquals("organization", context.settings.value.context.organizationId)
        assertEquals("competition", context.settings.value.context.competitionId)
        assertEquals("cup", context.settings.value.context.tournamentId)
        assertEquals(1, context.tournamentWrites)
        assertEquals(1, phases.calls)
    }

    @Test
    fun currentOrUnknownTournamentDoesNotWriteOrReset() = runTest {
        val context = FakeContext()
        val viewModel = RootViewModel(context, FakePhases())
        advanceUntilIdle()
        val original = viewModel.tournament.value

        assertFalse(viewModel.switchTournament("league"))
        assertFalse(viewModel.switchTournament("unknown"))
        assertEquals(0, context.tournamentWrites)
        assertEquals(original, viewModel.tournament.value)
    }

    @Test
    fun singleServerGroupHasOnlyCurrentTournament() = runTest {
        val groups = listOf(TournamentGroup("league", "Only event", emptyList(), null))
        val viewModel = RootViewModel(FakeContext(), FakePhases(groups))
        advanceUntilIdle()
        val ready = viewModel.tournament.value as TournamentContextState.Ready
        assertEquals("Only event", ready.selected.name)
        assertEquals(1, ready.groups.size)
    }

    private class FakeContext : AppContextRepository {
        override val settings = MutableStateFlow(AppSettings(onboardingComplete = true,
            context = CompetitionContext("season", "organization", "competition", "league")))
        var tournamentWrites = 0
        override suspend fun selectTournament(id: String) {
            tournamentWrites++
            settings.value = settings.value.copy(context = settings.value.context.withTournament(id))
        }
        override suspend fun selectLanguage(tag: String) = Unit
        override suspend fun selectSeason(id: String) = Unit
        override suspend fun selectOrganization(id: String) = Unit
        override suspend fun selectCompetition(id: String) = Unit
        override suspend fun commitContext(context: CompetitionContext): Boolean = false
        override suspend fun completeOnboarding() = Unit
    }

    private class FakePhases(
        val groups: List<TournamentGroup> = listOf(
            TournamentGroup("league", "League from server", emptyList(), null),
            TournamentGroup("cup", "Cup from server", emptyList(), null),
        ),
    ) : PhasesRepository {
        var calls = 0
        override suspend fun competition(competitionId: String): CompetitionPhases {
            calls++
            return CompetitionPhases(
                Competition(competitionId, "season", "organization", "Competition", "slug", "league", null),
                emptyList(), null, emptySet(), groups,
            )
        }
        override suspend fun games(competitionId: String, phaseId: String, status: String?,
            order: String, cursor: String?): PhaseGamesPage = error("not called")
        override suspend fun standings(competitionId: String, phaseId: String): List<StandingRow> =
            error("not called")
    }
}
