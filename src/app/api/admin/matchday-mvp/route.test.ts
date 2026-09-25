import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(), resolveUser: vi.fn(), requireAccess: vi.fn(), authorizationError: vi.fn(),
  mvpError: vi.fn(), read: vi.fn(), save: vi.fn(),
}));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/app-user-identity", () => ({ resolveCanonicalAppUser: mocks.resolveUser }));
vi.mock("@/lib/platform-authorization", () => ({ requireCompetitionAccess: mocks.requireAccess, platformAuthorizationErrorResponse: mocks.authorizationError }));
vi.mock("@/services/matchday-mvp.service", () => ({ matchdayMvpErrorResponse: mocks.mvpError, readMatchdayMvp: mocks.read, saveMatchdayMvp: mocks.save }));
import { GET, PATCH } from "./route";

const state = { competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1, roundLabel: "1η Αγωνιστική", eligible: true, candidates: [], otherPerformances: [], selection: null };

describe("protected matchday MVP route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireAdmin.mockResolvedValue({ identity: { sub: "admin" } });
    mocks.resolveUser.mockResolvedValue({ id: "user-a" });
    mocks.requireAccess.mockResolvedValue({ organizationId: "org-a" });
    mocks.authorizationError.mockReturnValue(null);
    mocks.mvpError.mockReturnValue(null);
    mocks.read.mockResolvedValue(state);
    mocks.save.mockResolvedValue(state);
  });
  it("requires admin authentication before reading", async () => {
    mocks.requireAdmin.mockResolvedValue({ response: new Response("unauthorized", { status: 401 }) });
    const response = await GET(new Request("https://example.test/api/admin/matchday-mvp?competitionId=competition-a&phaseId=phase-a&roundNumber=1"));
    expect(response.status).toBe(401);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("derives organization scope from canonical competition read access", async () => {
    const response = await GET(new Request("https://example.test/api/admin/matchday-mvp?competitionId=competition-a&phaseId=phase-a&roundNumber=1"));
    expect(response.status).toBe(200);
    expect(mocks.requireAccess).toHaveBeenCalledWith({ id: "user-a" }, "competition-a", "read");
    expect(mocks.read).toHaveBeenCalledWith({ organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1 });
  });
  it.each([
    ["incomplete", { ...state, eligible: false, candidates: [], otherPerformances: [], selection: null }],
    ["eligible without selection", state],
    ["existing selection", { ...state, selection: { gameId: "game-a", playerId: "player-a", selectedAt: "2026-09-25T12:00:00.000Z" } }],
  ])("returns the %s read contract as a successful response", async (_label, readState) => {
    mocks.read.mockResolvedValueOnce(readState);
    const response = await GET(new Request("https://example.test/api/admin/matchday-mvp?competitionId=competition-a&phaseId=phase-a&roundNumber=1"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(readState);
  });
  it("keeps an unclassified database exception generic", async () => {
    mocks.read.mockRejectedValueOnce(new Error("D1_ERROR: private database detail"));
    const response = await GET(new Request("https://example.test/api/admin/matchday-mvp?competitionId=competition-a&phaseId=phase-a&roundNumber=1"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Η ανάγνωση MVP δεν ολοκληρώθηκε." });
  });
  it("requires canonical manage access and ignores client organization claims", async () => {
    const response = await PATCH(new Request("https://example.test/api/admin/matchday-mvp", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: "org-foreign", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1, gameId: "game-a", playerId: "player-a" }),
    }));
    expect(response.status).toBe(200);
    expect(mocks.requireAccess).toHaveBeenCalledWith({ id: "user-a" }, "competition-a", "manage");
    expect(mocks.save).toHaveBeenCalledWith({ organizationId: "org-a", competitionId: "competition-a", phaseId: "phase-a", roundNumber: 1, gameId: "game-a", playerId: "player-a" });
  });
  it("fails closed before mutation when access is denied", async () => {
    mocks.requireAccess.mockRejectedValue(new Error("forbidden"));
    mocks.authorizationError.mockReturnValue(new Response("forbidden", { status: 403 }));
    const response = await PATCH(new Request("https://example.test/api/admin/matchday-mvp", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ competitionId: "competition-a" }) }));
    expect(response.status).toBe(403);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
