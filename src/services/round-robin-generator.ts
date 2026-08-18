export type RoundRobinTeam = {
  id: string;
  name: string;
};

export type RoundRobinPairing = {
  homeTeamId: string;
  awayTeamId: string;
  homeTeamName: string;
  awayTeamName: string;
};

export type RoundRobinRound = {
  cycleNumber: number;
  roundNumber: number;
  roundLabel: string;
  games: RoundRobinPairing[];
  byeTeam: RoundRobinTeam | null;
};

export type RoundRobinGameCandidate = {
  id: string;
  competition_id: string;
  phase_id: string;
  schedule_id: string;
  cycle_number: number;
  round_number: number;
  game_order: number;
  round_label: string;
  home_team_id: string;
  away_team_id: string;
  home_team_name: string;
  away_team_name: string;
  scheduled_at: null;
  venue: string;
  home_score: null;
  away_score: null;
  status: string;
};

export type RoundRobinDryRunInput = {
  competitionId: string;
  phaseId: string;
  scheduleId: string;
  teams: RoundRobinTeam[];
  gamesPerPairing: number;
};

export type RoundRobinDryRunResult = {
  ok: boolean;
  errors: string[];
  input: {
    competitionId: string;
    phaseId: string;
    scheduleId: string;
    teamCount: number;
    gamesPerPairing: number;
    cycles: number;
    roundsPerCycle: number;
    gamesPerRound: number;
    totalGames: number;
    totalByesPerCycle: number;
  };
  rounds: RoundRobinRound[];
  games: RoundRobinGameCandidate[];
  teamStats: Record<string, { games: number; home: number; away: number; byes: number }>;
  pairStats: Record<string, number>;
};

type Orientation = {
  home: RoundRobinTeam;
  away: RoundRobinTeam;
};

const normalizePositiveInt = (value: number, fallback: number) => {
  const candidate = Math.floor(Number(value));
  if (!Number.isFinite(candidate) || candidate < 1) return fallback;
  return candidate;
};

const ordinalRoundLabel = (roundNumber: number) => `${roundNumber}η Αγωνιστική`;

const buildCircleCyclePairings = (teams: RoundRobinTeam[]) => {
  const baseTeams = teams.slice();
  const hasBye = baseTeams.length % 2 === 1;
  const workingTeams = hasBye ? [...baseTeams, { id: "__bye__", name: "BYE" }] : [...baseTeams];
  const roundsPerCycle = workingTeams.length - 1;
  const half = workingTeams.length / 2;
  const rotation = workingTeams.slice();
  const rounds: { pairs: [RoundRobinTeam, RoundRobinTeam][]; byeTeam: RoundRobinTeam | null }[] = [];

  for (let roundIndex = 0; roundIndex < roundsPerCycle; roundIndex += 1) {
    const pairs: [RoundRobinTeam, RoundRobinTeam][] = [];
    let byeTeam: RoundRobinTeam | null = null;
    for (let index = 0; index < half; index += 1) {
      const left = rotation[index];
      const right = rotation[rotation.length - 1 - index];
      if (!left || !right) continue;
      if (left.id === "__bye__") {
        byeTeam = right;
        continue;
      }
      if (right.id === "__bye__") {
        byeTeam = left;
        continue;
      }
      pairs.push([left, right]);
    }
    rounds.push({ pairs, byeTeam });

    const fixed = rotation[0];
    const rest = rotation.slice(1);
    if (rest.length > 0) {
      const last = rest.pop();
      if (typeof last !== "undefined") {
        rest.unshift(last);
      }
    }
    rotation.splice(0, rotation.length, fixed, ...rest);
  }

  return { rounds, roundsPerCycle, hasBye };
};

