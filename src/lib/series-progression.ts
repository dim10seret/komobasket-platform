export type SeriesProgressionTeam = {
  id: string;
  name: string;
};

export type SeriesProgressionTransferredGame = {
  sourceGameId: string;
  seriesRoundNumber: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  status: string;
  date?: string | null;
  time?: string | null;
  venue?: string | null;
};

export type SeriesProgressionMaterializedGame = {
  matchupId?: string | null;
  gameId: string;
  seriesRoundNumber: number;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  date?: string | null;
  time?: string | null;
  venue?: string | null;
};

export type SeriesProgressionPlanningSlot = {
  seriesRoundNumber: number;
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  venue?: string | null;
};

export type SeriesProgressionInput = {
  matchupId: string;
  teamA: SeriesProgressionTeam;
  teamB: SeriesProgressionTeam;
  winsRequired: number;
  transferredGames?: SeriesProgressionTransferredGame[];
  materializedGames?: SeriesProgressionMaterializedGame[];
  planningSlots?: SeriesProgressionPlanningSlot[];
};

export type SeriesProgressionRowState = "transferred" | "real_game" | "if_needed" | "qualified";

export type SeriesProgressionRoundRow = {
  seriesRoundNumber: number;
  rowState: SeriesProgressionRowState;
  expectedHomeTeamId: string | null;
  expectedHomeTeamName: string | null;
  expectedAwayTeamId: string | null;
  expectedAwayTeamName: string | null;
  sourceGameId: string | null;
  realGameId: string | null;
  planningSlot: SeriesProgressionPlanningSlot | null;
  homeTeamId: string | null;
  homeTeamName: string | null;
  awayTeamId: string | null;
  awayTeamName: string | null;
  homeScore: number | null;
  awayScore: number | null;
  winnerTeamId: string | null;
  winnerTeamName: string | null;
  qualificationRoundNumber: number | null;
  nextRequiredRoundNumber: number | null;
};

export type SeriesProgressionResult = {
  matchupId: string;
  teamAId: string;
  teamAName: string;
  teamBId: string;
  teamBName: string;
  winsRequired: number;
  maximumSeriesRounds: number;
  minimumNewRounds: number;
  maximumNewRounds: number;
  transferredRoundCount: number;
  currentWinsA: number;
  currentWinsB: number;
  qualifiedTeamId: string | null;
  qualifiedTeamName: string | null;
  qualificationRoundNumber: number | null;
  nextRequiredRoundNumber: number | null;
  rounds: SeriesProgressionRoundRow[];
};

type NormalizedTeam = SeriesProgressionTeam;

type RoundEntry = {
  seriesRoundNumber: number;
  rowState: SeriesProgressionRowState;
  sourceGameId: string | null;
  realGameId: string | null;
  planningSlot: SeriesProgressionPlanningSlot | null;
  game: SeriesProgressionTransferredGame | SeriesProgressionMaterializedGame | null;
};

export type SeriesRoundWindowInput = {
  winsRequired: number;
  currentWinsA: number;
  currentWinsB: number;
  qualified: boolean;
};

export const calculateSeriesRoundWindow = (input: SeriesRoundWindowInput) => {
  const winsRequired = normalizeRequiredRound(input.winsRequired, "Οι νίκες για πρόκριση");
  const maximumSeriesRounds = (winsRequired * 2) - 1;
  const currentWinsA = Math.max(0, Math.floor(Number(input.currentWinsA ?? 0) || 0));
  const currentWinsB = Math.max(0, Math.floor(Number(input.currentWinsB ?? 0) || 0));
  if (input.qualified) {
    return {
      minimumNewRounds: 0,
      maximumNewRounds: 0,
      maximumSeriesRounds,
    };
  }
  const currentBest = Math.max(currentWinsA, currentWinsB);
  return {
    minimumNewRounds: Math.max(0, winsRequired - currentBest),
    maximumNewRounds: Math.max(0, maximumSeriesRounds - (currentWinsA + currentWinsB)),
    maximumSeriesRounds,
  };
};

const toInt = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
};

const normalizeTeam = (team: SeriesProgressionTeam | undefined, label: string): NormalizedTeam => {
  const id = String(team?.id ?? "").trim();
  const name = String(team?.name ?? "").trim();
  if (!id) throw new Error(`${label} πρέπει να έχει σταθερό αναγνωριστικό.`);
  if (!name) throw new Error(`${label} πρέπει να έχει όνομα.`);
  return { id, name };
};

