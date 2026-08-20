export type PhaseProgramGameStartEvidence = {
  status: string | null | undefined;
  homeScore: number | null | undefined;
  awayScore: number | null | undefined;
  resultSource: string | null | undefined;
  externalId: string | null | undefined;
  hasPlayerStats: boolean;
  hasCompetitiveDependency?: boolean;
};

export function isPhaseProgramGameSafelyUnstarted(game: PhaseProgramGameStartEvidence) {
  return String(game.status ?? "").trim().toLowerCase() === "scheduled"
    && game.homeScore === null
    && game.awayScore === null
    && !String(game.resultSource ?? "").trim()
    // Conservative until KomoControl/play-by-play exposes explicit started_at evidence.
    && !String(game.externalId ?? "").trim()
    && !game.hasPlayerStats
    && !game.hasCompetitiveDependency;
}

export function hasPhaseProgramStarted(games: readonly PhaseProgramGameStartEvidence[]) {
  return games.some((game) => !isPhaseProgramGameSafelyUnstarted(game));
}
