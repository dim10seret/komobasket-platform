export const RulesEdition = {
  FIBA_2026: "FIBA_2026",
} as const;

export type RulesEdition = (typeof RulesEdition)[keyof typeof RulesEdition];

export const ResultPolicy = {
  ALLOW_TIE: "ALLOW_TIE",
  REQUIRE_WINNER: "REQUIRE_WINNER",
} as const;

export type ResultPolicy = (typeof ResultPolicy)[keyof typeof ResultPolicy];

export const OvertimeTeamFoulPolicy = {
  CARRY_FROM_FINAL_REGULATION: "CARRY_FROM_FINAL_REGULATION",
} as const;

export type OvertimeTeamFoulPolicy =
  (typeof OvertimeTeamFoulPolicy)[keyof typeof OvertimeTeamFoulPolicy];

export interface MatchRulesV1 {
  readonly schemaVersion: 1;
  readonly rulesEdition: typeof RulesEdition.FIBA_2026;
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly startingPlayers: number;
  readonly regulationPeriods: number;
  readonly regulationPeriodSeconds: number;
  readonly overtimeSeconds: number;
  readonly resultPolicy: ResultPolicy;
  readonly teamFoulPenaltyThreshold: number;
  readonly overtimeTeamFoulPolicy: typeof OvertimeTeamFoulPolicy.CARRY_FROM_FINAL_REGULATION;
}
