import { Quarter } from "../types/quarter.js";
import { TeamSide } from "../types/team-side.js";
import type { Match } from "../types/match.js";
import type { MatchState } from "../types/match-state.js";
import type { Player } from "../types/player.js";
import { createTeam } from "./team.js";

export interface CreateMatchOptions {
  id?: string;
  homeTeam?: { id: string; name: string; players?: Player[] };
  awayTeam?: { id: string; name: string; players?: Player[] };
}

export function createMatch(options: CreateMatchOptions = {}): Match {
  const state: MatchState = {
    id: options.id ?? crypto.randomUUID(),
    quarter: Quarter.Q1,
    clock: 600,
    clockRunning: false,
    started: false,
    home: createTeam(options.homeTeam?.id ?? "home", options.homeTeam?.name ?? "Home", TeamSide.HOME, options.homeTeam?.players),
    away: createTeam(options.awayTeam?.id ?? "away", options.awayTeam?.name ?? "Away", TeamSide.AWAY, options.awayTeam?.players),
    possession: TeamSide.HOME,
    alternatingPossession: TeamSide.AWAY,
    finished: false,
    lastProcessedSequence: 0,
  };
  return { state, events: [] };
}
