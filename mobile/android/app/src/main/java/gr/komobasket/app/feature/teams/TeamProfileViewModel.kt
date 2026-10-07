package gr.komobasket.app.feature.teams

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import gr.komobasket.app.core.common.validTeamId
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.Phase
import gr.komobasket.app.core.model.PhaseGame
import gr.komobasket.app.core.model.TeamProfile
import gr.komobasket.app.core.model.TeamStatistics
import gr.komobasket.app.core.model.togglePhaseSelection
import gr.komobasket.app.data.repository.PhasesRepository
import gr.komobasket.app.data.repository.TeamProfileRepository
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

internal const val MAX_TEAM_STATS_PHASES = 12

enum class TeamProfileSection { Overview, Roster, Stats, Games }
enum class TeamProfileFailure { NoNetwork, NotFound, Http, Malformed }

data class TeamProfileUiState(
    val loadingDetail: Boolean = true,
    val noCompetition: Boolean = false,
    val invalidTeam: Boolean = false,
    val contextChanged: Boolean = false,
    val detailFailure: TeamProfileFailure? = null,
    val detail: TeamProfile? = null,
    val section: TeamProfileSection = TeamProfileSection.Overview,
    val phases: List<Phase> = emptyList(),
    val phasesLoaded: Boolean = false,
    val loadingPhases: Boolean = false,
    val selectedPhaseIds: List<String> = emptyList(),
    val statistics: TeamStatistics? = null,
    val loadingStatistics: Boolean = false,
    val statisticsFailure: TeamProfileFailure? = null,
    val upcoming: List<PhaseGame> = emptyList(),
    val recent: List<PhaseGame> = emptyList(),
    val upcomingLoaded: Boolean = false,
    val recentLoaded: Boolean = false,
    val loadingUpcoming: Boolean = false,
    val loadingRecent: Boolean = false,
    val upcomingFailure: TeamProfileFailure? = null,
    val recentFailure: TeamProfileFailure? = null,
)

