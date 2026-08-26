import type { TeamSide } from "./team-side.js";

export const ShooterPolicy = {
  FOULED_PLAYER: "FOULED_PLAYER",
  ANY_OPPONENT: "ANY_OPPONENT",
} as const;

export type ShooterPolicy = (typeof ShooterPolicy)[keyof typeof ShooterPolicy];

export const PenaltyRestartKind = {
  LIVE_BALL: "LIVE_BALL",
  NEAREST_THROW_IN: "NEAREST_THROW_IN",
  FRONTCOURT_THROW_IN: "FRONTCOURT_THROW_IN",
  RESUME_INTERRUPTED: "RESUME_INTERRUPTED",
} as const;

export type PenaltyRestart =
  | { kind: typeof PenaltyRestartKind.LIVE_BALL }
  | { kind: typeof PenaltyRestartKind.NEAREST_THROW_IN; team: TeamSide }
  | { kind: typeof PenaltyRestartKind.FRONTCOURT_THROW_IN; team: TeamSide }
  | { kind: typeof PenaltyRestartKind.RESUME_INTERRUPTED; possession: TeamSide | null };

export interface PenaltyEntitlement {
  penaltyId: string;
  sourceFoulEventId: string;
  shootingTeam: TeamSide;
  attempts: number;
  shooterPolicy: ShooterPolicy;
  designatedPlayerId?: string;
  restart: PenaltyRestart;
  completedAttempts: number;
}

export interface FoulResolution {
  countsAsTeamFoul: boolean;
  penalty?: PenaltyEntitlement;
  immediateRestart?: PenaltyRestart;
}

export function penaltyIdFor(sourceFoulEventId: string): string {
  return `penalty:${sourceFoulEventId}`;
}
