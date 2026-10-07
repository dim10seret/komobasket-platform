import { CATALOGUE_CACHE, catalogueError, requiredCatalogueId } from "@/app/api/public/v1/catalogue-response";
import { listMobileCompetitions } from "@/services/public-mobile-catalogue.service";

export async function GET(request: Request) {
  const seasonId = requiredCatalogueId(request, "seasonId");
  if (!seasonId) return catalogueError("INVALID_SEASON_ID", "A valid seasonId is required.", 400);
  const organizationId = requiredCatalogueId(request, "organizationId");
  if (!organizationId) return catalogueError("INVALID_ORGANIZATION_ID", "A valid organizationId is required.", 400);

  try {
    const competitions = await listMobileCompetitions(seasonId, organizationId);
    if (!competitions) return catalogueError("CATALOGUE_NOT_FOUND", "Catalogue selection not found.", 404);
    return Response.json({ data: competitions }, { headers: CATALOGUE_CACHE.competitions });
  } catch {
    return catalogueError("CATALOGUE_UNAVAILABLE", "Public catalogue is temporarily unavailable.", 503);
  }
}
