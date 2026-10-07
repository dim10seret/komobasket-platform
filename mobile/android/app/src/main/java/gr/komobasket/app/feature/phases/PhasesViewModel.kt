package gr.komobasket.app.feature.phases

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import gr.komobasket.app.core.common.CatalogueLoadState
import gr.komobasket.app.core.common.catalogueFailure
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.CompetitionPhases
import gr.komobasket.app.core.model.Phase
import gr.komobasket.app.core.model.PhaseGame
import gr.komobasket.app.core.model.PhaseView
import gr.komobasket.app.core.model.StandingRow
import gr.komobasket.app.data.repository.PhasesRepository
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlin.coroutines.coroutineContext

enum class PhasesFailure { NoNetwork, Http, Malformed }

data class PhasesUiState(
    val tournamentId: String? = null,
    val loadingDetail: Boolean = true,
    val noCompetition: Boolean = false,
    val detailFailure: PhasesFailure? = null,
    val detail: CompetitionPhases? = null,
    val selectedPhaseId: String? = null,
    val selectedView: PhaseView? = null,
    val loadingView: Boolean = false,
    val refreshing: Boolean = false,
    val viewFailure: PhasesFailure? = null,
    val games: List<PhaseGame> = emptyList(),
    val standings: List<StandingRow> = emptyList(),
    val nextCursor: String? = null,
    val loadingMore: Boolean = false,
    val paginationFailure: PhasesFailure? = null,
) {
    val selectedPhase: Phase?
        get() = detail?.phases?.firstOrNull { it.id == selectedPhaseId }
}

