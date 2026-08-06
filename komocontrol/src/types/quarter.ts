export const Quarter = {
  Q1: 1,
  Q2: 2,
  Q3: 3,
  Q4: 4,
  OT1: 5,
  OT2: 6,
  OT3: 7,
} as const;

export type Quarter = (typeof Quarter)[keyof typeof Quarter];
