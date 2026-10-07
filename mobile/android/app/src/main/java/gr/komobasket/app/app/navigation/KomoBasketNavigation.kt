package gr.komobasket.app.app.navigation

import android.content.Intent
import android.widget.Toast
import androidx.annotation.StringRes
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.FormatListBulleted
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.core.net.toUri
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import gr.komobasket.app.R
import gr.komobasket.app.app.RootViewModel
import gr.komobasket.app.core.model.AppSettings
import gr.komobasket.app.core.common.CatalogueLoadState
import gr.komobasket.app.core.common.playerProfileRoute
import gr.komobasket.app.core.common.teamProfileRoute
import gr.komobasket.app.feature.home.HomeScreen
import gr.komobasket.app.feature.home.HomeViewModel
import gr.komobasket.app.feature.context.ChangeContextScreen
import gr.komobasket.app.feature.context.ChangeContextViewModel
import gr.komobasket.app.feature.more.AboutScreen
import gr.komobasket.app.feature.more.MoreScreen
import gr.komobasket.app.feature.onboarding.GuestScreen
import gr.komobasket.app.feature.onboarding.LanguageScreen
import gr.komobasket.app.feature.onboarding.OnboardingViewModel
import gr.komobasket.app.feature.onboarding.SelectionScreen
import gr.komobasket.app.feature.onboarding.TournamentGateState
import gr.komobasket.app.feature.onboarding.WelcomeScreen
import gr.komobasket.app.feature.phases.PhasesScreen
import gr.komobasket.app.feature.phases.PhasesViewModel
import gr.komobasket.app.feature.player.PlayerProfileScreen
import gr.komobasket.app.feature.player.PlayerProfileViewModel
import gr.komobasket.app.feature.stats.StatsScreen
import gr.komobasket.app.feature.stats.StatsViewModel
import gr.komobasket.app.feature.teams.TeamsScreen
import gr.komobasket.app.feature.teams.TeamsViewModel
import gr.komobasket.app.feature.teams.TeamProfileScreen
import gr.komobasket.app.feature.teams.TeamProfileViewModel
import kotlinx.coroutines.launch

private data class MainTab(val route: String, @param:StringRes val label: Int, val icon: ImageVector)

private val mainTabs = listOf(
    MainTab("home", R.string.home, Icons.Outlined.Home),
    MainTab("phases", R.string.phases, Icons.AutoMirrored.Outlined.FormatListBulleted),
    MainTab("stats", R.string.stats_tab, Icons.Outlined.BarChart),
    MainTab("teams", R.string.teams, Icons.Outlined.Groups),
    MainTab("more", R.string.more_tab, Icons.Outlined.MoreHoriz),
)

