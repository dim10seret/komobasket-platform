import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MvpVotingPage, { conservativeClockOffset, countdownLabel, googleLoginHref, remainingSeconds } from "./MvpVotingPage";

type Contest = React.ComponentProps<typeof MvpVotingPage>["initialContest"];

const candidate: Contest["candidates"][number] = {
  id: "candidate-a", playerId: "player-a", playerName: "Παίκτης Α", teamId: "team-a",
  teamName: "Ομάδα Α", performance: { points: 18, rebounds: 7, assists: 4, efficiency: 21 }, votes: null,
};

function contest(overrides: Partial<Contest> = {}): Contest {
  return {
    id: "contest-a", phaseId: "phase-a", scopeType: "round", roundNumber: 7,
    matchupId: null, title: "Round 7 MVP", selectionMethod: "app_poll", status: "open",
    opensAt: 1_000, closesAt: 4_600, finalizedAt: null, resultsVisibility: "hidden",
    totalVotes: null, candidates: [candidate], official: null, ...overrides,
  };
}

function render(input: Contest, authEnabled = true, votingEnabled = true) {
  return renderToStaticMarkup(<MvpVotingPage initialContest={input} initialServerTime={2_000}
    competitionId="competition-a" rootPhaseId="root-a" competitionName="Διοργάνωση Α"
    tournamentName="Θεσμός Α" authEnabled={authEnabled} votingEnabled={votingEnabled} />);
}

describe("public MVP voting page", () => {
  it("shows canonical context, selection, player statistics and countdown", () => {
    const html = render(contest());
    expect(html).toContain("Διοργάνωση Α · Θεσμός Α");
    expect(html).toContain("MVP 7ης αγωνιστικής");
    expect(html).toContain("Παίκτης Α");
    expect(html).toContain("Ομάδα Α");
    expect(html).toContain('type="radio"');
    expect(html).toContain("Απομένουν");
    expect(html).toContain("PTS");
  });

  it("hides totals and rankings for an after-close poll", () => {
    const html = render(contest());
    expect(html).toContain("Τα αποτελέσματα θα εμφανιστούν");
    expect(html).not.toContain("Σύνολο ψήφων");
    expect(html).not.toContain("ψήφοι</span>");
  });

  it("shows live totals only when supplied by the public projection", () => {
    const html = render(contest({ resultsVisibility: "visible", totalVotes: 5,
      candidates: [{ ...candidate, votes: 5 }] }));
    expect(html).toContain("Σύνολο ψήφων: 5");
    expect(html).toContain("5 ψήφοι");
  });

  it("shows a finalized Official MVP with optional enrichment", () => {
    const html = render(contest({ status: "finalized", resultsVisibility: "visible", totalVotes: 5,
      official: { winnerPlayerId: "player-a", winner: {
        playerId: "player-a", playerName: "Παίκτης Α", teamId: "team-a", teamName: "Ομάδα Α",
        performance: candidate.performance, performanceScope: "supporting_game",
      }, bodyText: "Περιγραφή", photoAssetKey: null, photoUrl: "/api/public/v1/mvp-media/contest-a/photo.webp",
      photoCaption: "Λεζάντα", sponsorName: "Χορηγός Α", giftDescription: "Δώρο Α" } }));
    expect(html).toContain("Επίσημο MVP");
    expect(html).toContain("Περιγραφή");
    expect(html).toContain("Λεζάντα");
    expect(html).toContain("Χορηγός Α");
    expect(html).toContain("Δώρο Α");
    expect(html).not.toContain("Επιβεβαίωση ψήφου");
  });

  it("keeps voting unavailable when either feature flag is off", () => {
    expect(render(contest(), false, true)).toContain("Η ψηφοφορία δεν είναι διαθέσιμη");
    expect(render(contest(), true, false)).toContain("Η ψηφοφορία δεν είναι διαθέσιμη");
  });

  it("uses the fixed return path and a server-time deadline", () => {
    const path = "/mvp/competitions/competition-a/tournaments/root-a/contests/contest-a";
    const url = new URL(googleLoginHref(path), "https://komobasket.gr");
    expect(url.pathname).toBe("/api/public/v1/mvp-google-auth/start");
    expect(url.searchParams.get("returnTo")).toBe(path);
    expect(remainingSeconds(4_599_000, 4_600)).toBe(1);
    expect(remainingSeconds(4_600_000, 4_600)).toBe(0);
    expect(conservativeClockOffset(4_599, 4_599_500)).toBe(500);
    expect(countdownLabel(3661)).toBe("1ω 1λ 1δ");
  });
});
