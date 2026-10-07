package gr.komobasket.app.feature.phases

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
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import gr.komobasket.app.core.common.validTeamId
import gr.komobasket.app.core.model.Phase
import gr.komobasket.app.core.model.PhaseGame
import gr.komobasket.app.core.model.PhaseView
import gr.komobasket.app.core.model.StandingRow
import gr.komobasket.app.core.ui.ErrorState
import gr.komobasket.app.core.ui.LoadingState
import gr.komobasket.app.core.ui.TournamentSelector
import gr.komobasket.app.feature.home.publicLogoUrl
import gr.komobasket.app.feature.home.scheduleLabel
import gr.komobasket.app.feature.home.trustedWebLiveUrl

@Composable
fun PhasesScreen(
    state: PhasesUiState,
    tournament: TournamentContextState,
    onRetryTournament: () -> Unit,
    onSelectTournament: (String) -> Unit,
    onRetryDetail: () -> Unit,
    onChooseCompetition: () -> Unit,
    onSelectPhase: (String) -> Unit,
    onSelectView: (PhaseView) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onOpenLive: (String) -> Unit,
    onOpenTeam: (String) -> Unit,
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
        state.detail != null -> PhasesContent(state, tournament as TournamentContextState.Ready,
            onSelectTournament, onSelectPhase, onSelectView,
            onRefresh, onLoadMore, onOpenLive, onOpenTeam)
    }
}

@StringRes
private fun failureMessage(failure: PhasesFailure): Int = when (failure) {
    PhasesFailure.NoNetwork -> R.string.no_connection
    PhasesFailure.Http -> R.string.phases_unavailable
    PhasesFailure.Malformed -> R.string.phases_malformed
}