const computeBaseHomeTargets = (teamCount: number) => {
  const gamesPerTeam = Math.max(0, teamCount - 1);
  const lower = Math.floor(gamesPerTeam / 2);
  const upper = Math.ceil(gamesPerTeam / 2);
  const lowerTotal = lower * teamCount;
  const expectedHomeTotal = (teamCount * gamesPerTeam) / 2;
  const extraUpperSlots = Math.round(expectedHomeTotal - lowerTotal);
  return { gamesPerTeam, lower, upper, extraUpperSlots };
};

const assignHomeTargets = (teams: RoundRobinTeam[]) => {
  const { lower, upper, extraUpperSlots } = computeBaseHomeTargets(teams.length);
  const targets = new Map<string, number>();
  teams.forEach((team, index) => {
    targets.set(team.id, index < extraUpperSlots ? upper : lower);
  });
  return targets;
};

const validateCounts = (
  candidate: RoundRobinGameCandidate[],
  rounds: RoundRobinRound[],
  teams: RoundRobinTeam[],
  gamesPerPairing: number,
) => {
  const errors: string[] = [];
  const teamIds = teams.map((team) => team.id);
  const expectedTeamGameCount = Math.max(0, teams.length - 1) * gamesPerPairing;
  const expectedUniquePairs = (teams.length * Math.max(0, teams.length - 1)) / 2;
  const expectedRoundsPerCycle = teams.length % 2 === 0 ? Math.max(0, teams.length - 1) : teams.length;
  const expectedTotalRounds = expectedRoundsPerCycle * gamesPerPairing;
  const expectedGamesPerRound = Math.floor(teams.length / 2);

  if (candidate.length !== expectedUniquePairs * gamesPerPairing) {
    errors.push(`Αναμενόμενοι αγώνες: ${expectedUniquePairs * gamesPerPairing}, βρέθηκαν: ${candidate.length}.`);
  }

  const teamStats = new Map<string, { games: number; home: number; away: number; byes: number }>();
  const pairStats = new Map<string, number>();
  const slotStats = new Set<string>();
  for (const teamId of teamIds) {
    teamStats.set(teamId, { games: 0, home: 0, away: 0, byes: 0 });
  }

  for (const game of candidate) {
    const home = teamStats.get(game.home_team_id);
    const away = teamStats.get(game.away_team_id);
    if (!home || !away) {
      errors.push(`Άγνωστη ομάδα στον αγώνα ${game.id}.`);
      continue;
    }
    if (game.home_team_id === game.away_team_id) {
      errors.push(`Αυτοαντιστοίχιση στον αγώνα ${game.id}.`);
    }
    home.games += 1;
    home.home += 1;
    away.games += 1;
    away.away += 1;
    const pairKey = [game.home_team_id, game.away_team_id].sort().join("::");
    pairStats.set(pairKey, (pairStats.get(pairKey) ?? 0) + 1);
    const slotKey = `${game.schedule_id}::${game.round_number}::${game.game_order}`;
    if (slotStats.has(slotKey)) {
      errors.push(`Διπλό slot προγράμματος: ${slotKey}.`);
    }
    slotStats.add(slotKey);
  }

  for (const team of teams) {
    const stats = teamStats.get(team.id);
    if (!stats) continue;
    if (stats.games !== expectedTeamGameCount) {
      errors.push(`Η ομάδα ${team.name} έχει ${stats.games} αγώνες αντί για ${expectedTeamGameCount}.`);
    }
  }

  if (teams.length % 2 === 1) {
    const byeStats = new Map<string, number>();
    for (const round of rounds) {
      const byeTeamId = String(round.byeTeam?.id ?? "");
      if (!byeTeamId) continue;
      byeStats.set(byeTeamId, (byeStats.get(byeTeamId) ?? 0) + 1);
    }
    for (const team of teams) {
      const actualByes = byeStats.get(team.id) ?? 0;
      if (actualByes !== gamesPerPairing) {
        errors.push(`Η ομάδα ${team.name} έχει ${actualByes} ρεπό αντί για ${gamesPerPairing}.`);
      }
    }
  }

  const expectedPairOccurrences = gamesPerPairing;
  for (const left of teams) {
    for (const right of teams) {
      if (left.id >= right.id) continue;
      const pairKey = [left.id, right.id].sort().join("::");
      if ((pairStats.get(pairKey) ?? 0) !== expectedPairOccurrences) {
        errors.push(`Το ζεύγος ${left.name} - ${right.name} εμφανίζεται ${(pairStats.get(pairKey) ?? 0)} φορές αντί για ${expectedPairOccurrences}.`);
      }
    }
  }

  const roundsByGlobalRound = new Map<number, RoundRobinGameCandidate[]>();
  for (const game of candidate) {
    roundsByGlobalRound.set(game.round_number, [...(roundsByGlobalRound.get(game.round_number) ?? []), game]);
  }
  const sortedRounds = [...roundsByGlobalRound.entries()].sort((left, right) => left[0] - right[0]);
  if (sortedRounds.length !== expectedTotalRounds) {
    errors.push(`Αναμενόμενες αγωνιστικές: ${expectedTotalRounds}, βρέθηκαν: ${sortedRounds.length}.`);
  }
  for (let index = 0; index < sortedRounds.length; index += 1) {
    const [roundNumber, games] = sortedRounds[index];
    if (roundNumber !== index + 1) {
      errors.push(`Οι global αγωνιστικές δεν είναι συνεχόμενες από το 1.`);
      break;
    }
    if (games.length !== expectedGamesPerRound) {
      errors.push(`Η αγωνιστική ${roundNumber} έχει ${games.length} αγώνες αντί για ${expectedGamesPerRound}.`);
    }
  }

  return { errors, teamStats: Object.fromEntries(teamStats.entries()), pairStats: Object.fromEntries(pairStats.entries()) };
};

