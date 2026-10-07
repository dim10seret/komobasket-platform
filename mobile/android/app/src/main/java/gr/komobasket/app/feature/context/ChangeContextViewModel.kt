package gr.komobasket.app.feature.context

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import dagger.hilt.android.lifecycle.HiltViewModel
import gr.komobasket.app.core.common.CatalogueLoadState
import gr.komobasket.app.core.common.catalogueFailure
import gr.komobasket.app.core.common.normalizeOrganizationSearch
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.model.CompetitionContext
import gr.komobasket.app.data.repository.CatalogueRepository
import gr.komobasket.app.data.repository.PhasesRepository
import gr.komobasket.app.feature.onboarding.SelectionOption
import javax.inject.Inject
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

enum class ContextStep { Season, Organization, Competition, Tournament, Confirm }

data class ChangeContextUiState(
    val step: ContextStep = ContextStep.Season,
    val options: CatalogueLoadState<List<SelectionOption>> = CatalogueLoadState.Idle,
    val draft: CompetitionContext = CompetitionContext(),
    val seasonName: String? = null,
    val organizationName: String? = null,
    val competitionName: String? = null,
    val tournamentName: String? = null,
    val organizationQuery: String = "",
    val committing: Boolean = false,
    val commitFailed: Boolean = false,
) {
    val visibleOptions: List<SelectionOption>
        get() {
            val choices = when (val current = options) {
                is CatalogueLoadState.Ready -> current.value
                else -> return emptyList()
            }
            if (step != ContextStep.Organization || organizationQuery.isBlank()) return choices
            val query = normalizeOrganizationSearch(organizationQuery)
            return choices.filter { normalizeOrganizationSearch(it.label).contains(query) }
        }
}

@HiltViewModel
class ChangeContextViewModel @Inject constructor(
    private val catalogueRepository: CatalogueRepository,
    private val phasesRepository: PhasesRepository,
    private val contextRepository: AppContextRepository,
) : ViewModel() {
    private val mutableState = MutableStateFlow(ChangeContextUiState())
    val state: StateFlow<ChangeContextUiState> = mutableState
    private var loadJob: Job? = null

    fun start() {
        if (mutableState.value.options == CatalogueLoadState.Idle) loadOptions()
    }

    fun retry() = loadOptions()

    fun searchOrganizations(query: String) {
        if (mutableState.value.step == ContextStep.Organization) {
            mutableState.value = mutableState.value.copy(organizationQuery = query)
        }
    }

    fun select(id: String) {
        val current = mutableState.value
        val option = current.visibleOptions.firstOrNull { it.id == id } ?: return
        mutableState.value = when (current.step) {
            ContextStep.Season -> current.copy(
                step = ContextStep.Organization, draft = CompetitionContext().withSeason(id),
                seasonName = option.label, organizationName = null, competitionName = null,
                tournamentName = null, organizationQuery = "", options = CatalogueLoadState.Loading)
            ContextStep.Organization -> current.copy(
                step = ContextStep.Competition, draft = current.draft.withOrganization(id),
                organizationName = option.label, competitionName = null, tournamentName = null,
                options = CatalogueLoadState.Loading)
            ContextStep.Competition -> current.copy(
                step = ContextStep.Tournament, draft = current.draft.withCompetition(id),
                competitionName = option.label, tournamentName = null,
                options = CatalogueLoadState.Loading)
            ContextStep.Tournament -> current.copy(
                step = ContextStep.Confirm, draft = current.draft.withTournament(id),
                tournamentName = option.label, options = CatalogueLoadState.Idle)
            ContextStep.Confirm -> return
        }
        if (mutableState.value.step != ContextStep.Confirm) loadOptions()
    }

    fun back(): Boolean {
        val current = mutableState.value
        loadJob?.cancel()
        mutableState.value = when (current.step) {
            ContextStep.Season -> return false
            ContextStep.Organization -> current.copy(step = ContextStep.Season,
                draft = CompetitionContext(), options = CatalogueLoadState.Loading)
            ContextStep.Competition -> current.copy(step = ContextStep.Organization,
                draft = current.draft.withSeason(requireNotNull(current.draft.seasonId)),
                organizationName = null, competitionName = null, tournamentName = null,
                options = CatalogueLoadState.Loading)
            ContextStep.Tournament -> current.copy(step = ContextStep.Competition,
                draft = current.draft.withOrganization(requireNotNull(current.draft.organizationId)),
                competitionName = null, tournamentName = null, options = CatalogueLoadState.Loading)
            ContextStep.Confirm -> current.copy(step = ContextStep.Tournament,
                draft = current.draft.withCompetition(requireNotNull(current.draft.competitionId)),
                tournamentName = null, options = CatalogueLoadState.Loading)
        }
        loadOptions()
        return true
    }

    suspend fun commit(): Boolean {
        val draft = mutableState.value.draft
        if (mutableState.value.step != ContextStep.Confirm || !draft.isComplete ||
            mutableState.value.committing) return false
        mutableState.value = mutableState.value.copy(committing = true, commitFailed = false)
        return try {
            contextRepository.commitContext(draft)
            true
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            mutableState.value = mutableState.value.copy(committing = false, commitFailed = true)
            false
        }
    }

    private fun loadOptions() {
        loadJob?.cancel()
        val step = mutableState.value.step
        val draft = mutableState.value.draft
        if (step == ContextStep.Confirm) return
        mutableState.value = mutableState.value.copy(options = CatalogueLoadState.Loading)
        loadJob = viewModelScope.launch {
            try {
                val options = when (step) {
                    ContextStep.Season -> catalogueRepository.seasons().map { SelectionOption(it.id, it.name) }
                    ContextStep.Organization -> catalogueRepository.organizations(requireNotNull(draft.seasonId))
                        .map { SelectionOption(it.id, it.name) }
                    ContextStep.Competition -> catalogueRepository.competitions(
                        requireNotNull(draft.seasonId), requireNotNull(draft.organizationId))
                        .map { SelectionOption(it.id, it.name) }
                    ContextStep.Tournament -> {
                        val competitionId = requireNotNull(draft.competitionId)
                        val detail = phasesRepository.competition(competitionId)
                        require(detail.competition.id == competitionId)
                        detail.tournamentGroups.map { SelectionOption(it.id, it.name) }
                    }
                    ContextStep.Confirm -> emptyList()
                }
                mutableState.value = mutableState.value.copy(options = if (options.isEmpty())
                    CatalogueLoadState.Empty else CatalogueLoadState.Ready(options))
            } catch (error: CancellationException) {
                throw error
            } catch (error: Exception) {
                mutableState.value = mutableState.value.copy(options = catalogueFailure(error))
            }
        }
    }
}
