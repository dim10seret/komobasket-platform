package gr.komobasket.app.core.common

private val CANONICAL_PUBLIC_ID = Regex("[A-Za-z0-9][A-Za-z0-9_-]{0,199}")

fun validPublicRouteId(id: String?): Boolean = id != null && CANONICAL_PUBLIC_ID.matches(id)

fun playerProfileRoute(playerId: String): String? =
    if (validPublicRouteId(playerId)) "player/$playerId" else null

fun validPlayerId(playerId: String?): Boolean = validPublicRouteId(playerId)

fun teamProfileRoute(teamId: String): String? =
    if (validPublicRouteId(teamId)) "team/$teamId" else null

fun validTeamId(teamId: String?): Boolean = validPublicRouteId(teamId)