const solveBaseOrientation = (
  rounds: { pairs: [RoundRobinTeam, RoundRobinTeam][]; byeTeam: RoundRobinTeam | null }[],
  teams: RoundRobinTeam[],
) => {
  const targetHome = assignHomeTargets(teams);
  const teamRemainingGames = new Map<string, number>(teams.map((team) => [team.id, Math.max(0, teams.length - 1)]));
  const homeRemaining = new Map<string, number>(teams.map((team) => [team.id, targetHome.get(team.id) ?? 0]));
  const solution: Orientation[][] = [];

  const canPlace = (home: RoundRobinTeam, away: RoundRobinTeam) => {
    const homeRemain = homeRemaining.get(home.id) ?? 0;
    const awayRemain = homeRemaining.get(away.id) ?? 0;
    const homeGames = teamRemainingGames.get(home.id) ?? 0;
    const awayGames = teamRemainingGames.get(away.id) ?? 0;
    if (homeRemain <= 0) return false;
    if (homeGames <= 0 || awayGames <= 0) return false;
    return true;
  };

  const apply = (home: RoundRobinTeam, away: RoundRobinTeam) => {
    homeRemaining.set(home.id, (homeRemaining.get(home.id) ?? 0) - 1);
    teamRemainingGames.set(home.id, (teamRemainingGames.get(home.id) ?? 0) - 1);
    teamRemainingGames.set(away.id, (teamRemainingGames.get(away.id) ?? 0) - 1);
  };

  const revert = (home: RoundRobinTeam, away: RoundRobinTeam) => {
    homeRemaining.set(home.id, (homeRemaining.get(home.id) ?? 0) + 1);
    teamRemainingGames.set(home.id, (teamRemainingGames.get(home.id) ?? 0) + 1);
    teamRemainingGames.set(away.id, (teamRemainingGames.get(away.id) ?? 0) + 1);
  };

  const compareChoice = (left: RoundRobinTeam, right: RoundRobinTeam) => {
    const leftNeed = homeRemaining.get(left.id) ?? 0;
    const rightNeed = homeRemaining.get(right.id) ?? 0;
    if (leftNeed !== rightNeed) return rightNeed - leftNeed;
    return String(left.id).localeCompare(String(right.id));
  };

  const dfs = (roundIndex: number): boolean => {
    if (roundIndex >= rounds.length) {
      for (const value of homeRemaining.values()) {
        if (value !== 0) return false;
      }
      return true;
    }
    const current = rounds[roundIndex];
    const orderedPairs = [...current.pairs].sort((left, right) => {
      const leftScore = compareChoice(left[0], left[1]);
      const rightScore = compareChoice(right[0], right[1]);
      return leftScore - rightScore;
    });

    const roundOrientations: Orientation[] = [];
    const solvePair = (pairIndex: number): boolean => {
      if (pairIndex >= orderedPairs.length) {
        solution[roundIndex] = [...roundOrientations];
        return dfs(roundIndex + 1);
      }
      const [left, right] = orderedPairs[pairIndex];
      const candidates: [RoundRobinTeam, RoundRobinTeam][] = [
        [left, right],
        [right, left],
      ];
      candidates.sort((first, second) => {
        const firstNeed = Math.abs((homeRemaining.get(first[0].id) ?? 0) - 1) + Math.abs(homeRemaining.get(first[1].id) ?? 0);
        const secondNeed = Math.abs((homeRemaining.get(second[0].id) ?? 0) - 1) + Math.abs(homeRemaining.get(second[1].id) ?? 0);
        if (firstNeed !== secondNeed) return firstNeed - secondNeed;
        return String(first[0].id).localeCompare(String(second[0].id)) || String(first[1].id).localeCompare(String(second[1].id));
      });
      for (const [home, away] of candidates) {
        if (!canPlace(home, away)) continue;
        apply(home, away);
        roundOrientations.push({ home, away });
        const remainingInRound = orderedPairs.length - pairIndex - 1;
        let valid = true;
        for (const team of teams) {
          const remainingHome = homeRemaining.get(team.id) ?? 0;
          const remainingGames = teamRemainingGames.get(team.id) ?? 0;
          if (remainingHome < 0 || remainingHome > remainingGames) {
            valid = false;
            break;
          }
        }
        if (valid && solvePair(pairIndex + 1)) return true;
        roundOrientations.pop();
        revert(home, away);
        void remainingInRound;
      }
      return false;
    };
    return solvePair(0);
  };

  const success = dfs(0);
  if (!success) return null;
  return solution;
};

