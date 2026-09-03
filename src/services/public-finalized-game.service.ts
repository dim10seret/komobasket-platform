import "server-only";

import { projectPublicFinalizedGame, type PublicFinalizedGameDetail } from "@/lib/public-finalized-game";
import { PUBLIC_KOMOBASKET_ORGANIZATION_ID } from "@/services/public-competition.service";
import { readPlatformMatchReport } from "@/services/platform-match-report.service";

export type PublicFinalizedGameReadResult =
  | { kind: "game"; game: PublicFinalizedGameDetail }
  | { kind: "unavailable" };

export async function readPublicFinalizedGame(gameId: string): Promise<PublicFinalizedGameReadResult> {
  const normalizedGameId = gameId.trim();
  if (!normalizedGameId) return { kind: "unavailable" };
  const result = await readPlatformMatchReport(normalizedGameId, PUBLIC_KOMOBASKET_ORGANIZATION_ID);
  return result.kind === "report"
    ? { kind: "game", game: projectPublicFinalizedGame(result.report) }
    : { kind: "unavailable" };
}
