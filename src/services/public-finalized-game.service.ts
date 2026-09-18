import "server-only";

import { projectPublicFinalizedGame, type PublicFinalizedGameDetail } from "@/lib/public-finalized-game";
import { PUBLIC_KOMOBASKET_ORGANIZATION_ID } from "@/services/public-competition.service";
import { readPlatformMatchReport } from "@/services/platform-match-report.service";

export type PublicFinalizedGameReadResult =
  | { kind: "game"; game: PublicFinalizedGameDetail }
  | { kind: "unavailable" };

export async function readPublicFinalizedGameForOrganization(
  organizationId: string,
  gameId: string,
): Promise<PublicFinalizedGameReadResult> {
  const normalizedGameId = gameId.trim();
  if (!normalizedGameId) return { kind: "unavailable" };
  const result = await readPlatformMatchReport(normalizedGameId, organizationId);
  return result.kind === "report"
    ? { kind: "game", game: projectPublicFinalizedGame(result.report) }
    : { kind: "unavailable" };
}

export async function readPublicFinalizedGame(gameId: string): Promise<PublicFinalizedGameReadResult> {
  return readPublicFinalizedGameForOrganization(PUBLIC_KOMOBASKET_ORGANIZATION_ID, gameId);
}
