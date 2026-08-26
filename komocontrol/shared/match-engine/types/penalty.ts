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
  ENDLINE_THROW_IN: "ENDLINE_THROW_IN",
  ALTERNATING_POSSESSION: "ALTERNATING_POSSESSION",
} as const;

export type PenaltyRestart =
  | { kind: typeof PenaltyRestartKind.LIVE_BALL }
  | { kind: typeof PenaltyRestartKind.NEAREST_THROW_IN; team: TeamSide }
  | { kind: typeof PenaltyRestartKind.FRONTCOURT_THROW_IN; team: TeamSide }
  | { kind: typeof PenaltyRestartKind.RESUME_INTERRUPTED; possession: TeamSide | null }
  | { kind: typeof PenaltyRestartKind.ENDLINE_THROW_IN; team: TeamSide }
  | { kind: typeof PenaltyRestartKind.ALTERNATING_POSSESSION };

export const PenaltyEntitlementKind = {
  FREE_THROWS: "FREE_THROWS",
  RESTART_ONLY: "RESTART_ONLY",
} as const;

export type PenaltyEntitlementKind =
  (typeof PenaltyEntitlementKind)[keyof typeof PenaltyEntitlementKind];

interface PenaltyEntitlementBase {
  penaltyId: string;
  sourceFoulEventId: string;
  beneficiaryTeam: TeamSide;
  restart: PenaltyRestart;
}

export interface FreeThrowPenaltyEntitlement extends PenaltyEntitlementBase {
  kind: typeof PenaltyEntitlementKind.FREE_THROWS;
  shootingTeam: TeamSide;
  attempts: number;
  shooterPolicy: ShooterPolicy;
  designatedPlayerId?: string;
  completedAttempts: number;
}

export interface RestartOnlyPenaltyEntitlement extends PenaltyEntitlementBase {
  kind: typeof PenaltyEntitlementKind.RESTART_ONLY;
}

export type PenaltyEntitlement =
  | FreeThrowPenaltyEntitlement
  | RestartOnlyPenaltyEntitlement;

export interface StoppagePenaltyResolution {
  stoppageId: string;
  interruptedPossession: TeamSide | null;
  interruptedAlternatingPossession: TeamSide;
  entitlements: PenaltyEntitlement[];
  cancelledPenaltyIds: string[];
  orderedEntitlements: PenaltyEntitlement[];
  freeThrowQueue: FreeThrowPenaltyEntitlement[];
  administrationStarted: boolean;
  finalRestart: PenaltyRestart;
}

export interface FoulResolution {
  countsAsTeamFoul: boolean;
  penalty: PenaltyEntitlement;
}

export function penaltyIdFor(sourceFoulEventId: string): string {
  return `penalty:${sourceFoulEventId}`;
}

export function isFreeThrowPenalty(
  penalty: PenaltyEntitlement,
): penalty is FreeThrowPenaltyEntitlement {
  return penalty.kind === PenaltyEntitlementKind.FREE_THROWS;
}
