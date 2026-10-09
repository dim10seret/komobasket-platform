import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  limit: vi.fn(), issue: vi.fn(), register: vi.fn(), vote: vi.fn(),
}));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: async () => state.current }));
vi.mock("@/services/mvp-guest-voting.service", () => ({
  MvpGuestError: class MvpGuestError extends Error {},
  MvpGuestVotingService: class {
    issueChallenge = state.issue;
    register = state.register;
    vote = state.vote;
  },
}));

import { POST } from "./route";

const body = { action: "register", contestId: "contest-a", candidateId: "candidate-a", publicKeySpki: "synthetic-key" };
function request(value = body) {
  return new Request("https://komobasket.gr/api/public/v1/mvp-voting/challenge", {
    method: "POST", headers: { "Content-Type": "application/json", "cf-connecting-ip": "203.0.113.10" },
    body: JSON.stringify(value),
  });
}
function context(operation: string) { return { params: Promise.resolve({ operation }) }; }

beforeEach(() => {
  vi.clearAllMocks();
  state.current = null;
  state.limit.mockResolvedValue({ success: true });
  state.issue.mockResolvedValue({ challenge: "synthetic-challenge" });
});

describe("guest MVP voting route gate", () => {
  it("is disabled by default before reading input or database", async () => {
    const response = await POST(request(), context("challenge"));
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.issue).not.toHaveBeenCalled();
  });

  it("fails closed without Google configuration or a rate limiter", async () => {
    state.current = { MVP_GUEST_VOTING_ENABLED: "enabled", NEWS_DB: {} };
    expect((await POST(request(), context("challenge"))).status).toBe(503);
    expect(state.issue).not.toHaveBeenCalled();
  });

  it("rejects rate-limited challenge issuance without touching the service", async () => {
    state.current = { MVP_GUEST_VOTING_ENABLED: "enabled", NEWS_DB: {},
      MVP_GOOGLE_SERVICE_ACCOUNT_EMAIL: "synthetic@example.test",
      MVP_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "synthetic-private-key",
      MVP_ANDROID_CERT_SHA256: "synthetic-cert", USER_LOGIN_RATE_LIMITER: { limit: state.limit } };
    state.limit.mockResolvedValueOnce({ success: false });
    const response = await POST(request(), context("challenge"));
    expect(response.status).toBe(429);
    expect((await response.json()).error.code).toBe("RATE_LIMITED");
    expect(state.issue).not.toHaveBeenCalled();
    expect(state.limit.mock.calls[0][0].key).toMatch(/^mvp2b:challenge:0:/);
  });

  it.each(["credential", "vote"] as const)("rate-limits %s before processing proof", async (operation) => {
    state.current = { MVP_GUEST_VOTING_ENABLED: "enabled", NEWS_DB: {},
      MVP_GOOGLE_SERVICE_ACCOUNT_EMAIL: "synthetic@example.test",
      MVP_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "synthetic-private-key",
      MVP_ANDROID_CERT_SHA256: "synthetic-cert", USER_LOGIN_RATE_LIMITER: { limit: state.limit } };
    state.limit.mockResolvedValueOnce({ success: false });
    const proof = { contestId: "contest-a", candidateId: "candidate-a", credentialId: "credential-a" };
    const response = await POST(request(proof as typeof body), context(operation));
    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state[operation === "credential" ? "register" : "vote"]).not.toHaveBeenCalled();
    expect(state.limit.mock.calls[0][0].key).toMatch(new RegExp(`^mvp2b:${operation}:0:`));
  });

  it("uses MVP-specific abuse keys and serves only an explicitly enabled operation", async () => {
    state.current = { MVP_GUEST_VOTING_ENABLED: "enabled", NEWS_DB: {},
      MVP_GOOGLE_SERVICE_ACCOUNT_EMAIL: "synthetic@example.test",
      MVP_GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: "synthetic-private-key",
      MVP_ANDROID_CERT_SHA256: "synthetic-cert", USER_LOGIN_RATE_LIMITER: { limit: state.limit } };
    const response = await POST(request(), context("challenge"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(state.limit).toHaveBeenCalledTimes(2);
    expect(state.issue).toHaveBeenCalledWith(body);
    expect((await POST(request(), context("results"))).status).toBe(404);
    const oversized = new Request("https://komobasket.gr/api/public/v1/mvp-voting/challenge", {
      method: "POST", headers: { "cf-connecting-ip": "203.0.113.10" }, body: "x".repeat(16_385),
    });
    expect((await POST(oversized, context("challenge"))).status).toBe(413);
  });
});
