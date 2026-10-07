package gr.komobasket.app.feature.player

import androidx.lifecycle.SavedStateHandle
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.AppSettings
import gr.komobasket.app.core.model.Competition
import gr.komobasket.app.core.model.CompetitionContext
import gr.komobasket.app.core.model.CompetitionPhases
import gr.komobasket.app.core.model.Phase
import gr.komobasket.app.core.model.PhaseGame
import gr.komobasket.app.core.model.PlayerAverages
import gr.komobasket.app.core.model.PlayerProfile
import gr.komobasket.app.core.model.PlayerShooting
import gr.komobasket.app.core.model.PlayerShot
import gr.komobasket.app.core.model.PlayerTotals
import gr.komobasket.app.core.model.StandingRow
import gr.komobasket.app.data.repository.PhasesRepository
import gr.komobasket.app.data.repository.PlayerProfileRepository
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
import okhttp3.MediaType.Companion.toMediaType
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
class PlayerProfileViewModelTest {
    @get:Rule val mainDispatcher = object : TestWatcher() {
        override fun starting(description: Description) { Dispatchers.setMain(StandardTestDispatcher()) }
        override fun finished(description: Description) { Dispatchers.resetMain() }
    }

    private fun viewModel(context: FakeContext = FakeContext("competition-a"),
        phases: FakePhases = FakePhases(), repo: FakeProfile = FakeProfile(),
        playerId: String = "player-a") = PlayerProfileViewModel(
        SavedStateHandle(mapOf("playerId" to playerId)), context, phases, repo)

    @Test fun initialLoadUsesCurrentPublicPhaseAndSingleB3Request() = runTest {
        val phases = FakePhases()
        val repo = FakeProfile()
        val vm = viewModel(phases = phases, repo = repo)
        advanceUntilIdle()
        assertEquals(1, phases.calls)
        assertEquals(listOf("phase-b"), vm.state.value.selectedPhaseIds)
        assertEquals(listOf(listOf("phase-b")), repo.scopes)
        assertEquals(0, vm.state.value.profile?.gamesPlayed)
        assertNull(vm.state.value.profile?.perGame?.points)
        assertNull(vm.state.value.profileFailure)
    }

    @Test fun tournamentChangeInvalidatesOpenPlayerProfile() = runTest {
        val context = FakeContext("competition-a")
        val vm = viewModel(context = context)
        advanceUntilIdle()
        assertEquals("player-a", vm.state.value.profile?.id)
        context.setTournament("cup")
        advanceUntilIdle()
        assertTrue(vm.state.value.contextChanged)
        assertNull(vm.state.value.profile)
    }

    @Test fun missingCurrentPhaseFallsBackToFirstAndSupportsMultiPhase() = runTest {
        val phases = FakePhases().apply { current = "unknown" }
        val repo = FakeProfile()
        val vm = viewModel(phases = phases, repo = repo)
        advanceUntilIdle()
        assertEquals(listOf("phase-a"), vm.state.value.selectedPhaseIds)
        vm.togglePhase("phase-b")
        advanceUntilIdle()
        assertEquals(listOf("phase-a", "phase-b"), vm.state.value.selectedPhaseIds)
        assertEquals(listOf("phase-a", "phase-b"), repo.scopes.last())
        vm.togglePhase("phase-a")
        vm.togglePhase("phase-b")
        advanceUntilIdle()
        assertEquals(listOf("phase-b"), vm.state.value.selectedPhaseIds)
        assertFalse(vm.state.value.loadingProfile)
    }

    @Test fun scopeChangeClearsOldContentAndCancelsObsoleteRequest() = runTest {
        val repo = FakeProfile()
        val vm = viewModel(repo = repo)
        advanceUntilIdle()
        val pending = CompletableDeferred<PlayerProfile>()
        repo.pending = pending
        vm.togglePhase("phase-a")
        runCurrent()
        assertNull(vm.state.value.profile)
        assertTrue(vm.state.value.loadingProfile)
        vm.togglePhase("phase-b")
        repo.pending = null
        runCurrent()
        assertEquals(listOf("phase-a"), vm.state.value.selectedPhaseIds)
        assertEquals(listOf("phase-a"), vm.state.value.profile?.phaseIds)
        pending.complete(repo.zero("competition-a", "player-a", listOf("phase-a", "phase-b")))
        advanceUntilIdle()
        assertEquals(listOf("phase-a"), vm.state.value.profile?.phaseIds)
    }