@Composable
private fun PhasesContent(
    state: PhasesUiState,
    tournament: TournamentContextState.Ready,
    onSelectTournament: (String) -> Unit,
    onSelectPhase: (String) -> Unit,
    onSelectView: (PhaseView) -> Unit,
    onRefresh: () -> Unit,
    onLoadMore: () -> Unit,
    onOpenLive: (String) -> Unit,
    onOpenTeam: (String) -> Unit,
) {
    val detail = state.detail ?: return
    PullToRefreshBox(
        isRefreshing = state.refreshing,
        onRefresh = { if (state.selectedView != null) onRefresh() },
        modifier = Modifier.fillMaxSize(),
    ) {
        Column(Modifier.fillMaxSize()) {
            Text(detail.competition.name, modifier = Modifier.padding(16.dp),
                style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            TournamentSelector(tournament, onSelectTournament,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            if (detail.phases.isEmpty()) {
                Text(stringResource(R.string.no_phases), modifier = Modifier.padding(16.dp))
                return@Column
            }
            LazyRow(
                contentPadding = PaddingValues(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(detail.phases.size, key = { detail.phases[it].id }) { index ->
                    val phase = detail.phases[index]
                    FilterChip(
                        selected = phase.id == state.selectedPhaseId,
                        onClick = { onSelectPhase(phase.id) },
                        label = {
                            Column {
                                Text(phase.name, modifier = Modifier.widthIn(max = 220.dp),
                                    maxLines = 3, overflow = TextOverflow.Ellipsis)
                                val marker = when {
                                    phase.id == detail.currentPhaseId -> R.string.phase_current
                                    phase.id in detail.activePhaseIds &&
                                        detail.activePhaseIds.size < detail.phases.size -> R.string.phase_active
                                    else -> null
                                }
                                if (marker != null) Text(stringResource(marker),
                                    style = MaterialTheme.typography.labelSmall)
                            }
                        },
                    )
                }
            }
            val phase = state.selectedPhase
            if (phase != null) {
                ViewSelector(phase, state.selectedView, onSelectView)
                PhaseBody(state, onRefresh, onLoadMore, onOpenLive, onOpenTeam)
            }
        }
    }
}

@Composable
private fun ViewSelector(phase: Phase, selected: PhaseView?, onSelect: (PhaseView) -> Unit) {
    if (phase.supportedViews.isEmpty()) {
        Text(stringResource(R.string.no_phase_views), modifier = Modifier.padding(16.dp))
        return
    }
    LazyRow(
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        items(phase.supportedViews.size) { index ->
            val view = phase.supportedViews[index]
            FilterChip(selected = selected == view, onClick = { onSelect(view) },
                label = { Text(stringResource(view.label())) })
        }
    }
}

@StringRes
private fun PhaseView.label(): Int = when (this) {
    PhaseView.Schedule -> R.string.phase_schedule
    PhaseView.Results -> R.string.phase_results
    PhaseView.Standings -> R.string.phase_standings
}

@Composable
private fun PhaseBody(
    state: PhasesUiState,
    onRetry: () -> Unit,
    onLoadMore: () -> Unit,
    onOpenLive: (String) -> Unit,
    onOpenTeam: (String) -> Unit,
) {
    val view = state.selectedView ?: return
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (state.loadingView) item(key = "loading") {
            Box(Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
        state.viewFailure?.let { failure -> item(key = "error") {
            InlineError(failureMessage(failure), onRetry)
        } }
        if (view == PhaseView.Standings) {
            if (!state.loadingView && state.viewFailure == null && state.standings.isEmpty()) {
                item(key = "empty") { Text(stringResource(R.string.no_standings)) }
            }
            itemsIndexed(state.standings, key = { _, row -> row.teamId }) { _, row ->
                StandingCard(row)
            }
        } else {
            if (!state.loadingView && state.viewFailure == null && state.games.isEmpty() &&
                state.nextCursor == null) item(key = "empty") {
                Text(stringResource(if (view == PhaseView.Schedule) R.string.no_scheduled_games
                    else R.string.no_results))
            }
            itemsIndexed(state.games, key = { _, game -> game.id }) { index, game ->
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    val label = game.roundLabel?.takeIf(String::isNotBlank)
                    if (label != null && (index == 0 || state.games[index - 1].roundLabel != label)) {
                        Text(label, style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold)
                    }
                    PhaseGameCard(game, onOpenLive, onOpenTeam)
                }
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
private fun PhaseGameCard(game: PhaseGame, onOpenLive: (String) -> Unit,
    onOpenTeam: (String) -> Unit) {
    val liveUrl = trustedWebLiveUrl(game.status, game.id, game.webLiveUrl)
    val colors = CardDefaults.cardColors(containerColor =
        if (game.status == "live") MaterialTheme.colorScheme.errorContainer
        else MaterialTheme.colorScheme.surfaceContainer)
    if (liveUrl != null) {
        Card(onClick = { onOpenLive(liveUrl) }, colors = colors,
            modifier = Modifier.fillMaxWidth()) { GameContent(game, true, null) }
    } else {
        Card(colors = colors, modifier = Modifier.fillMaxWidth()) {
            GameContent(game, false, onOpenTeam)
        }
    }
}

@Composable
private fun GameContent(game: PhaseGame, liveAction: Boolean,
    onOpenTeam: ((String) -> Unit)?) {
    val statusLabel = when (game.status) {
        "live" -> R.string.live_status
        "postponed" -> R.string.phase_postponed
        "cancelled" -> R.string.phase_cancelled
        "completed" -> R.string.phase_completed
        else -> R.string.phase_scheduled
    }
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(statusLabel), style = MaterialTheme.typography.labelMedium,
            color = if (game.status == "live") MaterialTheme.colorScheme.onErrorContainer
            else MaterialTheme.colorScheme.onSurfaceVariant)
        TeamLine(game.homeTeam.id, game.homeTeam.name, game.homeTeam.logoUrl,
            game.homeScore.takeIf { game.status == "completed" }, onOpenTeam)
        TeamLine(game.awayTeam.id, game.awayTeam.name, game.awayTeam.logoUrl,
            game.awayScore.takeIf { game.status == "completed" }, onOpenTeam)
        if (game.status != "postponed" && game.status != "cancelled") {
            val locale = LocalConfiguration.current.locales[0]
            scheduleLabel(game.scheduledDate, game.scheduledTime, locale)?.let {
                Text(it, style = MaterialTheme.typography.bodySmall)
            }
        }
        if (liveAction) Text(stringResource(R.string.open_live_score),
            style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun TeamLine(id: String, name: String, logo: String?, score: Int?,
    onOpenTeam: ((String) -> Unit)?) {
    val link = onOpenTeam?.takeIf { validTeamId(id) }
    val clickLabel = stringResource(R.string.open_team_profile)
    val modifier = if (link == null) Modifier.fillMaxWidth()
        else Modifier.fillMaxWidth().clickable(onClickLabel = clickLabel) { link(id) }
    Row(modifier.heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        TeamLogo(logo, 32)
        Spacer(Modifier.width(8.dp))
        Text(name, modifier = Modifier.weight(1f), maxLines = 2,
            overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.titleSmall)
        if (score != null) Text(score.toString(), modifier = Modifier.padding(start = 8.dp),
            fontWeight = FontWeight.Bold, style = MaterialTheme.typography.titleLarge)
    }
}

@Composable
private fun StandingCard(row: StandingRow) {
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(row.rank.toString(), modifier = Modifier.width(28.dp),
                    fontWeight = FontWeight.Bold)
                TeamLogo(row.teamLogoUrl, 28)
                Text(row.teamName, modifier = Modifier.weight(1f).padding(start = 8.dp),
                    style = MaterialTheme.typography.titleSmall, maxLines = 2)
                Text(stringResource(R.string.phase_standing_points, row.standingsPoints),
                    fontWeight = FontWeight.Bold,
                    style = MaterialTheme.typography.titleMedium)
            }
            Text(stringResource(R.string.phase_standing_summary, row.gamesPlayed, row.wins,
                row.losses), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun TeamLogo(rawUrl: String?, size: Int) {
    val url = remember(rawUrl) { publicLogoUrl(rawUrl) }
    Box(Modifier.size(size.dp).clip(CircleShape)
        .background(MaterialTheme.colorScheme.surfaceVariant)) {
        if (url != null) AsyncImage(model = url, contentDescription = null,
            contentScale = ContentScale.Crop, modifier = Modifier.fillMaxSize())
    }
}
