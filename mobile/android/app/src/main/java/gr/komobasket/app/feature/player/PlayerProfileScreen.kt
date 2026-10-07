package gr.komobasket.app.feature.player

import androidx.annotation.StringRes
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import gr.komobasket.app.R
import gr.komobasket.app.core.common.validTeamId
import gr.komobasket.app.core.model.PlayerAverages
import gr.komobasket.app.core.model.PlayerProfile
import gr.komobasket.app.core.model.PlayerRecentGame
import gr.komobasket.app.core.model.PlayerShot
import gr.komobasket.app.core.model.PlayerTotals
import gr.komobasket.app.core.ui.LoadingState
import gr.komobasket.app.core.ui.PhaseSelectionChips
import gr.komobasket.app.feature.home.publicLogoUrl
import gr.komobasket.app.feature.home.scheduleLabel
import gr.komobasket.app.feature.teams.TeamIdentityImage
import java.text.NumberFormat
import java.util.Locale

@Composable
fun PlayerProfileScreen(
    state: PlayerProfileUiState,
    onBack: () -> Unit,
    onChooseCompetition: () -> Unit,
    onRetryPhases: () -> Unit,
    onTogglePhase: (String) -> Unit,
    onRefresh: () -> Unit,
    onCurrentTeamOpen: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        TextButton(onClick = onBack, modifier = Modifier.padding(start = 8.dp)) {
            Text(stringResource(R.string.player_back))
        }
        when {
            state.invalidPlayer -> Recovery(R.string.player_invalid, onBack, R.string.player_back)
            state.contextChanged -> Recovery(R.string.player_context_changed, onBack, R.string.player_back)
            state.noCompetition -> Recovery(R.string.no_active_competition,
                onChooseCompetition, R.string.choose_competition)
            state.loadingPhases -> LoadingState()
            state.phasesFailure != null -> Recovery(failureMessage(state.phasesFailure),
                onRetryPhases, R.string.retry)
            state.phases.isEmpty() -> Recovery(R.string.no_phases, onRetryPhases, R.string.retry)
            else -> PlayerContent(state, onTogglePhase, onRefresh, onCurrentTeamOpen)
        }
    }
}

@StringRes
private fun failureMessage(failure: PlayerFailure): Int = when (failure) {
    PlayerFailure.NoNetwork -> R.string.no_connection
    PlayerFailure.NotFound -> R.string.player_not_found
    PlayerFailure.Http -> R.string.player_unavailable
    PlayerFailure.Malformed -> R.string.player_malformed
}

@Composable
private fun Recovery(@StringRes message: Int, onAction: () -> Unit, @StringRes action: Int) {
    Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally) {
        Text(stringResource(message), style = MaterialTheme.typography.bodyLarge)
        Button(onClick = onAction, modifier = Modifier.padding(top = 16.dp)) {
            Text(stringResource(action))
        }
    }
}

@Composable
private fun PlayerContent(state: PlayerProfileUiState, onTogglePhase: (String) -> Unit,
    onRefresh: () -> Unit, onCurrentTeamOpen: (String) -> Unit) {
    PullToRefreshBox(isRefreshing = state.refreshing, onRefresh = onRefresh,
        modifier = Modifier.fillMaxSize()) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item(key = "header") {
                if (state.profile != null) PlayerHeader(state.profile, onCurrentTeamOpen)
                else if (state.loadingProfile) InlineLoading()
            }
            item(key = "phases") {
                PhaseSelectionChips(state.phases, state.selectedPhaseIds,
                    MAX_PLAYER_PHASES, onTogglePhase)
            }
            state.profileFailure?.let { failure -> item(key = "error") {
                InlineFailure(failureMessage(failure), onRefresh)
            } }
            state.profile?.let { profile ->
                item(key = "games-played") {
                    Text(stringResource(R.string.player_games_played, profile.gamesPlayed),
                        style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                }
                if (profile.gamesPlayed == 0) item(key = "no-stats") {
                    Text(stringResource(R.string.player_no_statistics))
                }
                item(key = "key") { KeyMetrics(profile.perGame) }
                item(key = "totals") { TotalsCard(profile.totals) }
                item(key = "averages") { AveragesCard(profile.perGame) }
                item(key = "shooting") { ShootingCard(profile) }
                item(key = "recent-title") {
                    Text(stringResource(R.string.player_recent_games),
                        style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
                }
                if (profile.recentGames.isEmpty()) item(key = "recent-empty") {
                    Text(stringResource(R.string.player_no_recent_games))
                }
                items(profile.recentGames, key = { it.gameId }) { game -> RecentGameCard(game) }
            }
        }
    }
}

@Composable
private fun PlayerHeader(profile: PlayerProfile, onCurrentTeamOpen: (String) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        PlayerPortrait(profile.photoUrl)
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(profile.name, style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold)
            profile.currentTeam?.let { team ->
                val link = if (validTeamId(team.id)) onCurrentTeamOpen else null
                val clickLabel = stringResource(R.string.open_team_profile)
                val modifier = if (link == null) Modifier else Modifier.clickable(
                    onClickLabel = clickLabel) { link(team.id) }
                Row(modifier.heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
                    TeamIdentityImage(team.name, team.logoUrl, 28)
                    Spacer(Modifier.width(8.dp))
                    Text(team.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                }
            }
            profile.jerseyNumber?.let { jersey ->
                Text(stringResource(R.string.player_jersey, jersey),
                    style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun PlayerPortrait(rawUrl: String?) {
    val url = remember(rawUrl) { publicLogoUrl(rawUrl) }
    var failed by remember(url) { mutableStateOf(false) }
    Box(Modifier.size(76.dp).clip(CircleShape)
        .background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        if (url == null || failed) {
            Icon(Icons.Outlined.Person, contentDescription = null, modifier = Modifier.size(42.dp),
                tint = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(), onError = { failed = true })
        }
    }
}

@Composable
private fun KeyMetrics(averages: PlayerAverages) {
    val locale = LocalConfiguration.current.locales[0]
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.player_key_per_game), style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold)
            Metric(R.string.stats_points, averages.points, locale, 2)
            Metric(R.string.stats_rebounds, averages.rebounds, locale, 2)
            Metric(R.string.stats_assists, averages.assists, locale, 2)
            Metric(R.string.stats_efficiency, averages.efficiency, locale, 2)
        }
    }
}

