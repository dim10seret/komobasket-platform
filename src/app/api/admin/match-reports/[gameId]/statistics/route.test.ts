import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAdmin: vi.fn(), resolveUser: vi.fn(), requireAccess: vi.fn(), authorizationError: vi.fn(), readReport: vi.fn(), generate: vi.fn(), filename: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/app-user-identity", () => ({ resolveCanonicalAppUser: mocks.resolveUser }));
vi.mock("@/lib/platform-authorization", () => ({ requireGameAccess: mocks.requireAccess, platformAuthorizationErrorResponse: mocks.authorizationError }));
vi.mock("@/services/platform-match-report.service", () => ({ readPlatformMatchReport: mocks.readReport }));
vi.mock("@/services/platform-statistics-pdf.service", () => ({ generateStatisticsPdf: mocks.generate, statisticsPdfFilename: mocks.filename }));
import { GET } from "./route";

describe("protected Statistics PDF route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireAdmin.mockReturnValue({ identity: { sub: "admin" } }); mocks.resolveUser.mockResolvedValue({ id: "user" }); mocks.requireAccess.mockResolvedValue({ organizationId: "org-1" }); mocks.authorizationError.mockReturnValue(null); mocks.readReport.mockResolvedValue({ kind: "report", report: { game: {} } }); mocks.generate.mockResolvedValue(new TextEncoder().encode("%PDF-test")); mocks.filename.mockReturnValue("komobasket-statistics-ΛΕΚΑΒΕΞ-vs-JUGOPIASTIKA.pdf"); });
  const call = () => GET(new Request("https://example.test/api/admin/match-reports/game-1/statistics"), { params: Promise.resolve({ gameId: "game-1" }) });
  it("requires admin authentication", async () => { mocks.requireAdmin.mockReturnValue({ response: new Response("unauthorized", { status: 401 }) }); expect((await call()).status).toBe(401); });
  it("requires canonical organization/game read access", async () => { mocks.requireAccess.mockRejectedValue(new Error("forbidden")); mocks.authorizationError.mockReturnValue(new Response("forbidden", { status: 403 })); expect((await call()).status).toBe(403); expect(mocks.requireAccess).toHaveBeenCalledWith({ id: "user" }, "game-1", "read"); });
  it("fails closed when the Match Report is unavailable", async () => { mocks.readReport.mockResolvedValue({ kind: "unavailable", availability: { available: false, hasIncidentReport: false } }); expect((await call()).status).toBe(409); expect(mocks.generate).not.toHaveBeenCalled(); });
  it("returns application/pdf with no-store semantics", async () => { const response = await call(); expect(response.status).toBe(200); expect(response.headers.get("Content-Type")).toBe("application/pdf"); expect(response.headers.get("Cache-Control")).toBe("private, no-store"); });
  it("returns a safe attachment filename", async () => { const response = await call(); const disposition = response.headers.get("Content-Disposition") ?? ""; expect(disposition).toContain('filename="komobasket-statistics.pdf"'); expect(disposition).toContain("filename*=UTF-8''komobasket-statistics-"); expect(disposition).not.toMatch(/[\r\n]/); });
  it("generates from the authoritative report returned by Phase 1A", async () => { await call(); expect(mocks.readReport).toHaveBeenCalledWith("game-1", "org-1"); expect(mocks.generate).toHaveBeenCalledWith({ game: {} }); });
  it("exposes GET only", () => expect(GET).toBeTypeOf("function"));
});
