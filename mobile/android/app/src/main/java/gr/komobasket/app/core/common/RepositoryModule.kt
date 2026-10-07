package gr.komobasket.app.core.common

import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import gr.komobasket.app.core.datastore.AppContextRepository
import gr.komobasket.app.core.datastore.DataStoreAppContextRepository
import gr.komobasket.app.data.repository.CatalogueRepository
import gr.komobasket.app.data.repository.HttpCatalogueRepository
import gr.komobasket.app.data.repository.HomeRepository
import gr.komobasket.app.data.repository.HttpHomeRepository
import gr.komobasket.app.data.repository.HttpPhasesRepository
import gr.komobasket.app.data.repository.PhasesRepository
import gr.komobasket.app.data.repository.HttpRankingsRepository
import gr.komobasket.app.data.repository.RankingsRepository
import gr.komobasket.app.data.repository.HttpTeamsRepository
import gr.komobasket.app.data.repository.TeamsRepository
import gr.komobasket.app.data.repository.HttpTeamProfileRepository
import gr.komobasket.app.data.repository.TeamProfileRepository
import gr.komobasket.app.data.repository.HttpPlayerProfileRepository
import gr.komobasket.app.data.repository.PlayerProfileRepository
import gr.komobasket.app.data.repository.HttpOfficialMvpRepository
import gr.komobasket.app.data.repository.OfficialMvpRepository
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class RepositoryModule {
    @Binds
    @Singleton
    abstract fun catalogue(implementation: HttpCatalogueRepository): CatalogueRepository

    @Binds
    @Singleton
    abstract fun home(implementation: HttpHomeRepository): HomeRepository

    @Binds
    @Singleton
    abstract fun phases(implementation: HttpPhasesRepository): PhasesRepository

    @Binds
    @Singleton
    abstract fun rankings(implementation: HttpRankingsRepository): RankingsRepository

    @Binds
    @Singleton
    abstract fun teams(implementation: HttpTeamsRepository): TeamsRepository

    @Binds
    @Singleton
    abstract fun teamProfile(implementation: HttpTeamProfileRepository): TeamProfileRepository

    @Binds
    @Singleton
    abstract fun playerProfile(implementation: HttpPlayerProfileRepository): PlayerProfileRepository

    @Binds
    @Singleton
    abstract fun officialMvp(implementation: HttpOfficialMvpRepository): OfficialMvpRepository

    @Binds
    @Singleton
    abstract fun context(implementation: DataStoreAppContextRepository): AppContextRepository
}
