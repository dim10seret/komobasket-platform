package gr.komobasket.app.feature.stats

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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import gr.komobasket.app.R
import gr.komobasket.app.app.TournamentContextState
import gr.komobasket.app.core.common.validPlayerId
import gr.komobasket.app.core.common.validTeamId
import gr.komobasket.app.core.model.RankingCategory
import gr.komobasket.app.core.model.RankingEntry
import gr.komobasket.app.core.model.RankingMetric
import gr.komobasket.app.core.ui.ErrorState
import gr.komobasket.app.core.ui.LoadingState
import gr.komobasket.app.core.ui.TournamentSelector
import gr.komobasket.app.core.ui.PhaseSelectionChips
import gr.komobasket.app.feature.home.publicLogoUrl
import java.text.NumberFormat
import java.util.Locale

@Composable
fun StatsScreen(
    state: StatsUiState,
    tournament: TournamentContextState,
    onRetryTournament: () -> Unit,
    onSelectTournament: (String) -> Unit,
    onRetryDetail: () -> Unit,
    onChooseCompetition: () -> Unit,
    onTogglePhase: (String) -> Unit,
    onSelectCategory: (RankingCategory) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onPlayerOpen: ((String) -> Unit)? = null,
    onTeamOpen: ((String) -> Unit)? = null,
) {
    when {
        state.loadingDetail -> LoadingState()
        state.noCompetition -> Column(
            Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center,
        ) {
            Text(stringResource(R.string.no_active_competition))
            Button(onClick = onChooseCompetition, modifier = Modifier.padding(top = 16.dp)) {
                Text(stringResource(R.string.choose_competition))
            }
        }
        state.detailFailure != null -> ErrorState(failureMessage(state.detailFailure), onRetryDetail)
        state.detail != null && tournament == TournamentContextState.Unavailable ->
            ErrorState(R.string.tournament_unavailable, onRetryTournament)
        state.detail != null && (tournament !is TournamentContextState.Ready ||
            tournament.tournamentId != state.tournamentId) -> LoadingState()
        state.detail != null -> StatsContent(state, tournament as TournamentContextState.Ready,
            onSelectTournament, onTogglePhase, onSelectCategory,
            onRefresh, onLoadMore, onPlayerOpen, onTeamOpen)
    }
}

@StringRes
private fun failureMessage(failure: StatsFailure): Int = when (failure) {
    StatsFailure.NoNetwork -> R.string.no_connection
    StatsFailure.Http -> R.string.stats_unavailable
    StatsFailure.Malformed -> R.string.stats_malformed
}

@Composable
private fun StatsContent(
    state: StatsUiState,
    tournament: TournamentContextState.Ready,
    onSelectTournament: (String) -> Unit,
    onTogglePhase: (String) -> Unit,
    onSelectCategory: (RankingCategory) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onPlayerOpen: ((String) -> Unit)?,
    onTeamOpen: ((String) -> Unit)?,
) {
    val detail = state.detail ?: return
    PullToRefreshBox(
        isRefreshing = state.refreshing,
        onRefresh = { if (state.selectedPhaseIds.isNotEmpty()) onRefresh() },
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(Modifier.fillMaxSize()) {
            Text(stringResource(R.string.statistics_title), modifier = Modifier.padding(16.dp),
                style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            TournamentSelector(tournament, onSelectTournament,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            if (detail.phases.isEmpty()) {
                Text(stringResource(R.string.no_phases), modifier = Modifier.padding(16.dp))
                return@Column
            }
            Column(Modifier.padding(horizontal = 16.dp)) {
                PhaseSelectionChips(detail.phases, state.selectedPhaseIds,
                    MAX_RANKING_PHASES, onTogglePhase)
            }
            Text(stringResource(R.string.stats_category), modifier = Modifier.padding(16.dp),
                style = MaterialTheme.typography.titleSmall)
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(RankingCategory.entries.size) { index ->
                    val category = RankingCategory.entries[index]
                    FilterChip(selected = state.category == category,
                        onClick = { onSelectCategory(category) },
                        label = { Text(stringResource(category.label())) })
                }
            }
            RankingsBody(state, onRefresh, onLoadMore, onPlayerOpen, onTeamOpen)
        }
    }
}

@StringRes
private fun RankingCategory.label(): Int = when (this) {
    RankingCategory.Points -> R.string.stats_points
    RankingCategory.Rebounds -> R.string.stats_rebounds
    RankingCategory.Assists -> R.string.stats_assists
    RankingCategory.Efficiency -> R.string.stats_efficiency
    RankingCategory.TwoPoint -> R.string.stats_two_point
    RankingCategory.ThreePoint -> R.string.stats_three_point
    RankingCategory.FreeThrows -> R.string.stats_free_throws
}

@Composable
private fun RankingsBody(
    state: StatsUiState,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    onPlayerOpen: ((String) -> Unit)?,
    onTeamOpen: ((String) -> Unit)?,
) {
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (state.loadingRankings) item(key = "loading") {
            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
        state.rankingsFailure?.let { failure -> item(key = "error") {
            InlineError(failureMessage(failure), onRetry)
        } }
        if (!state.loadingRankings && state.rankingsFailure == null && state.rows.isEmpty()) {
            item(key = "empty") { Text(stringResource(R.string.no_statistics)) }
        }
        items(state.rows, key = { it.playerId }) { row ->
            RankingCard(row, onPlayerOpen, onTeamOpen)
        }
        if (state.loadingMore) item(key = "more-loading") {
            Box(Modifier.fillMaxWidth().padding(16.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
        state.paginationFailure?.let { failure -> item(key = "more-error") {
            InlineError(failureMessage(failure), onLoadMore)
        } }
        if (state.nextCursor != null && !state.loadingMore && state.paginationFailure == null) {
            item(key = "more") {
                Button(onClick = onLoadMore, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.load_more))
                }
            }
        }
    }
}

@Composable
private fun InlineError(@StringRes message: Int, onRetry: () -> Unit) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(message))
        Button(onClick = onRetry) { Text(stringResource(R.string.retry)) }
    }
}

