package gr.komobasket.app.core.model

data class TeamProfile(
    val id: String,
    val competitionId: String,
    val name: String,
    val logoUrl: String?,
    val currentPhaseId: String?,
    val standing: TeamStanding?,
    val roster: List<TeamRosterPlayer>,
)

data class TeamStanding(
    val phaseId: String,
    val rank: Int,
    val gamesPlayed: Int,
    val wins: Int,
    val losses: Int,
)

data class TeamRosterPlayer(
    val playerId: String,
    val name: String,
    val photoUrl: String?,
    val jerseyNumber: Int?,
)

data class TeamStatistics(
    val teamId: String,
    val competitionId: String,
    val phaseIds: List<String>,
    val gamesPlayed: Int,
    val totals: TeamStatisticsLine,
    val perGame: TeamStatisticsLine,
    val shooting: TeamShooting,
)

data class TeamStatisticsLine(
    val pointsScored: Double,
    val pointsAllowed: Double,
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
)

data class TeamShooting(val twoPoint: TeamShot, val threePoint: TeamShot, val freeThrow: TeamShot)

data class TeamShot(val made: Int, val attempted: Int, val percentage: Double?)
