import { beforeEach, describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

const mocks = vi.hoisted(() => ({ project: vi.fn() }));
vi.mock("./public-live-game-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./public-live-game-core")>();
  return { ...actual, projectPublicLiveGame: mocks.project };
});

import {
  PublicLiveGameServiceError,
  publicLiveEtag,
  readPublicLiveGameWithDb,
  type PublicLiveValidatorState,
} from "./public-live-game.service";

const validator: PublicLiveValidatorState = {
  runId: "run-1",
  lifecycle: "live",
  eventHistoryRevision: 8,
  lastAcceptedSequence: 14,
  historyHash: "history-8",
  headUpdatedAt: "2026-09-03T12:00:00.000Z",
  initialStateHash: "initial-hash",
  configurationRevision: 3,
  configurationHash: "configuration-hash-3",
  homeLogoUrl: "/home.png",
  awayLogoUrl: "/away.png",
};

function headRow(state: PublicLiveValidatorState = validator) {
  return {
    game_id: "game-1",
    home_logo_url: state.homeLogoUrl,
    away_logo_url: state.awayLogoUrl,
    run_id: state.runId,
    lifecycle: state.lifecycle,
    event_history_revision: state.eventHistoryRevision,
    last_accepted_sequence: state.lastAcceptedSequence,
    history_hash: state.historyHash,
    head_updated_at: state.headUpdatedAt,
    initial_state_hash: state.initialStateHash,
    configuration_revision: state.configurationRevision,
    configuration_hash: state.configurationHash,
  };
}

function databaseFor(state: PublicLiveValidatorState = validator) {
  const queries: string[] = [];
  const database: D1DatabaseBinding = {
    prepare(query) {
      queries.push(query);
      const statement: D1PreparedStatement = {
        bind: () => statement,
        first: async <T,>() => (query.includes("FROM league_games")
          ? headRow(state)
          : query.includes("FROM league_komocontrol_match_engine_snapshots_v1 snapshot")
            ? {
                initial_state_json: "{}",
                initial_state_hash: state.initialStateHash,
                configuration_json: null,
                configuration_revision: state.configurationRevision,
                configuration_hash: state.configurationHash,
              }
            : null) as T | null,
        all: async <T,>() => ({ results: (query.includes("league_komocontrol_match_events_v2") ? [{
          event_id: "event-1",
          sequence: 1,
          event_schema_version: 2,
          event_json: "{}",
          event_hash: "event-hash",
        }] : []) as T[] }),
        run: async () => ({}),
      };
      return statement;
    },
    batch: async () => [],
  };
  return { database, queries };
}

describe("public LIVE revision-aware short-circuit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.project.mockReturnValue({ gameId: "game-1", status: "live" });
  });

  it("returns the initial LIVE projection and deterministic ETag after authoritative replay", async () => {
    const fixture = databaseFor();
    const result = await readPublicLiveGameWithDb(fixture.database, "game-1");
    expect(result.kind).toBe("game");
    expect(result.kind === "game" ? result.etag : null).toBe(publicLiveEtag(validator));
    expect(fixture.queries.some((query) => query.includes("league_komocontrol_match_events_v2"))).toBe(true);
    expect(mocks.project).toHaveBeenCalledOnce();
  });

  it("returns 304 metadata before loading history or invoking projection", async () => {
    const fixture = databaseFor();
    const result = await readPublicLiveGameWithDb(fixture.database, "game-1", { ifNoneMatch: publicLiveEtag(validator) });
    expect(result).toEqual({ kind: "not-modified", etag: publicLiveEtag(validator) });
    expect(fixture.queries).toHaveLength(1);
    expect(fixture.queries[0]).not.toContain("initial_state_json");
    expect(fixture.queries[0]).not.toContain("configuration_json");
    expect(fixture.queries.some((query) => query.includes("league_komocontrol_match_events_v2"))).toBe(false);
    expect(mocks.project).not.toHaveBeenCalled();
  });

  it("replays and returns latest state for a stale client validator", async () => {
    const fixture = databaseFor();
    const result = await readPublicLiveGameWithDb(fixture.database, "game-1", { ifNoneMatch: '"public-live-stale"' });
    expect(result.kind).toBe("game");
    expect(fixture.queries.some((query) => query.includes("league_komocontrol_match_events_v2"))).toBe(true);
    expect(mocks.project).toHaveBeenCalledOnce();
  });

  it.each([
    ["new canonical event", { eventHistoryRevision: 9, lastAcceptedSequence: 15, historyHash: "history-9" }],
    ["historical edit", { eventHistoryRevision: 10, historyHash: "history-edit" }],
    ["historical delete", { eventHistoryRevision: 11, lastAcceptedSequence: 13, historyHash: "history-delete" }],
    ["historical correction", { eventHistoryRevision: 12, historyHash: "history-correction" }],
  ])("changes the validator after %s", (_label, change) => {
    expect(publicLiveEtag({ ...validator, ...change })).not.toBe(publicLiveEtag(validator));
  });

  it("changes the validator for live to finalized transition", () => {
    expect(publicLiveEtag({ ...validator, lifecycle: "finalized" })).not.toBe(publicLiveEtag(validator));
  });

  it("includes configuration and public presentation inputs in validator safety", () => {
    expect(publicLiveEtag({ ...validator, configurationRevision: 4, configurationHash: "configuration-hash-4" })).not.toBe(publicLiveEtag(validator));
    expect(publicLiveEtag({ ...validator, homeLogoUrl: "/new-home.png" })).not.toBe(publicLiveEtag(validator));
  });

  it("fails closed when changed-state projection fails instead of returning 304", async () => {
    const fixture = databaseFor();
    mocks.project.mockImplementation(() => { throw new Error("invalid replay"); });
    await expect(readPublicLiveGameWithDb(fixture.database, "game-1", { ifNoneMatch: '"public-live-stale"' }))
      .rejects.toEqual(expect.objectContaining<Partial<PublicLiveGameServiceError>>({ code: "PUBLIC_LIVE_CORRUPTED" }));
    expect(mocks.project).toHaveBeenCalledOnce();
  });
});
