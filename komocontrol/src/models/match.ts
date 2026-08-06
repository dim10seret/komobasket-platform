import { Quarter } from "../types/quarter";
import { TeamSide } from "../types/team-side";
import type { Match } from "../types/match";
import type { MatchState } from "../types/match-state";
import type { Player } from "../types/player";
import { createTeam } from "./team";

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
