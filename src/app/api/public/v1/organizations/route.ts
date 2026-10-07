import { CATALOGUE_CACHE, catalogueError, requiredCatalogueId } from "@/app/api/public/v1/catalogue-response";
import { listMobileOrganizations } from "@/services/public-mobile-catalogue.service";

export async function GET(request: Request) {
  const seasonId = requiredCatalogueId(request, "seasonId");
  if (!seasonId) return catalogueError("INVALID_SEASON_ID", "A valid seasonId is required.", 400);

  try {
    const organizations = await listMobileOrganizations(seasonId);
    if (!organizations) return catalogueError("SEASON_NOT_FOUND", "Season not found.", 404);
    return Response.json({ data: organizations }, { headers: CATALOGUE_CACHE.organizations });
  } catch {
    return catalogueError("CATALOGUE_UNAVAILABLE", "Public catalogue is temporarily unavailable.", 503);
  }
}
