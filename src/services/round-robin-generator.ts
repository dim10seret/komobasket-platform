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

export type RoundRobinMaterializedGame = {
  id: string;
  competition_id: string | null;
  phase_id: string | null;
  schedule_id: string | null;
  cycle_number: number | string | null;
  round_number: number | string | null;
  game_order: number | string | null;
  home_team_id: string | null;
  away_team_id: string | null;
};

export type RoundRobinFixturePlanState = "existing" | "missing" | "conflict";

export type RoundRobinFixturePlanItem = {
  identity: string;
  cycle_number: number;
  round_number: number;
  game_order: number;
  home_team_id: string;
  home_team_name: string;
  away_team_id: string;
  away_team_name: string;
  state: RoundRobinFixturePlanState;
  existing_game_id: string | null;
  expected_game_id: string;
};

export type RoundRobinFixturePlan = {
  expectedCount: number;
  existingCount: number;
  missingCount: number;
  conflictCount: number;
  items: RoundRobinFixturePlanItem[];
  groupedRounds: Array<{
    cycleNumber: number;
    roundNumber: number;
    roundLabel: string;
    games: RoundRobinFixturePlanItem[];
  }>;
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

const hashStringToSeed = (value: string) => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const createSeededRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const shuffleWithRandom = <T,>(items: T[], random: () => number) => {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};

const scorePositionMatrix = (positionMatrix: Map<string, number[]>) => {
  let maxSpread = 0;
  let totalSquaredDeviation = 0;
  let repeatPenalty = 0;
  for (const counts of positionMatrix.values()) {
    const total = counts.reduce((sum, value) => sum + value, 0);
    const slots = counts.length || 1;
    const ideal = total / slots;
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    maxSpread = Math.max(maxSpread, maxCount - minCount);
    for (const value of counts) {
      totalSquaredDeviation += (value - ideal) ** 2;
      if (value > 1) repeatPenalty += (value - 1) ** 2;
    }
  }
  return maxSpread * 100000 + totalSquaredDeviation * 100 + repeatPenalty * 10;
};

const clonePositionMatrix = (matrix: Map<string, number[]>) => {
  return new Map<string, number[]>([...matrix.entries()].map(([teamId, counts]) => [teamId, [...counts]]));
};

const chooseBalancedOrder = (
  roundGames: RoundRobinGameCandidate[],
  currentMatrix: Map<string, number[]>,
  gamesPerRound: number,
  random: () => number,
) => {
  if (roundGames.length <= 1) return [...roundGames];
  const candidates: RoundRobinGameCandidate[][] = [];
  const seen = new Set<string>();
  const addCandidate = (candidate: RoundRobinGameCandidate[]) => {
    const key = candidate.map((game) => game.id).join("::");
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  addCandidate([...roundGames]);
  addCandidate([...roundGames].reverse());

  const sampleCount = Math.min(8, Math.max(4, roundGames.length));
  for (let index = 0; index < sampleCount; index += 1) {
    addCandidate(shuffleWithRandom(roundGames, random));
  }

  let best = candidates[0] ?? [...roundGames];
  let bestScore = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const nextMatrix = clonePositionMatrix(currentMatrix);
    for (let position = 0; position < candidate.length; position += 1) {
      const game = candidate[position];
      const slotIndex = Math.min(position, gamesPerRound - 1);
      const homeCounts = nextMatrix.get(game.home_team_id) ?? Array(gamesPerRound).fill(0);
      const awayCounts = nextMatrix.get(game.away_team_id) ?? Array(gamesPerRound).fill(0);
      homeCounts[slotIndex] = (homeCounts[slotIndex] ?? 0) + 1;
      awayCounts[slotIndex] = (awayCounts[slotIndex] ?? 0) + 1;
      nextMatrix.set(game.home_team_id, homeCounts);
      nextMatrix.set(game.away_team_id, awayCounts);
    }
    const score = scorePositionMatrix(nextMatrix);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    } else if (score === bestScore && random() < 0.5) {
      best = candidate;
    }
  }

  return best;
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

const generateRoundRobinDryRunBase = (input: RoundRobinDryRunInput): RoundRobinDryRunResult => {
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
};

export function generateRoundRobinDryRun(input: RoundRobinDryRunInput): RoundRobinDryRunResult {
  const normalizedTeams = (input.teams ?? [])
    .map((team) => ({ id: String(team.id ?? "").trim(), name: String(team.name ?? "").trim() }))
    .filter((team) => team.id && team.name);

  const entropySeed = (() => {
    const cryptoGlobal = globalThis.crypto as Crypto | undefined;
    if (cryptoGlobal?.getRandomValues) {
      const buffer = new Uint32Array(1);
      cryptoGlobal.getRandomValues(buffer);
      return buffer[0] ?? 0;
    }
    return Math.floor(Math.random() * 0xffffffff) >>> 0;
  })();
  const baseSeed = entropySeed ^ hashStringToSeed(`${input.competitionId ?? ""}::${input.phaseId ?? ""}::${input.scheduleId ?? ""}`);
  const candidateCount = 2;
  let bestResult: RoundRobinDryRunResult | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (let attempt = 0; attempt < candidateCount; attempt += 1) {
    const random = createSeededRandom(baseSeed + attempt * 1013904223);
    const orderedTeams = attempt === 0 ? normalizedTeams : shuffleWithRandom(normalizedTeams, random);
    const result = generateRoundRobinDryRunBase({ ...input, teams: orderedTeams });
    if (!result.ok) {
      if (!bestResult) bestResult = result;
      continue;
    }

    const positionMatrix = new Map<string, number[]>(
      orderedTeams.map((team) => [team.id, Array(result.input.gamesPerRound).fill(0)]),
    );
    const balancedGames: RoundRobinGameCandidate[] = [];
    const balancedRounds: RoundRobinRound[] = [];

    for (const round of result.rounds) {
      const roundGames = result.games.filter((game) => game.round_number === round.roundNumber);
      const balancedOrder = chooseBalancedOrder(roundGames, positionMatrix, result.input.gamesPerRound, random);
      for (let index = 0; index < balancedOrder.length; index += 1) {
        const game = balancedOrder[index];
        const slotIndex = Math.min(index, result.input.gamesPerRound - 1);
        const homeCounts = positionMatrix.get(game.home_team_id) ?? Array(result.input.gamesPerRound).fill(0);
        const awayCounts = positionMatrix.get(game.away_team_id) ?? Array(result.input.gamesPerRound).fill(0);
        homeCounts[slotIndex] = (homeCounts[slotIndex] ?? 0) + 1;
        awayCounts[slotIndex] = (awayCounts[slotIndex] ?? 0) + 1;
        positionMatrix.set(game.home_team_id, homeCounts);
        positionMatrix.set(game.away_team_id, awayCounts);
        balancedGames.push({
          ...game,
          game_order: index + 1,
          id: `generated_${game.schedule_id}_c${game.cycle_number}_r${game.round_number}_g${index + 1}`,
        });
      }
      balancedRounds.push({
        ...round,
        games: balancedOrder.map((game) => ({
          homeTeamId: game.home_team_id,
          awayTeamId: game.away_team_id,
          homeTeamName: game.home_team_name,
          awayTeamName: game.away_team_name,
        })),
      });
    }

    const score = scorePositionMatrix(positionMatrix);
    if (score < bestScore) {
      bestScore = score;
      bestResult = {
        ...result,
        rounds: balancedRounds,
        games: balancedGames,
      };
    } else if (score === bestScore && random() < 0.5) {
      bestResult = {
        ...result,
        rounds: balancedRounds,
        games: balancedGames,
      };
    }
  }

  return bestResult ?? generateRoundRobinDryRunBase({ ...input, teams: normalizedTeams });
}

export function generateRoundRobinValidationPreview(input: RoundRobinDryRunInput) {
  return generateRoundRobinDryRun(input);
}

const buildRoundRobinFixtureIdentity = (scheduleId: string, cycleNumber: number, roundNumber: number, gameOrder: number) =>
  `${scheduleId}::c${cycleNumber}::r${roundNumber}::g${gameOrder}`;

export function generateRoundRobinFixturePlan(
  input: RoundRobinDryRunInput,
  materializedGames: RoundRobinMaterializedGame[],
): RoundRobinFixturePlan {
  const dryRun = generateRoundRobinDryRun(input);
  const expectedByIdentity = new Map<string, RoundRobinGameCandidate>();
  for (const game of dryRun.games) {
    expectedByIdentity.set(buildRoundRobinFixtureIdentity(game.schedule_id, game.cycle_number, game.round_number, game.game_order), game);
  }

  const materializedByIdentity = new Map<string, RoundRobinMaterializedGame>();
  const duplicateIdentities = new Set<string>();
  for (const game of materializedGames) {
    const scheduleId = String(game.schedule_id ?? "").trim();
    const cycleNumber = Number(game.cycle_number ?? 0) || 0;
    const roundNumber = Number(game.round_number ?? 0) || 0;
    const gameOrder = Number(game.game_order ?? 0) || 0;
    if (!scheduleId || cycleNumber < 1 || roundNumber < 1 || gameOrder < 1) {
      continue;
    }
    const identity = buildRoundRobinFixtureIdentity(scheduleId, cycleNumber, roundNumber, gameOrder);
    if (materializedByIdentity.has(identity)) {
      duplicateIdentities.add(identity);
    }
    materializedByIdentity.set(identity, game);
  }

  const items: RoundRobinFixturePlanItem[] = [];
  let existingCount = 0;
  let missingCount = 0;
  let conflictCount = 0;

  for (const expected of dryRun.games) {
    const identity = buildRoundRobinFixtureIdentity(expected.schedule_id, expected.cycle_number, expected.round_number, expected.game_order);
    const existing = materializedByIdentity.get(identity) ?? null;
    let state: RoundRobinFixturePlanState = "missing";
    if (existing) {
      const existingHome = String(existing.home_team_id ?? "");
      const existingAway = String(existing.away_team_id ?? "");
      if (existingHome === expected.home_team_id && existingAway === expected.away_team_id) {
        state = "existing";
        existingCount += 1;
      } else {
        state = "conflict";
        conflictCount += 1;
      }
    } else {
      missingCount += 1;
    }
    items.push({
      identity,
      cycle_number: expected.cycle_number,
      round_number: expected.round_number,
      game_order: expected.game_order,
      home_team_id: expected.home_team_id,
      home_team_name: expected.home_team_name,
      away_team_id: expected.away_team_id,
      away_team_name: expected.away_team_name,
      state,
      existing_game_id: existing?.id ?? null,
      expected_game_id: expected.id,
    });
  }

  if (duplicateIdentities.size > 0) {
    conflictCount += duplicateIdentities.size;
  }

  const groupedRounds = dryRun.rounds.map((round) => ({
    cycleNumber: round.cycleNumber,
    roundNumber: round.roundNumber,
    roundLabel: round.roundLabel,
    games: items.filter((item) => item.round_number === round.roundNumber),
  }));

  return {
    expectedCount: dryRun.games.length,
    existingCount,
    missingCount,
    conflictCount,
    items,
    groupedRounds,
  };
}
