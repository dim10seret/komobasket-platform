import { createHash } from "node:crypto";
import { MatchEngine } from "../../komocontrol/shared/match-engine/engine/match-engine";
import type { MatchEvent } from "../../komocontrol/shared/match-engine/types/event";
import type { MatchPeriod } from "../../komocontrol/shared/match-engine/types/period";
import type { Player } from "../../komocontrol/shared/match-engine/types/player";
import type { PlayerStatistics } from "../../komocontrol/shared/match-engine/types/statistics";
import type { Team } from "../../komocontrol/shared/match-engine/types/team";

export type PublicGameStatus = "scheduled" | "live" | "completed";
export type PublicTeamSide = "HOME" | "AWAY";

export type PublicLivePlayerStatistics = PlayerStatistics & {
  rebounds: number;
  efficiency: number;
};

export type PublicLivePlayer = {
  key: string;
  displayName: string;
  shirtNumber: string;
  onCourt: boolean;
  fouls: {
    total: number;
    status: string;
    statusReason: string | null;
  };
  statistics: PublicLivePlayerStatistics;
};

export type PublicLiveTeam = {
  side: PublicTeamSide;
  teamId: string;
  teamName: string;
  logoUrl: string | null;
  gameColor: string | null;
  score: number;
  timeouts: number;
  timeoutAllowance: number;
  teamFouls: number;
  inBonus: boolean;
  players: PublicLivePlayer[];
  activeFive: PublicLivePlayer[];
};

export type PublicLivePlayByPlayItem = {
  sequence: number;
  occurredAt: number;
  type: string;
  period: MatchPeriod;
  clockSeconds: number;
  team: PublicTeamSide | null;
  label: string;
};

export type PublicLiveGame = {
  gameId: string;
  status: "live" | "completed";
  lifecycle: "live" | "finalized";
  revision: number;
  lastAcceptedSequence: number;
  updatedAt: string;
  score: { home: number; away: number };
  period: MatchPeriod;
  periodScores: Array<{ period: MatchPeriod; home: number; away: number }>;
  clock: { remainingSeconds: number; running: boolean; asOfMs: number };
  possession: PublicTeamSide | null;
  home: PublicLiveTeam;
  away: PublicLiveTeam;
  playByPlay: PublicLivePlayByPlayItem[];
};

export type PublicLiveSource = {
  gameId: string;
  lifecycle: "live" | "finalized";
  eventHistoryRevision: number;
  lastAcceptedSequence: number;
  historyHash: string;
  updatedAt: string;
  initialStateJson: string;
  initialStateHash: string;
  currentConfigurationJson: string | null;
  homeLogoUrl: string | null;
  awayLogoUrl: string | null;
};

export type PublicLiveEventRow = {
  eventId: string;
  sequence: number;
  eventSchemaVersion: number;
  eventJson: string;
  eventHash: string;
};

