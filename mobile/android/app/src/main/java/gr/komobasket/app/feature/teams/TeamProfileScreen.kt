package gr.komobasket.app.feature.teams

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ScrollableTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import gr.komobasket.app.R
import gr.komobasket.app.core.model.PhaseGame
import gr.komobasket.app.core.model.TeamProfile
import gr.komobasket.app.core.model.TeamRosterPlayer
import gr.komobasket.app.core.model.TeamStatistics
import gr.komobasket.app.core.model.TeamStatisticsLine
import gr.komobasket.app.core.ui.LoadingState
import gr.komobasket.app.core.ui.PhaseSelectionChips
import gr.komobasket.app.feature.home.scheduleLabel
import java.text.NumberFormat
import java.util.Locale

@Composable
fun TeamProfileScreen(
    state: TeamProfileUiState,
    onBack: () -> Unit,
    onChooseCompetition: () -> Unit,
    onRetryDetail: () -> Unit,
    onSelectSection: (TeamProfileSection) -> Unit,
    onTogglePhase: (String) -> Unit,
    onRetryStatistics: () -> Unit,
    onRetryUpcoming: () -> Unit,
    onRetryRecent: () -> Unit,
    onPlayerOpen: (String) -> Unit,
) {
    Column(Modifier.fillMaxSize()) {
        TextButton(onClick = onBack, modifier = Modifier.padding(start = 8.dp)) {
            Text(stringResource(R.string.team_back))
        }
        when {
            state.loadingDetail -> LoadingState()
            state.invalidTeam -> Recovery(R.string.team_invalid, onBack, R.string.team_back)
            state.contextChanged -> Recovery(R.string.team_context_changed, onBack, R.string.team_back)
            state.noCompetition -> Recovery(R.string.no_active_competition,
                onChooseCompetition, R.string.choose_competition)
            state.detailFailure != null -> Recovery(failureMessage(state.detailFailure),
                onRetryDetail, R.string.retry)
            state.detail != null -> {
                TeamHeader(state.detail)
                val sections = TeamProfileSection.entries
                ScrollableTabRow(selectedTabIndex = sections.indexOf(state.section), edgePadding = 8.dp) {
                    sections.forEach { section ->
                        Tab(selected = state.section == section, onClick = { onSelectSection(section) },
                            text = { Text(stringResource(section.label())) })
                    }
                }
                when (state.section) {
                    TeamProfileSection.Overview -> OverviewSection(state.detail)
                    TeamProfileSection.Roster -> RosterSection(state.detail.roster, onPlayerOpen)
                    TeamProfileSection.Stats -> StatisticsSection(state, onTogglePhase, onRetryStatistics)
                    TeamProfileSection.Games -> GamesSection(state, onRetryUpcoming, onRetryRecent)
                }
            }
        }
    }
}

@StringRes
private fun TeamProfileSection.label(): Int = when (this) {
    TeamProfileSection.Overview -> R.string.team_overview
    TeamProfileSection.Roster -> R.string.team_roster
    TeamProfileSection.Stats -> R.string.team_statistics
    TeamProfileSection.Games -> R.string.team_games
}

@StringRes
private fun failureMessage(failure: TeamProfileFailure): Int = when (failure) {
    TeamProfileFailure.NoNetwork -> R.string.no_connection
    TeamProfileFailure.NotFound -> R.string.team_not_found
    TeamProfileFailure.Http -> R.string.team_unavailable
    TeamProfileFailure.Malformed -> R.string.team_malformed
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
private fun TeamHeader(detail: TeamProfile) {
    Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically) {
        TeamIdentityImage(detail.name, detail.logoUrl, 64)
        Spacer(Modifier.width(16.dp))
        Text(detail.name, modifier = Modifier.weight(1f), style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold)
    }
}

@Composable
private fun OverviewSection(detail: TeamProfile) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text(stringResource(R.string.team_overview), style = MaterialTheme.typography.titleLarge) }
        detail.standing?.let { standing -> item {
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.team_standing_rank, standing.rank),
                        style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
                    Text(stringResource(R.string.team_standing_record, standing.gamesPlayed,
                        standing.wins, standing.losses))
                }
            }
        } }
        if (detail.standing == null) item {
            Text(stringResource(R.string.team_no_standing), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

@Composable
private fun RosterSection(roster: List<TeamRosterPlayer>, onPlayerOpen: (String) -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)) {
        item { Text(stringResource(R.string.team_roster), style = MaterialTheme.typography.titleLarge) }
        if (roster.isEmpty()) item { Text(stringResource(R.string.team_no_roster)) }
        items(roster, key = { it.playerId }) { player ->
            Card(Modifier.fillMaxWidth().clickable { onPlayerOpen(player.playerId) }) {
                Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                    TeamIdentityImage(player.name, player.photoUrl, 44)
                    Spacer(Modifier.width(12.dp))
                    Text(player.name, modifier = Modifier.weight(1f),
                        style = MaterialTheme.typography.titleSmall)
                    player.jerseyNumber?.let {
                        Text(stringResource(R.string.team_jersey, it),
                            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}

@Composable
private fun StatisticsSection(state: TeamProfileUiState, onTogglePhase: (String) -> Unit,
    onRetry: () -> Unit) {
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (state.loadingPhases) item { InlineLoading() }
        if (state.phasesLoaded && state.phases.isEmpty()) item { Text(stringResource(R.string.no_phases)) }
        if (state.phases.isNotEmpty()) item {
            PhaseSelectionChips(state.phases, state.selectedPhaseIds, MAX_TEAM_STATS_PHASES, onTogglePhase)
        }
        if (state.loadingStatistics) item { InlineLoading() }
        state.statisticsFailure?.let { failure -> item {
            InlineFailure(failureMessage(failure), onRetry)
        } }
        state.statistics?.let { statistics ->
            item { StatisticsContent(statistics) }
        }
    }
}

@Composable
private fun StatisticsContent(statistics: TeamStatistics) {
    val locale = LocalConfiguration.current.locales[0]
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(stringResource(R.string.team_games_played, statistics.gamesPlayed),
            style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        if (statistics.gamesPlayed == 0) Text(stringResource(R.string.team_no_statistics))
        StatsCard(R.string.team_totals, statistics.totals, locale, 0)
        StatsCard(R.string.team_per_game, statistics.perGame, locale, 2)
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.team_shooting), style = MaterialTheme.typography.titleMedium)
                ShotRow(R.string.stats_two_point, statistics.shooting.twoPoint.made,
                    statistics.shooting.twoPoint.attempted, statistics.shooting.twoPoint.percentage, locale)
                ShotRow(R.string.stats_three_point, statistics.shooting.threePoint.made,
                    statistics.shooting.threePoint.attempted, statistics.shooting.threePoint.percentage, locale)
                ShotRow(R.string.stats_free_throws, statistics.shooting.freeThrow.made,
                    statistics.shooting.freeThrow.attempted, statistics.shooting.freeThrow.percentage, locale)
            }
        }
    }
}

