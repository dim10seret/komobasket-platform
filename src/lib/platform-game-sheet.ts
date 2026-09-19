import type { PlatformMatchReport, PlatformMatchReportPeriodScore } from "@/lib/platform-match-report";

export type GameSheetSide = "HOME" | "AWAY";
export type GameSheetPeriod = { kind: "REGULATION" | "OVERTIME"; index: number };
export type GameSheetFoulCode = "P" | "T" | "DI" | "FL" | "D";

export type PlatformGameSheetPlayer = {
  playerId: string;
  displayName: string;
  shirtNumber: string;
  captain: boolean;
  starter: boolean;
  fouls: GameSheetFoulCode[];
  foulMarks?: Array<{ code: GameSheetFoulCode; period: GameSheetPeriod }>;
  entry?: { kind: "STARTER" | "SUBSTITUTE"; period: GameSheetPeriod } | null;
};

export type PlatformGameSheetTeam = {
  side: GameSheetSide;
  designation: "Ομάδα Α" | "Ομάδα Β";
  teamId: string;
  name: string;
  players: PlatformGameSheetPlayer[];
  timeouts: string[];
  teamFouls: Array<{ period: GameSheetPeriod; label: string; count: number }>;
  headCoach: string;
  assistantCoach: string;
  extraBench: Array<{ name: string; role: string }>;
  timeoutMarks?: Array<{ period: GameSheetPeriod }>;
  coachFouls?: Array<{ code: "C" | "B"; period: GameSheetPeriod }>;
};

export type RunningScoreMark = { shirtNumber: string; points: 1 | 2 | 3; threePoint: boolean; period?: GameSheetPeriod; symbol?: "FREE_THROW" | "FIELD_GOAL" };
export type RunningScoreRow = { score: number; home: RunningScoreMark | null; away: RunningScoreMark | null };

export type PlatformGameSheet = {
  mode: "SIMPLE" | "FULL";
  regulationPeriods: number;
  game: PlatformMatchReport["game"];
  home: PlatformGameSheetTeam;
  away: PlatformGameSheetTeam;
  officials: {
    referees: { a: string; b: string; c: string };
    table: { timer: string; shotClock: string; scoresheet: string; commissioner: string };
  };
  runningScore: RunningScoreRow[];
  periodScores: PlatformMatchReportPeriodScore[];
  winner: string;
  periodClosures?: Array<{ period: GameSheetPeriod; home: number; away: number }>;
  diagnostics?: string[];
};

export type PlatformGameSheetSource = {
  report: PlatformMatchReport;
  packageSnapshotJson: string;
  currentConfigurationJson: string;
  finalStateJson: string;
  eventJson: string[];
};

const scoringPoints = { TWO_POINT: 2, THREE_POINT: 3 } as const;
const foulCodes: Record<string, GameSheetFoulCode> = {
  PERSONAL_FOUL: "P",
  TECHNICAL_FOUL: "T",
  DISRUPTIVE_FOUL: "DI",
  FLAGRANT_FOUL: "FL",
  DISQUALIFYING_FOUL: "D",
};

function invalid(message = "GAME_SHEET_SOURCE_INVALID"): never { throw new Error(message); }
function record(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) invalid(); return value as Record<string, unknown>; }
function list(value: unknown): unknown[] { if (!Array.isArray(value)) invalid(); return value; }
function text(value: unknown): string { if (typeof value !== "string" || !value.trim()) invalid(); return value.trim(); }
function nullableText(value: unknown): string { if (value === null || value === undefined || value === "") return ""; if (typeof value !== "string") invalid(); return value.trim(); }
function json(value: string): Record<string, unknown> { try { return record(JSON.parse(value)); } catch { return invalid(); } }
function side(value: unknown): GameSheetSide { if (value !== "HOME" && value !== "AWAY") invalid(); return value; }
function period(value: unknown): GameSheetPeriod {
  const item = record(value);
  if ((item.kind !== "REGULATION" && item.kind !== "OVERTIME") || !Number.isInteger(item.index) || Number(item.index) < 1) invalid();
  return { kind: item.kind, index: Number(item.index) };
}
function periodKey(value: GameSheetPeriod): string { return `${value.kind}:${value.index}`; }
export function gameSheetPeriodLabel(value: GameSheetPeriod): string { return value.kind === "REGULATION" ? `${value.index}η` : `Παρ. ${value.index}`; }
export function gameSheetPeriodColor(value: GameSheetPeriod, regulationPeriods: number): "red" | "blue" {
  if (!Number.isInteger(regulationPeriods) || regulationPeriods < 1 || !Number.isInteger(value.index) || value.index < 1 || value.kind === "REGULATION" && value.index > regulationPeriods) invalid();
  const ordinal = value.kind === "REGULATION" ? value.index : regulationPeriods + value.index;
  return ordinal % 2 === 1 ? "red" : "blue";
}