    @Test fun networkErrorRetriesAndHttp404IsSafeNotFound() = runTest {
        val repo = FakeProfile().apply { failure = IOException("offline") }
        val vm = viewModel(repo = repo)
        advanceUntilIdle()
        assertEquals(PlayerFailure.NoNetwork, vm.state.value.profileFailure)
        repo.failure = null
        vm.refresh()
        advanceUntilIdle()
        assertEquals("player-a", vm.state.value.profile?.id)
        repo.failure = HttpException(Response.error<String>(404,
            "hidden".toResponseBody("text/plain".toMediaType())))
        vm.refresh()
        advanceUntilIdle()
        assertEquals(PlayerFailure.NotFound, vm.state.value.profileFailure)
        assertNull(vm.state.value.profile)
    }

    @Test fun refreshRequestsOnlyCurrentPlayerAndScope() = runTest {
        val repo = FakeProfile()
        val vm = viewModel(repo = repo)
        advanceUntilIdle()
        vm.refresh()
        advanceUntilIdle()
        assertEquals(listOf(listOf("phase-b"), listOf("phase-b")), repo.scopes)
        assertEquals(listOf("player-a", "player-a"), repo.playerIds)
    }

    @Test fun missingInvalidAndChangedCompetitionNeverQueryWrongPlayerScope() = runTest {
        val repo = FakeProfile()
        val noCompetition = viewModel(context = FakeContext(null), repo = repo)
        advanceUntilIdle()
        assertTrue(noCompetition.state.value.noCompetition)
        val invalid = viewModel(repo = repo, playerId = "bad/id")
        advanceUntilIdle()
        assertTrue(invalid.state.value.invalidPlayer)
        assertTrue(repo.scopes.isEmpty())
        val context = FakeContext("competition-a")
        val vm = viewModel(context = context, repo = repo)
        advanceUntilIdle()
        context.set("competition-b")
        advanceUntilIdle()
        assertTrue(vm.state.value.contextChanged)
        assertNull(vm.state.value.profile)
        vm.refresh()
        vm.retryPhases()
        advanceUntilIdle()
        assertEquals(listOf("competition-a"), repo.competitionIds)
    }

    @Test fun separateDestinationUsesItsOwnPlayerId() = runTest {
        val repo = FakeProfile()
        val first = viewModel(repo = repo, playerId = "player-a")
        advanceUntilIdle()
        val second = viewModel(repo = repo, playerId = "player-b")
        advanceUntilIdle()
        assertEquals("player-a", first.state.value.profile?.id)
        assertEquals("player-b", second.state.value.profile?.id)
        assertEquals(listOf("player-a", "player-b"), repo.playerIds)
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
        var current: String? = "phase-b"
        override suspend fun competition(competitionId: String): CompetitionPhases {
            calls++
            return CompetitionPhases(
                Competition(competitionId, "season", "org", "League", "slug", "league", null),
                listOf(phase("phase-a"), phase("phase-b")), current, setOf("phase-b"),
                listOf(gr.komobasket.app.core.model.TournamentGroup("root", "League",
                    listOf("phase-a", "phase-b"), current)))
        }
        override suspend fun games(competitionId: String, phaseId: String, status: String?,
            order: String, cursor: String?): gr.komobasket.app.core.model.PhaseGamesPage =
            error("not called")
        override suspend fun standings(competitionId: String, phaseId: String): List<StandingRow> =
            error("not called")
        private fun phase(id: String) = Phase(id, id, 1, "standings", "regular", "active",
            id == "phase-b", listOf("schedule"))
    }

    private class FakeProfile : PlayerProfileRepository {
        val scopes = mutableListOf<List<String>>()
        val playerIds = mutableListOf<String>()
        val competitionIds = mutableListOf<String>()
        var failure: Exception? = null
        var pending: CompletableDeferred<PlayerProfile>? = null
        override suspend fun profile(competitionId: String, playerId: String,
            phaseIds: List<String>): PlayerProfile {
            competitionIds += competitionId
            playerIds += playerId
            scopes += phaseIds
            failure?.let { throw it }
            return pending?.await() ?: zero(competitionId, playerId, phaseIds)
        }
        fun zero(competitionId: String, playerId: String, phaseIds: List<String>): PlayerProfile {
            val total = PlayerTotals(0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0,
                0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
            val average = PlayerAverages(null, null, null, null, null, null, null, null)
            val shot = PlayerShot(0, 0, null)
            return PlayerProfile(playerId, "Player", null, competitionId, null, null, phaseIds,
                0, total, average, PlayerShooting(shot, shot, shot), emptyList())
        }
    }
}
