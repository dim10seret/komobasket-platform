package gr.komobasket.app.feature.stats

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import gr.komobasket.app.core.common.CatalogueLoadState
import gr.komobasket.app.core.common.catalogueFailure
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.CompetitionPhases
import gr.komobasket.app.core.model.RankingCategory
import gr.komobasket.app.core.model.RankingEntry
import gr.komobasket.app.core.model.RankingsPage
import gr.komobasket.app.core.model.togglePhaseSelection
import gr.komobasket.app.data.repository.PhasesRepository
import gr.komobasket.app.data.repository.RankingsRepository
import javax.inject.Inject
import kotlin.coroutines.coroutineContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import retrofit2.HttpException

internal const val MAX_RANKING_PHASES = 12

enum class StatsFailure { NoNetwork, Http, Malformed }

data class StatsUiState(
    val tournamentId: String? = null,
    val loadingDetail: Boolean = true,
    val noCompetition: Boolean = false,
    val detailFailure: StatsFailure? = null,
    val detail: CompetitionPhases? = null,
    val selectedPhaseIds: List<String> = emptyList(),
    val category: RankingCategory = RankingCategory.Points,
    val loadingRankings: Boolean = false,
    val refreshing: Boolean = false,
    val rankingsFailure: StatsFailure? = null,
    val rows: List<RankingEntry> = emptyList(),
    val nextCursor: String? = null,
    val loadingMore: Boolean = false,
    val paginationFailure: StatsFailure? = null,
)

