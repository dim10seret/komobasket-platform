package gr.komobasket.app.feature.onboarding

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.TextButton
import androidx.compose.material3.Text
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import gr.komobasket.app.R
import gr.komobasket.app.core.common.CatalogueLoadState
import gr.komobasket.app.core.common.normalizeOrganizationSearch
import gr.komobasket.app.core.ui.EmptyState
import gr.komobasket.app.core.ui.ErrorState
import gr.komobasket.app.core.ui.LoadingState

@Composable
fun WelcomeScreen(onContinue: () -> Unit) {
    IntroPage(R.string.welcome_title, R.string.welcome_body, R.string.continue_label, onContinue)
}

@Composable
fun GuestScreen(onContinue: () -> Unit) {
    IntroPage(R.string.guest_title, R.string.guest_body, R.string.continue_guest, onContinue)
}

@Composable
private fun IntroPage(@StringRes title: Int, @StringRes body: Int, @StringRes action: Int,
    onContinue: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally) {
        Text(stringResource(title), style = MaterialTheme.typography.headlineMedium)
        Text(stringResource(body), modifier = Modifier.padding(vertical = 20.dp))
        Button(onClick = onContinue) { Text(stringResource(action)) }
    }
}

@Composable
fun LanguageScreen(selectedTag: String?, onSelect: (String) -> Unit, onContinue: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally) {
        Text(stringResource(R.string.language_title), style = MaterialTheme.typography.headlineMedium)
        OutlinedButton(onClick = { onSelect("el") }, modifier = Modifier.fillMaxWidth().padding(top = 24.dp)) {
            Text(stringResource(R.string.language_greek))
            if (selectedTag == "el") Icon(Icons.Filled.Check, contentDescription = null)
        }
        OutlinedButton(onClick = { onSelect("en") }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(R.string.language_english))
            if (selectedTag == "en") Icon(Icons.Filled.Check, contentDescription = null)
        }
        Button(onClick = onContinue, enabled = selectedTag != null,
            modifier = Modifier.padding(top = 24.dp)) {
            Text(stringResource(R.string.continue_label))
        }
    }
}

@Composable
fun SelectionScreen(
    @StringRes title: Int,
    @StringRes emptyMessage: Int,
    state: CatalogueLoadState<List<SelectionOption>>,
    onRetry: () -> Unit,
    onSelect: (String) -> Unit,
    searchQuery: String? = null,
    onSearch: (String) -> Unit = {},
) {
    Column(Modifier.fillMaxSize()) {
        Text(stringResource(title), style = MaterialTheme.typography.headlineMedium,
            modifier = Modifier.padding(24.dp))
        if (searchQuery != null) {
            OutlinedTextField(value = searchQuery, onValueChange = onSearch,
                label = { Text(stringResource(R.string.search_organizations)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp))
            if (searchQuery.isNotEmpty()) {
                TextButton(onClick = { onSearch("") }, modifier = Modifier.padding(start = 16.dp)) {
                    Text(stringResource(R.string.clear_search))
                }
            }
        }
        when (state) {
            CatalogueLoadState.Idle, CatalogueLoadState.Loading -> LoadingState()
            CatalogueLoadState.Empty -> EmptyState(emptyMessage, onRetry)
            CatalogueLoadState.NoNetwork -> ErrorState(R.string.no_connection, onRetry)
            CatalogueLoadState.HttpError -> ErrorState(R.string.http_error, onRetry)
            CatalogueLoadState.MalformedResponse -> ErrorState(R.string.malformed_response, onRetry)
            is CatalogueLoadState.Ready -> {
                val visible = if (searchQuery.isNullOrBlank()) state.value else {
                    val query = normalizeOrganizationSearch(searchQuery)
                    state.value.filter { normalizeOrganizationSearch(it.label).contains(query) }
                }
                if (visible.isEmpty()) Text(stringResource(R.string.no_search_results),
                    modifier = Modifier.padding(24.dp))
                else LazyColumn(contentPadding = PaddingValues(16.dp)) {
                    items(visible, key = { it.id }) { option ->
                        FilledTonalButton(onClick = { onSelect(option.id) },
                            modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
                            Text(option.label)
                        }
                    }
                }
            }
        }
    }
}
