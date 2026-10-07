package gr.komobasket.app.feature.teams

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import gr.komobasket.app.R
import gr.komobasket.app.core.model.CompetitionTeam
import gr.komobasket.app.core.ui.ErrorState
import gr.komobasket.app.core.ui.LoadingState
import gr.komobasket.app.feature.home.publicLogoUrl

@Composable
fun TeamsScreen(
    state: TeamsUiState,
    onRefresh: () -> Unit,
    onChooseCompetition: () -> Unit,
    onTeamClick: ((String) -> Unit)? = null,
) {
    when (state) {
        TeamsUiState.Loading -> LoadingState()
        TeamsUiState.NoNetwork -> ErrorState(R.string.no_connection, onRefresh)
        TeamsUiState.HttpError -> ErrorState(R.string.teams_unavailable, onRefresh)
        TeamsUiState.MalformedResponse -> ErrorState(R.string.teams_malformed, onRefresh)
        TeamsUiState.NoActiveCompetition -> Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(stringResource(R.string.no_active_competition), style = MaterialTheme.typography.titleMedium)
            Button(onClick = onChooseCompetition, modifier = Modifier.padding(top = 16.dp)) {
                Text(stringResource(R.string.choose_competition))
            }
        }
        TeamsUiState.Empty -> TeamsList(emptyList(), false, onRefresh)
        is TeamsUiState.Content -> TeamsList(state.teams, state.refreshing, onRefresh, onTeamClick)
    }
}

@Composable
private fun TeamsList(teams: List<CompetitionTeam>, refreshing: Boolean, onRefresh: () -> Unit,
    onTeamClick: ((String) -> Unit)? = null) {
    PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            item(key = "title") {
                Text(stringResource(R.string.teams), style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold)
            }
            if (teams.isEmpty()) item(key = "empty") {
                Text(stringResource(R.string.no_teams), style = MaterialTheme.typography.bodyLarge)
            }
            items(teams, key = { it.id }) { team -> TeamRow(team, onTeamClick) }
        }
    }
}

@Composable
private fun TeamRow(team: CompetitionTeam, onTeamClick: ((String) -> Unit)?) {
    val body: @Composable () -> Unit = {
        Row(
            modifier = Modifier.fillMaxWidth().padding(16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            TeamIdentityImage(team.name, team.logoUrl, 52)
            Spacer(Modifier.width(16.dp))
            Text(team.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold)
        }
    }
    if (onTeamClick == null) Card(modifier = Modifier.fillMaxWidth()) { body() }
    else Card(onClick = { onTeamClick(team.id) }, modifier = Modifier.fillMaxWidth()) { body() }
}

@Composable
internal fun TeamIdentityImage(name: String, rawUrl: String?, size: Int) {
    val url = remember(rawUrl) { publicLogoUrl(rawUrl) }
    var failed by remember(url) { mutableStateOf(false) }
    Box(
        Modifier.size(size.dp).clip(CircleShape).background(MaterialTheme.colorScheme.surfaceVariant),
        contentAlignment = Alignment.Center,
    ) {
        if (url == null || failed) {
            TeamInitial(name)
        } else {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(), onError = { failed = true })
        }
    }
}

@Composable
private fun TeamInitial(name: String) {
    Text(name.trim().take(1).uppercase(), style = MaterialTheme.typography.titleLarge,
        color = MaterialTheme.colorScheme.onSurfaceVariant, fontWeight = FontWeight.Bold)
}
