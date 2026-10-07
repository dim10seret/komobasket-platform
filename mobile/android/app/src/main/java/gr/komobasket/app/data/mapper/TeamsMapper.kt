package gr.komobasket.app.data.mapper

import gr.komobasket.app.core.model.CompetitionTeam
import gr.komobasket.app.data.api.TeamsEnvelope

fun TeamsEnvelope.toTeamsModel(): List<CompetitionTeam> = data.map { team ->
    require(team.id.isNotBlank() && team.name.isNotBlank())
    CompetitionTeam(team.id, team.name, team.logoUrl)
}