@Composable
private fun StatsCard(@StringRes title: Int, line: TeamStatisticsLine, locale: Locale, digits: Int) {
    val values = listOf(
        R.string.team_points_scored to line.pointsScored,
        R.string.team_points_allowed to line.pointsAllowed,
        R.string.team_offensive_rebounds to line.offensiveRebounds,
        R.string.team_defensive_rebounds to line.defensiveRebounds,
        R.string.team_rebounds to line.rebounds,
        R.string.team_assists to line.assists,
        R.string.team_steals to line.steals,
        R.string.team_blocks to line.blocks,
        R.string.team_turnovers to line.turnovers,
        R.string.team_fouls to line.fouls,
        R.string.team_two_made to line.twoPointMade,
        R.string.team_two_attempts to line.twoPointAttempts,
        R.string.team_three_made to line.threePointMade,
        R.string.team_three_attempts to line.threePointAttempts,
        R.string.team_free_made to line.freeThrowMade,
        R.string.team_free_attempts to line.freeThrowAttempts,
    )
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(title), style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold)
            values.forEach { (label, value) ->
                MetricRow(label, formatTeamNumber(value, locale, digits))
            }
        }
    }
}

@Composable
private fun ShotRow(@StringRes label: Int, made: Int, attempted: Int, percentage: Double?, locale: Locale) {
    val percent = percentage?.let { stringResource(R.string.stats_percentage_value,
        formatTeamNumber(it, locale, 2)) } ?: stringResource(R.string.stats_no_percentage)
    MetricRow(label, stringResource(R.string.team_shooting_value, made, attempted, percent))
}

@Composable
private fun MetricRow(@StringRes label: Int, value: String) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(stringResource(label), modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
    }
}

internal fun formatTeamNumber(value: Double, locale: Locale, digits: Int): String =
    NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = digits }.format(value)

@Composable
private fun GamesSection(state: TeamProfileUiState, onRetryUpcoming: () -> Unit,
    onRetryRecent: () -> Unit) {
    val teamId = state.detail?.id ?: return
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item { Text(stringResource(R.string.team_upcoming), style = MaterialTheme.typography.titleLarge) }
        if (state.loadingUpcoming) item { InlineLoading() }
        state.upcomingFailure?.let { failure -> item {
            InlineFailure(failureMessage(failure), onRetryUpcoming)
        } }
        if (state.upcomingLoaded && state.upcoming.isEmpty()) item {
            Text(stringResource(R.string.team_no_upcoming))
        }
        items(state.upcoming, key = { "upcoming-${it.id}" }) { game -> TeamGameCard(game, teamId) }
        item { Text(stringResource(R.string.team_recent), style = MaterialTheme.typography.titleLarge) }
        if (state.loadingRecent) item { InlineLoading() }
        state.recentFailure?.let { failure -> item {
            InlineFailure(failureMessage(failure), onRetryRecent)
        } }
        if (state.recentLoaded && state.recent.isEmpty()) item {
            Text(stringResource(R.string.team_no_recent))
        }
        items(state.recent, key = { "recent-${it.id}" }) { game -> TeamGameCard(game, teamId) }
    }
}

@Composable
private fun TeamGameCard(game: PhaseGame, teamId: String) {
    val home = game.homeTeam.id == teamId
    val opponent = if (home) game.awayTeam else game.homeTeam
    val locale = LocalConfiguration.current.locales[0]
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(stringResource(if (home) R.string.team_home_opponent else R.string.team_away_opponent,
                opponent.name), style = MaterialTheme.typography.titleMedium)
            game.roundLabel?.let { Text(it, style = MaterialTheme.typography.bodySmall) }
            scheduleLabel(game.scheduledDate, game.scheduledTime, locale)?.let {
                Text(it, style = MaterialTheme.typography.bodySmall)
            }
            if (game.status == "completed" && game.homeScore != null && game.awayScore != null) {
                Text(stringResource(R.string.team_result_score, game.homeScore, game.awayScore),
                    style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
            }
            Text(stringResource(if (game.status == "completed") R.string.phase_completed
                else R.string.phase_scheduled), style = MaterialTheme.typography.labelMedium)
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
