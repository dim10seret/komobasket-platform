package gr.komobasket.app.data.repository

import gr.komobasket.app.core.common.validPublicRouteId
import gr.komobasket.app.core.model.OfficialMvp
import gr.komobasket.app.core.model.OfficialMvpScope
import gr.komobasket.app.data.api.PublicOfficialMvpApi
import gr.komobasket.app.data.mapper.toModel
import javax.inject.Inject

interface OfficialMvpRepository {
    suspend fun current(scope: OfficialMvpScope): OfficialMvp?
}

class HttpOfficialMvpRepository @Inject constructor(
    private val api: PublicOfficialMvpApi,
) : OfficialMvpRepository {
    override suspend fun current(scope: OfficialMvpScope): OfficialMvp? {
        require(validPublicRouteId(scope.competitionId) && validPublicRouteId(scope.phaseId) &&
            scope.round in 1..10000)
        return api.current(scope.competitionId, scope.phaseId, scope.round).data?.toModel(scope)
    }
}
