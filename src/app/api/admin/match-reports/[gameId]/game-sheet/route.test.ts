import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), resolveUser: vi.fn(), requireAccess: vi.fn(), authorizationError: vi.fn(), readSheet: vi.fn(), render: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/app-user-identity", () => ({ resolveCanonicalAppUser: mocks.resolveUser }));
vi.mock("@/lib/platform-authorization", () => ({ requireGameAccess: mocks.requireAccess, platformAuthorizationErrorResponse: mocks.authorizationError }));
vi.mock("@/services/platform-game-sheet.service", () => ({ readPlatformGameSheet: mocks.readSheet, renderPlatformGameSheetHtml: mocks.render }));
import { GET } from "./route";

describe("protected printable Game Sheet route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireAdmin.mockReturnValue({ identity: { sub: "admin" } }); mocks.resolveUser.mockResolvedValue({ id: "user" }); mocks.requireAccess.mockResolvedValue({ organizationId: "org-1" }); mocks.authorizationError.mockReturnValue(null); mocks.readSheet.mockResolvedValue({ kind: "sheet", sheet: { game: {} } }); mocks.render.mockReturnValue("<!doctype html><html></html>"); });
  const call = () => GET(new Request("https://example.test/api/admin/match-reports/game-1/game-sheet"), { params: Promise.resolve({ gameId: "game-1" }) });
  it("requires admin authentication", async () => { mocks.requireAdmin.mockReturnValue({ response: new Response("unauthorized", { status: 401 }) }); expect((await call()).status).toBe(401); });
  it("requires organization-scoped game read access", async () => { mocks.requireAccess.mockRejectedValue(new Error("forbidden")); mocks.authorizationError.mockReturnValue(new Response("forbidden", { status: 403 })); expect((await call()).status).toBe(403); expect(mocks.requireAccess).toHaveBeenCalledWith({ id: "user" }, "game-1", "read"); });
  it("returns printable no-store HTML", async () => { const response = await call(); expect(response.status).toBe(200); expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8"); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); expect(response.headers.get("Content-Security-Policy")).toContain("script-src 'nonce-"); });
  it("fails closed for unavailable finalized data", async () => { mocks.readSheet.mockResolvedValue({ kind: "unavailable", reason: "MATCH_REPORT_UNAVAILABLE" }); expect((await call()).status).toBe(409); expect(mocks.render).not.toHaveBeenCalled(); });
  it("reports score overflow explicitly", async () => { mocks.readSheet.mockResolvedValue({ kind: "unavailable", reason: "GAME_SHEET_SCORE_OVERFLOW" }); expect((await call()).status).toBe(422); });
  it("reads only within the authorized Organization", async () => { await call(); expect(mocks.readSheet).toHaveBeenCalledWith("game-1", "org-1"); });
});
