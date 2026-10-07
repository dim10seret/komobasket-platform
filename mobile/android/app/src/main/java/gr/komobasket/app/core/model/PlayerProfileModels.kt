package gr.komobasket.app.core.model

data class PlayerProfile(
    val id: String,
    val name: String,
    val photoUrl: String?,
    val competitionId: String,
    val currentTeam: PlayerTeam?,
    val jerseyNumber: String?,
    val phaseIds: List<String>,
    val gamesPlayed: Int,
    val totals: PlayerTotals,
    val perGame: PlayerAverages,
    val shooting: PlayerShooting,
    val recentGames: List<PlayerRecentGame>,
)

data class PlayerTeam(val id: String, val name: String, val logoUrl: String?)
data class PlayerGameTeam(val id: String, val name: String)

data class PlayerTotals(
    val points: Double,
    val twoPointMade: Double,
    val twoPointAttempts: Double,
    val threePointMade: Double,
    val threePointAttempts: Double,
    val freeThrowMade: Double,
    val freeThrowAttempts: Double,
    val offensiveRebounds: Double,
    val defensiveRebounds: Double,
    val rebounds: Double,
    val assists: Double,
    val steals: Double,
    val blocks: Double,
    val turnovers: Double,
    val fouls: Double,
    val efficiency: Double,
)

data class PlayerAverages(
    val points: Double?,
    val rebounds: Double?,
    val assists: Double?,
    val steals: Double?,
    val blocks: Double?,
    val turnovers: Double?,
    val fouls: Double?,
    val efficiency: Double?,
)

data class PlayerShooting(val twoPoint: PlayerShot, val threePoint: PlayerShot, val freeThrow: PlayerShot)
data class PlayerShot(val made: Int, val attempted: Int, val percentage: Double?)

data class PlayerRecentGame(
    val gameId: String,
    val phaseId: String,
    val round: Int?,
    val roundLabel: String?,
    val scheduledDate: String?,
    val scheduledTime: String?,
    val playerTeam: PlayerGameTeam,
    val opponentTeam: PlayerGameTeam,
    val teamScore: Int,
    val opponentScore: Int,
    val outcome: String,
    val points: Int,
    val rebounds: Int,
    val assists: Int,
    val efficiency: Int,
)
