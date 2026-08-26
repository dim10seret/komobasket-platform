export function isCoherentKomoControlResultPolicy(tieAllowed: boolean, winnerRequired: boolean): boolean {
  return tieAllowed !== winnerRequired;
}
