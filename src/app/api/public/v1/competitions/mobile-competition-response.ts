import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { MobileCompetitionError } from "@/services/public-mobile-competition.service";

export const MOBILE_COMPETITION_CACHE = {
  detail: { "Cache-Control": "public, max-age=300, s-maxage=1800" },
  phase: { "Cache-Control": "public, max-age=300, s-maxage=1800" },
  games: { "Cache-Control": "public, max-age=30, s-maxage=60" },
  standings: { "Cache-Control": "public, max-age=60, s-maxage=300" },
} as const;

export function routeId(value: string): string | null {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

export function singleQueryId(request: Request, name: string): string | null {
  const values = new URL(request.url).searchParams.getAll(name);
  return values.length === 1 ? routeId(values[0]) : null;
}

export function mobileCompetitionError(error: unknown): Response {
  if (error instanceof MobileCompetitionError) {
    const status = error.code === "INVALID_CURSOR" ? 400
      : error.code === "STANDINGS_NOT_AVAILABLE" ? 409
      : error.code === "CATALOGUE_UNAVAILABLE" ? 503 : 404;
    const message = status === 503 ? "Public competition data is temporarily unavailable."
      : status === 409 ? "Standings are not available for this phase."
      : status === 400 ? "Invalid pagination cursor."
      : "Public selection not found.";
    return catalogueError(error.code, message, status);
  }
  return catalogueError("CATALOGUE_UNAVAILABLE", "Public competition data is temporarily unavailable.", 503);
}
