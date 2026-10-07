package gr.komobasket.app.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.material3.Button
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import gr.komobasket.app.R
import gr.komobasket.app.app.TournamentContextState
import gr.komobasket.app.core.model.CompetitionHome
import gr.komobasket.app.core.model.HomeGame
import gr.komobasket.app.core.model.HomeStanding
import gr.komobasket.app.core.model.OfficialMvp
import gr.komobasket.app.core.common.validTeamId
import gr.komobasket.app.core.ui.ErrorState
import gr.komobasket.app.core.ui.LoadingState
import gr.komobasket.app.core.ui.TournamentSelector
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import coil3.compose.AsyncImage

@Composable
fun HomeScreen(
    state: HomeUiState,
    tournament: TournamentContextState,
    onRetryTournament: () -> Unit,
    onSelectTournament: (String) -> Unit,
    onRetry: () -> Unit,
    onChooseCompetition: () -> Unit,
    onOpenLive: (String) -> Unit,
    onOpenPlayer: (String) -> Unit,
    onOpenTeam: (String) -> Unit,
) {
    when (state) {
        HomeUiState.Loading -> LoadingState()
        HomeUiState.NoNetwork -> ErrorState(R.string.no_connection, onRetry)
        HomeUiState.HttpError -> ErrorState(R.string.home_unavailable, onRetry)
        HomeUiState.MalformedResponse -> ErrorState(R.string.home_malformed, onRetry)
        HomeUiState.NoActiveCompetition -> Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(stringResource(R.string.no_active_competition), style = MaterialTheme.typography.titleMedium)
            Button(onClick = onChooseCompetition, modifier = Modifier.padding(top = 16.dp)) {
                Text(stringResource(R.string.choose_competition))
            }
        }
        is HomeUiState.Content -> when {
            tournament == TournamentContextState.Unavailable ->
                ErrorState(R.string.tournament_unavailable, onRetryTournament)
            tournament !is TournamentContextState.Ready ||
                tournament.tournamentId != state.tournamentId ||
                tournament.competitionId != state.home.competition.id -> LoadingState()
            else -> HomeContent(state.home, state.officialMvp, tournament,
                onSelectTournament, state.refreshing, onRetry, onOpenLive, onOpenPlayer, onOpenTeam)
        }
    }
}

@Composable
private fun HomeContent(
    home: CompetitionHome,
    officialMvp: OfficialMvp?,
    tournament: TournamentContextState.Ready,
    onSelectTournament: (String) -> Unit,
    refreshing: Boolean,
    onRefresh: () -> Unit,
    onOpenLive: (String) -> Unit,
    onOpenPlayer: (String) -> Unit,
    onOpenTeam: (String) -> Unit,
) {
    PullToRefreshBox(isRefreshing = refreshing, onRefresh = onRefresh, modifier = Modifier.fillMaxSize()) {
        LazyColumn(
            modifier = Modifier.fillMaxSize(),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            item(key = "header") { CompetitionHeader(home) }
            item(key = "tournament") {
                Card(modifier = Modifier.fillMaxWidth()) {
                    TournamentSelector(tournament, onSelectTournament,
                        modifier = Modifier.padding(16.dp))
                }
            }
            if (home.currentPhase != null) item(key = "phase") { PhaseContext(home) }
            officialMvp?.let { mvp -> item(key = "official-mvp") {
                OfficialMvpCard(mvp, onOpenPlayer)
            } }
            if (home.liveGames.isNotEmpty()) {
                item(key = "live-title") { SectionTitle(R.string.live_games) }
                items(home.liveGames, key = { "live-${it.id}" }) { game ->
                    GameCard(game, live = true, onOpenLive, onOpenTeam)
                }
            }
            if (home.upcomingGames.isNotEmpty()) {
                item(key = "upcoming-title") { SectionTitle(R.string.upcoming_games) }
                items(home.upcomingGames, key = { "upcoming-${it.id}" }) { game ->
                    GameCard(game, live = false, onOpenLive, onOpenTeam)
                }
            }
            if (home.recentResults.isNotEmpty()) {
                item(key = "results-title") { SectionTitle(R.string.recent_results) }
                items(home.recentResults, key = { "result-${it.id}" }) { game ->
                    GameCard(game, live = false, onOpenLive, onOpenTeam)
                }
            }
            if (!home.standingsPreview.isNullOrEmpty()) {
                item(key = "standings-title") { SectionTitle(R.string.standings_preview) }
                item(key = "standings") { StandingsCard(home.standingsPreview) }
            }
            if (!home.hasSportsContent && officialMvp == null) item(key = "empty") {
                Text(stringResource(R.string.no_home_activity), style = MaterialTheme.typography.bodyLarge)
            }
        }
    }
}