@HiltViewModel
class TeamProfileViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val contextRepository: AppContextRepository,
    private val phasesRepository: PhasesRepository,
    private val repository: TeamProfileRepository,
) : ViewModel() {
    private val teamId = savedStateHandle.get<String>("teamId")?.takeIf(::validTeamId)
    private val mutableState = MutableStateFlow(TeamProfileUiState())
    val state: StateFlow<TeamProfileUiState> = mutableState

    private var competitionId: String? = null
    private var tournamentId: String? = null
    private var activeScope: Pair<String, String>? = null
    private var contextSeen = false
    private var invalidated = false
    private var detailJob: Job? = null
    private var phasesJob: Job? = null
    private var statisticsJob: Job? = null
    private var upcomingJob: Job? = null
    private var recentJob: Job? = null

    init {
        if (teamId == null) mutableState.value = TeamProfileUiState(loadingDetail = false, invalidTeam = true)
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
                        if (scope == null) mutableState.value = TeamProfileUiState(
                            loadingDetail = false, noCompetition = true)
                        else detailJob = viewModelScope.launch { loadDetail(scope.first, scope.second) }
                    } else if (scope != activeScope) {
                        invalidateContext()
                    }
                }
        }
    }

    private fun invalidateContext() {
        invalidated = true
        detailJob?.cancel()
        phasesJob?.cancel()
        statisticsJob?.cancel()
        upcomingJob?.cancel()
        recentJob?.cancel()
        mutableState.value = TeamProfileUiState(loadingDetail = false, contextChanged = true)
    }

    fun retryDetail() {
        val id = competitionId ?: return
        val root = tournamentId ?: return
        if (invalidated || teamId == null) return
        detailJob?.cancel()
        mutableState.value = TeamProfileUiState()
        detailJob = viewModelScope.launch { loadDetail(id, root) }
    }

    private suspend fun loadDetail(id: String, root: String) {
        try {
            val detail = repository.detail(id, requireNotNull(teamId), root)
            coroutineContext.ensureActive()
            if (!invalidated) mutableState.value = TeamProfileUiState(loadingDetail = false, detail = detail)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            coroutineContext.ensureActive()
            if (!invalidated) mutableState.value = TeamProfileUiState(
                loadingDetail = false, detailFailure = error.toProfileFailure())
        }
    }

    fun selectSection(section: TeamProfileSection) {
        val current = mutableState.value
        if (invalidated || current.detail == null) return
        mutableState.update { it.copy(section = section) }
        val id = competitionId ?: return
        if (section == TeamProfileSection.Stats && !current.phasesLoaded && !current.loadingPhases) {
            loadPhases(id)
        }
        if (section == TeamProfileSection.Games) {
            if (!current.upcomingLoaded && !current.loadingUpcoming) loadUpcoming(id)
            if (!current.recentLoaded && !current.loadingRecent) loadRecent(id)
        }
    }

    private fun loadPhases(id: String) {
        phasesJob?.cancel()
        mutableState.update { it.copy(loadingPhases = true, statisticsFailure = null) }
        phasesJob = viewModelScope.launch {
            try {
                val detail = requireNotNull(phasesRepository.competition(id)
                    .forTournament(requireNotNull(tournamentId)))
                coroutineContext.ensureActive()
                require(detail.competition.id == id)
                val preferred = (mutableState.value.detail?.currentPhaseId ?: detail.currentPhaseId)?.takeIf { selected ->
                    detail.phases.any { it.id == selected }
                } ?: detail.phases.firstOrNull()?.id
                val selected = listOfNotNull(preferred)
                mutableState.update { it.copy(phases = detail.phases, phasesLoaded = true,
                    loadingPhases = false, selectedPhaseIds = selected) }
                if (selected.isNotEmpty()) loadStatistics(id, selected)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                coroutineContext.ensureActive()
                mutableState.update { it.copy(loadingPhases = false,
                    statisticsFailure = error.toProfileFailure()) }
            }
        }
    }

    fun togglePhase(phaseId: String) {
        val current = mutableState.value
        if (current.section != TeamProfileSection.Stats) return
        val selected = togglePhaseSelection(current.phases, current.selectedPhaseIds,
            phaseId, MAX_TEAM_STATS_PHASES) ?: return
        competitionId?.let { loadStatistics(it, selected) }
    }

    fun retryStatistics() {
        val id = competitionId ?: return
        val current = mutableState.value
        if (invalidated || current.detail == null) return
        if (!current.phasesLoaded) loadPhases(id)
        else if (current.selectedPhaseIds.isNotEmpty()) loadStatistics(id, current.selectedPhaseIds)
    }

    private fun loadStatistics(id: String, selected: List<String>) {
        statisticsJob?.cancel()
        mutableState.update { it.copy(selectedPhaseIds = selected, statistics = null,
            loadingStatistics = true, statisticsFailure = null) }
        statisticsJob = viewModelScope.launch {
            try {
                val result = repository.statistics(id, requireNotNull(teamId), selected)
                coroutineContext.ensureActive()
                if (!invalidated) mutableState.update { it.copy(statistics = result,
                    loadingStatistics = false) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                coroutineContext.ensureActive()
                if (!invalidated) mutableState.update { it.copy(loadingStatistics = false,
                    statisticsFailure = error.toProfileFailure()) }
            }
        }
    }

    fun retryUpcoming() { competitionId?.takeUnless { invalidated }?.let(::loadUpcoming) }
    fun retryRecent() { competitionId?.takeUnless { invalidated }?.let(::loadRecent) }

    private fun loadUpcoming(id: String) {
        upcomingJob?.cancel()
        mutableState.update { it.copy(loadingUpcoming = true, upcomingFailure = null) }
        upcomingJob = viewModelScope.launch {
            try {
                val games = repository.upcoming(id, requireNotNull(teamId), requireNotNull(tournamentId))
                coroutineContext.ensureActive()
                if (!invalidated) mutableState.update { it.copy(upcoming = games,
                    upcomingLoaded = true, loadingUpcoming = false) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                coroutineContext.ensureActive()
                if (!invalidated) mutableState.update { it.copy(loadingUpcoming = false,
                    upcomingFailure = error.toProfileFailure()) }
            }
        }
    }

    private fun loadRecent(id: String) {
        recentJob?.cancel()
        mutableState.update { it.copy(loadingRecent = true, recentFailure = null) }
        recentJob = viewModelScope.launch {
            try {
                val games = repository.recent(id, requireNotNull(teamId), requireNotNull(tournamentId))
                coroutineContext.ensureActive()
                if (!invalidated) mutableState.update { it.copy(recent = games,
                    recentLoaded = true, loadingRecent = false) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                coroutineContext.ensureActive()
                if (!invalidated) mutableState.update { it.copy(loadingRecent = false,
                    recentFailure = error.toProfileFailure()) }
            }
        }
    }
}

private fun Exception.toProfileFailure(): TeamProfileFailure = when (this) {
    is IOException -> TeamProfileFailure.NoNetwork
    is HttpException -> if (code() == 404) TeamProfileFailure.NotFound else TeamProfileFailure.Http
    is SerializationException, is IllegalArgumentException -> TeamProfileFailure.Malformed
    else -> TeamProfileFailure.Malformed
}
