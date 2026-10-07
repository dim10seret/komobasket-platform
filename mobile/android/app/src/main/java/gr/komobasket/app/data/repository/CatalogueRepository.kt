package gr.komobasket.app.data.repository

import gr.komobasket.app.core.model.Competition
import gr.komobasket.app.core.model.Organization
import gr.komobasket.app.core.model.Season
import gr.komobasket.app.data.api.PublicCatalogueApi
import gr.komobasket.app.data.mapper.toModel
import javax.inject.Inject

interface CatalogueRepository {
    suspend fun seasons(): List<Season>
    suspend fun organizations(seasonId: String): List<Organization>
    suspend fun competitions(seasonId: String, organizationId: String): List<Competition>
}

class HttpCatalogueRepository @Inject constructor(
    private val api: PublicCatalogueApi,
) : CatalogueRepository {
    override suspend fun seasons() = api.seasons().data.map { it.toModel() }

    override suspend fun organizations(seasonId: String) =
        api.organizations(seasonId).data.map { it.toModel() }

    override suspend fun competitions(seasonId: String, organizationId: String) =
        api.competitions(seasonId, organizationId).data.map { it.toModel() }
}
