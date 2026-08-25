export const TeamSide = {
  HOME: "HOME",
  AWAY: "AWAY",
} as const;

export type TeamSide = (typeof TeamSide)[keyof typeof TeamSide];