const normalizeRequiredRound = (value: unknown, label: string) => {
  const round = toInt(value, 0);
  if (round < 1) throw new Error(`${label} πρέπει να είναι ακέραιος θετικός αριθμός.`);
  return round;
};

const parseScore = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Το πεδίο «${label}» πρέπει να είναι ακέραιος μη αρνητικός αριθμός.`);
  }
  return parsed;
};

const isCompletedResult = (status: string | null, homeScore: number | null, awayScore: number | null) => {
  if (String(status ?? "").trim().toLowerCase() !== "completed") return false;
  if (homeScore === null || awayScore === null) return false;
  if (homeScore === awayScore) return false;
  return true;
};

const resolveWinner = (
  homeTeamId: string,
  awayTeamId: string,
  homeScore: number,
  awayScore: number,
  teamAId: string,
  teamBId: string,
) => {
  const homeWon = homeScore > awayScore;
  if (homeTeamId === teamAId && awayTeamId === teamBId) return homeWon ? teamAId : teamBId;
  if (homeTeamId === teamBId && awayTeamId === teamAId) return homeWon ? teamBId : teamAId;
  return null;
};

const expectedOrientation = (roundNumber: number, teamAId: string, teamBId: string) => {
  return roundNumber % 2 === 1
    ? { homeTeamId: teamAId, awayTeamId: teamBId }
    : { homeTeamId: teamBId, awayTeamId: teamAId };
};

const validateGameForMatchup = (
  homeTeamId: string,
  awayTeamId: string,
  teamAId: string,
  teamBId: string,
) => {
  const matchesPair =
    (homeTeamId === teamAId && awayTeamId === teamBId) ||
    (homeTeamId === teamBId && awayTeamId === teamAId);
  if (!matchesPair) throw new Error("Ο αγώνας δεν ανήκει στο συγκεκριμένο matchup.");
};

const uniqueByRound = <T extends { seriesRoundNumber: number }>(rows: T[], label: string) => {
  const seen = new Set<number>();
  for (const row of rows) {
    if (seen.has(row.seriesRoundNumber)) {
      throw new Error(`Υπάρχει διπλή εγγραφή για τον ${label} ${row.seriesRoundNumber}.`);
    }
    seen.add(row.seriesRoundNumber);
  }
};

const sortRounds = <T extends { seriesRoundNumber: number }>(rounds: T[]) => {
  return [...rounds].sort((left, right) => left.seriesRoundNumber - right.seriesRoundNumber);
};

export const calculateSeriesProgression = (input: SeriesProgressionInput): SeriesProgressionResult => {
  const matchupId = String(input.matchupId ?? "").trim();
  if (!matchupId) throw new Error("Το matchup είναι υποχρεωτικό.");

  const teamA = normalizeTeam(input.teamA, "Η Ομάδα Α");
  const teamB = normalizeTeam(input.teamB, "Η Ομάδα Β");
  if (teamA.id === teamB.id) {
    throw new Error("Η Ομάδα Α και η Ομάδα Β δεν μπορούν να είναι η ίδια ομάδα.");
  }

  const winsRequired = normalizeRequiredRound(input.winsRequired, "Οι νίκες για πρόκριση");
  const maximumSeriesRounds = (winsRequired * 2) - 1;

  const transferredGames = sortRounds((input.transferredGames ?? []).map((game, index): SeriesProgressionTransferredGame => {
    const sourceGameId = String(game.sourceGameId ?? "").trim();
    if (!sourceGameId) throw new Error(`Το μεταφερμένο παιχνίδι ${index + 1} πρέπει να έχει sourceGameId.`);
    const seriesRoundNumber = normalizeRequiredRound(game.seriesRoundNumber, `Ο μεταφερμένος γύρος ${index + 1}`);
    const homeTeamId = String(game.homeTeamId ?? "").trim();
    const awayTeamId = String(game.awayTeamId ?? "").trim();
    const homeScore = parseScore(game.homeScore, "home_score");
    const awayScore = parseScore(game.awayScore, "away_score");
    if (homeScore === null || awayScore === null) {
      throw new Error("Ο μεταφερμένος αγώνας πρέπει να έχει έγκυρο τελικό σκορ.");
    }
    if (homeScore === awayScore) throw new Error("Ο μεταφερμένος αγώνας δεν μπορεί να είναι ισόπαλος.");
    validateGameForMatchup(homeTeamId, awayTeamId, teamA.id, teamB.id);
    if (String(game.status ?? "").trim().toLowerCase() !== "completed") {
      throw new Error("Ο μεταφερμένος αγώνας πρέπει να είναι ολοκληρωμένος.");
    }
    return {
      ...game,
      sourceGameId,
      seriesRoundNumber,
      homeTeamId,
      awayTeamId,
      homeScore,
      awayScore,
      status: String(game.status ?? ""),
    };
  }));

  const materializedGames = sortRounds((input.materializedGames ?? []).map((game, index): SeriesProgressionMaterializedGame => {
    const gameMatchupId = String(game.matchupId ?? "").trim();
    if (gameMatchupId && gameMatchupId !== matchupId) {
      throw new Error("Ο υλοποιημένος αγώνας ανήκει σε διαφορετικό matchup.");
    }
    const gameId = String(game.gameId ?? "").trim();
    if (!gameId) throw new Error(`Ο υλικοποιημένος αγώνας ${index + 1} πρέπει να έχει gameId.`);
    const seriesRoundNumber = normalizeRequiredRound(game.seriesRoundNumber, `Ο υλικοποιημένος γύρος ${index + 1}`);
    const homeTeamId = String(game.homeTeamId ?? "").trim();
    const awayTeamId = String(game.awayTeamId ?? "").trim();
    validateGameForMatchup(homeTeamId, awayTeamId, teamA.id, teamB.id);
    const homeScore = parseScore(game.homeScore, "home_score");
    const awayScore = parseScore(game.awayScore, "away_score");
    if (homeScore !== null && awayScore !== null && homeScore === awayScore) {
      throw new Error("Ο υλικοποιημένος αγώνας δεν μπορεί να είναι ισόπαλος.");
    }
    const status = String(game.status ?? "").trim().toLowerCase();
    if (status && !["scheduled", "completed", "postponed", "cancelled"].includes(status)) {
      throw new Error("Η κατάσταση του υλικοποιημένου αγώνα δεν είναι έγκυρη.");
    }
    if (status === "completed" && (homeScore === null || awayScore === null)) {
      throw new Error("Ο ολοκληρωμένος αγώνας πρέπει να έχει σκορ.");
    }
    return {
      ...game,
      gameId,
      seriesRoundNumber,
      homeTeamId,
      awayTeamId,
      homeScore,
      awayScore,
      status: String(game.status ?? ""),
    };
  }));

  const planningSlots = sortRounds((input.planningSlots ?? []).map((slot, index): SeriesProgressionPlanningSlot => {
    const seriesRoundNumber = normalizeRequiredRound(slot.seriesRoundNumber, `Ο προγραμματισμένος γύρος ${index + 1}`);
    return {
      seriesRoundNumber,
      scheduledDate: slot.scheduledDate ?? null,
      scheduledTime: slot.scheduledTime ?? null,
      venue: slot.venue ?? null,
    };
  }));

  uniqueByRound(transferredGames, "μεταφερόμενο γύρο");
  uniqueByRound(materializedGames, "υλικοποιημένο γύρο");
  uniqueByRound(planningSlots, "προγραμματισμένο γύρο");

  const allRounds = new Set<number>();
  for (const row of [...transferredGames, ...materializedGames, ...planningSlots]) {
    if (row.seriesRoundNumber > maximumSeriesRounds) {
      throw new Error(`Ο γύρος ${row.seriesRoundNumber} υπερβαίνει το μέγιστο επιτρεπτό πλήθος των ${maximumSeriesRounds}.`);
    }
    if (allRounds.has(row.seriesRoundNumber)) {
      throw new Error(`Υπάρχει διπλή εγγραφή για τον γύρο ${row.seriesRoundNumber}.`);
    }
    allRounds.add(row.seriesRoundNumber);
  }

  for (const transferred of transferredGames) {
    for (const materialized of materializedGames) {
      if (transferred.seriesRoundNumber === materialized.seriesRoundNumber) {
        throw new Error(`Ο γύρος ${transferred.seriesRoundNumber} έχει και μεταφερόμενο και πραγματικό αγώνα.`);
      }
    }
  }

  const byRound = new Map<number, RoundEntry>();
  const addRound = (entry: RoundEntry) => {
    if (byRound.has(entry.seriesRoundNumber)) {
      throw new Error(`Υπάρχει διπλή εγγραφή για τον γύρο ${entry.seriesRoundNumber}.`);
    }
    byRound.set(entry.seriesRoundNumber, entry);
  };

  for (const game of transferredGames) {
    addRound({
      seriesRoundNumber: game.seriesRoundNumber,
      rowState: "transferred",
      sourceGameId: game.sourceGameId,
      realGameId: null,
      planningSlot: planningSlots.find((slot) => slot.seriesRoundNumber === game.seriesRoundNumber) ?? null,
      game,
    });
  }

  for (const game of materializedGames) {
    addRound({
      seriesRoundNumber: game.seriesRoundNumber,
      rowState: isCompletedResult(game.status, game.homeScore, game.awayScore) ? "real_game" : "real_game",
      sourceGameId: null,
      realGameId: game.gameId,
      planningSlot: planningSlots.find((slot) => slot.seriesRoundNumber === game.seriesRoundNumber) ?? null,
      game,
    });
  }

  for (const slot of planningSlots) {
    if (!byRound.has(slot.seriesRoundNumber)) {
      addRound({
        seriesRoundNumber: slot.seriesRoundNumber,
        rowState: "if_needed",
        sourceGameId: null,
        realGameId: null,
        planningSlot: slot,
        game: null,
      });
    }
  }

  const qualifiedRounds = new Set<number>();
  let currentWinsA = 0;
  let currentWinsB = 0;
  const rounds = Array.from({ length: maximumSeriesRounds }, (_, index) => index + 1).map((seriesRoundNumber) => {
    const entry = byRound.get(seriesRoundNumber);
    const planningSlot = entry?.planningSlot ?? planningSlots.find((slot) => slot.seriesRoundNumber === seriesRoundNumber) ?? null;
    const newGameOrdinal = seriesRoundNumber - transferredGames.length;
    const expected = expectedOrientation(Math.max(1, newGameOrdinal), teamA.id, teamB.id);
    const baseRow = {
      seriesRoundNumber,
      expectedHomeTeamId: expected.homeTeamId,
      expectedHomeTeamName: expected.homeTeamId === teamA.id ? teamA.name : teamB.name,
      expectedAwayTeamId: expected.awayTeamId,
      expectedAwayTeamName: expected.awayTeamId === teamA.id ? teamA.name : teamB.name,
      sourceGameId: entry?.sourceGameId ?? null,
      realGameId: entry?.realGameId ?? null,
      planningSlot,
      homeTeamId: null as string | null,
      homeTeamName: null as string | null,
      awayTeamId: null as string | null,
      awayTeamName: null as string | null,
      homeScore: null as number | null,
      awayScore: null as number | null,
      winnerTeamId: null as string | null,
      winnerTeamName: null as string | null,
      qualificationRoundNumber: null as number | null,
      nextRequiredRoundNumber: null as number | null,
    };

    if (qualifiedRounds.size > 0) {
      return {
        ...baseRow,
        rowState: "qualified" as const,
        qualificationRoundNumber: Math.min(...qualifiedRounds),
        winnerTeamId: currentWinsA >= winsRequired ? teamA.id : teamB.id,
        winnerTeamName: currentWinsA >= winsRequired ? teamA.name : teamB.name,
        nextRequiredRoundNumber: null,
      };
    }

    if (entry?.rowState === "transferred" && entry.game) {
      const game = entry.game as SeriesProgressionTransferredGame;
      const winnerTeamId = resolveWinner(game.homeTeamId, game.awayTeamId, game.homeScore, game.awayScore, teamA.id, teamB.id);
      if (!winnerTeamId) throw new Error(`Ο μεταφερόμενος γύρος ${seriesRoundNumber} δεν έχει έγκυρο νικητή.`);
      if (winnerTeamId === teamA.id) currentWinsA += 1;
      else currentWinsB += 1;
      if (currentWinsA >= winsRequired || currentWinsB >= winsRequired) {
        qualifiedRounds.add(seriesRoundNumber);
      }
      return {
        ...baseRow,
        rowState: "transferred" as const,
        homeTeamId: game.homeTeamId,
        homeTeamName: game.homeTeamId === teamA.id ? teamA.name : teamB.name,
        awayTeamId: game.awayTeamId,
        awayTeamName: game.awayTeamId === teamA.id ? teamA.name : teamB.name,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
        winnerTeamId,
        winnerTeamName: winnerTeamId === teamA.id ? teamA.name : teamB.name,
        qualificationRoundNumber: currentWinsA >= winsRequired || currentWinsB >= winsRequired ? seriesRoundNumber : null,
      };
    }

    if (entry?.rowState === "real_game" && entry.game) {
      const game = entry.game as SeriesProgressionMaterializedGame;
      const completed = isCompletedResult(game.status, game.homeScore, game.awayScore);
      if (completed) {
        const winnerTeamId = resolveWinner(game.homeTeamId, game.awayTeamId, game.homeScore!, game.awayScore!, teamA.id, teamB.id);
        if (!winnerTeamId) throw new Error(`Ο πραγματικός γύρος ${seriesRoundNumber} δεν έχει έγκυρο νικητή.`);
        if (winnerTeamId === teamA.id) currentWinsA += 1;
        else currentWinsB += 1;
        if (currentWinsA >= winsRequired || currentWinsB >= winsRequired) {
          qualifiedRounds.add(seriesRoundNumber);
        }
        return {
          ...baseRow,
          rowState: "real_game" as const,
          homeTeamId: game.homeTeamId,
          homeTeamName: game.homeTeamId === teamA.id ? teamA.name : teamB.name,
          awayTeamId: game.awayTeamId,
          awayTeamName: game.awayTeamId === teamA.id ? teamA.name : teamB.name,
          homeScore: game.homeScore,
          awayScore: game.awayScore,
          winnerTeamId,
          winnerTeamName: winnerTeamId === teamA.id ? teamA.name : teamB.name,
          qualificationRoundNumber: currentWinsA >= winsRequired || currentWinsB >= winsRequired ? seriesRoundNumber : null,
        };
      }

      return {
        ...baseRow,
        rowState: "real_game" as const,
        homeTeamId: game.homeTeamId,
        homeTeamName: game.homeTeamId === teamA.id ? teamA.name : teamB.name,
        awayTeamId: game.awayTeamId,
        awayTeamName: game.awayTeamId === teamA.id ? teamA.name : teamB.name,
        homeScore: game.homeScore,
        awayScore: game.awayScore,
      };
    }

    if (currentWinsA >= winsRequired || currentWinsB >= winsRequired) {
      const winnerTeamId = currentWinsA >= winsRequired ? teamA.id : teamB.id;
      const winnerTeamName = currentWinsA >= winsRequired ? teamA.name : teamB.name;
      return {
        ...baseRow,
        rowState: "qualified" as const,
        winnerTeamId,
        winnerTeamName,
        qualificationRoundNumber: seriesRoundNumber - 1 >= 1 ? seriesRoundNumber - 1 : 1,
      };
    }

    return {
      ...baseRow,
      rowState: "if_needed" as const,
      nextRequiredRoundNumber: seriesRoundNumber === 1 ? 1 : seriesRoundNumber,
    };
  });

  const finalQualifiedRound = rounds.find((round) => round.winnerTeamId && round.qualificationRoundNumber !== null)?.qualificationRoundNumber ?? null;
  const qualifiedTeamId = currentWinsA >= winsRequired ? teamA.id : currentWinsB >= winsRequired ? teamB.id : null;
  const qualifiedTeamName = currentWinsA >= winsRequired ? teamA.name : currentWinsB >= winsRequired ? teamB.name : null;
  const hasPendingRealGame = rounds.some((round) =>
    round.rowState === "real_game" && round.winnerTeamId === null,
  );
  const nextRequiredRoundNumber = qualifiedTeamId || hasPendingRealGame
    ? null
    : rounds.find((round) => round.rowState === "if_needed")?.seriesRoundNumber ?? null;
  const roundWindow = calculateSeriesRoundWindow({
    winsRequired,
    currentWinsA,
    currentWinsB,
    qualified: Boolean(qualifiedTeamId),
  });

  return {
    matchupId,
    teamAId: teamA.id,
    teamAName: teamA.name,
    teamBId: teamB.id,
    teamBName: teamB.name,
    winsRequired,
    maximumSeriesRounds,
    minimumNewRounds: roundWindow.minimumNewRounds,
    maximumNewRounds: roundWindow.maximumNewRounds,
    transferredRoundCount: transferredGames.length,
    currentWinsA,
    currentWinsB,
    qualifiedTeamId,
    qualifiedTeamName,
    qualificationRoundNumber: finalQualifiedRound,
    nextRequiredRoundNumber,
    rounds,
  };
};
