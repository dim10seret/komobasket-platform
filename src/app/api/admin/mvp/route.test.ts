import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), env: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/admin-auth", () => ({ requireAdmin: mocks.admin }));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: mocks.env }));
vi.mock("@/services/platform-mvp-operation", () => ({ platformMvpOperation: vi.fn(),
  platformMvpPresentationOperation: mocks.upload, platformMvpErrorResponse: vi.fn() }));

import { POST } from "./route";

const origin = "https://local.test";
const request = (overrides: { origin?: string; organizationId?: string; length?: string } = {}) => {
  const form = new FormData();
  if (overrides.organizationId !== "") form.set("organizationId", overrides.organizationId ?? "org-a");
  form.set("contestId", "finalized");
  for (const key of ["photoCaption", "bodyText", "sponsorName", "giftDescription"]) form.set(key, "");
  const response = new Request(`${origin}/api/admin/mvp`, { method: "POST", body: form,
    headers: { origin: overrides.origin ?? origin, "sec-fetch-site": "same-origin" } });
  if (overrides.length) response.headers.set("content-length", overrides.length);
  return response;
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.admin.mockResolvedValue({ user: { userId: "admin-a", email: "admin@example.test" } });
  mocks.env.mockResolvedValue({ NEWS_DB: {}, NEWS_IMAGES: {} });
  mocks.upload.mockResolvedValue(Response.json({ contestId: "finalized" }));
});

describe("central Platform MVP presentation upload", () => {
  it("uses existing admin authentication and forwards a bounded multipart body", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.upload).toHaveBeenCalledOnce();
    expect(mocks.upload.mock.calls[0][3]).toBe("org-a");
    expect(mocks.upload.mock.calls[0][4].get("contestId")).toBe("finalized");
  });

  it("rejects cross-origin and oversized requests before storage", async () => {
    expect((await POST(request({ origin: "https://outside.test" }))).status).toBe(403);
    expect((await POST(request({ length: String(7 * 1024 * 1024) }))).status).toBe(413);
    expect((await POST(request({ organizationId: "" }))).status).toBe(400);
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
