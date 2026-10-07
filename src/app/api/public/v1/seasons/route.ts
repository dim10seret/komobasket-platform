import { CATALOGUE_CACHE, catalogueError } from "@/app/api/public/v1/catalogue-response";
import { listMobileSeasons } from "@/services/public-mobile-catalogue.service";

export async function GET() {
  try {
    return Response.json({ data: await listMobileSeasons() }, { headers: CATALOGUE_CACHE.seasons });
  } catch {
    return catalogueError("CATALOGUE_UNAVAILABLE", "Public catalogue is temporarily unavailable.", 503);
  }
}
