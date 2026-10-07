package gr.komobasket.app.core.datastore

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import gr.komobasket.app.core.model.AppSettings
import gr.komobasket.app.core.model.CompetitionContext
import javax.inject.Inject
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.appSettingsStore by preferencesDataStore(name = "app_settings")

interface AppContextRepository {
    val settings: Flow<AppSettings>
    suspend fun selectLanguage(tag: String)
    suspend fun selectSeason(id: String)
    suspend fun selectOrganization(id: String)
    suspend fun selectCompetition(id: String)
    suspend fun selectTournament(id: String)
    suspend fun commitContext(context: CompetitionContext): Boolean
    suspend fun completeOnboarding()
}

class DataStoreAppContextRepository internal constructor(
    private val store: DataStore<Preferences>,
) : AppContextRepository {
    @Inject constructor(@ApplicationContext context: Context) : this(context.appSettingsStore)

    private object Keys {
        val language = stringPreferencesKey("language_tag")
        val onboardingComplete = booleanPreferencesKey("onboarding_complete")
        val seasonId = stringPreferencesKey("season_id")
        val organizationId = stringPreferencesKey("organization_id")
        val competitionId = stringPreferencesKey("competition_id")
        val tournamentId = stringPreferencesKey("tournament_id")
    }

    override val settings: Flow<AppSettings> = store.data.map { prefs ->
        AppSettings(
            languageTag = prefs[Keys.language],
            onboardingComplete = prefs[Keys.onboardingComplete] ?: false,
            context = CompetitionContext(
                seasonId = prefs[Keys.seasonId],
                organizationId = prefs[Keys.organizationId],
                competitionId = prefs[Keys.competitionId],
                tournamentId = prefs[Keys.tournamentId],
            ),
        )
    }

    override suspend fun selectLanguage(tag: String) {
        require(tag == "en" || tag == "el")
        store.edit { it[Keys.language] = tag }
    }

    override suspend fun selectSeason(id: String) {
        require(id.isNotBlank())
        store.edit {
            it[Keys.seasonId] = id
            it.remove(Keys.organizationId)
            it.remove(Keys.competitionId)
            it.remove(Keys.tournamentId)
            it[Keys.onboardingComplete] = false
        }
    }

    override suspend fun selectOrganization(id: String) {
        require(id.isNotBlank())
        store.edit {
            require(!it[Keys.seasonId].isNullOrBlank())
            it[Keys.organizationId] = id
            it.remove(Keys.competitionId)
            it.remove(Keys.tournamentId)
            it[Keys.onboardingComplete] = false
        }
    }

    override suspend fun selectCompetition(id: String) {
        require(id.isNotBlank())
        store.edit {
            require(!it[Keys.seasonId].isNullOrBlank() && !it[Keys.organizationId].isNullOrBlank())
            it[Keys.competitionId] = id
            it.remove(Keys.tournamentId)
            it[Keys.onboardingComplete] = false
        }
    }

    override suspend fun selectTournament(id: String) {
        require(id.isNotBlank())
        store.edit {
            require(!it[Keys.seasonId].isNullOrBlank() && !it[Keys.organizationId].isNullOrBlank()
                && !it[Keys.competitionId].isNullOrBlank())
            if (it[Keys.tournamentId] != id) it[Keys.tournamentId] = id
        }
    }

    override suspend fun commitContext(context: CompetitionContext): Boolean {
        require(context.isComplete)
        var changed = false
        store.edit { prefs ->
            if (prefs[Keys.seasonId] != context.seasonId ||
                prefs[Keys.organizationId] != context.organizationId ||
                prefs[Keys.competitionId] != context.competitionId ||
                prefs[Keys.tournamentId] != context.tournamentId ||
                prefs[Keys.onboardingComplete] != true) {
                prefs[Keys.seasonId] = requireNotNull(context.seasonId)
                prefs[Keys.organizationId] = requireNotNull(context.organizationId)
                prefs[Keys.competitionId] = requireNotNull(context.competitionId)
                prefs[Keys.tournamentId] = requireNotNull(context.tournamentId)
                prefs[Keys.onboardingComplete] = true
                changed = true
            }
        }
        return changed
    }

    override suspend fun completeOnboarding() {
        store.edit {
            require(!it[Keys.seasonId].isNullOrBlank() && !it[Keys.organizationId].isNullOrBlank()
                && !it[Keys.competitionId].isNullOrBlank() && !it[Keys.tournamentId].isNullOrBlank())
            it[Keys.onboardingComplete] = true
        }
    }
}
