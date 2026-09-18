import { describe, expect, test, vi } from "vitest";
import { buildAthleteEditSavePlan, executeAthleteEditSave } from "./PlayersSection.tsx";

const original = {
  playerId: "player-1",
  rosterId: "roster-1",
  firstName: "ΜΑΡΙΟΣ",
  lastName: "ΠΑΠΑΣ",
  birthDate: "1990-01-02",
  photoUrl: "https://example.com/player.png",
  shirtNumber: 7,
};

const unchanged = {
  firstName: original.firstName,
  lastName: original.lastName,
  birthDate: original.birthDate,
  photoUrl: original.photoUrl,
  shirtNumber: original.shirtNumber,
};

const actions = () => ({
  patch: vi.fn(async () => undefined),
  close: vi.fn(),
  refreshRoster: vi.fn(async () => undefined),
  refreshSnapshot: vi.fn(async () => undefined),
});

describe("Player roster edit save", () => {
  test("builds only the canonical PATCH for a birth-date-only change", () => {
    const plan = buildAthleteEditSavePlan(original, { ...unchanged, birthDate: "1991-02-03" });
    expect(plan.canonicalPatch).toMatchObject({ action: "updateAthleteCanonical", birthDate: "1991-02-03" });
    expect(plan.rosterPatch).toBeNull();
  });

  test("builds only the roster PATCH for a shirt-number-only change", () => {
    const plan = buildAthleteEditSavePlan(original, { ...unchanged, shirtNumber: 12 });
    expect(plan.canonicalPatch).toBeNull();
    expect(plan.rosterPatch).toEqual({ action: "updateAthleteShirt", rosterId: "roster-1", shirtNumber: 12 });
  });

  test("builds both PATCHes only when both scopes changed", () => {
    const plan = buildAthleteEditSavePlan(original, { ...unchanged, firstName: "ΝΙΚΟΣ", shirtNumber: 12 });
    expect(plan.canonicalPatch).toMatchObject({ action: "updateAthleteCanonical", firstName: "ΝΙΚΟΣ" });
    expect(plan.rosterPatch).toMatchObject({ action: "updateAthleteShirt", shirtNumber: 12 });
  });

  test("builds no mutation for an unchanged edit", () => {
    expect(buildAthleteEditSavePlan(original, unchanged)).toEqual({ canonicalPatch: null, rosterPatch: null });
  });

  test("runs one compound sequence, closes once, then refreshes each source once", async () => {
    const calls = [];
    const effects = {
      patch: vi.fn(async (payload) => { calls.push(`patch:${payload.action}`); }),
      close: vi.fn(() => { calls.push("close"); }),
      refreshRoster: vi.fn(async () => { calls.push("refreshRoster"); }),
      refreshSnapshot: vi.fn(async () => { calls.push("refreshSnapshot"); }),
    };
    const plan = buildAthleteEditSavePlan(original, { ...unchanged, firstName: "ΝΙΚΟΣ", shirtNumber: 12 });

    await executeAthleteEditSave({ current: false }, () => plan, effects);

    expect(effects.patch).toHaveBeenCalledTimes(2);
    expect(effects.close).toHaveBeenCalledTimes(1);
    expect(effects.refreshRoster).toHaveBeenCalledTimes(1);
    expect(effects.refreshSnapshot).toHaveBeenCalledTimes(1);
    expect(calls).toEqual([
      "patch:updateAthleteCanonical",
      "patch:updateAthleteShirt",
      "close",
      "refreshRoster",
      "refreshSnapshot",
    ]);
  });

  test("ignores a rapid second save while the first is in flight", async () => {
    let releasePatch;
    const pendingPatch = new Promise((resolve) => { releasePatch = resolve; });
    const effects = actions();
    effects.patch.mockImplementationOnce(() => pendingPatch);
    const gate = { current: false };
    const plan = buildAthleteEditSavePlan(original, { ...unchanged, firstName: "ΝΙΚΟΣ" });

    const first = executeAthleteEditSave(gate, () => plan, effects);
    const second = await executeAthleteEditSave(gate, () => plan, effects);

    expect(second).toBe("ignored");
    expect(effects.patch).toHaveBeenCalledTimes(1);
    releasePatch();
    await first;
    expect(effects.close).toHaveBeenCalledTimes(1);
  });

  test("stops before the roster mutation and keeps the modal open when the Player PATCH fails", async () => {
    const effects = actions();
    effects.patch.mockRejectedValueOnce(new Error("player failed"));
    const plan = buildAthleteEditSavePlan(original, { ...unchanged, firstName: "ΝΙΚΟΣ", shirtNumber: 12 });

    await expect(executeAthleteEditSave({ current: false }, () => plan, effects)).rejects.toThrow("player failed");
    expect(effects.patch).toHaveBeenCalledTimes(1);
    expect(effects.close).not.toHaveBeenCalled();
    expect(effects.refreshRoster).not.toHaveBeenCalled();
    expect(effects.refreshSnapshot).not.toHaveBeenCalled();
  });

  test("keeps the modal open when the roster PATCH fails", async () => {
    const effects = actions();
    effects.patch.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("roster failed"));
    const plan = buildAthleteEditSavePlan(original, { ...unchanged, firstName: "ΝΙΚΟΣ", shirtNumber: 12 });

    await expect(executeAthleteEditSave({ current: false }, () => plan, effects)).rejects.toThrow("roster failed");
    expect(effects.patch).toHaveBeenCalledTimes(2);
    expect(effects.close).not.toHaveBeenCalled();
    expect(effects.refreshRoster).not.toHaveBeenCalled();
    expect(effects.refreshSnapshot).not.toHaveBeenCalled();
  });
});
