package gr.komobasket.app.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import gr.komobasket.app.core.common.CatalogueLoadState
import gr.komobasket.app.core.common.catalogueFailure
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.CompetitionHome
import gr.komobasket.app.core.model.OfficialMvp
import gr.komobasket.app.core.model.currentOfficialMvpScope
import gr.komobasket.app.data.repository.HomeRepository
import gr.komobasket.app.data.repository.OfficialMvpRepository
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

sealed interface HomeUiState {
    data object Loading : HomeUiState
    data class Content(
        val home: CompetitionHome,
        val tournamentId: String,
        val officialMvp: OfficialMvp? = null,
        val refreshing: Boolean = false,
    ) : HomeUiState
    data object NoActiveCompetition : HomeUiState
    data object NoNetwork : HomeUiState
    data object HttpError : HomeUiState
    data object MalformedResponse : HomeUiState
}

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val contextRepository: AppContextRepository,
    private val homeRepository: HomeRepository,
    private val officialMvpRepository: OfficialMvpRepository,
) : ViewModel() {
    private val mutableState = MutableStateFlow<HomeUiState>(HomeUiState.Loading)
    val state: StateFlow<HomeUiState> = mutableState

    private var activeScope: Pair<String, String>? = null
    private var requestJob: Job? = null

    init {
        viewModelScope.launch {
            contextRepository.settings
                .map { settings ->
                    val context = settings.context
                    context.competitionId?.takeIf(String::isNotBlank)?.let { competitionId ->
                        context.tournamentId?.takeIf(String::isNotBlank)?.let { competitionId to it }
                    }
                }
                .distinctUntilChanged()
                .collect { scope ->
                    activeScope = scope
                    requestJob?.cancel()
                    if (scope == null) {
                        mutableState.value = HomeUiState.NoActiveCompetition
                    } else {
                        mutableState.value = HomeUiState.Loading
                        requestJob = viewModelScope.launch { load(scope) }
                    }
                }
        }
    }

    fun retry() {
        val scope = activeScope ?: run {
            mutableState.value = HomeUiState.NoActiveCompetition
            return
        }
        requestJob?.cancel()
        val current = mutableState.value
        mutableState.value = if (current is HomeUiState.Content) current.copy(refreshing = true)
        else HomeUiState.Loading
        requestJob = viewModelScope.launch { load(scope) }
    }

    private suspend fun load(scope: Pair<String, String>) {
        try {
            val home = homeRepository.home(scope.first, scope.second)
            coroutineContext.ensureActive()
            if (activeScope != scope) return
            mutableState.value = HomeUiState.Content(home, scope.second)
            val mvpScope = home.currentOfficialMvpScope() ?: return
            val mvp = try {
                officialMvpRepository.current(mvpScope)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                return // Optional C1 section cannot replace the A3 Home result.
            }
            coroutineContext.ensureActive()
            if (activeScope == scope) {
                mutableState.value = HomeUiState.Content(home, scope.second, officialMvp = mvp)
            }
        } catch (error: CancellationException) {
            throw error
        } catch (error: Exception) {
            coroutineContext.ensureActive()
            if (activeScope != scope) return
            mutableState.value = when (catalogueFailure(error)) {
                CatalogueLoadState.NoNetwork -> HomeUiState.NoNetwork
                CatalogueLoadState.HttpError -> HomeUiState.HttpError
                else -> HomeUiState.MalformedResponse
            }
        }
    }
}
