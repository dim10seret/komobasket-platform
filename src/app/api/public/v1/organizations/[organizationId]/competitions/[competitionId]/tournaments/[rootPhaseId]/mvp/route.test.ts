import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  env: vi.fn(), read: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: mocks.env }));
vi.mock("@/services/public-mvp-contests.service", () => ({
  PublicMvpContestError: class extends Error { code = "CONTEXT_NOT_FOUND"; },
  readPublicMvpContestsWithDb: mocks.read,
}));

import { GET } from "./route";

const request = new Request("https://example.test/api/public/v1/organizations/org-a/competitions/competition-a/tournaments/league-root/mvp");
const context = { params: Promise.resolve({ organizationId: "org-a", competitionId: "competition-a", rootPhaseId: "league-root" }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.mockResolvedValue(null);
  mocks.read.mockResolvedValue({ active: [], history: [], serverTime: 123 });
});

describe("public MVP read route", () => {
  it("is disabled by default and cannot touch D1", async () => {
    const response = await GET(request, context);
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("uses no-store so a post-deadline GET reaches reconciliation", async () => {
    const db = {};
    mocks.env.mockResolvedValue({ MVP_PUBLIC_READ_ENABLED: "enabled", NEWS_DB: db });
    const response = await GET(request, context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.read).toHaveBeenCalledWith(db, {
      organizationId: "org-a", competitionId: "competition-a", rootPhaseId: "league-root",
    });
  });

  it("fails closed when D1 is unavailable", async () => {
    mocks.env.mockResolvedValue({ MVP_PUBLIC_READ_ENABLED: "enabled" });
    const response = await GET(request, context);
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
