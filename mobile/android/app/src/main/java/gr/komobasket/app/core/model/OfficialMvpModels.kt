package gr.komobasket.app.core.model

import gr.komobasket.app.core.common.validPublicRouteId

data class OfficialMvpScope(val competitionId: String, val phaseId: String, val round: Int)

/** A3's numeric current round is C1's round_number only for standings phases. */
fun CompetitionHome.currentOfficialMvpScope(): OfficialMvpScope? {
    val phase = currentPhase ?: return null
    val phaseId = currentPhaseId ?: return null
    val round = currentRound?.number ?: return null
    if (phase.format != "standings" || phase.id != phaseId ||
        !validPublicRouteId(competition.id) || !validPublicRouteId(phaseId) ||
        round !in 1..10000) return null
    return OfficialMvpScope(competition.id, phaseId, round)
}

data class OfficialMvp(
    val selectionId: String,
    val selectedAt: String,
    val competitionId: String,
    val phaseId: String,
    val round: Int,
    val gameId: String,
    val player: OfficialMvpPlayer,
    val team: OfficialMvpTeam?,
    val performance: OfficialMvpPerformance?,
)

data class OfficialMvpPlayer(val id: String, val name: String, val photoUrl: String?)
data class OfficialMvpTeam(val id: String, val name: String, val logoUrl: String?)
data class OfficialMvpPerformance(val points: Int, val rebounds: Int, val assists: Int, val efficiency: Int)
