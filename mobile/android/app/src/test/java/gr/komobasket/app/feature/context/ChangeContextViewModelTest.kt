package gr.komobasket.app.feature.context

import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.AppSettings
import gr.komobasket.app.core.model.Competition
import gr.komobasket.app.core.model.CompetitionContext
import gr.komobasket.app.core.model.CompetitionPhases
import gr.komobasket.app.core.model.Organization
import gr.komobasket.app.core.model.PhaseGamesPage
import gr.komobasket.app.core.model.Season
import gr.komobasket.app.core.model.StandingRow
import gr.komobasket.app.core.model.TournamentGroup
import gr.komobasket.app.data.repository.CatalogueRepository
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
class ChangeContextViewModelTest {
    @get:Rule val mainDispatcher = object : TestWatcher() {
        override fun starting(description: Description) { Dispatchers.setMain(StandardTestDispatcher()) }
        override fun finished(description: Description) { Dispatchers.resetMain() }
    }

    @Test
    fun draftAndSearchNeverChangeActiveContextUntilApply() = runTest {
        val active = FakeContext()
        val viewModel = ChangeContextViewModel(FakeCatalogue(), FakePhases(), active)
        val original = active.settings.value.context
        viewModel.start()
        advanceUntilIdle()
        viewModel.select("new-season")
        advanceUntilIdle()
        viewModel.searchOrganizations("αθηνα")
        assertEquals(listOf("new-org"), viewModel.state.value.visibleOptions.map { it.id })
        assertEquals(original, active.settings.value.context)
        viewModel.select("new-org")
        advanceUntilIdle()
        viewModel.select("new-comp")
        advanceUntilIdle()
        assertEquals(listOf("root-a", "root-b"), viewModel.state.value.visibleOptions.map { it.id })
        viewModel.select("root-b")
        assertEquals(ContextStep.Confirm, viewModel.state.value.step)
        assertEquals(original, active.settings.value.context)
        assertEquals(0, active.commits)

        assertTrue(viewModel.commit())
        assertEquals(1, active.commits)
        assertEquals(CompetitionContext("new-season", "new-org", "new-comp", "root-b"),
            active.settings.value.context)
    }

    @Test
    fun backOrCancelLeavesActiveSelectionIntact() = runTest {
        val active = FakeContext()
        val viewModel = ChangeContextViewModel(FakeCatalogue(), FakePhases(), active)
        viewModel.start()
        advanceUntilIdle()
        viewModel.select("new-season")
        advanceUntilIdle()
        assertTrue(viewModel.back())
        advanceUntilIdle()
        assertEquals(ContextStep.Season, viewModel.state.value.step)
        assertFalse(viewModel.back())
        assertEquals(0, active.commits)
        assertEquals("old-root", active.settings.value.context.tournamentId)
    }

    private class FakeContext : AppContextRepository {
        override val settings = MutableStateFlow(AppSettings(onboardingComplete = true,
            context = CompetitionContext("old-season", "old-org", "old-comp", "old-root")))
        var commits = 0
        override suspend fun commitContext(context: CompetitionContext): Boolean {
            commits++
            settings.value = settings.value.copy(context = context)
            return true
        }
        override suspend fun selectLanguage(tag: String) = Unit
        override suspend fun selectSeason(id: String) = Unit
        override suspend fun selectOrganization(id: String) = Unit
        override suspend fun selectCompetition(id: String) = Unit
        override suspend fun selectTournament(id: String) = Unit
        override suspend fun completeOnboarding() = Unit
    }

    private class FakeCatalogue : CatalogueRepository {
        override suspend fun seasons() = listOf(Season("new-season", "New season", "2027-01-01", null))
        override suspend fun organizations(seasonId: String) = listOf(
            Organization("new-org", "Αθήνα Basket", "athina", null),
            Organization("other-org", "Θεσσαλονίκη", "thessaloniki", null),
        )
        override suspend fun competitions(seasonId: String, organizationId: String) = listOf(
            Competition("new-comp", seasonId, organizationId, "New competition", "new", "league", null),
        )
    }

    private class FakePhases : PhasesRepository {
        override suspend fun competition(competitionId: String) = CompetitionPhases(
            Competition(competitionId, "new-season", "new-org", "New competition", "new", "league", null),
            emptyList(), null, emptySet(), listOf(
                TournamentGroup("root-a", "Event A", emptyList(), null),
                TournamentGroup("root-b", "Event B", emptyList(), null),
            ),
        )
        override suspend fun games(competitionId: String, phaseId: String, status: String?,
            order: String, cursor: String?): PhaseGamesPage = error("not called")
        override suspend fun standings(competitionId: String, phaseId: String): List<StandingRow> =
            error("not called")
    }
}
