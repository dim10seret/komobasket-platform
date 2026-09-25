export type StandingsTeamInput = {
  id: string;
  name: string;
};

export type StandingsGameInput = {
  id: string;
  phaseId: string | null;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | string | null;
  awayScore: number | string | null;
  status: string | null;
  resultSource: string | null;
  homeStandingsPointsOverride?: number | string | null;
  awayStandingsPointsOverride?: number | string | null;
};

export type StandingsRulesInput = {
  pointsForWin: number;
  pointsForLoss: number;
};

export type StandingsTieBreakerKey =
  | "head_to_head"
  | "head_to_head_point_diff"
  | "overall_point_diff"
  | "points_for"
  | "alphabetical";

export type StandingsCalculatorInput = {
  phaseId: string;
  teams: StandingsTeamInput[];
  games: StandingsGameInput[];
  rules: StandingsRulesInput;
  tieBreakers?: StandingsTieBreakerKey[];
};

export type TeamStandingRow = {
  teamId: string;
  teamName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  standingsPoints: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDifference: number;
  primaryPointsGroup: string;
};

export type StandingsCalculatorResult = {
  rows: TeamStandingRow[];
  tieGroups: Array<{
    primaryPoints: number;
    teamIds: string[];
  }>;
  orderedRows: Array<{
    teamId: string;
    teamName: string;
    rank: number;
    resolvedBy: StandingsTieBreakerKey | "primary_points" | "fallback";
    primaryPoints: number;
    tieResolved: boolean;
    tieGroupId: string | null;
  }>;
  unresolvedTieGroups: Array<{
    tieGroupId: string;
    teamIds: string[];
    primaryPoints: number;
    exhaustedCriteria: boolean;
  }>;
};

export const standingsCalculatorTestFixtures = {
  currentResult: {
    teams: [
      { id: "team-sidream", name: "ΣΙDREAM TEAM" },
      { id: "team-jugopiastika", name: "JUGOPIASTIKA" },
      { id: "team-extra-1", name: "TEAM 3" },
    ],
    games: [
      {
        id: "game-1",
        phaseId: "phase-1",
        homeTeamId: "team-sidream",
        awayTeamId: "team-jugopiastika",
        homeScore: 78,
        awayScore: 76,
        status: "completed",
        resultSource: "manual",
      },
    ] as StandingsGameInput[],
    rules: { pointsForWin: 2, pointsForLoss: 1 },
  },
  customResult: {
    teams: [
      { id: "team-a", name: "A" },
      { id: "team-b", name: "B" },
    ],
    games: [
      {
        id: "game-1",
        phaseId: "phase-1",
        homeTeamId: "team-a",
        awayTeamId: "team-b",
        homeScore: 70,
        awayScore: 75,
        status: "completed",
        resultSource: "manual",
      },
    ] as StandingsGameInput[],
    rules: { pointsForWin: 3, pointsForLoss: 0 },
  },
};

const ALLOWED_TIE_BREAKERS: StandingsTieBreakerKey[] = [
  "head_to_head",
  "head_to_head_point_diff",
  "overall_point_diff",
  "points_for",
  "alphabetical",
];

const normalizeTeamIdList = (teams: StandingsTeamInput[]) => {
  const seen = new Set<string>();
  return teams.map((team) => {
    const id = String(team.id ?? "").trim();
    const name = String(team.name ?? "").trim();
    if (!id) throw new Error("Κάθε ομάδα πρέπει να έχει σταθερό αναγνωριστικό.");
    if (!name) throw new Error("Κάθε ομάδα πρέπει να έχει όνομα.");
    if (seen.has(id)) throw new Error("Υπάρχουν διπλά αναγνωριστικά ομάδων στη λίστα συμμετεχόντων.");
    seen.add(id);
    return { id, name };
  });
};

const parseScore = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === "") return null;
  const candidate = Number(value);
  if (!Number.isInteger(candidate) || candidate < 0) {
    throw new Error(`Το πεδίο «${label}» πρέπει να είναι ακέραιος μη αρνητικός αριθμός.`);
  }
  return candidate;
};

const parseStandingsPointsOverride = (value: unknown, label: string) => {
  if (value === null || value === undefined || value === "") return null;
  return parseScore(value, label);
};

const compareAlpha = (leftName: string, rightName: string, leftId: string, rightId: string) => {
  const collator = new Intl.Collator("el-GR", { sensitivity: "base", numeric: true });
  const normalizedLeft = String(leftName ?? "").trim() || leftId;
  const normalizedRight = String(rightName ?? "").trim() || rightId;
  const byName = collator.compare(normalizedLeft, normalizedRight);
  return byName || String(leftId).localeCompare(String(rightId));
};