export function generateRoundRobinDryRun(input: RoundRobinDryRunInput): RoundRobinDryRunResult {
  const competitionId = String(input.competitionId ?? "").trim();
  const phaseId = String(input.phaseId ?? "").trim();
  const scheduleId = String(input.scheduleId ?? "").trim();
  const teams = (input.teams ?? [])
    .map((team) => ({ id: String(team.id ?? "").trim(), name: String(team.name ?? "").trim() }))
    .filter((team) => team.id && team.name);
  const gamesPerPairing = normalizePositiveInt(input.gamesPerPairing, 1);
  const errors: string[] = [];

  if (!competitionId) errors.push("Η διοργάνωση είναι υποχρεωτική.");
  if (!phaseId) errors.push("Η φάση είναι υποχρεωτική.");
  if (!scheduleId) errors.push("Το πρόγραμμα είναι υποχρεωτικό.");
  if (teams.length < 2) errors.push("Απαιτούνται τουλάχιστον 2 ομάδες.");

  const { rounds: baseRounds, roundsPerCycle, hasBye } = buildCircleCyclePairings(teams);
  const orientedBase = solveBaseOrientation(baseRounds, teams);
  if (!orientedBase) {
    errors.push("Δεν βρέθηκε έγκυρη ισορροπημένη διάταξη γηπεδούχου/φιλοξενούμενου.");
  }

  const cycles = gamesPerPairing;
  const totalRounds = roundsPerCycle * cycles;
  const gamesPerRound = Math.floor(teams.length / 2);
  const totalGames = ((teams.length * (teams.length - 1)) / 2) * cycles;
  const totalByesPerCycle = hasBye ? 1 : 0;

  const rounds: RoundRobinRound[] = [];
  const games: RoundRobinGameCandidate[] = [];
  const pairStats: Record<string, number> = {};
  const teamStats: Record<string, { games: number; home: number; away: number; byes: number }> = {};
  for (const team of teams) {
    teamStats[team.id] = { games: 0, home: 0, away: 0, byes: 0 };
  }

  if (orientedBase) {
    for (let cycleIndex = 0; cycleIndex < cycles; cycleIndex += 1) {
      const cycleNumber = cycleIndex + 1;
      const isEvenCycle = cycleNumber % 2 === 0;
      for (let roundIndex = 0; roundIndex < orientedBase.length; roundIndex += 1) {
        const globalRoundNumber = cycleIndex * roundsPerCycle + roundIndex + 1;
        const baseRound = baseRounds[roundIndex];
        const orientedPairs = orientedBase[roundIndex] ?? [];
        const roundGames: RoundRobinPairing[] = [];
        for (let gameOrder = 0; gameOrder < baseRound.pairs.length; gameOrder += 1) {
          const baseOrientation = orientedPairs[gameOrder];
          if (!baseOrientation) continue;
          const home = isEvenCycle
            ? { ...baseOrientation.away }
            : { ...baseOrientation.home };
          const away = isEvenCycle
            ? { ...baseOrientation.home }
            : { ...baseOrientation.away };
          roundGames.push({
            homeTeamId: home.id,
            awayTeamId: away.id,
            homeTeamName: home.name,
            awayTeamName: away.name,
          });
          const pairKey = [home.id, away.id].sort().join("::");
          pairStats[pairKey] = (pairStats[pairKey] ?? 0) + 1;
          teamStats[home.id].games += 1;
          teamStats[home.id].home += 1;
          teamStats[away.id].games += 1;
          teamStats[away.id].away += 1;
          games.push({
            id: `generated_${scheduleId}_c${cycleNumber}_r${globalRoundNumber}_g${gameOrder + 1}`,
            competition_id: competitionId,
            phase_id: phaseId,
            schedule_id: scheduleId,
            cycle_number: cycleNumber,
            round_number: globalRoundNumber,
            game_order: gameOrder + 1,
            round_label: ordinalRoundLabel(globalRoundNumber),
            home_team_id: home.id,
            away_team_id: away.id,
            home_team_name: home.name,
            away_team_name: away.name,
            scheduled_at: null,
            venue: "",
            home_score: null,
            away_score: null,
            status: "scheduled",
          });
        }
        const byeTeam = baseRound.byeTeam
          ? teams.find((team) => team.id === baseRound.byeTeam?.id) ?? null
          : null;
        if (byeTeam) {
          teamStats[byeTeam.id].byes += 1;
        }
        rounds.push({
          cycleNumber,
          roundNumber: globalRoundNumber,
          roundLabel: ordinalRoundLabel(globalRoundNumber),
          games: roundGames,
          byeTeam: byeTeam ? { ...byeTeam } : null,
        });
      }
    }
  }

  const validation = orientedBase
    ? validateCounts(games, rounds, teams, gamesPerPairing)
    : { errors: [], teamStats: {}, pairStats: {} };
  const mergedErrors = [...errors, ...validation.errors];

  return {
    ok: mergedErrors.length === 0,
    errors: mergedErrors,
    input: {
      competitionId,
      phaseId,
      scheduleId,
      teamCount: teams.length,
      gamesPerPairing,
      cycles,
      roundsPerCycle,
      gamesPerRound,
      totalGames,
      totalByesPerCycle,
    },
    rounds,
    games,
    teamStats: Object.keys(teamStats).length ? teamStats : validation.teamStats,
    pairStats,
  };
}

export function generateRoundRobinValidationPreview(input: RoundRobinDryRunInput) {
  return generateRoundRobinDryRun(input);
}
