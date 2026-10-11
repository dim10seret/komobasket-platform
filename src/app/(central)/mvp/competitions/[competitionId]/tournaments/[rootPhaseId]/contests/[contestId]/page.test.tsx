import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  env: vi.fn(), feed: vi.fn(), competition: vi.fn(),
}));

vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: fixture.env }));
vi.mock("@/services/public-mvp-contests.service", () => ({ readPublicMvpContestsWithDb: fixture.feed }));
vi.mock("@/services/public-mobile-competition.service", () => ({ readCompetitionDetailWithDb: fixture.competition }));
vi.mock("@/components/layout/Header", () => ({ default: () => null }));
vi.mock("@/components/mvp/MvpVotingPage", () => ({ default: () => null }));

import PublicMvpVotingPage from "./page";

const params = Promise.resolve({ competitionId: "competition-a", rootPhaseId: "root-a", contestId: "contest-a" });

beforeEach(() => {
  vi.clearAllMocks();
  fixture.env.mockResolvedValue({ NEWS_DB: {}, MVP_PUBLIC_READ_ENABLED: "enabled",
    MVP_GOOGLE_AUTH_ENABLED: undefined, MVP_GOOGLE_VOTING_ENABLED: undefined });
  fixture.feed.mockResolvedValue({ serverTime: 2_000, active: [{ id: "contest-a" }], history: [] });
  fixture.competition.mockResolvedValue({ name: "Διοργάνωση Α",
    tournamentGroups: [{ id: "root-a", name: "Θεσμός Α" }] });
});

describe("canonical public MVP voting route", () => {
  it("renders only a contest in the authorized competition and tournament feed", async () => {
    const page = await PublicMvpVotingPage({ params });
    expect(page).toBeTruthy();
    expect(fixture.feed).toHaveBeenCalledWith(expect.anything(),
      { competitionId: "competition-a", rootPhaseId: "root-a" });
  });

  it("does not expose the page while public reading is disabled", async () => {
    fixture.env.mockResolvedValue({ NEWS_DB: {}, MVP_PUBLIC_READ_ENABLED: undefined });
    await expect(PublicMvpVotingPage({ params })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(fixture.feed).not.toHaveBeenCalled();
  });

  it("rejects a contest absent from the visible canonical feed", async () => {
    fixture.feed.mockResolvedValue({ serverTime: 2_000, active: [], history: [] });
    await expect(PublicMvpVotingPage({ params })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("rejects invalid identifiers before querying the database", async () => {
    await expect(PublicMvpVotingPage({ params: Promise.resolve({ competitionId: "../other",
      rootPhaseId: "root-a", contestId: "contest-a" }) })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(fixture.feed).not.toHaveBeenCalled();
  });
});
