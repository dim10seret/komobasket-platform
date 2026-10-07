package gr.komobasket.app.data.mapper

import gr.komobasket.app.core.common.validPublicRouteId
import gr.komobasket.app.core.model.OfficialMvp
import gr.komobasket.app.core.model.OfficialMvpPerformance
import gr.komobasket.app.core.model.OfficialMvpPlayer
import gr.komobasket.app.core.model.OfficialMvpScope
import gr.komobasket.app.core.model.OfficialMvpTeam
import gr.komobasket.app.data.api.OfficialMvpDto

fun OfficialMvpDto.toModel(scope: OfficialMvpScope): OfficialMvp {
    require(competitionId == scope.competitionId && phaseId == scope.phaseId && round == scope.round)
    require(id.isNotBlank() && selectedAt.isNotBlank() && validPublicRouteId(gameId))
    require(validPublicRouteId(player.id) && player.name.isNotBlank())
    require(team == null || (validPublicRouteId(team.id) && team.name.isNotBlank()))
    return OfficialMvp(
        selectionId = id, selectedAt = selectedAt, competitionId = competitionId,
        phaseId = phaseId, round = round, gameId = gameId,
        player = OfficialMvpPlayer(player.id, player.name, player.photoUrl),
        team = team?.let { OfficialMvpTeam(it.id, it.name, it.logoUrl) },
        performance = performance?.let {
            OfficialMvpPerformance(it.points, it.rebounds, it.assists, it.efficiency)
        },
    )
}