@Composable
private fun CompetitionHeader(home: CompetitionHome) {
    ElevatedCard(
        modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.elevatedCardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Row(Modifier.padding(20.dp), verticalAlignment = Alignment.CenterVertically) {
            TeamLogo(home.competition.logoUrl, 48)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.competition_header), style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer)
                Text(home.competition.name, style = MaterialTheme.typography.headlineMedium,
                    fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
        }
    }
}

@Composable
private fun PhaseContext(home: CompetitionHome) {
    val phase = home.currentPhase ?: return
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(stringResource(R.string.current_phase), style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary)
            Text(phase.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.SemiBold)
            home.currentRound?.label?.takeIf(String::isNotBlank)?.let { label ->
                Text(label, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun SectionTitle(title: Int) {
    Text(stringResource(title), style = MaterialTheme.typography.titleLarge,
        fontWeight = FontWeight.SemiBold)
}

@Composable
private fun OfficialMvpCard(mvp: OfficialMvp, onOpenPlayer: (String) -> Unit) {
    Card(onClick = { onOpenPlayer(mvp.player.id) }, modifier = Modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.official_mvp), style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onPrimaryContainer, fontWeight = FontWeight.Bold)
            Row(verticalAlignment = Alignment.CenterVertically) {
                MvpPortrait(mvp.player.photoUrl)
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(mvp.player.name, style = MaterialTheme.typography.titleLarge,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        fontWeight = FontWeight.SemiBold)
                    mvp.team?.let { team ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            TeamLogo(team.logoUrl, 24)
                            Spacer(Modifier.width(6.dp))
                            Text(team.name, style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                    }
                }
            }
            mvp.performance?.let { performance ->
                Text(stringResource(R.string.mvp_performance, performance.points,
                    performance.rebounds, performance.assists, performance.efficiency),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
        }
    }
}

@Composable
private fun MvpPortrait(rawUrl: String?) {
    val url = remember(rawUrl) { publicLogoUrl(rawUrl) }
    var failed by remember(url) { mutableStateOf(false) }
    Box(Modifier.size(64.dp).clip(CircleShape)
        .background(MaterialTheme.colorScheme.surfaceVariant), contentAlignment = Alignment.Center) {
        if (url == null || failed) Icon(Icons.Outlined.Person, contentDescription = null,
            modifier = Modifier.size(38.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        else AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop,
            modifier = Modifier.fillMaxSize(), onError = { failed = true })
    }
}

@Composable
private fun GameCard(game: HomeGame, live: Boolean, onOpenLive: (String) -> Unit,
    onOpenTeam: (String) -> Unit) {
    val liveUrl = if (live) trustedWebLiveUrl(game) else null
    val colors = CardDefaults.cardColors(
        containerColor = if (live) MaterialTheme.colorScheme.errorContainer
        else MaterialTheme.colorScheme.surfaceContainer,
    )
    if (liveUrl == null) {
        Card(modifier = Modifier.fillMaxWidth(), colors = colors) {
            GameBody(game, live, false, onOpenTeam)
        }
    } else {
        Card(onClick = { onOpenLive(liveUrl) }, modifier = Modifier.fillMaxWidth(), colors = colors) {
            GameBody(game, live, true, null)
        }
    }
}

@Composable
private fun GameBody(game: HomeGame, live: Boolean, hasLiveAction: Boolean,
    onOpenTeam: ((String) -> Unit)?) {
    val locale = LocalConfiguration.current.locales[0]
    val schedule = scheduleLabel(game.scheduledDate, game.scheduledTime, locale)
    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        if (live) {
            Text(stringResource(R.string.live_status), style = MaterialTheme.typography.labelLarge,
                fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onErrorContainer)
        }
        game.roundLabel?.takeIf(String::isNotBlank)?.let {
            Text(it, style = MaterialTheme.typography.labelMedium)
        }
        TeamAndScore(game, onOpenTeam)
        if (schedule != null) Text(schedule, style = MaterialTheme.typography.bodySmall)
        game.venueName?.takeIf(String::isNotBlank)?.let {
            Text(it, style = MaterialTheme.typography.bodySmall, maxLines = 1,
                overflow = TextOverflow.Ellipsis)
        }
        if (hasLiveAction) Text(stringResource(R.string.open_live_score),
            style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.primary)
    }
}

@Composable
private fun TeamAndScore(game: HomeGame, onOpenTeam: ((String) -> Unit)?) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        TeamLine(game.homeTeam.id, game.homeTeam.name, game.homeTeam.logoUrl,
            game.homeScore, onOpenTeam)
        TeamLine(game.awayTeam.id, game.awayTeam.name, game.awayTeam.logoUrl,
            game.awayScore, onOpenTeam)
    }
}

