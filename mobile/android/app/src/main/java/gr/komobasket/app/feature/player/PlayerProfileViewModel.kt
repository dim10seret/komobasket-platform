package gr.komobasket.app.feature.player

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import gr.komobasket.app.core.common.validPlayerId
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.Phase
import gr.komobasket.app.core.model.PlayerProfile
import gr.komobasket.app.core.model.togglePhaseSelection
import gr.komobasket.app.data.repository.PhasesRepository
import gr.komobasket.app.data.repository.PlayerProfileRepository
import java.io.IOException
import javax.inject.Inject
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.serialization.SerializationException
import retrofit2.HttpException

internal const val MAX_PLAYER_PHASES = 12

enum class PlayerFailure { NoNetwork, NotFound, Http, Malformed }

data class PlayerProfileUiState(
    val loadingPhases: Boolean = true,
    val noCompetition: Boolean = false,
    val invalidPlayer: Boolean = false,
    val contextChanged: Boolean = false,
    val phasesFailure: PlayerFailure? = null,
    val phases: List<Phase> = emptyList(),
    val selectedPhaseIds: List<String> = emptyList(),
    val loadingProfile: Boolean = false,
    val refreshing: Boolean = false,
    val profileFailure: PlayerFailure? = null,
    val profile: PlayerProfile? = null,
)

@HiltViewModel
class PlayerProfileViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val contextRepository: AppContextRepository,
    private val phasesRepository: PhasesRepository,
    private val repository: PlayerProfileRepository,
) : ViewModel() {
    private val playerId = savedStateHandle.get<String>("playerId")?.takeIf(::validPlayerId)
    private val mutableState = MutableStateFlow(PlayerProfileUiState())
    val state: StateFlow<PlayerProfileUiState> = mutableState

    private var competitionId: String? = null
    private var tournamentId: String? = null
    private var activeScope: Pair<String, String>? = null
    private var contextSeen = false
    private var invalidated = false
    private var phasesJob: Job? = null
    private var profileJob: Job? = null

    init {
        if (playerId == null) mutableState.value = PlayerProfileUiState(
            loadingPhases = false, invalidPlayer = true)
        else viewModelScope.launch {
            contextRepository.settings.map { settings ->
                val context = settings.context
                context.competitionId?.takeIf(String::isNotBlank)?.let { competition ->
                    context.tournamentId?.takeIf(String::isNotBlank)?.let { competition to it }
                }
            }.distinctUntilChanged().collect { scope ->
                    if (!contextSeen) {
                        contextSeen = true
                        activeScope = scope
                        competitionId = scope?.first
                        tournamentId = scope?.second
                        if (scope == null) mutableState.value = PlayerProfileUiState(
                            loadingPhases = false, noCompetition = true)
                        else loadPhases(scope.first)
                    } else if (scope != activeScope) {
                        invalidated = true
                        phasesJob?.cancel()
                        profileJob?.cancel()
                        mutableState.value = PlayerProfileUiState(
                            loadingPhases = false, contextChanged = true)
                    }
                }
        }
    }

    fun retryPhases() {
        val id = competitionId ?: return
        if (!invalidated && playerId != null) loadPhases(id)
    }

    private fun loadPhases(id: String) {
        phasesJob?.cancel()
        profileJob?.cancel()
        mutableState.value = PlayerProfileUiState()
        phasesJob = viewModelScope.launch {
            try {
                val detail = requireNotNull(phasesRepository.competition(id)
                    .forTournament(requireNotNull(tournamentId)))
                coroutineContext.ensureActive()
                require(detail.competition.id == id)
                val initial = detail.currentPhaseId?.takeIf { current ->
                    detail.phases.any { it.id == current }
                } ?: detail.phases.firstOrNull()?.id
                val selected = listOfNotNull(initial)
                if (!invalidated) mutableState.value = PlayerProfileUiState(
                    loadingPhases = false, phases = detail.phases, selectedPhaseIds = selected)
                if (!invalidated && selected.isNotEmpty()) loadProfile(id, selected)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                coroutineContext.ensureActive()
                if (!invalidated) mutableState.value = PlayerProfileUiState(
                    loadingPhases = false, phasesFailure = error.toPlayerFailure())
            }
        }
    }

    fun togglePhase(phaseId: String) {
        val id = competitionId ?: return
        val current = mutableState.value
        if (invalidated) return
        val selected = togglePhaseSelection(current.phases, current.selectedPhaseIds,
            phaseId, MAX_PLAYER_PHASES) ?: return
        profileJob?.cancel()
        mutableState.update { it.copy(selectedPhaseIds = selected, profile = null,
            profileFailure = null, refreshing = false, loadingProfile = true) }
        loadProfile(id, selected)
    }

    fun refresh() {
        val id = competitionId ?: return
        val current = mutableState.value
        if (invalidated || current.selectedPhaseIds.isEmpty()) return
        profileJob?.cancel()
        mutableState.update { it.copy(refreshing = current.profile != null,
            loadingProfile = current.profile == null, profileFailure = null) }
        loadProfile(id, current.selectedPhaseIds, preserveProfile = current.profile != null)
    }

    private fun loadProfile(id: String, selected: List<String>, preserveProfile: Boolean = false) {
        profileJob?.cancel()
        if (!preserveProfile) mutableState.update { it.copy(profile = null,
            profileFailure = null, loadingProfile = true, refreshing = false) }
        profileJob = viewModelScope.launch {
            try {
                val result = repository.profile(id, requireNotNull(playerId), selected)
                coroutineContext.ensureActive()
                if (!invalidated) mutableState.update { it.copy(profile = result,
                    loadingProfile = false, refreshing = false, profileFailure = null) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                coroutineContext.ensureActive()
                val failure = error.toPlayerFailure()
                if (!invalidated) mutableState.update { it.copy(loadingProfile = false,
                    refreshing = false, profileFailure = failure,
                    profile = if (failure == PlayerFailure.NoNetwork) it.profile else null) }
            }
        }
    }
}

private fun Exception.toPlayerFailure(): PlayerFailure = when (this) {
    is IOException -> PlayerFailure.NoNetwork
    is HttpException -> if (code() == 404) PlayerFailure.NotFound else PlayerFailure.Http
    is SerializationException, is IllegalArgumentException -> PlayerFailure.Malformed
    else -> PlayerFailure.Malformed
}
