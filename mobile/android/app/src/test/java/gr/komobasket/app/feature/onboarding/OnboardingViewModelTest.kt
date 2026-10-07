package gr.komobasket.app.feature.onboarding

import androidx.lifecycle.ViewModel
import gr.komobasket.app.core.common.CatalogueLoadState
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.AppSettings
import gr.komobasket.app.core.model.Competition
import gr.komobasket.app.core.model.Organization
import gr.komobasket.app.core.model.Season
import gr.komobasket.app.core.model.CompetitionPhases
import gr.komobasket.app.core.model.Phase
import gr.komobasket.app.core.model.PhaseGamesPage
import gr.komobasket.app.core.model.StandingRow
import gr.komobasket.app.core.model.TournamentGroup
import gr.komobasket.app.data.repository.CatalogueRepository
import gr.komobasket.app.data.repository.PhasesRepository
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TestWatcher
import org.junit.runner.Description

@OptIn(ExperimentalCoroutinesApi::class)
class OnboardingViewModelTest {
    @get:Rule val mainDispatcher = object : TestWatcher() {
        override fun starting(description: Description) { Dispatchers.setMain(StandardTestDispatcher()) }
        override fun finished(description: Description) { Dispatchers.resetMain() }
    }

    @Test
    fun seasonsSuccessProducesSelectableOptions() = runTest {
        val repository = FakeCatalogueRepository()
        repository.seasonValues = listOf(Season("s", "Example Season", "2026-10-01", null))
        val viewModel = OnboardingViewModel(repository, FakeContextRepository(), FakePhasesRepository())

        viewModel.loadSeasons()
        advanceUntilIdle()

        assertEquals(CatalogueLoadState.Ready(listOf(SelectionOption("s", "Example Season"))), viewModel.catalogue.value)
    }

    @Test
    fun networkFailureHasSafeStateAndRetryCanRecover() = runTest {
        val repository = FakeCatalogueRepository()
        repository.failure = IOException("private transport detail")
        val viewModel = OnboardingViewModel(repository, FakeContextRepository(), FakePhasesRepository())

        viewModel.loadSeasons()
        advanceUntilIdle()
        assertEquals(CatalogueLoadState.NoNetwork, viewModel.catalogue.value)

        repository.failure = null
        repository.seasonValues = listOf(Season("s", "Season 2027–28", "2027-09-01", null))
        viewModel.loadSeasons()
        advanceUntilIdle()
        assertEquals(CatalogueLoadState.Ready(listOf(SelectionOption("s", "Season 2027–28"))), viewModel.catalogue.value)
    }

    @Test
    fun multipleTournamentsRequireSelectionAndPersistCup() = runTest {
        val context = FakeContextRepository()
        context.selectSeason("season")
        context.selectOrganization("organization")
        context.selectCompetition("competition-a")
        val viewModel = OnboardingViewModel(FakeCatalogueRepository(), context, FakePhasesRepository())

        viewModel.loadTournaments("competition-a", null)
        advanceUntilIdle()
        val options = (viewModel.tournament.value as TournamentGateState.Selection).options
        assertEquals(listOf("league", "cup"), options.map { it.id })
        assertEquals(false, context.settings.value.onboardingComplete)
        assertEquals(true, viewModel.selectTournament("cup"))
        assertEquals("cup", context.settings.value.context.tournamentId)
        assertEquals(true, context.settings.value.onboardingComplete)
    }

    @Test
    fun savedCupRestoresAndInvalidSavedRootRequiresRecovery() = runTest {
        val context = FakeContextRepository()
        context.selectSeason("season")
        context.selectOrganization("organization")
        context.selectCompetition("competition-a")
        context.selectTournament("cup")
        context.completeOnboarding()
        val viewModel = OnboardingViewModel(FakeCatalogueRepository(), context, FakePhasesRepository())
        viewModel.loadTournaments("competition-a", "cup")
        advanceUntilIdle()
        assertEquals(TournamentGateState.Validated, viewModel.tournament.value)

        context.selectTournament("removed-root")
        viewModel.loadTournaments("competition-a", "removed-root")
        advanceUntilIdle()
        assertEquals(listOf("league", "cup"),
            (viewModel.tournament.value as TournamentGateState.Selection).options.map { it.id })
        assertEquals("removed-root", context.settings.value.context.tournamentId)
    }

    @Test
    fun oneTournamentCanAutoSelectForLegacyThreeIdContext() = runTest {
        val context = FakeContextRepository()
        context.selectSeason("season")
        context.selectOrganization("organization")
        context.selectCompetition("competition-a")
        val phases = FakePhasesRepository().apply { groups = groups.take(1) }
        val viewModel = OnboardingViewModel(FakeCatalogueRepository(), context, phases)
        viewModel.loadTournaments("competition-a", null)
        advanceUntilIdle()
        assertEquals(TournamentGateState.Validated, viewModel.tournament.value)
        assertEquals("league", context.settings.value.context.tournamentId)
    }

    private class FakeCatalogueRepository : CatalogueRepository {
        var seasonValues: List<Season> = emptyList()
        var failure: IOException? = null
        override suspend fun seasons(): List<Season> = failure?.let { throw it } ?: seasonValues
        override suspend fun organizations(seasonId: String): List<Organization> = emptyList()
        override suspend fun competitions(seasonId: String, organizationId: String): List<Competition> = emptyList()
    }

    private class FakeContextRepository : AppContextRepository {
        private val mutableSettings = MutableStateFlow(AppSettings())
        override val settings = mutableSettings.asStateFlow()
        override suspend fun selectLanguage(tag: String) { mutableSettings.value = mutableSettings.value.copy(languageTag = tag) }
        override suspend fun selectSeason(id: String) { mutableSettings.value = mutableSettings.value.copy(context = mutableSettings.value.context.withSeason(id)) }
        override suspend fun selectOrganization(id: String) { mutableSettings.value = mutableSettings.value.copy(context = mutableSettings.value.context.withOrganization(id)) }
        override suspend fun selectCompetition(id: String) { mutableSettings.value = mutableSettings.value.copy(context = mutableSettings.value.context.withCompetition(id)) }
        override suspend fun selectTournament(id: String) { mutableSettings.value = mutableSettings.value.copy(context = mutableSettings.value.context.withTournament(id)) }
        override suspend fun commitContext(context: gr.komobasket.app.core.model.CompetitionContext): Boolean {
            val changed = mutableSettings.value.context != context
            mutableSettings.value = mutableSettings.value.copy(context = context, onboardingComplete = true)
            return changed
        }
        override suspend fun completeOnboarding() { mutableSettings.value = mutableSettings.value.copy(onboardingComplete = true) }
    }

    private class FakePhasesRepository : PhasesRepository {
        var groups = listOf(
            TournamentGroup("league", "League Event", listOf("league"), "league"),
            TournamentGroup("cup", "Cup Event", listOf("cup"), "cup"),
        )
        override suspend fun competition(competitionId: String) = CompetitionPhases(
            Competition(competitionId, "season", "organization", "Example Competition", "example-competition", "league", null),
            groups.mapIndexed { index, group ->
                Phase(group.id, group.name, index, "standings", "regular", "active", true, listOf("schedule"))
            }, "league", setOf("league"), groups,
        )
        override suspend fun games(competitionId: String, phaseId: String, status: String?,
            order: String, cursor: String?): PhaseGamesPage = error("not called")
        override suspend fun standings(competitionId: String, phaseId: String): List<StandingRow> =
            error("not called")
    }
}