const sortByCriterion = (
  criterion: StandingsTieBreakerKey,
  stats: Array<{
    teamId: string;
    teamName: string;
    points: number;
    pointDifference: number;
    overallPointDifference: number;
    overallPointsFor: number;
  }>,
) => {
  if (criterion === "alphabetical") {
    return [...stats].sort((left, right) => compareAlpha(left.teamName, right.teamName, left.teamId, right.teamId));
  }

  const bucketed = new Map<number, typeof stats>();
  for (const item of stats) {
    let keyValue = 0;
    if (criterion === "head_to_head") keyValue = item.points;
    else if (criterion === "head_to_head_point_diff") keyValue = item.pointDifference;
    else if (criterion === "overall_point_diff") keyValue = item.overallPointDifference;
    else if (criterion === "points_for") keyValue = item.overallPointsFor;
    if (!bucketed.has(keyValue)) bucketed.set(keyValue, []);
    bucketed.get(keyValue)!.push(item);
  }

  return [...bucketed.entries()]
    .sort((left, right) => right[0] - left[0])
    .flatMap(([, group]) => group);
};

const validateConfiguredTieBreakers = (tieBreakers: unknown) => {
  const configured = Array.isArray(tieBreakers) ? tieBreakers : [];
  const cleaned = configured
    .map((key) => String(key ?? "").trim())
    .filter((key): key is StandingsTieBreakerKey => ALLOWED_TIE_BREAKERS.includes(key as StandingsTieBreakerKey));
  const unique = cleaned.filter((key, index) => cleaned.indexOf(key) === index);
  return unique.length ? unique : [...ALLOWED_TIE_BREAKERS];
};

const isEligibleGame = (game: StandingsGameInput, phaseId: string, teamIds: Set<string>) => {
  const homeTeamId = String(game.homeTeamId ?? "").trim();
  const awayTeamId = String(game.awayTeamId ?? "").trim();
  if (String(game.phaseId ?? "").trim() !== phaseId) return false;
  if (!homeTeamId || !awayTeamId) return false;
  if (homeTeamId === awayTeamId) return false;
  if (!teamIds.has(homeTeamId) || !teamIds.has(awayTeamId)) return false;
  if (String(game.status ?? "").trim().toLowerCase() !== "completed") return false;
  const homeScore = parseScore(game.homeScore, "home_score");
  const awayScore = parseScore(game.awayScore, "away_score");
  if (homeScore === null || awayScore === null) return false;
  if (homeScore === awayScore) return false;
  return true;
};

type TeamStats = {
  teamId: string;
  teamName: string;
  gamesPlayed: number;
  wins: number;
  losses: number;
  standingsPoints: number;
  pointsFor: number;
  pointsAgainst: number;
};

type TieResolvedRow = {
  teamId: string;
  teamName: string;
  rank: number;
  resolvedBy: StandingsTieBreakerKey | "primary_points" | "fallback";
  primaryPoints: number;
  tieResolved: boolean;
  tieGroupId: string | null;
};

type ResolutionNode = {
  orderedTeamIds: string[];
  unresolved: boolean;
  resolvedBy: StandingsTieBreakerKey | "primary_points" | "fallback";
  tieGroupId: string | null;
};

