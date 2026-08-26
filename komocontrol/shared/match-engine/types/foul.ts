export const FoulOffenderKind = {
  PLAYER: "PLAYER",
  BENCH: "BENCH",
} as const;

export type FoulOffenderKind = (typeof FoulOffenderKind)[keyof typeof FoulOffenderKind];

export const BenchRole = {
  HEAD_COACH: "HEAD_COACH",
  FIRST_ASSISTANT_COACH: "FIRST_ASSISTANT_COACH",
  SUBSTITUTE: "SUBSTITUTE",
  EXCLUDED_PLAYER: "EXCLUDED_PLAYER",
  ACCOMPANYING_DELEGATION: "ACCOMPANYING_DELEGATION",
} as const;

export type BenchRole = (typeof BenchRole)[keyof typeof BenchRole];

export interface PlayerFoulOffender {
  kind: typeof FoulOffenderKind.PLAYER;
  playerId: string;
}

export interface BenchFoulOffender {
  kind: typeof FoulOffenderKind.BENCH;
  personId: string;
  role: BenchRole;
}

export type FoulOffender = PlayerFoulOffender | BenchFoulOffender;

export const TechnicalFoulCategory = {
  CATEGORY_1: "CATEGORY_1",
  CATEGORY_2: "CATEGORY_2",
} as const;

export type TechnicalFoulCategory =
  (typeof TechnicalFoulCategory)[keyof typeof TechnicalFoulCategory];

export const FoulContextKind = {
  NON_SHOOTING: "NON_SHOOTING",
  SHOOTING: "SHOOTING",
  NON_CONTACT: "NON_CONTACT",
} as const;

export interface NonShootingFoulContext {
  kind: typeof FoulContextKind.NON_SHOOTING;
  teamControlFoul: boolean;
}

export interface ShootingFoulContext {
  kind: typeof FoulContextKind.SHOOTING;
}

export interface NonContactFoulContext {
  kind: typeof FoulContextKind.NON_CONTACT;
}

export type ContactFoulContext = NonShootingFoulContext | ShootingFoulContext;
export type FoulContext = ContactFoulContext | NonContactFoulContext;

export const PlayerFoulStatus = {
  ELIGIBLE: "ELIGIBLE",
  EXCLUDED: "EXCLUDED",
  DISQUALIFIED: "DISQUALIFIED",
} as const;

export type PlayerFoulStatus = (typeof PlayerFoulStatus)[keyof typeof PlayerFoulStatus];

export const PlayerFoulStatusReason = {
  FIVE_FOULS: "FIVE_FOULS",
  TWO_CATEGORY_1_TECHNICALS: "TWO_CATEGORY_1_TECHNICALS",
  TWO_FLAGRANT_FOULS: "TWO_FLAGRANT_FOULS",
  MIXED_CATEGORY_1_TECHNICAL_AND_FLAGRANT: "MIXED_CATEGORY_1_TECHNICAL_AND_FLAGRANT",
  DIRECT_DISQUALIFICATION: "DIRECT_DISQUALIFICATION",
} as const;

export type PlayerFoulStatusReason =
  (typeof PlayerFoulStatusReason)[keyof typeof PlayerFoulStatusReason];

export interface PlayerFoulState {
  total: number;
  category1TechnicalCount: number;
  category2TechnicalCount: number;
  disruptiveCount: number;
  flagrantCount: number;
  directDisqualification: boolean;
  status: PlayerFoulStatus;
  statusReason?: PlayerFoulStatusReason;
}

export interface TeamDisciplineState {
  headCoachCategory1TechnicalCount: number;
  benchCategory1TechnicalCount: number;
  headCoachDisqualified: boolean;
  disqualifiedBenchPersonIds: string[];
}
