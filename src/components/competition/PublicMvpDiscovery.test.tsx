import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ env: vi.fn(), feed: vi.fn() }));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: fixture.env }));
vi.mock("@/services/public-mvp-contests.service", () => ({ readPublicMvpContestsWithDb: fixture.feed }));

import PublicMvpDiscovery, { publicMvpContestHref } from "./PublicMvpDiscovery";

const props = { organizationId: "org-a", competitionId: "comp-a", rootPhaseId: "root-a" };
const open = {
  id: "poll-a", scopeType: "round", roundNumber: 7, status: "open",
  opensAt: 1_000, closesAt: 3_000, resultsVisibility: "hidden",
  totalVotes: null, candidates: [], official: null,
};

function feed(active: object[] = [], history: object[] = []) {
  return { ...props, serverTime: 2_000, active, history };
}

async function render() {
  const section = await PublicMvpDiscovery(props);
  return section ? renderToStaticMarkup(section) : "";
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.env.mockResolvedValue({ MVP_PUBLIC_READ_ENABLED: "enabled", NEWS_DB: {} });
  fixture.feed.mockResolvedValue(feed([open]));
});

describe("public MVP discovery in the existing competition page", () => {
  it("links an eligible open poll using only canonical competition, tournament and contest IDs", async () => {
    const html = await render();
    expect(html).toContain("Δες την ψηφοφορία");
    expect(html).not.toContain("Ψήφισε για MVP");
    expect(html).toContain("MVP 7ης αγωνιστικής");
    expect(html).toContain("Ανοιχτή");
    expect(html).toContain("Λήξη:");
    expect(html).toContain('href="/mvp/competitions/comp-a/tournaments/root-a/contests/poll-a"');
    expect(fixture.feed).toHaveBeenCalledWith(expect.anything(), props);
    expect(publicMvpContestHref("comp-a", "root-a", "../outside")).toBeNull();
  });

  it("keeps the OPEN action neutral regardless of Google auth and voting flags", async () => {
    fixture.env.mockResolvedValue({ MVP_PUBLIC_READ_ENABLED: "enabled", NEWS_DB: {},
      MVP_GOOGLE_AUTH_ENABLED: "enabled", MVP_GOOGLE_VOTING_ENABLED: "enabled" });
    expect(await render()).toContain("Δες την ψηφοφορία");
    fixture.env.mockResolvedValue({ MVP_PUBLIC_READ_ENABLED: "enabled", NEWS_DB: {},
      MVP_GOOGLE_AUTH_ENABLED: undefined, MVP_GOOGLE_VOTING_ENABLED: undefined });
    expect(await render()).toContain("Δες την ψηφοφορία");
  });

  it("hides the section before querying when public MVP reading is disabled", async () => {
    fixture.env.mockResolvedValue({ NEWS_DB: {} });
    expect(await render()).toBe("");
    expect(fixture.feed).not.toHaveBeenCalled();
  });

  it("rejects a feed from a different organization or tournament", async () => {
    fixture.feed.mockResolvedValue({ ...feed([open]), organizationId: "org-b" });
    expect(await render()).toBe("");
    fixture.feed.mockResolvedValue({ ...feed([open]), rootPhaseId: "root-b" });
    expect(await render()).toBe("");
  });

  it("links the existing finalized publication without showing private vote details", async () => {
    fixture.feed.mockResolvedValue(feed([], [{ ...open, id: "final-a", status: "finalized",
      official: { winner: { playerName: "Παίκτης Α" } }, totalVotes: 5 }]));
    const html = await render();
    expect(html).toContain("Δες το επίσημο MVP");
    expect(html).toContain('href="/mvp/competitions/comp-a/tournaments/root-a/contests/final-a"');
    expect(html).not.toContain("5 ψήφοι");
    expect(html).not.toContain("Παίκτης Α");
  });

  it("shows unresolved and not-yet-open contests without a vote or winner action", async () => {
    fixture.feed.mockResolvedValue(feed([{ ...open, id: "future-a", opensAt: 2_500 }], [
      { ...open, id: "tie-a", status: "tie_requires_resolution" },
      { ...open, id: "zero-a", status: "needs_operator_decision" },
    ]));
    const html = await render();
    expect(html).toContain("Δεν έχει ανοίξει");
    expect(html).toContain("Αναμονή επίσημης απόφασης");
    expect(html).not.toContain("Δες την ψηφοφορία");
    expect(html).not.toContain("Δες το επίσημο MVP");
    expect(html).not.toContain("href=");
  });

  it("shows an empty state and filters invalid contest IDs", async () => {
    fixture.feed.mockResolvedValue(feed());
    expect(await render()).toContain("Δεν υπάρχουν διαθέσιμες ψηφοφορίες");
    fixture.feed.mockResolvedValue(feed([{ ...open, id: "../outside" }]));
    expect(await render()).not.toContain("href=");
  });

});
