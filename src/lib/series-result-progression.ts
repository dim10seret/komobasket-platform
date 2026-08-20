import type { SeriesProgressionResult } from "./series-progression";
import {
  isPhaseProgramGameSafelyUnstarted,
  type PhaseProgramGameStartEvidence,
} from "./phase-program-delete-policy";

export type SeriesResultDownstreamGame = PhaseProgramGameStartEvidence & {
  gameId: string;
  seriesRoundNumber: number;
};

export type SeriesResultTransitionPlan = {
  qualifiedTeamId: string | null;
  qualificationRoundNumber: number | null;
  materializeRoundNumber: number | null;
  dematerializeGameIds: string[];
};

export class SeriesResultCorrectionBlockedError extends Error {
  readonly gameIds: string[];

  constructor(gameIds: string[]) {
    super("Η διόρθωση δεν επιτρέπεται επειδή μεταγενέστερος αγώνας έχει ξεκινήσει ή περιέχει αγωνιστικά δεδομένα.");
    this.name = "SeriesResultCorrectionBlockedError";
    this.gameIds = [...gameIds];
  }
}

export function planSeriesResultTransition(input: {
  proposedProgression: SeriesProgressionResult;
  resultRoundNumber: number;
  downstreamGames: readonly SeriesResultDownstreamGame[];
}): SeriesResultTransitionPlan {
  const invalidatedGames = input.downstreamGames.filter((game) => {
    if (game.seriesRoundNumber <= input.resultRoundNumber) return false;
    const proposedRow = input.proposedProgression.rounds.find(
      (row) => row.seriesRoundNumber === game.seriesRoundNumber,
    );
    return !proposedRow || proposedRow.rowState !== "real_game";
  });
  const blockedGameIds = invalidatedGames
    .filter((game) => !isPhaseProgramGameSafelyUnstarted(game))
    .map((game) => game.gameId);
  if (blockedGameIds.length) throw new SeriesResultCorrectionBlockedError(blockedGameIds);

  const nextRoundNumber = input.proposedProgression.nextRequiredRoundNumber;
  const nextRound = nextRoundNumber === null
    ? null
    : input.proposedProgression.rounds.find((row) => row.seriesRoundNumber === nextRoundNumber) ?? null;

  return {
    qualifiedTeamId: input.proposedProgression.qualifiedTeamId,
    qualificationRoundNumber: input.proposedProgression.qualificationRoundNumber,
    materializeRoundNumber: nextRound && !nextRound.realGameId ? nextRound.seriesRoundNumber : null,
    dematerializeGameIds: invalidatedGames.map((game) => game.gameId),
  };
}