function teamItem(root: Record<string, unknown>, value: GameSheetSide): Record<string, unknown> {
  const item = list(root.teams).map(record).find((candidate) => candidate.side === value);
  if (!item) invalid();
  return item;
}

function finalTeam(root: Record<string, unknown>, value: GameSheetSide): Record<string, unknown> {
  return record(value === "HOME" ? root.home : root.away);
}

function roleKind(roleValue: unknown): "HEAD" | "ASSISTANT" | "OTHER" {
  const role = nullableText(roleValue).toLocaleLowerCase("el").replace(/[\s-]+/g, "_");
  if (role.includes("assistant") || role.includes("βοηθ")) return "ASSISTANT";
  if (role === "coach" || role.includes("head_coach") || role.includes("προπονητ")) return "HEAD";
  return "OTHER";
}

function extraBenchRole(value: unknown): string {
  const roles: Record<string, string> = { coach: "Προπονητής", assistant_coach: "Βοηθός Προπονητή", team_manager: "Υπεύθυνος Ομάδας", physiotherapist: "Φυσικοθεραπευτής", doctor: "Ιατρός", other: "Άλλο" };
  const role = text(value);
  if (!roles[role]) invalid();
  return roles[role];
}

function buildTeam(
  report: PlatformMatchReport,
  packageRoot: Record<string, unknown>,
  configurationRoot: Record<string, unknown>,
  finalRoot: Record<string, unknown>,
  value: GameSheetSide,
  events: Record<string, unknown>[],
): PlatformGameSheetTeam {
  const packageTeam = teamItem(packageRoot, value);
  const configurationTeam = teamItem(configurationRoot, value);
  const stateTeam = finalTeam(finalRoot, value);
  const expected = value === "HOME" ? report.game.homeTeam : report.game.awayTeam;
  if (text(packageTeam.id) !== expected.teamId || text(configurationTeam.teamId) !== expected.teamId || text(stateTeam.id) !== expected.teamId) invalid();

  const packagePlayers = new Map(list(packageTeam.players).map(record).map((player) => [text(player.id), player]));
  const statePlayers = new Map(list(stateTeam.players).map(record).map((player) => [text(player.playerId), player]));
  const configuredPlayers = list(configurationTeam.players).map(record);
  const configuredById = new Map(configuredPlayers.map((player) => [text(player.playerId), player]));
  const required = new Set(configuredPlayers.filter((player) => player.participating === true).map((player) => text(player.playerId)));
  for (const id of statePlayers.keys()) required.add(id);
  const additions = new Map<string, Record<string, unknown>>();
  for (const event of events) {
    if (event.type === "ROSTER_PLAYER_ADDED" && event.team === value) additions.set(text(event.playerId), event);
    if (event.team === value) {
      for (const key of ["playerId", "playerInId", "playerOutId", "assistPlayerId"] as const) if (typeof event[key] === "string") required.add(text(event[key]));
      if (event.type === "LINEUP_SET") for (const id of list(event.playerIds).map(text)) required.add(id);
      if (event.offender && record(event.offender).kind === "PLAYER") required.add(text(record(event.offender).playerId));
    }
    if (event.team !== value && (event.team === "HOME" || event.team === "AWAY") && typeof event.fouledPlayerId === "string") required.add(text(event.fouledPlayerId));
  }
  const captainPlayerId = configurationTeam.captainPlayerId === null ? null : text(configurationTeam.captainPlayerId);
  const starterIds = new Set(list(configurationTeam.starterPlayerIds).map(text));
  const players = [...required].map((playerId): PlatformGameSheetPlayer => {
    const statePlayer = statePlayers.get(playerId);
    const packagePlayer = packagePlayers.get(playerId);
    const configured = configuredById.get(playerId);
    const addition = additions.get(playerId);
    const name = statePlayer?.displayName ?? addition?.displayName ?? packagePlayer?.displayName;
    const number = statePlayer?.shirtNumber ?? configured?.gameShirtNumber ?? addition?.shirtNumber ?? packagePlayer?.shirtNumber;
    if (!name || number === null || number === undefined || String(number).trim() === "") invalid(`GAME_SHEET_PLAYER_UNRESOLVED:${playerId}`);
    const shirtNumber = String(number);
    return { playerId, displayName: text(name), shirtNumber, captain: captainPlayerId === playerId, starter: starterIds.has(playerId), fouls: [], foulMarks: [], entry: starterIds.has(playerId) ? { kind: "STARTER", period: { kind: "REGULATION", index: 1 } } : null };
  }).sort((a, b) => {
    const rank = (number: string) => number === "0" ? -2 : number === "00" ? -1 : /^\d+$/.test(number) ? Number(number) : Number.POSITIVE_INFINITY;
    return rank(a.shirtNumber) - rank(b.shirtNumber) || a.shirtNumber.localeCompare(b.shirtNumber) || a.playerId.localeCompare(b.playerId);
  });
  if ((captainPlayerId && !players.some((player) => player.playerId === captainPlayerId)) || [...starterIds].some((id) => !players.some((player) => player.playerId === id))) invalid();

  const selectedStaff = new Set(list(configurationTeam.staff).map(record).filter((member) => member.participating === true).map((member) => text(member.staffId)));
  const staff = list(packageTeam.staff).map(record).filter((member) => selectedStaff.has(text(member.id)));
  const namedStaff = (kind: "HEAD" | "ASSISTANT") => nullableText(staff.find((member) => roleKind(member.role) === kind)?.displayName);
  const extraBench = list(configurationTeam.extraBench).map((entry) => {
    const item = record(entry);
    return { name: text(item.name), role: extraBenchRole(item.role) };
  });
  if (extraBench.length > 10) invalid();
  return {
    side: value,
    designation: value === "HOME" ? "Ομάδα Α" : "Ομάδα Β",
    teamId: expected.teamId,
    name: expected.name,
    players,
    timeouts: [],
    teamFouls: report.game.periodScores.map((score) => ({ period: score.period, label: gameSheetPeriodLabel(score.period), count: 0 })),
    headCoach: namedStaff("HEAD"),
    assistantCoach: namedStaff("ASSISTANT"),
    extraBench,
    timeoutMarks: [],
    coachFouls: [],
  };
}