@Composable
private fun TeamLine(id: String, name: String, logoUrl: String?, score: Int?,
    onOpenTeam: ((String) -> Unit)?) {
    val link = onOpenTeam?.takeIf { validTeamId(id) }
    val clickLabel = stringResource(R.string.open_team_profile)
    val modifier = if (link == null) Modifier.fillMaxWidth()
        else Modifier.fillMaxWidth().clickable(onClickLabel = clickLabel) { link(id) }
    Row(modifier.heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically) {
        TeamLogo(logoUrl, 36)
        Spacer(Modifier.width(10.dp))
        Text(name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.titleMedium,
            fontWeight = FontWeight.Medium, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (score != null) {
            Spacer(Modifier.width(12.dp))
            Text(score.toString(), style = MaterialTheme.typography.titleLarge,
                fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun StandingsCard(rows: List<HomeStanding>) {
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(horizontal = 16.dp)) {
            rows.forEachIndexed { index, row ->
                if (index > 0) HorizontalDivider()
                Column(Modifier.padding(vertical = 12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        TeamLogo(row.teamLogoUrl, 28)
                        Spacer(Modifier.width(8.dp))
                        Text(stringResource(R.string.standing_team, row.rank, row.teamName),
                            style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold,
                            maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    Text(stringResource(R.string.standings_summary, row.gamesPlayed, row.wins,
                        row.losses, row.standingsPoints), style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}

@Composable
private fun TeamLogo(rawUrl: String?, size: Int) {
    val url = remember(rawUrl) { publicLogoUrl(rawUrl) }
    Box(Modifier.size(size.dp).clip(CircleShape)
        .background(MaterialTheme.colorScheme.surfaceVariant)) {
        if (url != null) {
            AsyncImage(model = url, contentDescription = null, contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize())
        }
    }
}

/** Date and time are local schedule components; no instant or time zone is constructed. */
internal fun scheduleLabel(date: String?, time: String?, locale: Locale): String? {
    val day = date?.let {
        runCatching { LocalDate.parse(it).format(DateTimeFormatter.ofPattern("EEE d MMM", locale)) }
            .getOrDefault(it)
    }
    return listOfNotNull(day, time).filter(String::isNotBlank).joinToString(" · ").ifBlank { null }
}
