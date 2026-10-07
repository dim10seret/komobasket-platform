package gr.komobasket.app.feature.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import gr.komobasket.app.core.common.CatalogueLoadState
import gr.komobasket.app.core.common.catalogueFailure
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.data.repository.CatalogueRepository
import gr.komobasket.app.data.repository.PhasesRepository
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

data class SelectionOption(val id: String, val label: String)

sealed interface TournamentGateState {
    data object Loading : TournamentGateState
    data object Validated : TournamentGateState
    data class Selection(val options: List<SelectionOption>) : TournamentGateState
    data object Empty : TournamentGateState
    data object NoNetwork : TournamentGateState
    data object HttpError : TournamentGateState
    data object MalformedResponse : TournamentGateState
}

@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val catalogueRepository: CatalogueRepository,
    private val contextRepository: AppContextRepository,
    private val phasesRepository: PhasesRepository,
) : ViewModel() {
    private val mutableCatalogue = MutableStateFlow<CatalogueLoadState<List<SelectionOption>>>(CatalogueLoadState.Idle)
    val catalogue: StateFlow<CatalogueLoadState<List<SelectionOption>>> = mutableCatalogue
    private val mutableOrganizationQuery = MutableStateFlow("")
    val organizationQuery: StateFlow<String> = mutableOrganizationQuery
    private var loadJob: Job? = null
    private val mutableTournament = MutableStateFlow<TournamentGateState>(TournamentGateState.Loading)
    val tournament: StateFlow<TournamentGateState> = mutableTournament
    private var tournamentJob: Job? = null
    private var tournamentCompetitionId: String? = null

    fun loadSeasons() = load {
        catalogueRepository.seasons().map { SelectionOption(it.id, it.name) }
    }

    fun loadOrganizations(seasonId: String) = load {
        catalogueRepository.organizations(seasonId).map { SelectionOption(it.id, it.name) }
    }

    fun searchOrganizations(query: String) { mutableOrganizationQuery.value = query }

    fun loadCompetitions(seasonId: String, organizationId: String) = load {
        catalogueRepository.competitions(seasonId, organizationId).map { SelectionOption(it.id, it.name) }
    }

    fun loadTournaments(competitionId: String, savedTournamentId: String?) {
        tournamentJob?.cancel()
        tournamentCompetitionId = null
        mutableTournament.value = TournamentGateState.Loading
        tournamentJob = viewModelScope.launch {
            try {
                require(contextRepository.settings.first().context.competitionId == competitionId)
                val detail = phasesRepository.competition(competitionId)
                require(detail.competition.id == competitionId)
                require(contextRepository.settings.first().context.competitionId == competitionId)
                val options = detail.tournamentGroups.map { SelectionOption(it.id, it.name) }
                tournamentCompetitionId = competitionId
                mutableTournament.value = when {
                    options.isEmpty() -> TournamentGateState.Empty
                    savedTournamentId != null && options.any { it.id == savedTournamentId } ->
                        TournamentGateState.Validated
                    savedTournamentId == null && options.size == 1 -> {
                        contextRepository.selectTournament(options.single().id)
                        contextRepository.completeOnboarding()
                        TournamentGateState.Validated
                    }
                    else -> TournamentGateState.Selection(options)
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                mutableTournament.value = when (catalogueFailure(error)) {
                    CatalogueLoadState.NoNetwork -> TournamentGateState.NoNetwork
                    CatalogueLoadState.HttpError -> TournamentGateState.HttpError
                    else -> TournamentGateState.MalformedResponse
                }
            }
        }
    }

    suspend fun selectTournament(id: String): Boolean {
        val options = (mutableTournament.value as? TournamentGateState.Selection)?.options ?: return false
        if (options.none { it.id == id }) return false
        if (contextRepository.settings.first().context.competitionId != tournamentCompetitionId) return false
        contextRepository.selectTournament(id)
        contextRepository.completeOnboarding()
        return true
    }

    private fun load(fetch: suspend () -> List<SelectionOption>) {
        loadJob?.cancel()
        mutableCatalogue.value = CatalogueLoadState.Loading
        loadJob = viewModelScope.launch {
            try {
                val options = fetch()
                mutableCatalogue.value = if (options.isEmpty()) CatalogueLoadState.Empty
                else CatalogueLoadState.Ready(options)
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                mutableCatalogue.value = catalogueFailure(error)
            }
        }
    }

    suspend fun selectSeason(id: String) {
        contextRepository.selectSeason(id)
        mutableOrganizationQuery.value = ""
        loadJob?.cancel()
        mutableCatalogue.value = CatalogueLoadState.Loading
    }

    suspend fun selectOrganization(id: String) {
        contextRepository.selectOrganization(id)
        mutableOrganizationQuery.value = ""
        loadJob?.cancel()
        mutableCatalogue.value = CatalogueLoadState.Loading
    }

    suspend fun selectCompetition(id: String) {
        contextRepository.selectCompetition(id)
        tournamentJob?.cancel()
        tournamentCompetitionId = null
        mutableTournament.value = TournamentGateState.Loading
    }
    suspend fun completeOnboarding() = contextRepository.completeOnboarding()
}
