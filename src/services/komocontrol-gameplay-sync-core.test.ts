import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MatchEngine } from "../../komocontrol/shared/match-engine/engine/match-engine";
import { createPlayer } from "../../komocontrol/shared/match-engine/models/player";
import { TeamSide } from "../../komocontrol/shared/match-engine/types/team-side";
import {
  GameplaySyncValidationError,
  assertGameplayPackageLineage,
  assertGameplaySyncIdentity,
  decideGameplayConfigurationSync,
  decideGameplaySync,
  stable as stableGameplaySyncJson,
  validateGameplaySync,
} from "./komocontrol-gameplay-sync-core";

function stable(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const item = value as Record<string, unknown>;
  return `{${Object.keys(item).sort().map((key) => `${JSON.stringify(key)}:${stable(item[key])}`).join(",")}}`;
}

function sha256(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

function packageSnapshot(includeSecondHomePlayer = false): string {
  return JSON.stringify({
    schemaVersion: 1,
    game: { id: "game-1", organizationId: "organization-1" },
    settings: { tie_allowed: true, winner_required: false },
    teams: [
      {
        side: "HOME",
        id: "home",
        players: [
          { id: "home-1", displayName: "Home One" },
          ...(includeSecondHomePlayer ? [{ id: "home-2", displayName: "Home Two" }] : []),
        ],
      },
      { side: "AWAY", id: "away", players: [{ id: "away-1", displayName: "Away One" }] },
    ],
  });
}

function payload(includeRosterAmendment = false) {
  const runId = "run-sync-fixture";
  const engine = new MatchEngine({
    id: runId,
    rules: { schemaVersion: 1, rulesEdition: "FIBA_2026", minPlayers: 1, maxPlayers: 12, startingPlayers: 1,
      regulationPeriods: 1, regulationPeriodSeconds: 600, overtimeSeconds: 300, resultPolicy: "ALLOW_TIE",
      teamFoulPenaltyThreshold: 5, overtimeTeamFoulPolicy: "CARRY_FROM_FINAL_REGULATION" },
    homeTeam: { id: "home", name: "Home", players: [createPlayer({ playerId: "home-1", displayName: "Home One", team: TeamSide.HOME, shirtNumber: "0", onCourt: true })] },
    awayTeam: { id: "away", name: "Away", players: [createPlayer({ playerId: "away-1", displayName: "Away One", team: TeamSide.AWAY, shirtNumber: "00", onCourt: true })] },
  });
  const initialStateJson = stable({ ...engine.getState(), possession: null });
  const event = { schemaVersion: 2, id: "event-start", occurredAt: Date.parse("2026-08-26T12:00:00.000Z"), sequence: 1, type: "MATCH_START" };
  const replayEngine = MatchEngine.fromInitialState(JSON.parse(initialStateJson));
  expect(replayEngine.process(event).accepted).toBe(true);
  const events = [event];
  if (includeRosterAmendment) {
    const amendment = {
      schemaVersion: 2,
      id: "event-roster-home-2",
      occurredAt: Date.parse("2026-08-26T12:00:01.000Z"),
      sequence: 2,
      type: "ROSTER_PLAYER_ADDED",
      team: "HOME",
      playerId: "home-2",
      displayName: "Home Two",
      shirtNumber: "1",
    };
    expect(replayEngine.process(amendment).accepted).toBe(true);
    events.push(amendment);
  }
  const eventRows = events.map((value) => {
    const eventJson = stable(value);
    return { eventId: value.id, sequence: value.sequence, eventSchemaVersion: 2 as const, eventJson, eventHash: sha256(eventJson) };
  });
  const historyHash = sha256(`[${eventRows.map((value) => value.eventJson).join(",")}]`);
  const currentConfiguration = {
    schemaVersion: 1,
    runId,
    gameId: "game-1",
    teams: [
      {
        side: "HOME",
        teamId: "home",
        players: [
          { playerId: "home-1", participating: true, gameShirtNumber: "0" },
          ...(includeRosterAmendment ? [{ playerId: "home-2", participating: true, gameShirtNumber: "1" }] : []),
        ],
        gameColor: "#D62828",
      },
      {
        side: "AWAY",
        teamId: "away",
        players: [{ playerId: "away-1", participating: true, gameShirtNumber: "00" }],
        gameColor: "#168B4B",
      },
    ],
    presentation: { leftSide: "AWAY" },
  };
  const currentConfigurationJson = JSON.stringify(currentConfiguration);
  const snapshot = packageSnapshot(includeRosterAmendment);
  return {
    schemaVersion: 1, runId, gameId: "game-1", packageId: "package-1", packageVersion: 2, packageHash: sha256(snapshot),
    organizationId: "organization-1", scorerId: "scorer-1", deviceId: "device-1", startedAtUtc: "2026-08-26T12:00:00.000Z",
    configurationRevision: 4, configurationHash: "b".repeat(64), snapshotSchemaVersion: 1, matchEventSchemaVersion: 2,
    currentConfigurationRevision: includeRosterAmendment ? 5 : 4,
    currentConfigurationHash: sha256(currentConfigurationJson),
    currentConfigurationJson,
    initialStateJson,
    initialStateHash: sha256(initialStateJson),
    eventHistoryRevision: includeRosterAmendment ? 2 : 1,
    lastAcceptedSequence: includeRosterAmendment ? 2 : 1,
    historyHash,
    events: eventRows,
    finalization: null,
  };
}

describe("KomoControl gameplay sync replay and revision policy", () => {
  it("omits undefined object properties without changing canonical JSON ordering or normal hashes", () => {
    expect(stableGameplaySyncJson({ a: 1, optional: undefined, b: 2 })).toBe('{"a":1,"b":2}');
    expect(stableGameplaySyncJson({ z: { b: 2, a: 1 }, a: [{ b: 2, a: 1 }] }))
      .toBe('{"a":[{"a":1,"b":2}],"z":{"a":1,"b":2}}');
    expect(sha256(stableGameplaySyncJson({ b: 2, a: 1 }))).toBe("43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777");
    expect(() => stableGameplaySyncJson([1, undefined, 2])).toThrow(GameplaySyncValidationError);
  });

  it("accepts finalized replay when the MatchState has an undefined optional penalty resolution", () => {
    const live = payload();
    const engine = MatchEngine.fromInitialState(JSON.parse(live.initialStateJson));
    for (const row of live.events) expect(engine.process(JSON.parse(row.eventJson)).accepted).toBe(true);
    const finalEvents = [
      { schemaVersion: 2, id: "event-clock-zero", occurredAt: Date.parse("2026-08-26T12:00:01.000Z"), sequence: 2, type: "CLOCK_SET", remainingSeconds: 0 },
      { schemaVersion: 2, id: "event-period-end", occurredAt: Date.parse("2026-08-26T12:00:02.000Z"), sequence: 3, type: "PERIOD_END", period: { kind: "REGULATION", index: 1 } },
      { schemaVersion: 2, id: "event-match-end", occurredAt: Date.parse("2026-08-26T12:00:03.000Z"), sequence: 4, type: "MATCH_END" },
    ];
    for (const event of finalEvents) expect(engine.process(event).accepted).toBe(true);
    const eventRows = [...live.events, ...finalEvents.map((event) => {
      const eventJson = stableGameplaySyncJson(event);
      return { eventId: event.id, sequence: event.sequence, eventSchemaVersion: 2 as const, eventJson, eventHash: sha256(eventJson) };
    })];
    const historyHash = sha256(`[${eventRows.map((event) => event.eventJson).join(",")}]`);
    const finalState = engine.getState();
    expect(finalState.penaltyResolution).toBeUndefined();
    const finalStateJson = stableGameplaySyncJson(finalState);
    const finalStateHash = sha256(finalStateJson);
    const finalizedAtUtc = "2026-08-26T12:00:03.000Z";
    const finalizationJson = stableGameplaySyncJson({
      schemaVersion: 1,
      runId: live.runId,
      finalizedHistoryRevision: 4,
      finalizedHistoryHash: historyHash,
      finalStateHash,
      finalizedAtUtc,
    });
    const finalized = {
      ...live,
      eventHistoryRevision: 4,
      lastAcceptedSequence: 4,
      historyHash,
      events: eventRows,
      finalization: {
        schemaVersion: 1,
        finalizedHistoryRevision: 4,
        finalizedHistoryHash: historyHash,
        finalStateJson,
        finalStateHash,
        finalizationJson,
        finalizationHash: sha256(finalizationJson),
        finalizedAtUtc,
      },
    };

    expect(validateGameplaySync(finalized, live.runId)).toMatchObject({
      eventHistoryRevision: 4,
      finalization: { finalizedHistoryRevision: 4, finalizedHistoryHash: historyHash, finalStateHash },
    });
  });

  it("accepts an exact deterministic full-history revision after MatchEngine replay", () => {
    const input = payload();
    expect(validateGameplaySync(input, input.runId)).toMatchObject({ runId: input.runId, eventHistoryRevision: 1, historyHash: input.historyHash });
  });

  it("fails closed on exact-byte hash tampering", () => {
    const input = payload(); input.events[0].eventHash = "f".repeat(64);
    expect(() => validateGameplaySync(input, input.runId)).toThrow(GameplaySyncValidationError);
  });

  it("makes same revision and hash idempotent", () => {
    const input = validateGameplaySync(payload(), "run-sync-fixture");
    expect(decideGameplaySync({ eventHistoryRevision: 1, historyHash: input.historyHash, finalizationHash: null }, input)).toBe("idempotent");
  });

  it("applies independent strict CAS decisions to the current configuration mirror", () => {
    const input = validateGameplaySync(payload(), "run-sync-fixture");
    expect(decideGameplayConfigurationSync(null, input)).toBe("insert");
    expect(decideGameplayConfigurationSync({ configurationRevision: 4, configurationHash: input.currentConfigurationHash }, input)).toBe("idempotent");
    expect(() => decideGameplayConfigurationSync({ configurationRevision: 5, configurationHash: "c".repeat(64) }, input)).toThrow(/SYNC_STALE/);
    expect(() => decideGameplayConfigurationSync({ configurationRevision: 4, configurationHash: "c".repeat(64) }, input)).toThrow(/SYNC_INTEGRITY_CONFLICT/);
  });

  it("accepts exact Package and player lineage including a factual roster amendment", () => {
    const input = validateGameplaySync(payload(true), "run-sync-fixture");
    expect(() => assertGameplayPackageLineage(input, packageSnapshot(true))).not.toThrow();
    expect(input.finalState.home.players.map((player) => [player.playerId, player.shirtNumber])).toEqual([
      ["home-1", "0"],
      ["home-2", "1"],
    ]);
  });

  it("rejects Package/result-policy/player lineage divergence", () => {
    const input = validateGameplaySync(payload(true), "run-sync-fixture");
    const malformed = JSON.parse(packageSnapshot(true));
    malformed.settings.winner_required = true;
    const malformedJson = JSON.stringify(malformed);
    const raw = payload(true);
    raw.packageHash = sha256(malformedJson);
    const validated = validateGameplaySync(raw, raw.runId);
    expect(() => assertGameplayPackageLineage(validated, malformedJson)).toThrow(/SYNC_INVALID/);

    const missingPlayer = JSON.parse(packageSnapshot(true));
    missingPlayer.teams[0].players.pop();
    const missingPlayerJson = JSON.stringify(missingPlayer);
    raw.packageHash = sha256(missingPlayerJson);
    const missingPlayerInput = validateGameplaySync(raw, raw.runId);
    expect(() => assertGameplayPackageLineage(missingPlayerInput, missingPlayerJson)).toThrow(/SYNC_INVALID/);
    expect(input.currentConfiguration.teams[0].players.map((player) => player.playerId)).toContain("home-2");
  });

  it("rejects stale and same-revision divergent histories", () => {
    const input = validateGameplaySync(payload(), "run-sync-fixture");
    expect(() => decideGameplaySync({ eventHistoryRevision: 2, historyHash: "c".repeat(64), finalizationHash: null }, input)).toThrow(/SYNC_STALE/);
    expect(() => decideGameplaySync({ eventHistoryRevision: 1, historyHash: "c".repeat(64), finalizationHash: null }, input)).toThrow(/SYNC_INTEGRITY_CONFLICT/);
  });

  it("accepts a newer revision only while the stored Run is not finalized", () => {
    const raw = payload(); raw.eventHistoryRevision = 2;
    const input = validateGameplaySync(raw, raw.runId);
    expect(decideGameplaySync({ eventHistoryRevision: 1, historyHash: "c".repeat(64), finalizationHash: null }, input)).toBe("replace");
    expect(() => decideGameplaySync({ eventHistoryRevision: 1, historyHash: "c".repeat(64), finalizationHash: "d".repeat(64) }, input)).toThrow(/SYNC_INTEGRITY_CONFLICT/);
  });

  it("accepts correction gaps while preserving the monotonic sequence high-water", () => {
    const raw = payload();
    const clockStart = {
      schemaVersion: 2,
      id: "event-clock-start",
      occurredAt: Date.parse("2026-08-26T12:00:01.000Z"),
      sequence: 3,
      type: "CLOCK_START",
    };
    const eventJson = stable(clockStart);
    raw.events.push({
      eventId: clockStart.id,
      sequence: clockStart.sequence,
      eventSchemaVersion: 2,
      eventJson,
      eventHash: sha256(eventJson),
    });
    raw.eventHistoryRevision = 2;
    raw.lastAcceptedSequence = 3;
    raw.historyHash = sha256(`[${raw.events.map((item) => item.eventJson).join(",")}]`);

    expect(validateGameplaySync(raw, raw.runId)).toMatchObject({
      eventHistoryRevision: 2,
      lastAcceptedSequence: 3,
      historyHash: raw.historyHash,
    });
  });

  it("rejects a different device at the pure identity boundary", () => {
    const input = payload();
    expect(() => assertGameplaySyncIdentity({ scorerId: input.scorerId, organizationId: input.organizationId, deviceId: "different-device" }, input)).toThrowError(/SYNC_RUN_CONFLICT/);
  });
});
