import { catalogueError } from "@/app/api/public/v1/catalogue-response";
import { MobileTeamError } from "@/services/public-mobile-team.service";

export const MOBILE_TEAM_CACHE = {
  list: { "Cache-Control": "public, max-age=120, s-maxage=600" },
  detail: { "Cache-Control": "public, max-age=60, s-maxage=300" },
  statistics: { "Cache-Control": "public, max-age=15, s-maxage=60" },
} as const;

export function mobileTeamError(error: unknown): Response {
  if (error instanceof MobileTeamError) {
    const status = error.code === "INVALID_PHASES" ? 400
      : error.code === "TEAM_DATA_UNAVAILABLE" ? 503 : 404;
    const message = status === 400 ? "Valid phaseIds are required."
      : status === 503 ? "Public team data is temporarily unavailable."
      : "Public selection not found.";
    return catalogueError(error.code, message, status);
  }
  return catalogueError("TEAM_DATA_UNAVAILABLE", "Public team data is temporarily unavailable.", 503);
}
