import type { PlatformMatchReport, PlatformMatchReportPeriodScore } from "@/lib/platform-match-report";

export type GameSheetSide = "HOME" | "AWAY";
export type GameSheetPeriod = { kind: "REGULATION" | "OVERTIME"; index: number };
export type GameSheetFoulCode = "P" | "T" | "U" | "F" | "D";

export type PlatformGameSheetPlayer = {
  playerId: string;
  displayName: string;
  shirtNumber: string;
  captain: boolean;
  starter: boolean;
  fouls: GameSheetFoulCode[];
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
};

export type RunningScoreMark = { shirtNumber: string; points: 1 | 2 | 3; threePoint: boolean };
export type RunningScoreRow = { score: number; home: RunningScoreMark | null; away: RunningScoreMark | null };

export type PlatformGameSheet = {
  mode: "SIMPLE" | "FULL";
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
  DISRUPTIVE_FOUL: "U",
  FLAGRANT_FOUL: "F",
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
): PlatformGameSheetTeam {
  const packageTeam = teamItem(packageRoot, value);
  const configurationTeam = teamItem(configurationRoot, value);
  const stateTeam = finalTeam(finalRoot, value);
  const expected = value === "HOME" ? report.game.homeTeam : report.game.awayTeam;
  if (text(packageTeam.id) !== expected.teamId || text(configurationTeam.teamId) !== expected.teamId || text(stateTeam.id) !== expected.teamId) invalid();

  const packagePlayers = new Map(list(packageTeam.players).map(record).map((player) => [text(player.id), player]));
  const statePlayers = new Map(list(stateTeam.players).map(record).map((player) => [text(player.playerId), player]));
  const configuredPlayers = list(configurationTeam.players).map(record);
  const participating = configuredPlayers.filter((player) => player.participating === true);
  if (participating.length > 12) invalid("GAME_SHEET_ROSTER_OVERFLOW");
  const captainPlayerId = configurationTeam.captainPlayerId === null ? null : text(configurationTeam.captainPlayerId);
  const starterIds = new Set(list(configurationTeam.starterPlayerIds).map(text));
  const players = participating.map((configured): PlatformGameSheetPlayer => {
    const playerId = text(configured.playerId);
    const statePlayer = statePlayers.get(playerId);
    const packagePlayer = packagePlayers.get(playerId);
    if (!statePlayer || !packagePlayer) invalid();
    const configuredShirt = configured.gameShirtNumber === null ? "" : nullableText(configured.gameShirtNumber);
    const shirtNumber = configuredShirt || String(statePlayer.shirtNumber ?? packagePlayer.shirtNumber ?? "");
    return { playerId, displayName: text(statePlayer.displayName ?? packagePlayer.displayName), shirtNumber, captain: captainPlayerId === playerId, starter: starterIds.has(playerId), fouls: [] };
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
  };
}

function officialGroup(root: Record<string, unknown>, key: "referees" | "table"): Record<string, unknown> { return record(root[key]); }

export function projectPlatformGameSheet(source: PlatformGameSheetSource): PlatformGameSheet {
  if (!source.report.availability.available) invalid("MATCH_REPORT_UNAVAILABLE");
  const packageRoot = json(source.packageSnapshotJson);
  const configurationRoot = json(source.currentConfigurationJson);
  const finalRoot = json(source.finalStateJson);
  const packageGame = record(packageRoot.game);
  if (text(packageGame.id) !== source.report.game.gameId || text(configurationRoot.gameId) !== source.report.game.gameId || text(finalRoot.id) !== text(configurationRoot.runId)) invalid();

  const home = buildTeam(source.report, packageRoot, configurationRoot, finalRoot, "HOME");
  const away = buildTeam(source.report, packageRoot, configurationRoot, finalRoot, "AWAY");
  const teams = { HOME: home, AWAY: away };
  const playerMap = { HOME: new Map(home.players.map((player) => [player.playerId, player])), AWAY: new Map(away.players.map((player) => [player.playerId, player])) };
  const periodFouls = { HOME: new Map(home.teamFouls.map((item) => [periodKey(item.period), item])), AWAY: new Map(away.teamFouls.map((item) => [periodKey(item.period), item])) };
  const runningScore: RunningScoreRow[] = Array.from({ length: 160 }, (_, index) => ({ score: index + 1, home: null, away: null }));
  const cumulative = { HOME: 0, AWAY: 0 };
  let activePeriod: GameSheetPeriod | null = null;
  const events = source.eventJson.map(json).sort((left, right) => Number(left.sequence) - Number(right.sequence) || text(left.id).localeCompare(text(right.id)));

  for (const event of events) {
    if (event.type === "MATCH_START") { activePeriod = { kind: "REGULATION", index: 1 }; continue; }
    if (event.type === "PERIOD_START") { activePeriod = period(event.period); continue; }
    if (event.type === "PERIOD_END") { activePeriod = null; continue; }
    const eventSide = event.team === "HOME" || event.team === "AWAY" ? side(event.team) : null;
    const points = event.type === "FREE_THROW" && event.made === true ? 1 : scoringPoints[event.type as keyof typeof scoringPoints];
    if (points) {
      if (!eventSide || !activePeriod) invalid();
      const player = playerMap[eventSide].get(text(event.playerId));
      if (!player) invalid();
      cumulative[eventSide] += points;
      if (cumulative[eventSide] > 160) invalid("GAME_SHEET_SCORE_OVERFLOW");
      const mark: RunningScoreMark = { shirtNumber: player.shirtNumber, points: points as 1 | 2 | 3, threePoint: points === 3 };
      if (eventSide === "HOME") runningScore[cumulative.HOME - 1]!.home = mark;
      else runningScore[cumulative.AWAY - 1]!.away = mark;
    }
    const foulCode = typeof event.type === "string" ? foulCodes[event.type] : undefined;
    if (foulCode) {
      if (!eventSide || !activePeriod) invalid();
      const offender = record(event.offender);
      if (offender.kind === "PLAYER") {
        const player = playerMap[eventSide].get(text(offender.playerId));
        if (!player) invalid();
        player.fouls.push(foulCode);
        if (player.fouls.length > 5) invalid("GAME_SHEET_PLAYER_FOUL_OVERFLOW");
        const key = periodKey(activePeriod);
        let summary = periodFouls[eventSide].get(key);
        if (!summary) {
          summary = { period: activePeriod, label: gameSheetPeriodLabel(activePeriod), count: 0 };
          periodFouls[eventSide].set(key, summary);
          teams[eventSide].teamFouls.push(summary);
        }
        summary.count += 1;
      }
    }
    if (event.type === "TIMEOUT") {
      if (!eventSide || !activePeriod) invalid();
      teams[eventSide].timeouts.push(gameSheetPeriodLabel(activePeriod));
    }
  }
  if (cumulative.HOME !== source.report.game.finalScore.home || cumulative.AWAY !== source.report.game.finalScore.away) invalid("GAME_SHEET_SCORE_MISMATCH");

  const officials = record(configurationRoot.officials);
  const referees = officialGroup(officials, "referees");
  const table = officialGroup(officials, "table");
  return {
    mode: source.report.mode,
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
  };
}
