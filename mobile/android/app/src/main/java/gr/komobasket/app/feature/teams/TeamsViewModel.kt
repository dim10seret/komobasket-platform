package gr.komobasket.app.feature.teams

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import gr.komobasket.app.core.common.CatalogueLoadState
import gr.komobasket.app.core.common.catalogueFailure
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.CompetitionTeam
import gr.komobasket.app.data.repository.TeamsRepository
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

sealed interface TeamsUiState {
    data object Loading : TeamsUiState
    data object NoActiveCompetition : TeamsUiState
    data object Empty : TeamsUiState
    data object NoNetwork : TeamsUiState
    data object HttpError : TeamsUiState
    data object MalformedResponse : TeamsUiState
    data class Content(val teams: List<CompetitionTeam>, val refreshing: Boolean = false) : TeamsUiState
}

@HiltViewModel
class TeamsViewModel @Inject constructor(
    private val contextRepository: AppContextRepository,
    private val repository: TeamsRepository,
) : ViewModel() {
    private val mutableState = MutableStateFlow<TeamsUiState>(TeamsUiState.Loading)
    val state: StateFlow<TeamsUiState> = mutableState

    private var competitionId: String? = null
    private var requestJob: Job? = null

    init {
        viewModelScope.launch {
            contextRepository.settings
                .map { it.context.competitionId?.takeIf(String::isNotBlank) }
                .distinctUntilChanged()
                .collect { id ->
                    requestJob?.cancel()
                    competitionId = id
                    mutableState.value = if (id == null) TeamsUiState.NoActiveCompetition else TeamsUiState.Loading
                    if (id != null) requestJob = viewModelScope.launch { load(id) }
                }
        }
    }

    fun refresh() {
        val id = competitionId ?: run {
            mutableState.value = TeamsUiState.NoActiveCompetition
            return
        }
        requestJob?.cancel()
        val current = mutableState.value
        mutableState.value = if (current is TeamsUiState.Content) current.copy(refreshing = true)
        else TeamsUiState.Loading
        requestJob = viewModelScope.launch { load(id) }
    }

    private suspend fun load(id: String) {
        try {
            val teams = repository.teams(id)
            coroutineContext.ensureActive()
            mutableState.value = if (teams.isEmpty()) TeamsUiState.Empty else TeamsUiState.Content(teams)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            coroutineContext.ensureActive()
            mutableState.value = when (catalogueFailure(error)) {
                CatalogueLoadState.NoNetwork -> TeamsUiState.NoNetwork
                CatalogueLoadState.HttpError -> TeamsUiState.HttpError
                else -> TeamsUiState.MalformedResponse
            }
        }
    }
}