@Composable
private fun RankingCard(row: RankingEntry, onPlayerOpen: ((String) -> Unit)?,
    onTeamOpen: ((String) -> Unit)?) {
    Card(Modifier.fillMaxWidth()) {
        RankingContent(row, onPlayerOpen, onTeamOpen)
    }
}

@Composable
private fun RankingContent(row: RankingEntry, onPlayerOpen: ((String) -> Unit)?,
    onTeamOpen: ((String) -> Unit)?) {
    val locale = LocalConfiguration.current.locales[0]
    val playerLink = onPlayerOpen?.takeIf { validPlayerId(row.playerId) }
    val teamLink = onTeamOpen?.takeIf { validTeamId(row.teamId) }
    val playerClickLabel = stringResource(R.string.open_player_profile)
    val teamClickLabel = stringResource(R.string.open_team_profile)
    val playerModifier = if (playerLink == null) Modifier.fillMaxWidth()
        else Modifier.fillMaxWidth().clickable(onClickLabel = playerClickLabel) {
            playerLink(row.playerId)
        }
    val teamModifier = if (teamLink == null) Modifier.fillMaxWidth()
        else Modifier.fillMaxWidth().clickable(onClickLabel = teamClickLabel) {
            teamLink(row.teamId)
        }
    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(playerModifier.heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(row.rank.toString(), modifier = Modifier.width(30.dp),
                color = MaterialTheme.colorScheme.primary,
                style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            RankingImage(row.playerPhotoUrl, row.playerName, 42)
            Spacer(Modifier.width(10.dp))
            Text(row.playerName, modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold, maxLines = 2,
                overflow = TextOverflow.Ellipsis)
        }
        Row(teamModifier.heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
            RankingImage(row.teamLogoUrl, null, 24)
            Spacer(Modifier.width(8.dp))
            Text(row.teamName, style = MaterialTheme.typography.bodyMedium,
                maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Column(playerModifier.heightIn(min = 48.dp),
            verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.stats_games_value, row.gamesPlayed),
                style = MaterialTheme.typography.bodySmall)
            when (val metric = row.metric) {
                is RankingMetric.Counting -> Text(
                    stringResource(R.string.stats_counting_values,
                        formatRankingNumber(metric.total, locale),
                        formatRankingNumber(metric.perGameAverage, locale, 1)),
                    style = MaterialTheme.typography.bodyMedium,
                )
                is RankingMetric.Shooting -> Text(
                    stringResource(R.string.stats_shooting_values,
                        formatRankingNumber(metric.made.toDouble(), locale),
                        formatRankingNumber(metric.attempted.toDouble(), locale),
                        metric.percentage?.let { stringResource(R.string.stats_percentage_value,
                            formatRankingNumber(it, locale, 1)) }
                            ?: stringResource(R.string.stats_no_percentage)),
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
        }
    }
}

@Composable
private fun RankingImage(rawUrl: String?, fallbackName: String?, size: Int) {
    val url = remember(rawUrl) { publicLogoUrl(rawUrl) }
    Box(Modifier.size(size.dp).clip(CircleShape)
        .background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        fallbackName?.firstOrNull()?.let { initial ->
            Text(initial.toString(), style = MaterialTheme.typography.labelLarge)
        }
        if (url != null) AsyncImage(model = url, contentDescription = null,
            contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}

internal fun formatRankingNumber(value: Double, locale: Locale, minimumFractionDigits: Int = 0): String =
    NumberFormat.getNumberInstance(locale).apply {
        this.minimumFractionDigits = minimumFractionDigits
        maximumFractionDigits = 2
    }.format(value)
