import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  parseStandingPlanningConfiguration,
  planRoundRobinFinalizationMaterialization,
} from "./league-admin.service";

const root = process.cwd();
const migrationPath = join(root, "cloudflare", "migrations", "0039_round_robin_planning_slots.sql");

describe("round-robin provisional planning", () => {
  it("accepts the canonical saved standing-position participant configuration", () => {
    const configuration = parseStandingPlanningConfiguration({
      rule_settings_json: JSON.stringify({
        participantConfiguration: {
          participantSourceType: "standing_positions",
          participantSourcePhaseId: "phase_regular",
          standingFrom: 9,
          standingTo: 15,
        },
      }),
    });

    expect(configuration).toEqual({
      sourcePhaseId: "phase_regular",
      fromPosition: 9,
      toPosition: 15,
    });
    expect(Array.from(
      { length: configuration.toPosition - configuration.fromPosition + 1 },
      (_, index) => `standing:${configuration.sourcePhaseId}:position:${configuration.fromPosition + index}`,
    )).toEqual([
      "standing:phase_regular:position:9",
      "standing:phase_regular:position:10",
      "standing:phase_regular:position:11",
      "standing:phase_regular:position:12",
      "standing:phase_regular:position:13",
      "standing:phase_regular:position:14",
      "standing:phase_regular:position:15",
    ]);
  });

  it.each([
    ["missing source phase", {
      participantSourceType: "standing_positions",
      standingFrom: 1,
      standingTo: 2,
    }],
    ["missing first position", {
      participantSourceType: "standing_positions",
      participantSourcePhaseId: "phase_regular",
      standingTo: 2,
    }],
    ["missing last position", {
      participantSourceType: "standing_positions",
      participantSourcePhaseId: "phase_regular",
      standingFrom: 1,
    }],
    ["non-positive first position", {
      participantSourceType: "standing_positions",
      participantSourcePhaseId: "phase_regular",
      standingFrom: 0,
      standingTo: 2,
    }],
    ["reversed position range", {
      participantSourceType: "standing_positions",
      participantSourcePhaseId: "phase_regular",
      standingFrom: 3,
      standingTo: 2,
    }],
  ])("rejects canonical planning configuration with %s", (_label, participantConfiguration) => {
    expect(() => parseStandingPlanningConfiguration({
      rule_settings_json: JSON.stringify({ participantConfiguration }),
    })).toThrow("Η περιοχή θέσεων βαθμολογίας δεν είναι έγκυρη για προσωρινό πρόγραμμα.");
  });

  it("stores frozen symbolic pairings without requiring real teams or games", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("CREATE TABLE league_phase_schedules (id TEXT PRIMARY KEY)");
    db.exec(readFileSync(migrationPath, "utf8"));
    db.prepare(`
      INSERT INTO league_phase_schedules (id) VALUES (?);
    `).run("schedule_future");
    db.prepare(`
      INSERT INTO league_round_robin_planning_slots
        (id,schedule_id,cycle_number,round_number,game_order,home_participant_key,away_participant_key)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      "slot_1", "schedule_future", 1, 1, 1,
      "standing:phase_regular:position:1",
      "standing:phase_regular:position:4",
    );

    const row = db.prepare("SELECT * FROM league_round_robin_planning_slots").get() as Record<string, unknown>;
    expect(row.home_participant_key).toBe("standing:phase_regular:position:1");
    expect(row.away_participant_key).toBe("standing:phase_regular:position:4");
    expect(row.scheduled_date).toBeNull();
    expect(row.scheduled_time).toBeNull();
    expect(row.venue).toBe("");
    expect(() => db.prepare(`
      INSERT INTO league_round_robin_planning_slots
        (id,schedule_id,cycle_number,round_number,game_order,home_participant_key,away_participant_key)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      "slot_duplicate", "schedule_future", 1, 1, 1,
      "standing:phase_regular:position:2",
      "standing:phase_regular:position:3",
    )).toThrow();
    expect(() => db.prepare(`
      INSERT INTO league_round_robin_planning_slots
        (id,schedule_id,cycle_number,round_number,game_order,home_participant_key,away_participant_key)
      VALUES (?,?,?,?,?,?,?)
    `).run(
      "slot_same", "schedule_future", 1, 2, 1,
      "standing:phase_regular:position:2",
      "standing:phase_regular:position:2",
    )).toThrow();
    db.close();
  });

  it("cascades only with its owning phase schedule", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys=ON");
    db.exec("CREATE TABLE league_phase_schedules (id TEXT PRIMARY KEY)");
    db.exec(readFileSync(migrationPath, "utf8"));
    db.exec(`
      INSERT INTO league_phase_schedules (id) VALUES ('schedule_future');
      INSERT INTO league_round_robin_planning_slots
        (id,schedule_id,cycle_number,round_number,game_order,home_participant_key,away_participant_key)
      VALUES
        ('slot_1','schedule_future',1,1,1,'standing:source:position:1','standing:source:position:2');
      DELETE FROM league_phase_schedules WHERE id='schedule_future';
    `);
    expect(db.prepare("SELECT COUNT(*) AS count FROM league_round_robin_planning_slots").get()).toEqual({ count: 0 });
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    db.close();
  });

  it("keeps the planning path separate from real-game materialization", () => {
    const source = readFileSync(join(root, "src", "services", "league-admin.service.ts"), "utf8");
    const start = source.indexOf("export async function planRoundRobinScheduleWithDb");
    const end = source.indexOf("export async function planRoundRobinSchedule(", start);
    const planningPath = source.slice(start, end);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(planningPath).toContain("league_round_robin_planning_slots");
    expect(planningPath).toContain("standingParticipantKey");
    expect(planningPath).not.toContain("INSERT INTO league_games");
    expect(planningPath).not.toContain("league_teams");
    expect(planningPath).toContain('String(sourcePhase.competition_id ?? "") !== competitionId');
  });

  it("freezes pairings and limits edits to scheduling fields", () => {
    const source = readFileSync(join(root, "src", "services", "league-admin.service.ts"), "utf8");
    expect(source).toContain("if (existingSlots.length)");
    expect(source).toContain("pairingsCreated: 0");
    expect(source).toContain("SET scheduled_date=?, scheduled_time=?, venue=?, updated_at=CURRENT_TIMESTAMP");
    expect(source).toContain("saveRoundRobinPlanningSlotWithDb");
  });

  it("resolves standings into create-only games while preserving frozen scheduling metadata", () => {
    const result = planRoundRobinFinalizationMaterialization({
      sourcePhaseId: "phase_regular",
      standings: [{ position: 1, teamId: "team-a" }, { position: 2, teamId: "team-b" }],
      slots: [{
        id: "slot-1",
        competitionId: "competition-1",
        phaseId: "phase-playout",
        scheduleId: "schedule-1",
        cycleNumber: 2,
        roundNumber: 3,
        gameOrder: 4,
        homeParticipantKey: "standing:phase_regular:position:1",
        awayParticipantKey: "standing:phase_regular:position:2",
        scheduledDate: "2026-10-12",
        scheduledTime: "20:30",
        venue: "KomoBasket Arena",
      }],
      existingGames: [],
    });
    expect(result.creates).toEqual([expect.objectContaining({
      homeTeamId: "team-a",
      awayTeamId: "team-b",
      scheduledDate: "2026-10-12",
      scheduledTime: "20:30",
      venue: "KomoBasket Arena",
      cycleNumber: 2,
      roundNumber: 3,
      gameOrder: 4,
    })]);
  });

  it("is idempotent for an exact existing game and rejects a participant mismatch", () => {
    const slot = {
      id: "slot-1",
      competitionId: "competition-1",
      phaseId: "phase-playout",
      scheduleId: "schedule-1",
      cycleNumber: 1,
      roundNumber: 1,
      gameOrder: 1,
      homeParticipantKey: "standing:phase_regular:position:1",
      awayParticipantKey: "standing:phase_regular:position:2",
      scheduledDate: null,
      scheduledTime: null,
      venue: "",
    };
    const input = {
      sourcePhaseId: "phase_regular",
      standings: [{ position: 1, teamId: "team-a" }, { position: 2, teamId: "team-b" }],
      slots: [slot],
    };
    const exact = planRoundRobinFinalizationMaterialization({
      ...input,
      existingGames: [{
        id: "game-1", competitionId: "competition-1", phaseId: "phase-playout", scheduleId: "schedule-1",
        cycleNumber: 1, roundNumber: 1, gameOrder: 1, homeTeamId: "team-a", awayTeamId: "team-b",
      }],
    });
    expect(exact.creates).toEqual([]);
    expect(exact.alreadyMaterializedGameIds).toEqual(["game-1"]);
    expect(() => planRoundRobinFinalizationMaterialization({
      ...input,
      existingGames: [{
        id: "game-1", competitionId: "competition-1", phaseId: "phase-playout", scheduleId: "schedule-1",
        cycleNumber: 1, roundNumber: 1, gameOrder: 1, homeTeamId: "team-b", awayTeamId: "team-a",
      }],
    })).toThrow(/Σύγκρουση υλοποίησης/);
  });
});