@Composable
fun KomoBasketNavigation(
    settings: AppSettings,
    rootViewModel: RootViewModel,
    onboardingViewModel: OnboardingViewModel,
) {
    val navController = rememberNavController()
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val initialRoute = rememberSaveable {
        if (settings.onboardingComplete && !settings.context.competitionId.isNullOrBlank() &&
            !settings.context.seasonId.isNullOrBlank() && !settings.context.organizationId.isNullOrBlank())
            "tournament" else "welcome"
    }
    val currentRoute = navController.currentBackStackEntryAsState().value?.destination?.route
    val catalogueState by onboardingViewModel.catalogue.collectAsStateWithLifecycle()
    val tournamentState by onboardingViewModel.tournament.collectAsStateWithLifecycle()
    val activeTournament by rootViewModel.tournament.collectAsStateWithLifecycle()
    val organizationQuery by onboardingViewModel.organizationQuery.collectAsStateWithLifecycle()
    val switchTournament: (String) -> Unit = { id ->
        scope.launch {
            if (rootViewModel.switchTournament(id)) {
                navController.navigate("home") {
                    popUpTo("home") { inclusive = true }
                    launchSingleTop = true
                }
            }
        }
    }

    Scaffold(bottomBar = {
        if (mainTabs.any { it.route == currentRoute }) {
            NavigationBar {
                mainTabs.forEach { tab ->
                    NavigationBarItem(
                        selected = currentRoute == tab.route,
                        onClick = {
                            navController.navigate(tab.route) {
                                popUpTo("home")
                                launchSingleTop = true
                            }
                        },
                        icon = { Icon(tab.icon, contentDescription = null) },
                        label = { Text(stringResource(tab.label)) },
                    )
                }
            }
        }
    }) { padding ->
        NavHost(navController, startDestination = initialRoute, modifier = Modifier.padding(padding)) {
            composable("welcome") {
                WelcomeScreen { navController.navigate("language") }
            }
            composable("language") {
                LanguageScreen(
                    selectedTag = settings.languageTag,
                    onSelect = rootViewModel::selectLanguage,
                    onContinue = {
                        if (settings.onboardingComplete && settings.context.isComplete) navController.popBackStack()
                        else navController.navigate("guest")
                    },
                )
            }
            composable("guest") {
                GuestScreen { navController.navigate("season") }
            }
            composable("season") {
                LaunchedEffect(Unit) { onboardingViewModel.loadSeasons() }
                SelectionScreen(R.string.season_title, R.string.empty_seasons, catalogueState,
                    onRetry = onboardingViewModel::loadSeasons,
                    onSelect = { id -> scope.launch {
                        onboardingViewModel.selectSeason(id)
                        navController.navigate("organization")
                    } },
                )
            }
            composable("organization") {
                val seasonId = settings.context.seasonId
                LaunchedEffect(seasonId) {
                    if (seasonId != null) onboardingViewModel.loadOrganizations(seasonId)
                }
                SelectionScreen(R.string.organization_title, R.string.empty_organizations, catalogueState,
                    onRetry = { if (seasonId != null) onboardingViewModel.loadOrganizations(seasonId) },
                    onSelect = { id -> scope.launch {
                        onboardingViewModel.selectOrganization(id)
                        navController.navigate("competition")
                    } },
                    searchQuery = organizationQuery,
                    onSearch = onboardingViewModel::searchOrganizations,
                )
            }
            composable("competition") {
                val seasonId = settings.context.seasonId
                val organizationId = settings.context.organizationId
                LaunchedEffect(seasonId, organizationId) {
                    if (seasonId != null && organizationId != null) {
                        onboardingViewModel.loadCompetitions(seasonId, organizationId)
                    }
                }
                SelectionScreen(R.string.competition_title, R.string.empty_competitions, catalogueState,
                    onRetry = {
                        if (seasonId != null && organizationId != null) {
                            onboardingViewModel.loadCompetitions(seasonId, organizationId)
                        }
                    },
                    onSelect = { id -> scope.launch {
                        onboardingViewModel.selectCompetition(id)
                        navController.navigate("tournament") {
                            popUpTo(navController.graph.startDestinationId) { inclusive = true }
                            launchSingleTop = true
                        }
                    } },
                )
            }
            composable("tournament") {
                val competitionId = settings.context.competitionId
                val savedTournamentId = settings.context.tournamentId
                LaunchedEffect(competitionId, savedTournamentId) {
                    if (competitionId != null) onboardingViewModel.loadTournaments(competitionId, savedTournamentId)
                }
                LaunchedEffect(tournamentState) {
                    if (tournamentState == TournamentGateState.Validated) {
                        navController.navigate("home") {
                            popUpTo("tournament") { inclusive = true }
                            launchSingleTop = true
                        }
                    }
                }
                val selectionState = when (val state = tournamentState) {
                    TournamentGateState.Loading, TournamentGateState.Validated -> CatalogueLoadState.Loading
                    TournamentGateState.Empty -> CatalogueLoadState.Empty
                    TournamentGateState.NoNetwork -> CatalogueLoadState.NoNetwork
                    TournamentGateState.HttpError -> CatalogueLoadState.HttpError
                    TournamentGateState.MalformedResponse -> CatalogueLoadState.MalformedResponse
                    is TournamentGateState.Selection -> CatalogueLoadState.Ready(state.options)
                }
                SelectionScreen(R.string.tournament_title, R.string.empty_tournaments, selectionState,
                    onRetry = {
                        if (competitionId != null) onboardingViewModel.loadTournaments(competitionId, savedTournamentId)
                    },
                    onSelect = { id -> scope.launch {
                        if (onboardingViewModel.selectTournament(id)) {
                            navController.navigate("home") {
                                popUpTo("tournament") { inclusive = true }
                                launchSingleTop = true
                            }
                        }
                    } },
                )
            }
            composable("home") {
                val homeViewModel: HomeViewModel = hiltViewModel()
                val homeState by homeViewModel.state.collectAsStateWithLifecycle()
                HomeScreen(
                    state = homeState,
                    tournament = activeTournament,
                    onRetryTournament = rootViewModel::retryTournaments,
                    onSelectTournament = switchTournament,
                    onRetry = homeViewModel::retry,
                    onChooseCompetition = {
                        navController.navigate(
                            if (settings.context.seasonId != null && settings.context.organizationId != null)
                                "competition" else "season"
                        )
                    },
                    onOpenLive = { url ->
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }
                            .onFailure {
                                Toast.makeText(context, R.string.browser_unavailable, Toast.LENGTH_SHORT).show()
                            }
                    },
                    onOpenPlayer = { playerId ->
                        playerProfileRoute(playerId)?.let(navController::navigate)
                    },
                    onOpenTeam = { teamId ->
                        teamProfileRoute(teamId)?.let(navController::navigate)
                    },
                )
            }
            composable("phases") {
                val phasesViewModel: PhasesViewModel = hiltViewModel()
                val phasesState by phasesViewModel.state.collectAsStateWithLifecycle()
                PhasesScreen(
                    state = phasesState,
                    tournament = activeTournament,
                    onRetryTournament = rootViewModel::retryTournaments,
                    onSelectTournament = switchTournament,
                    onRetryDetail = phasesViewModel::retryDetail,
                    onChooseCompetition = {
                        navController.navigate(
                            if (settings.context.seasonId != null && settings.context.organizationId != null)
                                "competition" else "season"
                        )
                    },
                    onSelectPhase = phasesViewModel::selectPhase,
                    onSelectView = phasesViewModel::selectView,
                    onRefresh = phasesViewModel::refreshView,
                    onLoadMore = phasesViewModel::loadMore,
                    onOpenLive = { url ->
                        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) }
                            .onFailure {
                                Toast.makeText(context, R.string.browser_unavailable, Toast.LENGTH_SHORT).show()
                            }
                    },
                    onOpenTeam = { teamId ->
                        teamProfileRoute(teamId)?.let(navController::navigate)
                    },
                )
            }
            composable("stats") {
                val statsViewModel: StatsViewModel = hiltViewModel()
                val statsState by statsViewModel.state.collectAsStateWithLifecycle()
                StatsScreen(
                    state = statsState,
                    tournament = activeTournament,
                    onRetryTournament = rootViewModel::retryTournaments,
                    onSelectTournament = switchTournament,
                    onRetryDetail = statsViewModel::retryDetail,
                    onChooseCompetition = {
                        navController.navigate(
                            if (settings.context.seasonId != null && settings.context.organizationId != null)
                                "competition" else "season"
                        )
                    },
                    onTogglePhase = statsViewModel::togglePhase,
                    onSelectCategory = statsViewModel::selectCategory,
                    onRefresh = statsViewModel::refresh,
                    onLoadMore = statsViewModel::loadMore,
                    onPlayerOpen = { playerId ->
                        playerProfileRoute(playerId)?.let(navController::navigate)
                    },
                    onTeamOpen = { teamId ->
                        teamProfileRoute(teamId)?.let(navController::navigate)
                    },
                )
            }
            composable("teams") {
                val teamsViewModel: TeamsViewModel = hiltViewModel()
                val teamsState by teamsViewModel.state.collectAsStateWithLifecycle()
                TeamsScreen(
                    state = teamsState,
                    onRefresh = teamsViewModel::refresh,
                    onTeamClick = { teamId ->
                        teamProfileRoute(teamId)?.let(navController::navigate)
                    },
                    onChooseCompetition = {
                        navController.navigate(
                            if (settings.context.seasonId != null && settings.context.organizationId != null)
                                "competition" else "season"
                        )
                    },
                )
            }
            composable("team/{teamId}") {
                val profileViewModel: TeamProfileViewModel = hiltViewModel()
                val profileState by profileViewModel.state.collectAsStateWithLifecycle()
                TeamProfileScreen(
                    state = profileState,
                    onBack = { navController.popBackStack() },
                    onChooseCompetition = {
                        navController.navigate(
                            if (settings.context.seasonId != null && settings.context.organizationId != null)
                                "competition" else "season"
                        )
                    },
                    onRetryDetail = profileViewModel::retryDetail,
                    onSelectSection = profileViewModel::selectSection,
                    onTogglePhase = profileViewModel::togglePhase,
                    onRetryStatistics = profileViewModel::retryStatistics,
                    onRetryUpcoming = profileViewModel::retryUpcoming,
                    onRetryRecent = profileViewModel::retryRecent,
                    onPlayerOpen = { playerId ->
                        playerProfileRoute(playerId)?.let(navController::navigate)
                    },
                )
            }
            composable("player/{playerId}") {
                val playerViewModel: PlayerProfileViewModel = hiltViewModel()
                val playerState by playerViewModel.state.collectAsStateWithLifecycle()
                PlayerProfileScreen(
                    state = playerState,
                    onBack = { navController.popBackStack() },
                    onChooseCompetition = {
                        navController.navigate(
                            if (settings.context.seasonId != null && settings.context.organizationId != null)
                                "competition" else "season"
                        )
                    },
                    onRetryPhases = playerViewModel::retryPhases,
                    onTogglePhase = playerViewModel::togglePhase,
                    onRefresh = playerViewModel::refresh,
                    onCurrentTeamOpen = { teamId ->
                        teamProfileRoute(teamId)?.let { route ->
                            val previous = navController.previousBackStackEntry
                            if (previous?.destination?.route == "team/{teamId}" &&
                                previous.arguments?.getString("teamId") == teamId) {
                                navController.popBackStack()
                            } else navController.navigate(route)
                        }
                    },
                )
            }
            composable("more") {
                MoreScreen(onLanguage = { navController.navigate("language") },
                    onAbout = { navController.navigate("about") },
                    onChangeContext = { navController.navigate("change-context") })
            }
            composable("change-context") {
                val changeViewModel: ChangeContextViewModel = hiltViewModel()
                val changeState by changeViewModel.state.collectAsStateWithLifecycle()
                LaunchedEffect(Unit) { changeViewModel.start() }
                ChangeContextScreen(
                    state = changeState,
                    onBack = { if (!changeViewModel.back()) navController.popBackStack() },
                    onCancel = { navController.popBackStack() },
                    onRetry = changeViewModel::retry,
                    onSearch = changeViewModel::searchOrganizations,
                    onSelect = changeViewModel::select,
                    onCommit = { scope.launch {
                        if (changeViewModel.commit()) {
                            navController.navigate("home") {
                                popUpTo("home") { inclusive = true }
                                launchSingleTop = true
                            }
                        }
                    } },
                )
            }
            composable("about") { AboutScreen() }
        }
    }
}
