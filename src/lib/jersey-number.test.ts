import { describe, expect, it } from "vitest";
import { compareJerseyNumbers, normalizeOptionalJerseyNumber } from "./jersey-number";

describe("canonical textual jersey numbers", () => {
  it.each(["0", "00", "1", "9", "10", "23", "99"])("preserves valid value %s", (value) => {
    expect(normalizeOptionalJerseyNumber(value)).toBe(value);
  });

  it.each(["01", "000", "001", "100", "1.0", "-1", "abc", "   "])("rejects invalid value %s", (value) => {
    expect(() => normalizeOptionalJerseyNumber(value)).toThrow(/0, 00/);
  });

  it("normalizes only legacy numeric inputs without collapsing textual 00", () => {
    expect(normalizeOptionalJerseyNumber(0)).toBe("0");
    expect(normalizeOptionalJerseyNumber(23)).toBe("23");
    expect(normalizeOptionalJerseyNumber("00")).toBe("00");
  });

  it("keeps null and an intentionally empty optional input unassigned", () => {
    expect(normalizeOptionalJerseyNumber(null)).toBeNull();
    expect(normalizeOptionalJerseyNumber("")).toBeNull();
  });

  it("sorts 0, 00 and 1-99 deterministically without changing identity", () => {
    const values = ["23", "2", "00", "1", "0", "99"] as const;
    expect([...values].sort((left, right) => compareJerseyNumbers(left, right))).toEqual(["0", "00", "1", "2", "23", "99"]);
  });
});
