package gr.komobasket.app.data.mapper

import gr.komobasket.app.core.model.Competition
import gr.komobasket.app.core.model.Organization
import gr.komobasket.app.core.model.Season
import gr.komobasket.app.data.api.CompetitionDto
import gr.komobasket.app.data.api.OrganizationDto
import gr.komobasket.app.data.api.SeasonDto

fun SeasonDto.toModel() = Season(id = id, name = name, startDate = startDate, endDate = endDate)

fun OrganizationDto.toModel() = Organization(id = id, name = name, slug = slug, logoUrl = logoUrl)

fun CompetitionDto.toModel() = Competition(
    id = id,
    seasonId = seasonId,
    organizationId = organizationId,
    name = name,
    slug = slug,
    type = type,
    logoUrl = logoUrl,
)
