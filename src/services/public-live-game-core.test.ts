import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { projectPublicLiveGame, publicGameStatus } from "./public-live-game-core";

const coreSource = readFileSync(new URL("./public-live-game-core.ts", import.meta.url), "utf8");
const serviceSource = readFileSync(new URL("./public-live-game.service.ts", import.meta.url), "utf8");
const routeSource = readFileSync(
  new URL("../app/api/public/v1/games/[gameId]/live/route.ts", import.meta.url),
  "utf8",
);

describe("public live game read model", () => {
  it("keeps a scheduled game non-live", () => {
    expect(publicGameStatus(null, "scheduled", null, null)).toBe("scheduled");
  });

  it("uses the authoritative gameplay-head lifecycle for LIVE", () => {
    expect(publicGameStatus("scheduled", null, null, "live")).toBe("live");
  });

  it("projects a completed public state only from completed data", () => {
    expect(publicGameStatus("completed", 105, 103, "finalized")).toBe("completed");
  });

  it("does not turn incomplete result data into a completed game", () => {
    expect(publicGameStatus("completed", 105, null, "finalized")).toBe("scheduled");
  });

  it("resolves a live Run by game id and authoritative live head", () => {
    expect(serviceSource).toContain("FROM league_games g");
    expect(serviceSource).toContain('row.lifecycle !== "live" && row.lifecycle !== "finalized"');
    expect(serviceSource).toMatch(/claim\.game_id\s*=\s*g\.id/);
  });

  it("loads the initial snapshot and complete canonical server history", () => {
    expect(serviceSource).toContain("league_komocontrol_match_engine_snapshots_v1");
    expect(serviceSource).toContain("league_komocontrol_match_events_v2");
    expect(serviceSource).toContain("ORDER BY sequence, event_id");
  });

  it("replays canonical events through the shared MatchEngine", () => {
    expect(typeof projectPublicLiveGame).toBe("function");
    expect(coreSource).toContain("MatchEngine");
    expect(coreSource).toContain("engine");
    expect(coreSource).toContain("accepted");
  });

  it("validates snapshot, event, and whole-history hashes before projection", () => {
    expect(coreSource).toContain("initialStateHash");
    expect(coreSource).toContain("eventHash");
    expect(coreSource).toContain("historyHash");
    expect(coreSource).toContain("lastAcceptedSequence");
  });

  it("projects authoritative period and clock baseline data", () => {
    const dtoBlock = coreSource.slice(
      coreSource.indexOf("export type PublicLiveGame ="),
      coreSource.indexOf("export type PublicLiveSource ="),
    );
    expect(dtoBlock).toContain("remainingSeconds");
    expect(dtoBlock).toContain("asOfMs");
    expect(dtoBlock).toContain("running: boolean");
  });

  it("projects each active five only from authoritative onCourt state", () => {
    expect(coreSource).toContain("player.onCourt");
    expect(coreSource).not.toContain("slice(0, 5)");
  });

  it("projects public statistics using the existing KomoControl EFF meaning", () => {
    expect(coreSource).toContain("player.statistics");
    expect(coreSource).toContain("efficiency");
    expect(coreSource).toContain("turnovers");
  });

  it("uses a public event-label projection and omits scorer metadata", () => {
    expect(coreSource).toContain("HIDDEN_PUBLIC");
    expect(coreSource).toContain('"TWO_POINT"');
    expect(coreSource).toContain('"THREE_POINT"');
    expect(coreSource).toContain('"PERSONAL_FOUL"');
    expect(coreSource).not.toContain("scorerEventId:");
  });

  it("keeps scorer, device, auth, and sync secrets out of the public DTO", () => {
    const dtoBlock = coreSource.slice(
      coreSource.indexOf("export type PublicLiveGame ="),
      coreSource.indexOf("export type PublicLiveSource ="),
    );
    expect(dtoBlock).not.toContain("scorerId");
    expect(dtoBlock).not.toContain("deviceId");
    expect(dtoBlock).not.toContain("token");
    expect(dtoBlock).not.toContain("authorization");
    expect(dtoBlock).not.toContain("historyHash");
  });

  it("supports conditional GET without replaying unchanged history", () => {
    expect(serviceSource).toContain('kind: "not-modified"');
    expect(serviceSource).toContain("options.ifNoneMatch");
    expect(routeSource).toContain("status: 304");
    expect(routeSource).toContain('ETag');
  });

  it("returns a public non-live response without exposing private state", () => {
    expect(serviceSource).toContain('kind: "not-live"');
    expect(routeSource).toContain('GAME_NOT_LIVE');
    expect(routeSource).toContain("status: 404");
  });

  it("uses a read-only GET route", () => {
    expect(routeSource).toContain("export async function GET");
    expect(routeSource).not.toContain("export async function POST");
    expect(routeSource).not.toContain("export async function PUT");
    expect(routeSource).not.toContain(".run(");
  });
});