@Composable
private fun TotalsCard(totals: PlayerTotals) {
    val locale = LocalConfiguration.current.locales[0]
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.team_totals), style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold)
            Metric(R.string.stats_points, totals.points, locale, 0)
            Metric(R.string.team_offensive_rebounds, totals.offensiveRebounds, locale, 0)
            Metric(R.string.team_defensive_rebounds, totals.defensiveRebounds, locale, 0)
            Metric(R.string.stats_rebounds, totals.rebounds, locale, 0)
            Metric(R.string.stats_assists, totals.assists, locale, 0)
            Metric(R.string.team_steals, totals.steals, locale, 0)
            Metric(R.string.team_blocks, totals.blocks, locale, 0)
            Metric(R.string.team_turnovers, totals.turnovers, locale, 0)
            Metric(R.string.team_fouls, totals.fouls, locale, 0)
            Metric(R.string.stats_efficiency, totals.efficiency, locale, 0)
            Metric(R.string.team_two_made, totals.twoPointMade, locale, 0)
            Metric(R.string.team_two_attempts, totals.twoPointAttempts, locale, 0)
            Metric(R.string.team_three_made, totals.threePointMade, locale, 0)
            Metric(R.string.team_three_attempts, totals.threePointAttempts, locale, 0)
            Metric(R.string.team_free_made, totals.freeThrowMade, locale, 0)
            Metric(R.string.team_free_attempts, totals.freeThrowAttempts, locale, 0)
        }
    }
}

@Composable
private fun AveragesCard(averages: PlayerAverages) {
    val locale = LocalConfiguration.current.locales[0]
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.team_per_game), style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold)
            Metric(R.string.stats_points, averages.points, locale, 2)
            Metric(R.string.stats_rebounds, averages.rebounds, locale, 2)
            Metric(R.string.stats_assists, averages.assists, locale, 2)
            Metric(R.string.team_steals, averages.steals, locale, 2)
            Metric(R.string.team_blocks, averages.blocks, locale, 2)
            Metric(R.string.team_turnovers, averages.turnovers, locale, 2)
            Metric(R.string.team_fouls, averages.fouls, locale, 2)
            Metric(R.string.stats_efficiency, averages.efficiency, locale, 2)
        }
    }
}

@Composable
private fun ShootingCard(profile: PlayerProfile) {
    val locale = LocalConfiguration.current.locales[0]
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.team_shooting), style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold)
            ShotMetric(R.string.stats_two_point, profile.shooting.twoPoint, locale)
            ShotMetric(R.string.stats_three_point, profile.shooting.threePoint, locale)
            ShotMetric(R.string.stats_free_throws, profile.shooting.freeThrow, locale)
        }
    }
}

@Composable
private fun ShotMetric(@StringRes label: Int, shot: PlayerShot, locale: Locale) {
    val percentage = shot.percentage?.let {
        stringResource(R.string.stats_percentage_value, playerNumber(it, locale, 2))
    } ?: stringResource(R.string.stats_no_percentage)
    MetricText(label, stringResource(R.string.team_shooting_value,
        shot.made, shot.attempted, percentage))
}

@Composable
private fun Metric(@StringRes label: Int, value: Double?, locale: Locale, digits: Int) {
    MetricText(label, value?.let { playerNumber(it, locale, digits) }
        ?: stringResource(R.string.stats_no_percentage))
}

@Composable
private fun MetricText(@StringRes label: Int, value: String) {
    Text(stringResource(R.string.player_metric_value, stringResource(label), value),
        style = MaterialTheme.typography.bodyMedium)
}

internal fun playerNumber(value: Double, locale: Locale, digits: Int): String =
    NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = digits }.format(value)

@Composable
private fun RecentGameCard(game: PlayerRecentGame) {
    val locale = LocalConfiguration.current.locales[0]
    val outcome = when (game.outcome) {
        "win" -> R.string.player_win
        "loss" -> R.string.player_loss
        else -> R.string.player_tie
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(R.string.player_recent_match, game.playerTeam.name,
                game.opponentTeam.name), style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.SemiBold)
            game.roundLabel?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            scheduleLabel(game.scheduledDate, game.scheduledTime, locale)?.let {
                Text(it, style = MaterialTheme.typography.bodySmall)
            }
            Text(stringResource(R.string.player_recent_result, game.teamScore, game.opponentScore,
                stringResource(outcome)), style = MaterialTheme.typography.bodyMedium)
            Text(stringResource(R.string.player_recent_stats, game.points, game.rebounds,
                game.assists, game.efficiency), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun InlineLoading() {
    Box(Modifier.fillMaxWidth().padding(20.dp), contentAlignment = Alignment.Center) {
        CircularProgressIndicator()
    }
}

@Composable
private fun InlineFailure(@StringRes message: Int, onRetry: () -> Unit) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(stringResource(message))
        Button(onClick = onRetry, modifier = Modifier.padding(top = 8.dp)) {
            Text(stringResource(R.string.retry))
        }
    }
}
