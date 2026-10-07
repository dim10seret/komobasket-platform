package gr.komobasket.app.app

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.AppSettings
import gr.komobasket.app.core.model.TournamentGroup
import gr.komobasket.app.data.repository.PhasesRepository
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.launch

sealed interface TournamentContextState {
    data object Loading : TournamentContextState
    data object Switching : TournamentContextState
    data object Unavailable : TournamentContextState
    data class Ready(
        val competitionId: String,
        val tournamentId: String,
        val groups: List<TournamentGroup>,
    ) : TournamentContextState {
        val selected: TournamentGroup get() = requireNotNull(groups.firstOrNull { it.id == tournamentId })
    }
}

@HiltViewModel
class RootViewModel @Inject constructor(
    private val contextRepository: AppContextRepository,
    private val phasesRepository: PhasesRepository,
) : ViewModel() {
    val settings: StateFlow<AppSettings?> = contextRepository.settings
        .map<AppSettings, AppSettings?> { it }
        .stateIn(viewModelScope, SharingStarted.Eagerly, null)

    private val mutableTournament = MutableStateFlow<TournamentContextState>(TournamentContextState.Loading)
    val tournament: StateFlow<TournamentContextState> = mutableTournament
    private var cachedCompetitionId: String? = null
    private var cachedGroups: List<TournamentGroup> = emptyList()

    init {
        viewModelScope.launch {
            contextRepository.settings.map { it.context.competitionId to it.context.tournamentId }
                .distinctUntilChanged().collectLatest { (competitionId, tournamentId) ->
                    loadTournament(competitionId, tournamentId)
                }
        }
    }

    private suspend fun loadTournament(competitionId: String?, tournamentId: String?, force: Boolean = false) {
        if (competitionId.isNullOrBlank() || tournamentId.isNullOrBlank()) {
            mutableTournament.value = TournamentContextState.Loading
            return
        }
        mutableTournament.value = TournamentContextState.Loading
        try {
            val groups = if (!force && cachedCompetitionId == competitionId) cachedGroups else {
                val detail = phasesRepository.competition(competitionId)
                require(detail.competition.id == competitionId)
                cachedCompetitionId = competitionId
                cachedGroups = detail.tournamentGroups
                detail.tournamentGroups
            }
            require(groups.any { it.id == tournamentId })
            mutableTournament.value = TournamentContextState.Ready(competitionId, tournamentId, groups)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            mutableTournament.value = TournamentContextState.Unavailable
        }
    }

    fun retryTournaments() {
        viewModelScope.launch {
            val context = contextRepository.settings.first().context
            loadTournament(context.competitionId, context.tournamentId, force = true)
        }
    }

    suspend fun switchTournament(id: String): Boolean {
        val ready = mutableTournament.value as? TournamentContextState.Ready ?: return false
        if (id == ready.tournamentId || ready.groups.none { it.id == id }) return false
        val context = contextRepository.settings.first().context
        if (context.competitionId != ready.competitionId || context.tournamentId != ready.tournamentId) return false
        mutableTournament.value = TournamentContextState.Switching
        return try {
            contextRepository.selectTournament(id)
            true
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            mutableTournament.value = ready
            false
        }
    }

    fun selectLanguage(tag: String) {
        viewModelScope.launch { contextRepository.selectLanguage(tag) }
    }
}