function officialGroup(root: Record<string, unknown>, key: "referees" | "table"): Record<string, unknown> { return record(root[key]); }

export function projectPlatformGameSheet(source: PlatformGameSheetSource): PlatformGameSheet {
  if (!source.report.availability.available) invalid("MATCH_REPORT_UNAVAILABLE");
  const packageRoot = json(source.packageSnapshotJson);
  const configurationRoot = json(source.currentConfigurationJson);
  const finalRoot = json(source.finalStateJson);
  const regulationPeriods = record(finalRoot.rules).regulationPeriods;
  if (!Number.isInteger(regulationPeriods) || Number(regulationPeriods) < 1) invalid();
  const packageGame = record(packageRoot.game);
  if (text(packageGame.id) !== source.report.game.gameId || text(configurationRoot.gameId) !== source.report.game.gameId || text(finalRoot.id) !== text(configurationRoot.runId)) invalid();

  const events = source.eventJson.map(json).sort((left, right) => Number(left.sequence) - Number(right.sequence) || text(left.id).localeCompare(text(right.id)));
  const home = buildTeam(source.report, packageRoot, configurationRoot, finalRoot, "HOME", events);
  const away = buildTeam(source.report, packageRoot, configurationRoot, finalRoot, "AWAY", events);
  const teams = { HOME: home, AWAY: away };
  const playerMap = { HOME: new Map(home.players.map((player) => [player.playerId, player])), AWAY: new Map(away.players.map((player) => [player.playerId, player])) };
  const periodFouls = { HOME: new Map(home.teamFouls.map((item) => [periodKey(item.period), item])), AWAY: new Map(away.teamFouls.map((item) => [periodKey(item.period), item])) };
  const runningScore: RunningScoreRow[] = Array.from({ length: 160 }, (_, index) => ({ score: index + 1, home: null, away: null }));
  const cumulative = { HOME: 0, AWAY: 0 };
  const periodTotals = new Map<string, { home: number; away: number }>();
  const periodClosures: NonNullable<PlatformGameSheet["periodClosures"]> = [];
  const diagnostics: string[] = [];
  let activePeriod: GameSheetPeriod | null = null;

  for (const event of events) {
    if (event.type === "MATCH_START") { activePeriod = { kind: "REGULATION", index: 1 }; continue; }
    if (event.type === "PERIOD_START") { activePeriod = period(event.period); continue; }
    if (event.type === "PERIOD_END") { periodClosures.push({ period: period(event.period), home: cumulative.HOME, away: cumulative.AWAY }); activePeriod = null; continue; }
    const eventSide = event.team === "HOME" || event.team === "AWAY" ? side(event.team) : null;
    const points = event.type === "FREE_THROW" && event.made === true ? 1 : scoringPoints[event.type as keyof typeof scoringPoints];
    if (points) {
      if (!eventSide || !activePeriod) invalid();
      const player = playerMap[eventSide].get(text(event.playerId));
      if (!player) invalid();
      cumulative[eventSide] += points;
      if (cumulative[eventSide] > 160) invalid("GAME_SHEET_SCORE_OVERFLOW");
      const mark: RunningScoreMark = { shirtNumber: player.shirtNumber, points: points as 1 | 2 | 3, threePoint: points === 3, period: activePeriod, symbol: points === 1 ? "FREE_THROW" : "FIELD_GOAL" };
      if (eventSide === "HOME") runningScore[cumulative.HOME - 1]!.home = mark;
      else runningScore[cumulative.AWAY - 1]!.away = mark;
      const total = periodTotals.get(periodKey(activePeriod)) ?? { home: 0, away: 0 };
      if (eventSide === "HOME") total.home += points; else total.away += points;
      periodTotals.set(periodKey(activePeriod), total);
    }
    if (event.type === "SUBSTITUTION") {
      if (!eventSide || !activePeriod) invalid();
      const entering = playerMap[eventSide].get(text(event.playerInId));
      if (!entering) invalid(`GAME_SHEET_PLAYER_UNRESOLVED:${text(event.playerInId)}`);
      if (!entering.entry) entering.entry = { kind: "SUBSTITUTE", period: activePeriod };
    }
    const foulCode = typeof event.type === "string" ? foulCodes[event.type] : undefined;
    if (foulCode) {
      if (!eventSide || !activePeriod) invalid();
      const offender = record(event.offender);
      if (offender.kind === "PLAYER") {
        const player = playerMap[eventSide].get(text(offender.playerId));
        if (!player) invalid();
        player.fouls.push(foulCode);
        player.foulMarks?.push({ code: foulCode, period: activePeriod });
        if (player.fouls.length > 5) invalid("GAME_SHEET_PLAYER_FOUL_OVERFLOW");
        const key = periodKey(activePeriod);
        let summary = periodFouls[eventSide].get(key);
        if (!summary) {
          summary = { period: activePeriod, label: gameSheetPeriodLabel(activePeriod), count: 0 };
          periodFouls[eventSide].set(key, summary);
          teams[eventSide].teamFouls.push(summary);
        }
        summary.count += 1;
      } else if (offender.kind === "BENCH" && event.type === "TECHNICAL_FOUL") {
        const context = event.scorerEventContext && typeof event.scorerEventContext === "object" ? record(event.scorerEventContext) : {};
        const code = context.technicalStaffSource === "COACH" ? "C" : context.technicalStaffSource === "BENCH" ? "B" : offender.role === "HEAD_COACH" ? "C" : offender.role === "ACCOMPANYING_DELEGATION" ? "B" : null;
        if (code) teams[eventSide].coachFouls?.push({ code, period: activePeriod });
      }
    }
    if (event.type === "TIMEOUT") {
      if (!eventSide || !activePeriod) invalid();
      teams[eventSide].timeouts.push(gameSheetPeriodLabel(activePeriod));
      teams[eventSide].timeoutMarks?.push({ period: activePeriod });
    }
  }
  if (cumulative.HOME !== source.report.game.finalScore.home || cumulative.AWAY !== source.report.game.finalScore.away) invalid("GAME_SHEET_SCORE_MISMATCH");
  for (const score of source.report.game.periodScores) {
    const actual = periodTotals.get(periodKey(score.period)) ?? { home: 0, away: 0 };
    if (actual.home !== score.home || actual.away !== score.away) invalid(`GAME_SHEET_PERIOD_SCORE_MISMATCH:${periodKey(score.period)}`);
  }
  for (const value of ["HOME", "AWAY"] as const) {
    const stats = value === "HOME" ? source.report.statistics.home : source.report.statistics.away;
    // Match Report rows lack playerId; never infer an identity from a shirt/name or fail an otherwise canonical event history.
    stats.players.forEach((_, index) => diagnostics.push(`GAME_SHEET_STATISTICS_ROW_UNKEYED:${value}:${index}`));
  }

  const officials = record(configurationRoot.officials);
  const referees = officialGroup(officials, "referees");
  const table = officialGroup(officials, "table");
  return {
    mode: source.report.mode,
    regulationPeriods: Number(regulationPeriods),
    game: source.report.game,
    home,
    away,
    officials: {
      referees: { a: nullableText(referees.a), b: nullableText(referees.b), c: nullableText(referees.c) },
      table: { timer: nullableText(table.timer), shotClock: nullableText(table.shotClock), scoresheet: nullableText(table.scoresheet), commissioner: nullableText(table.commissioner) },
    },
    runningScore,
    periodScores: source.report.game.periodScores,
    winner: source.report.game.winner === "HOME" ? home.name : source.report.game.winner === "AWAY" ? away.name : "ΙΣΟΠΑΛΙΑ",
    periodClosures,
    diagnostics,
  };
}