@HiltViewModel
class PhasesViewModel @Inject constructor(
    private val contextRepository: AppContextRepository,
    private val repository: PhasesRepository,
) : ViewModel() {
    private val mutableState = MutableStateFlow(PhasesUiState())
    val state: StateFlow<PhasesUiState> = mutableState

    private var competitionId: String? = null
    private var tournamentId: String? = null
    private var detailJob: Job? = null
    private var viewJob: Job? = null

    init {
        viewModelScope.launch {
            contextRepository.settings
                .map { settings ->
                    val context = settings.context
                    context.competitionId?.takeIf(String::isNotBlank)?.let { competition ->
                        context.tournamentId?.takeIf(String::isNotBlank)?.let { competition to it }
                    }
                }
                .distinctUntilChanged()
                .collect { scope ->
                    detailJob?.cancel()
                    viewJob?.cancel()
                    competitionId = scope?.first
                    tournamentId = scope?.second
                    mutableState.value = if (scope == null) PhasesUiState(
                        loadingDetail = false, noCompetition = true,
                    ) else PhasesUiState()
                    if (scope != null) detailJob = viewModelScope.launch { loadDetail(scope.first, scope.second) }
                }
        }
    }

    fun retryDetail() {
        val id = competitionId ?: return
        val root = tournamentId ?: return
        detailJob?.cancel()
        viewJob?.cancel()
        mutableState.value = PhasesUiState()
        detailJob = viewModelScope.launch { loadDetail(id, root) }
    }

    private suspend fun loadDetail(id: String, root: String) {
        try {
            val detail = requireNotNull(repository.competition(id).forTournament(root))
            coroutineContext.ensureActive()
            val phase = detail.phases.firstOrNull { it.id == detail.currentPhaseId }
                ?: detail.phases.firstOrNull()
            val view = phase?.supportedViews?.firstOrNull()
            mutableState.value = PhasesUiState(
                tournamentId = root, loadingDetail = false, detail = detail,
                selectedPhaseId = phase?.id, selectedView = view,
            )
            if (phase != null && view != null) loadSelected(id, phase.id, view)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            mutableState.value = PhasesUiState(
                loadingDetail = false, detailFailure = error.toPhasesFailure(),
            )
        }
    }

    fun selectPhase(phaseId: String) {
        val detail = mutableState.value.detail ?: return
        val phase = detail.phases.firstOrNull { it.id == phaseId } ?: return
        if (phaseId == mutableState.value.selectedPhaseId) return
        viewJob?.cancel()
        val view = phase.supportedViews.firstOrNull()
        mutableState.value = mutableState.value.copy(
            selectedPhaseId = phaseId, selectedView = view,
            loadingView = false, refreshing = false, viewFailure = null,
            games = emptyList(), standings = emptyList(), nextCursor = null,
            loadingMore = false, paginationFailure = null,
        )
        if (view != null) competitionId?.let { loadSelected(it, phaseId, view) }
    }

    fun selectView(view: PhaseView) {
        val current = mutableState.value
        val phase = current.selectedPhase ?: return
        if (view !in phase.supportedViews || view == current.selectedView) return
        viewJob?.cancel()
        mutableState.value = current.copy(
            selectedView = view, loadingView = false, refreshing = false,
            viewFailure = null, games = emptyList(), standings = emptyList(),
            nextCursor = null, loadingMore = false, paginationFailure = null,
        )
        competitionId?.let { loadSelected(it, phase.id, view) }
    }

    fun retryView() = refreshView()

    fun refreshView() {
        val current = mutableState.value
        val id = competitionId ?: return
        val phase = current.selectedPhase ?: return
        val view = current.selectedView ?: return
        viewJob?.cancel()
        mutableState.value = current.copy(
            refreshing = current.games.isNotEmpty() || current.standings.isNotEmpty(),
            loadingView = current.games.isEmpty() && current.standings.isEmpty(),
            viewFailure = null, paginationFailure = null, loadingMore = false,
            games = emptyList(), standings = emptyList(), nextCursor = null,
        )
        loadSelected(id, phase.id, view, showLoading = false)
    }

    private fun loadSelected(id: String, phaseId: String, view: PhaseView,
        showLoading: Boolean = true) {
        if (showLoading) mutableState.value = mutableState.value.copy(loadingView = true)
        viewJob = viewModelScope.launch {
            try {
                if (view == PhaseView.Standings) {
                    // The capability guard also prevents direct calls from requesting unsupported standings.
                    if (view !in (mutableState.value.selectedPhase?.supportedViews ?: emptyList())) return@launch
                    val rows = repository.standings(id, phaseId)
                    coroutineContext.ensureActive()
                    mutableState.value = mutableState.value.copy(
                        standings = rows, loadingView = false, refreshing = false,
                        viewFailure = null,
                    )
                } else {
                    val page = repository.games(id, phaseId, statusFor(view), orderFor(view), null)
                    coroutineContext.ensureActive()
                    mutableState.value = mutableState.value.copy(
                        games = visibleGames(view, page.games), nextCursor = page.nextCursor,
                        loadingView = false, refreshing = false, viewFailure = null,
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(
                    loadingView = false, refreshing = false,
                    viewFailure = error.toPhasesFailure(),
                )
            }
        }
    }

    fun loadMore() {
        val current = mutableState.value
        val id = competitionId ?: return
        val phaseId = current.selectedPhaseId ?: return
        val view = current.selectedView ?: return
        val cursor = current.nextCursor ?: return
        if (view == PhaseView.Standings || current.loadingView || current.loadingMore) return
        mutableState.value = current.copy(loadingMore = true, paginationFailure = null)
        viewJob = viewModelScope.launch {
            try {
                val page = repository.games(id, phaseId, statusFor(view), orderFor(view), cursor)
                coroutineContext.ensureActive()
                val existing = mutableState.value.games
                val ids = existing.mapTo(mutableSetOf()) { it.id }
                mutableState.value = mutableState.value.copy(
                    games = existing + visibleGames(view, page.games).filter { ids.add(it.id) },
                    nextCursor = page.nextCursor, loadingMore = false,
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(
                    loadingMore = false, paginationFailure = error.toPhasesFailure(),
                )
            }
        }
    }
}

internal fun statusFor(view: PhaseView): String? = if (view == PhaseView.Results) "completed" else null
internal fun orderFor(view: PhaseView): String = if (view == PhaseView.Results) "desc" else "asc"

internal fun visibleGames(view: PhaseView, games: List<PhaseGame>): List<PhaseGame> = when (view) {
    PhaseView.Schedule -> games.filter { it.status in setOf("scheduled", "live", "postponed", "cancelled") }
    PhaseView.Results -> games.filter { it.status == "completed" }
    PhaseView.Standings -> emptyList()
}

private fun Exception.toPhasesFailure() = when (catalogueFailure(this)) {
    CatalogueLoadState.NoNetwork -> PhasesFailure.NoNetwork
    CatalogueLoadState.HttpError -> PhasesFailure.Http
    else -> PhasesFailure.Malformed
}