@HiltViewModel
class StatsViewModel @Inject constructor(
    private val contextRepository: AppContextRepository,
    private val phasesRepository: PhasesRepository,
    private val rankingsRepository: RankingsRepository,
) : ViewModel() {
    private val mutableState = MutableStateFlow(StatsUiState())
    val state: StateFlow<StatsUiState> = mutableState

    private var competitionId: String? = null
    private var tournamentId: String? = null
    private var detailJob: Job? = null
    private var rankingsJob: Job? = null

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
                    rankingsJob?.cancel()
                    competitionId = scope?.first
                    tournamentId = scope?.second
                    mutableState.value = if (scope == null) StatsUiState(
                        loadingDetail = false, noCompetition = true,
                    ) else StatsUiState()
                    if (scope != null) detailJob = viewModelScope.launch { loadDetail(scope.first, scope.second) }
                }
        }
    }

    fun retryDetail() {
        val id = competitionId ?: return
        val root = tournamentId ?: return
        detailJob?.cancel()
        rankingsJob?.cancel()
        mutableState.value = StatsUiState()
        detailJob = viewModelScope.launch { loadDetail(id, root) }
    }

    private suspend fun loadDetail(id: String, root: String) {
        try {
            val detail = requireNotNull(phasesRepository.competition(id).forTournament(root))
            coroutineContext.ensureActive()
            val phaseId = detail.currentPhaseId?.takeIf { current ->
                detail.phases.any { it.id == current }
            } ?: detail.phases.firstOrNull()?.id
            val selected = listOfNotNull(phaseId)
            mutableState.value = StatsUiState(
                tournamentId = root, loadingDetail = false, detail = detail, selectedPhaseIds = selected,
            )
            if (selected.isNotEmpty()) loadFirst(id, selected, RankingCategory.Points)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            mutableState.value = StatsUiState(
                loadingDetail = false, detailFailure = error.toStatsFailure(),
            )
        }
    }

    fun togglePhase(phaseId: String) {
        val current = mutableState.value
        val detail = current.detail ?: return
        val selected = togglePhaseSelection(detail.phases, current.selectedPhaseIds,
            phaseId, MAX_RANKING_PHASES) ?: return
        rankingsJob?.cancel()
        mutableState.value = current.copy(selectedPhaseIds = selected,
            rows = emptyList(), nextCursor = null, rankingsFailure = null,
            paginationFailure = null, loadingMore = false, refreshing = false)
        competitionId?.let { loadFirst(it, selected, current.category) }
    }

    fun selectCategory(category: RankingCategory) {
        val current = mutableState.value
        if (category == current.category || current.selectedPhaseIds.isEmpty()) return
        rankingsJob?.cancel()
        mutableState.value = current.copy(category = category, rows = emptyList(),
            nextCursor = null, rankingsFailure = null, paginationFailure = null,
            loadingMore = false, refreshing = false)
        competitionId?.let { loadFirst(it, current.selectedPhaseIds, category) }
    }

    fun retryRankings() = refresh()

    fun refresh() {
        val current = mutableState.value
        val id = competitionId ?: return
        if (current.detail == null || current.selectedPhaseIds.isEmpty()) return
        rankingsJob?.cancel()
        val refreshing = current.rows.isNotEmpty()
        mutableState.value = current.copy(rows = emptyList(), nextCursor = null,
            rankingsFailure = null, paginationFailure = null, loadingMore = false,
            loadingRankings = !refreshing, refreshing = refreshing)
        loadFirst(id, current.selectedPhaseIds, current.category, showLoading = false)
    }

    private fun loadFirst(id: String, phaseIds: List<String>, category: RankingCategory,
        showLoading: Boolean = true) {
        if (showLoading) mutableState.value = mutableState.value.copy(loadingRankings = true)
        rankingsJob = viewModelScope.launch {
            try {
                applyFirstPage(rankingsRepository.rankings(id, phaseIds, category, null))
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(
                    loadingRankings = false, refreshing = false,
                    rankingsFailure = error.toStatsFailure(),
                )
            }
        }
    }

    private suspend fun applyFirstPage(page: RankingsPage) {
        coroutineContext.ensureActive()
        mutableState.value = mutableState.value.copy(
            rows = page.rows, nextCursor = page.nextCursor,
            loadingRankings = false, refreshing = false, loadingMore = false,
            rankingsFailure = null, paginationFailure = null,
        )
    }

    fun loadMore() {
        val current = mutableState.value
        val id = competitionId ?: return
        val cursor = current.nextCursor ?: return
        if (current.selectedPhaseIds.isEmpty() || current.loadingRankings || current.loadingMore) return
        val phases = current.selectedPhaseIds
        val category = current.category
        mutableState.value = current.copy(loadingMore = true, paginationFailure = null)
        rankingsJob = viewModelScope.launch {
            try {
                val page = rankingsRepository.rankings(id, phases, category, cursor)
                coroutineContext.ensureActive()
                val existing = mutableState.value.rows
                val ids = existing.mapTo(mutableSetOf()) { it.playerId }
                mutableState.value = mutableState.value.copy(
                    rows = existing + page.rows.filter { ids.add(it.playerId) },
                    nextCursor = page.nextCursor, loadingMore = false,
                )
            } catch (error: CancellationException) {
                throw error
            } catch (error: HttpException) {
                if (error.code() == 409) {
                    // A stale B1 cursor means the authoritative ranking changed. Reload page one once.
                    mutableState.value = mutableState.value.copy(
                        rows = emptyList(), nextCursor = null, loadingMore = false,
                        loadingRankings = true, paginationFailure = null,
                    )
                    try {
                        applyFirstPage(rankingsRepository.rankings(id, phases, category, null))
                    } catch (retryError: CancellationException) {
                        throw retryError
                    } catch (retryError: Exception) {
                        mutableState.value = mutableState.value.copy(
                            loadingRankings = false, rankingsFailure = retryError.toStatsFailure(),
                        )
                    }
                } else {
                    mutableState.value = mutableState.value.copy(
                        loadingMore = false, paginationFailure = error.toStatsFailure(),
                    )
                }
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(
                    loadingMore = false, paginationFailure = error.toStatsFailure(),
                )
            }
        }
    }
}

private fun Exception.toStatsFailure() = when (catalogueFailure(this)) {
    CatalogueLoadState.NoNetwork -> StatsFailure.NoNetwork
    CatalogueLoadState.HttpError -> StatsFailure.Http
    else -> StatsFailure.Malformed
}