export const calculateStandings = (input: StandingsCalculatorInput): StandingsCalculatorResult => {
  const phaseId = String(input.phaseId ?? "").trim();
  if (!phaseId) throw new Error("Η φάση είναι υποχρεωτική για τον υπολογισμό βαθμολογίας.");

  const rules = input.rules;
  if (!Number.isInteger(rules.pointsForWin) || rules.pointsForWin < 0) {
    throw new Error("Οι βαθμοί νίκης πρέπει να είναι ακέραιος μη αρνητικός αριθμός.");
  }
  if (!Number.isInteger(rules.pointsForLoss) || rules.pointsForLoss < 0) {
    throw new Error("Οι βαθμοί ήττας πρέπει να είναι ακέραιος μη αρνητικός αριθμός.");
  }

  const tieBreakers = validateConfiguredTieBreakers(input.tieBreakers);
  const teams = normalizeTeamIdList(input.teams);
  const teamIds = new Set(teams.map((team) => team.id));
  const teamById = new Map<string, StandingsTeamInput>(teams.map((team) => [team.id, team]));
  const statsById = new Map<string, TeamStats>();

  for (const team of teams) {
    statsById.set(team.id, {
      teamId: team.id,
      teamName: team.name,
      gamesPlayed: 0,
      wins: 0,
      losses: 0,
      standingsPoints: 0,
      pointsFor: 0,
      pointsAgainst: 0,
    });
  }

  const seenGameIds = new Set<string>();
  const eligibleGames: StandingsGameInput[] = [];
  for (const game of input.games) {
    const gameId = String(game.id ?? "").trim();
    if (!gameId) throw new Error("Κάθε αγώνας πρέπει να έχει σταθερό αναγνωριστικό.");
    if (seenGameIds.has(gameId)) throw new Error("Η ίδια εγγραφή αγώνα δόθηκε περισσότερες από μία φορές στον calculator.");
    seenGameIds.add(gameId);
    if (!isEligibleGame(game, phaseId, teamIds)) continue;
    eligibleGames.push(game);
  }

  for (const game of eligibleGames) {
    const homeTeamId = String(game.homeTeamId ?? "").trim();
    const awayTeamId = String(game.awayTeamId ?? "").trim();
    const homeScore = parseScore(game.homeScore, "home_score");
    const awayScore = parseScore(game.awayScore, "away_score");
    if (homeScore === null || awayScore === null) continue;
    const home = statsById.get(homeTeamId);
    const away = statsById.get(awayTeamId);
    if (!home || !away) continue;

    home.gamesPlayed += 1;
    away.gamesPlayed += 1;
    home.pointsFor += homeScore;
    home.pointsAgainst += awayScore;
    away.pointsFor += awayScore;
    away.pointsAgainst += homeScore;

    const homePointsOverride = parseStandingsPointsOverride(game.homeStandingsPointsOverride, "home_standings_points_override");
    const awayPointsOverride = parseStandingsPointsOverride(game.awayStandingsPointsOverride, "away_standings_points_override");

    if (homeScore > awayScore) {
      home.wins += 1;
      away.losses += 1;
      home.standingsPoints += homePointsOverride ?? rules.pointsForWin;
      away.standingsPoints += awayPointsOverride ?? rules.pointsForLoss;
    } else {
      away.wins += 1;
      home.losses += 1;
      away.standingsPoints += awayPointsOverride ?? rules.pointsForWin;
      home.standingsPoints += homePointsOverride ?? rules.pointsForLoss;
    }
  }

  const primaryRows: TeamStandingRow[] = teams.map((team) => {
    const stats = statsById.get(team.id)!;
    return {
      teamId: team.id,
      teamName: team.name,
      gamesPlayed: stats.gamesPlayed,
      wins: stats.wins,
      losses: stats.losses,
      standingsPoints: stats.standingsPoints,
      pointsFor: stats.pointsFor,
      pointsAgainst: stats.pointsAgainst,
      pointDifference: stats.pointsFor - stats.pointsAgainst,
      primaryPointsGroup: String(stats.standingsPoints),
    };
  });

  const groupByPoints = new Map<number, TeamStandingRow[]>();
  for (const row of primaryRows) {
    if (!groupByPoints.has(row.standingsPoints)) groupByPoints.set(row.standingsPoints, []);
    groupByPoints.get(row.standingsPoints)!.push(row);
  }

  const tieGroups = [...groupByPoints.entries()]
    .filter(([, group]) => group.length > 1)
    .sort((left, right) => right[0] - left[0])
    .map(([primaryPoints, group]) => ({ primaryPoints, teamIds: group.map((row) => row.teamId) }));

  const groupStats = (teamIdsInGroup: string[]) => {
    const teamSet = new Set(teamIdsInGroup);
    return teamIdsInGroup.map((teamId) => {
      const stats = statsById.get(teamId)!;
      const subset = eligibleGames.filter((game) => {
        const homeTeamId = String(game.homeTeamId ?? "").trim();
        const awayTeamId = String(game.awayTeamId ?? "").trim();
        return teamSet.has(homeTeamId) && teamSet.has(awayTeamId) && (homeTeamId === teamId || awayTeamId === teamId);
      });
      let points = 0;
      let pf = 0;
      let pa = 0;
      for (const game of subset) {
        const homeTeamId = String(game.homeTeamId ?? "").trim();
        const awayTeamId = String(game.awayTeamId ?? "").trim();
        const homeScore = parseScore(game.homeScore, "home_score");
        const awayScore = parseScore(game.awayScore, "away_score");
        if (homeScore === null || awayScore === null || homeScore === awayScore) continue;
        const teamIsHome = teamId === homeTeamId;
        const teamScore = teamIsHome ? homeScore : awayScore;
        const opponentScore = teamIsHome ? awayScore : homeScore;
        pf += teamScore;
        pa += opponentScore;
        const teamWon = teamScore > opponentScore;
        const override = parseStandingsPointsOverride(
          teamIsHome ? game.homeStandingsPointsOverride : game.awayStandingsPointsOverride,
          "standings_points_override",
        );
        points += override ?? (teamWon ? rules.pointsForWin : rules.pointsForLoss);
      }
      return {
        teamId,
        points,
        pointDifference: pf - pa,
        pointsFor: pf,
        teamName: stats.teamName,
        overallPointDifference: stats.pointsFor - stats.pointsAgainst,
        overallPointsFor: stats.pointsFor,
      };
    });
  };

  const orderGroup = (teamIdsInGroup: string[], criterionIndex: number, tieGroupId: string): ResolutionNode => {
    if (teamIdsInGroup.length <= 1) {
      return {
        orderedTeamIds: [...teamIdsInGroup],
        unresolved: false,
        resolvedBy: "primary_points",
        tieGroupId: null,
      };
    }

    if (criterionIndex >= tieBreakers.length) {
      return {
        orderedTeamIds: [...teamIdsInGroup].sort((left, right) => {
          const leftTeam = teamById.get(left)!;
          const rightTeam = teamById.get(right)!;
          return compareAlpha(leftTeam.name, rightTeam.name, leftTeam.id, rightTeam.id);
        }),
        unresolved: false,
        resolvedBy: "fallback",
        tieGroupId: null,
      };
    }

    const criterion = tieBreakers[criterionIndex];
    const stats = groupStats(teamIdsInGroup);
    const sortedStats = sortByCriterion(criterion, stats);
    const orderedTeamIds: string[] = [];
    let unresolved = false;

    if (criterion === "alphabetical") {
      orderedTeamIds.push(...sortedStats.map((item) => item.teamId));
      unresolved = false;
    } else {
      const buckets = new Map<number, string[]>();
      for (const item of sortedStats) {
        let keyValue = 0;
        if (criterion === "head_to_head") keyValue = item.points;
        else if (criterion === "head_to_head_point_diff") keyValue = item.pointDifference;
        else if (criterion === "overall_point_diff") keyValue = item.overallPointDifference;
        else if (criterion === "points_for") keyValue = item.overallPointsFor;
        if (!buckets.has(keyValue)) buckets.set(keyValue, []);
        buckets.get(keyValue)!.push(item.teamId);
      }

      const orderedBucketValues = [...buckets.keys()].sort((left, right) => right - left);

      for (const bucketValue of orderedBucketValues) {
        const bucket = buckets.get(bucketValue)!;
        if (bucket.length === 1) {
          orderedTeamIds.push(bucket[0]);
          continue;
        }
        const nested = orderGroup(bucket, criterionIndex + 1, tieGroupId);
        orderedTeamIds.push(...nested.orderedTeamIds);
        unresolved = unresolved || nested.unresolved;
      }
    }

    return {
      orderedTeamIds,
      unresolved,
      resolvedBy: criterion,
      tieGroupId: null,
    };
  };

  const orderedRows: StandingsCalculatorResult["orderedRows"] = [];
  const unresolvedTieGroups: StandingsCalculatorResult["unresolvedTieGroups"] = [];
  let rank = 1;
  let tieGroupIndex = 0;

  for (const [primaryPoints, group] of [...groupByPoints.entries()].sort((left, right) => right[0] - left[0])) {
    if (group.length === 1) {
      const row = group[0];
      orderedRows.push({
        teamId: row.teamId,
        teamName: row.teamName,
        rank,
        resolvedBy: "primary_points",
        primaryPoints,
        tieResolved: true,
        tieGroupId: null,
      });
      rank += 1;
      continue;
    }

    tieGroupIndex += 1;
    const tieGroupId = `tg-${primaryPoints}-${tieGroupIndex}`;
    const ordered = orderGroup(group.map((row) => row.teamId), 0, tieGroupId);
    for (const teamId of ordered.orderedTeamIds) {
      const row = primaryRows.find((item) => item.teamId === teamId)!;
      orderedRows.push({
        teamId,
        teamName: row.teamName,
        rank,
        resolvedBy: ordered.resolvedBy,
        primaryPoints,
        tieResolved: true,
        tieGroupId: null,
      });
      rank += 1;
    }
  }

  return {
    rows: primaryRows,
    tieGroups,
    orderedRows,
    unresolvedTieGroups,
  };
};
