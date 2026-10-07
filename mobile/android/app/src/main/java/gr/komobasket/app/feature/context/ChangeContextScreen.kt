package gr.komobasket.app.feature.context

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import gr.komobasket.app.R
import gr.komobasket.app.core.common.CatalogueLoadState
import gr.komobasket.app.core.ui.EmptyState
import gr.komobasket.app.core.ui.ErrorState
import gr.komobasket.app.core.ui.LoadingState

@Composable
fun ChangeContextScreen(
    state: ChangeContextUiState,
    onBack: () -> Unit,
    onCancel: () -> Unit,
    onRetry: () -> Unit,
    onSearch: (String) -> Unit,
    onSelect: (String) -> Unit,
    onCommit: () -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = onBack) { Text(stringResource(R.string.team_back)) }
            TextButton(onClick = onCancel) { Text(stringResource(R.string.cancel)) }
        }
        Text(stringResource(R.string.change_context),
            style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
        if (state.step == ContextStep.Confirm) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                ContextValue(R.string.season_title, state.seasonName)
                ContextValue(R.string.organization_title, state.organizationName)
                ContextValue(R.string.competition_title, state.competitionName)
                ContextValue(R.string.tournament_label, state.tournamentName)
                if (state.commitFailed) Text(stringResource(R.string.context_commit_failed),
                    color = MaterialTheme.colorScheme.error)
                Button(onClick = onCommit, enabled = !state.committing && state.draft.isComplete) {
                    Text(stringResource(R.string.apply_context))
                }
            }
            return@Column
        }
        Text(stringResource(state.step.title()), style = MaterialTheme.typography.titleLarge,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
        if (state.step == ContextStep.Organization) {
            OutlinedTextField(
                value = state.organizationQuery,
                onValueChange = onSearch,
                label = { Text(stringResource(R.string.search_organizations)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
            )
            if (state.organizationQuery.isNotEmpty()) {
                TextButton(onClick = { onSearch("") }, modifier = Modifier.padding(start = 16.dp)) {
                    Text(stringResource(R.string.clear_search))
                }
            }
        }
        when (state.options) {
            CatalogueLoadState.Idle, CatalogueLoadState.Loading -> LoadingState()
            CatalogueLoadState.Empty -> EmptyState(state.step.empty(), onRetry)
            CatalogueLoadState.NoNetwork -> ErrorState(R.string.no_connection, onRetry)
            CatalogueLoadState.HttpError -> ErrorState(R.string.http_error, onRetry)
            CatalogueLoadState.MalformedResponse -> ErrorState(R.string.malformed_response, onRetry)
            is CatalogueLoadState.Ready -> {
                if (state.visibleOptions.isEmpty()) {
                    Text(stringResource(R.string.no_search_results), modifier = Modifier.padding(24.dp))
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(state.visibleOptions, key = { it.id }) { option ->
                            FilledTonalButton(onClick = { onSelect(option.id) },
                                modifier = Modifier.fillMaxWidth()
                                    .padding(horizontal = 16.dp, vertical = 4.dp)) {
                                Text(option.label)
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun ContextValue(@StringRes label: Int, value: String?) {
    Text(stringResource(label), style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.primary)
    Text(value.orEmpty(), style = MaterialTheme.typography.titleMedium)
}

@StringRes
private fun ContextStep.title(): Int = when (this) {
    ContextStep.Season -> R.string.season_title
    ContextStep.Organization -> R.string.organization_title
    ContextStep.Competition -> R.string.competition_title
    ContextStep.Tournament -> R.string.tournament_title
    ContextStep.Confirm -> R.string.change_context
}

@StringRes
private fun ContextStep.empty(): Int = when (this) {
    ContextStep.Season -> R.string.empty_seasons
    ContextStep.Organization -> R.string.empty_organizations
    ContextStep.Competition -> R.string.empty_competitions
    ContextStep.Tournament -> R.string.empty_tournaments
    ContextStep.Confirm -> R.string.empty_tournaments
}