const HIDDEN_PUBLIC_EVENTS = new Set([
  "CLOCK_START",
  "CLOCK_STOP",
  "CLOCK_SET",
  "LINEUP_SET",
  "ROSTER_PLAYER_ADDED",
  "PENALTY_ADMINISTRATION_ENDED",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function publicGameStatus(
  gameStatus: string | null,
  homeScore: number | null,
  awayScore: number | null,
  gameplayLifecycle: string | null,
): PublicGameStatus {
  if (gameplayLifecycle === "live") return "live";
  return gameStatus === "completed" && homeScore !== null && awayScore !== null ? "completed" : "scheduled";
}

export function publicPlayerStatistics(statistics: PlayerStatistics): PublicLivePlayerStatistics {
  const rebounds = statistics.offensiveRebounds + statistics.defensiveRebounds;
  const efficiency = statistics.points + rebounds + statistics.assists + statistics.steals + statistics.blocks - statistics.turnovers
    - (statistics.freeThrowAttempts - statistics.freeThrowMade)
    - (statistics.twoPointAttempts - statistics.twoPointMade)
    - (statistics.threePointAttempts - statistics.threePointMade);
  return { ...statistics, rebounds, efficiency };
}

function publicPlayer(player: Player, side: PublicTeamSide): PublicLivePlayer {
  return {
    key: `${side}:${player.shirtNumber}`,
    displayName: player.displayName,
    shirtNumber: player.shirtNumber,
    onCourt: player.onCourt,
    fouls: {
      total: player.foulState.total,
      status: player.foulState.status,
      statusReason: player.foulState.statusReason ?? null,
    },
    statistics: publicPlayerStatistics(player.statistics),
  };
}

function teamColor(configurationJson: string | null, side: PublicTeamSide): string | null {
  if (!configurationJson) return null;
  try {
    const root = JSON.parse(configurationJson) as { teams?: Array<{ side?: unknown; gameColor?: unknown }> };
    const color = root.teams?.find((team) => team.side === side)?.gameColor;
    return typeof color === "string" && /^#[0-9A-F]{6}$/i.test(color) ? color : null;
  } catch {
    return null;
  }
}

function publicTeam(
  team: Team,
  side: PublicTeamSide,
  logoUrl: string | null,
  configurationJson: string | null,
  bonusThreshold: number,
): PublicLiveTeam {
  const players = team.players.map((player) => publicPlayer(player, side));
  return {
    side,
    teamId: team.id,
    teamName: team.name,
    logoUrl,
    gameColor: teamColor(configurationJson, side),
    score: team.score,
    timeouts: team.timeouts,
    timeoutAllowance: team.timeoutAllowance ?? 0,
    teamFouls: team.teamFouls,
    inBonus: team.teamFouls >= bonusThreshold,
    players,
    activeFive: players.filter((player) => player.onCourt),
  };
}

function findPlayerLabel(home: Team, away: Team, playerId: string | undefined): string | null {
  if (!playerId) return null;
  const player = [...home.players, ...away.players].find((candidate) => candidate.playerId === playerId);
  return player ? `#${player.shirtNumber} ${player.displayName}` : null;
}

function teamName(home: Team, away: Team, side: PublicTeamSide | undefined): string | null {
  return side === "HOME" ? home.name : side === "AWAY" ? away.name : null;
}

function eventTeam(event: MatchEvent): PublicTeamSide | null {
  return "team" in event && (event.team === "HOME" || event.team === "AWAY") ? event.team : null;
}

export function isPublicPlayByPlayEvent(type: string): boolean {
  return !HIDDEN_PUBLIC_EVENTS.has(type);
}

function foulLabel(event: Extract<MatchEvent, { type: "PERSONAL_FOUL" | "TECHNICAL_FOUL" | "DISRUPTIVE_FOUL" | "FLAGRANT_FOUL" | "DISQUALIFYING_FOUL" }>, home: Team, away: Team): string {
  const base = event.type === "PERSONAL_FOUL"
    ? "Προσωπικό φάουλ"
    : event.type === "TECHNICAL_FOUL"
      ? event.category === "CATEGORY_1" ? "Τεχνική ποινή GD" : "Τεχνική ποινή"
      : event.type === "DISRUPTIVE_FOUL"
        ? "Disruptive foul"
        : event.type === "FLAGRANT_FOUL"
          ? "Flagrant foul"
          : "Disqualifying foul";
  const offender = event.offender.kind === "PLAYER"
    ? findPlayerLabel(home, away, event.offender.playerId)
    : `${event.scorerEventContext?.technicalStaffSource ?? event.offender.role} · ${teamName(home, away, event.team)}`;
  return `${base}${offender ? ` · ${offender}` : ""}`;
}

export function publicPlayByPlayLabel(event: MatchEvent, home: Team, away: Team): string {
  const actor = "playerId" in event ? findPlayerLabel(home, away, event.playerId) : null;
  switch (event.type) {
    case "MATCH_START": return "Έναρξη αγώνα";
    case "MATCH_END": return "Λήξη αγώνα";
    case "PERIOD_START": return `Έναρξη ${event.period.kind === "REGULATION" ? `Q${event.period.index}` : `OT${event.period.index}`}`;
    case "PERIOD_END": return `Λήξη ${event.period.kind === "REGULATION" ? `Q${event.period.index}` : `OT${event.period.index}`}`;
    case "TWO_POINT":
    case "THREE_POINT": {
      const assist = event.assistPlayerId ? findPlayerLabel(home, away, event.assistPlayerId) : null;
      return `${event.type === "TWO_POINT" ? "2PT εύστοχο" : "3PT εύστοχο"}${actor ? ` · ${actor}` : ""}${assist ? ` · ασίστ ${assist}` : ""}`;
    }
    case "TWO_POINT_MISSED":
    case "THREE_POINT_MISSED": return `${event.type === "TWO_POINT_MISSED" ? "2PT άστοχο" : "3PT άστοχο"}${actor ? ` · ${actor}` : ""}`;
    case "FREE_THROW": return `1PT ${event.made ? "εύστοχο" : "άστοχο"}${actor ? ` · ${actor}` : ""}`;
    case "PERSONAL_FOUL":
    case "TECHNICAL_FOUL":
    case "DISRUPTIVE_FOUL":
    case "FLAGRANT_FOUL":
    case "DISQUALIFYING_FOUL": return foulLabel(event, home, away);
    case "TURNOVER": return `Λάθος${actor ? ` · ${actor}` : ""}`;
    case "STEAL": return `Κλέψιμο${actor ? ` · ${actor}` : ""}`;
    case "BLOCK": return `Τάπα${actor ? ` · ${actor}` : ""}`;
    case "REBOUND": return `${event.offensive ? "Επιθετικό" : "Αμυντικό"} ριμπάουντ${event.teamRebound ? ` · TEAM ${teamName(home, away, event.team)}` : actor ? ` · ${actor}` : ""}`;
    case "TIMEOUT": return `Time out · ${teamName(home, away, event.team)}`;
    case "SUBSTITUTION": return `Αλλαγή · μέσα ${findPlayerLabel(home, away, event.playerInId) ?? "παίκτης"} · έξω ${findPlayerLabel(home, away, event.playerOutId) ?? "παίκτης"}`;
    case "JUMP_BALL": return `Jump ball · κατοχή ${teamName(home, away, event.possession)}`;
    case "ALTERNATING_POSSESSION": return "Εναλλασσόμενη κατοχή";
    default: return event.type;
  }
}

function samePeriod(left: MatchPeriod, right: MatchPeriod): boolean {
  return left.kind === right.kind && left.index === right.index;
}

function periodScores(events: MatchEvent[], currentPeriod: MatchPeriod) {
  const scores: Array<{ period: MatchPeriod; home: number; away: number }> = [];
  let active: MatchPeriod = { kind: "REGULATION", index: 1 };
  const ensure = () => {
    let score = scores.find((candidate) => samePeriod(candidate.period, active));
    if (!score) { score = { period: { ...active }, home: 0, away: 0 }; scores.push(score); }
    return score;
  };
  ensure();
  for (const event of events) {
    if (event.type === "PERIOD_START") { active = { ...event.period }; ensure(); continue; }
    const points = event.type === "TWO_POINT" ? 2 : event.type === "THREE_POINT" ? 3 : event.type === "FREE_THROW" && event.made ? 1 : 0;
    const side = eventTeam(event);
    if (points && side) ensure()[side === "HOME" ? "home" : "away"] += points;
  }
  active = currentPeriod;
  ensure();
  return scores;
}

export function projectPublicLiveGame(source: PublicLiveSource, rows: PublicLiveEventRow[], nowMs = Date.now()): PublicLiveGame {
  if (sha256(source.initialStateJson) !== source.initialStateHash || rows.length === 0) throw new Error("PUBLIC_LIVE_CORRUPTED");
  const ordered = [...rows].sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
  let previousSequence = 0;
  const events = ordered.map((row) => {
    if (row.eventSchemaVersion !== 2 || sha256(row.eventJson) !== row.eventHash || row.sequence <= previousSequence) throw new Error("PUBLIC_LIVE_CORRUPTED");
    previousSequence = row.sequence;
    const event = JSON.parse(row.eventJson) as MatchEvent;
    if (event.schemaVersion !== 2 || event.id !== row.eventId || event.sequence !== row.sequence) throw new Error("PUBLIC_LIVE_CORRUPTED");
    return event;
  });
  if (events[0]?.type !== "MATCH_START" || events.at(-1)!.sequence > source.lastAcceptedSequence
    || sha256(`[${ordered.map((row) => row.eventJson).join(",")}]`) !== source.historyHash) throw new Error("PUBLIC_LIVE_CORRUPTED");

  const initialState = JSON.parse(source.initialStateJson);
  const engine = MatchEngine.fromInitialState(initialState);
  const playByPlay: PublicLivePlayByPlayItem[] = [];
  let clockStartedAtMs: number | null = null;
  for (const event of events) {
    const result = engine.process(event);
    if (!result.accepted) throw new Error("PUBLIC_LIVE_CORRUPTED");
    if (event.type === "CLOCK_START") clockStartedAtMs = event.occurredAt;
    else if (["CLOCK_STOP", "CLOCK_SET", "PERIOD_START", "PERIOD_END"].includes(event.type)) clockStartedAtMs = null;
    if (isPublicPlayByPlayEvent(event.type)) {
      const state = engine.getState();
      playByPlay.push({
        sequence: event.sequence,
        occurredAt: event.occurredAt,
        type: event.type,
        period: "period" in event && event.period ? { ...event.period } : { ...state.period },
        clockSeconds: state.clock,
        team: eventTeam(event),
        label: publicPlayByPlayLabel(event, state.home, state.away),
      });
    }
  }
  const state = engine.getState();
  if ((source.lifecycle === "live" && state.finished) || (source.lifecycle === "finalized" && !state.finished)) throw new Error("PUBLIC_LIVE_CORRUPTED");
  const elapsed = state.clockRunning && clockStartedAtMs !== null ? Math.max(0, Math.floor((nowMs - clockStartedAtMs) / 1000)) : 0;
  const bonusThreshold = state.rules.teamFoulPenaltyThreshold;
  const home = publicTeam(state.home, "HOME", source.homeLogoUrl, source.currentConfigurationJson, bonusThreshold);
  const away = publicTeam(state.away, "AWAY", source.awayLogoUrl, source.currentConfigurationJson, bonusThreshold);
  return {
    gameId: source.gameId,
    status: source.lifecycle === "live" ? "live" : "completed",
    lifecycle: source.lifecycle,
    revision: source.eventHistoryRevision,
    lastAcceptedSequence: source.lastAcceptedSequence,
    updatedAt: source.updatedAt,
    score: { home: home.score, away: away.score },
    period: { ...state.period },
    periodScores: periodScores(events, state.period),
    clock: { remainingSeconds: Math.max(0, state.clock - elapsed), running: state.clockRunning, asOfMs: nowMs },
    possession: state.possession === "HOME" || state.possession === "AWAY" ? state.possession : null,
    home,
    away,
    playByPlay: playByPlay.reverse().slice(0, 100),
  };
}
