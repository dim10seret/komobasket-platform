import { describe, expect, it } from "vitest";
import { isCoherentKomoControlResultPolicy } from "./komocontrol-result-policy";

describe("KomoControl authoritative result policy", () => {
  it.each([[true, false], [false, true]])("accepts coherent policy %s/%s", (tieAllowed, winnerRequired) => {
    expect(isCoherentKomoControlResultPolicy(tieAllowed, winnerRequired)).toBe(true);
  });

  it.each([[true, true], [false, false]])("rejects incoherent policy %s/%s", (tieAllowed, winnerRequired) => {
    expect(isCoherentKomoControlResultPolicy(tieAllowed, winnerRequired)).toBe(false);
  });
});
