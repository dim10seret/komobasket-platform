package gr.komobasket.app.core

import androidx.datastore.preferences.core.PreferenceDataStoreFactory
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import gr.komobasket.app.core.datastore.DataStoreAppContextRepository
import gr.komobasket.app.core.model.CompetitionContext
import java.io.File
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

@OptIn(ExperimentalCoroutinesApi::class)
class AppContextRepositoryTest {
    @get:Rule val temporaryFolder = TemporaryFolder()

    @Test
    fun persistsLanguageAndCompleteContextThenResetsChildrenForNewSeason() = runTest {
        val file = File(temporaryFolder.root, "app_settings.preferences_pb")
        val repository = DataStoreAppContextRepository(
            PreferenceDataStoreFactory.create(scope = backgroundScope, produceFile = { file }),
        )

        assertFalse(repository.settings.first().onboardingComplete)
        repository.selectLanguage("el")
        repository.selectSeason("season-a")
        repository.selectOrganization("organization-a")
        repository.selectCompetition("competition-a")
        repository.selectTournament("league-root")
        repository.completeOnboarding()

        val completed = repository.settings.first()
        assertEquals("el", completed.languageTag)
        assertEquals("season-a", completed.context.seasonId)
        assertEquals("organization-a", completed.context.organizationId)
        assertEquals("competition-a", completed.context.competitionId)
        assertEquals("league-root", completed.context.tournamentId)
        assertTrue(completed.context.isComplete)
        assertTrue(completed.onboardingComplete)

        repository.selectSeason("season-b")
        val changed = repository.settings.first()
        assertEquals("season-b", changed.context.seasonId)
        assertEquals(null, changed.context.organizationId)
        assertEquals(null, changed.context.competitionId)
        assertEquals(null, changed.context.tournamentId)
        assertFalse(changed.onboardingComplete)
    }

    @Test
    fun legacyThreeIdInstallKeepsOnboardingAndCanAddTournament() = runTest {
        val file = File(temporaryFolder.root, "legacy.preferences_pb")
        val store = PreferenceDataStoreFactory.create(scope = backgroundScope, produceFile = { file })
        store.edit {
            it[stringPreferencesKey("season_id")] = "season-a"
            it[stringPreferencesKey("organization_id")] = "organization-a"
            it[stringPreferencesKey("competition_id")] = "competition-a"
            it[booleanPreferencesKey("onboarding_complete")] = true
        }
        val repository = DataStoreAppContextRepository(store)
        val legacy = repository.settings.first()
        assertTrue(legacy.onboardingComplete)
        assertFalse(legacy.context.isComplete)
        assertEquals("competition-a", legacy.context.competitionId)

        repository.selectTournament("cup-root")
        repository.completeOnboarding()
        val upgraded = repository.settings.first()
        assertTrue(upgraded.onboardingComplete)
        assertTrue(upgraded.context.isComplete)
        assertEquals("cup-root", upgraded.context.tournamentId)
    }

    @Test
    fun tournamentSwitchKeepsParentsAndSurvivesRepositoryRecreation() = runTest {
        val file = File(temporaryFolder.root, "switch.preferences_pb")
        val store = PreferenceDataStoreFactory.create(scope = backgroundScope, produceFile = { file })
        val repository = DataStoreAppContextRepository(store)
        val league = CompetitionContext("season", "organization", "competition", "league")
        assertTrue(repository.commitContext(league))

        repository.selectTournament("cup")
        val restored = DataStoreAppContextRepository(store).settings.first()
        assertEquals(league.copy(tournamentId = "cup"), restored.context)
        assertTrue(restored.onboardingComplete)
        repository.selectTournament("cup")
        assertEquals(restored, repository.settings.first())
    }

    @Test
    fun changeContextWritesAllFourIdsInOneSettingsUpdate() = runTest {
        val file = File(temporaryFolder.root, "context.preferences_pb")
        val repository = DataStoreAppContextRepository(
            PreferenceDataStoreFactory.create(scope = backgroundScope, produceFile = { file }),
        )
        val old = CompetitionContext("old-season", "old-org", "old-comp", "old-root")
        val next = CompetitionContext("new-season", "new-org", "new-comp", "new-root")
        repository.commitContext(old)
        val emissions = mutableListOf<CompetitionContext>()
        val observer = backgroundScope.launch {
            repository.settings.map { it.context }.distinctUntilChanged().collect { emissions += it }
        }
        runCurrent()
        assertTrue(repository.commitContext(next))
        runCurrent()
        observer.cancel()
        assertEquals(listOf(old, next), emissions)
        assertFalse(repository.commitContext(next))
    }
}
