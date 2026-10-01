import { describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: async () => ({}) }));

import { getConfiguredSeriesCarryOverMeetingNumbers, isConfiguredSeriesCarryOverMeeting } from "@/lib/series-carry-over";
import { saveSeriesPlanningSlotWithDb } from "./league-admin.service";

const bracketConfiguration = {
  matchups: [{
    id: "matchup-a",
    slotA: { type: "standing_position", position: "8" },
    slotB: { type: "standing_position", position: "9" },
  }],
};

const phase = {
  id: "phase-series",
  competition_id: "competition-a",
  format: "series",
  phase_kind: "play_in",
  lifecycle_status: "active",
  finalized_at: null,
  wins_required: 2,
  carry_over_enabled: 1,
  carry_over_source_phase_id: "phase-source",
  rule_settings_json: JSON.stringify({ carryOverMeetingNumbers: [1], bracketConfiguration }),
};

describe("Series pending carry-over planning guard", () => {
  it("uses only explicit carry-over configuration, not participant labels", () => {
    expect(getConfiguredSeriesCarryOverMeetingNumbers(phase)).toEqual([1]);
    expect(isConfiguredSeriesCarryOverMeeting(phase, 1)).toBe(true);
    expect(isConfiguredSeriesCarryOverMeeting(phase, 2)).toBe(false);
    expect(isConfiguredSeriesCarryOverMeeting({
      ...phase,
      rule_settings_json: JSON.stringify({ carryOverMeetingNumbers: [2], bracketConfiguration }),
    }, 1)).toBe(false);
  });

  it("rejects a forged save for a reserved meeting before any insert or update", async () => {
    const statements: string[] = [];
    const writes: string[] = [];
    const statement = (sql: string): D1PreparedStatement => ({
      bind: () => statement(sql),
      first: async <T,>() => {
        if (sql.includes("FROM league_phases p")) return phase as T;
        throw new Error(`Unexpected first query: ${sql}`);
      },
      all: async <T,>() => {
        if (sql.includes("FROM league_phase_schedules")) {
          return {
            success: true,
            results: [{ id: "schedule-a", competition_id: "competition-a", phase_id: "phase-series" }] as T[],
          };
        }
        throw new Error(`Unexpected all query: ${sql}`);
      },
      run: async () => {
        writes.push(sql);
        throw new Error(`Unexpected write: ${sql}`);
      },
    });
    const db = {
      prepare: (sql: string) => {
        statements.push(sql);
        return statement(sql);
      },
      batch: async () => {
        throw new Error("Unexpected batch write");
      },
    } as unknown as D1DatabaseBinding;

    await expect(saveSeriesPlanningSlotWithDb(db, {
      competitionId: "competition-a",
      phaseId: "phase-series",
      matchupId: "matchup-a",
      seriesRoundNumber: 1,
      scheduledDate: "2026-10-20",
    }, "admin@example.test")).rejects.toThrow(
      "Η συγκεκριμένη συνάντηση αναμένει μεταφορά αποτελέσματος από την προηγούμενη φάση και δεν μπορεί να προγραμματιστεί.",
    );

    expect(writes).toEqual([]);
    expect(statements.some((sql) => /INSERT|UPDATE|DELETE/i.test(sql))).toBe(false);
  });
});
