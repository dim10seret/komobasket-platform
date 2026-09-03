import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/services/public-live-game.service", () => ({
  PublicLiveGameServiceError: class PublicLiveGameServiceError extends Error {
    constructor(readonly code: string) { super(code); }
  },
  readPublicLiveGame: mocks.read,
}));

import { GET } from "./route";

const call = (etag?: string) => GET(new Request("https://example.test/api/public/v1/games/game-1/live", {
  headers: etag ? { "If-None-Match": etag } : undefined,
}), { params: Promise.resolve({ gameId: "game-1" }) });

describe("public LIVE conditional GET", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 200 plus ETag and a LIVE DTO for an initial request", async () => {
    mocks.read.mockResolvedValue({ kind: "game", etag: '"etag-1"', game: { gameId: "game-1", status: "live" } });
    const response = await call();
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"etag-1"');
    expect(await response.json()).toEqual({ data: { gameId: "game-1", status: "live" } });
    expect(mocks.read).toHaveBeenCalledWith("game-1", { ifNoneMatch: null });
  });

  it("forwards the browser validator and returns a bodyless 304", async () => {
    mocks.read.mockResolvedValue({ kind: "not-modified", etag: '"etag-1"' });
    const response = await call('"etag-1"');
    expect(mocks.read).toHaveBeenCalledWith("game-1", { ifNoneMatch: '"etag-1"' });
    expect(response.status).toBe(304);
    expect(response.headers.get("ETag")).toBe('"etag-1"');
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=0, must-revalidate");
    expect(await response.text()).toBe("");
  });

  it("returns a changed validator and latest DTO for a stale client", async () => {
    mocks.read.mockResolvedValue({ kind: "game", etag: '"etag-2"', game: { gameId: "game-1", status: "completed" } });
    const response = await call('"etag-1"');
    expect(response.status).toBe(200);
    expect(response.headers.get("ETag")).toBe('"etag-2"');
    expect(await response.json()).toEqual({ data: { gameId: "game-1", status: "completed" } });
  });
});
