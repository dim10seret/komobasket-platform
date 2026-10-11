import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlatformMvpPresentationEditor from "./PlatformMvpPresentationEditor";

const contest = { id: "synthetic", competition_name: "Competition", phase_name: "Phase", winner_player_id: "p1",
  candidates: [{ player_id: "p1", player_name: "Player One", team_name: "Team One",
    points: 21, rebounds: 8, assists: 5, efficiency: 27 }], photoUrl: null,
  photo_caption: null, body_text: null, sponsor_name: null, gift_description: null,
  presentationRevision: "a".repeat(64) };

describe("MVP presentation in Platform History", () => {
  it("shows the finalized winner and statistics with optional content absent", () => {
    const html = renderToStaticMarkup(<PlatformMvpPresentationEditor contest={contest} organizationId="org-a"
      scopeLabel="Αγωνιστική 7" canManage onSaved={async () => true} />);
    expect(html).toContain("Επεξεργασία παρουσίασης");
    expect(html).toContain("Player One");
    expect(html).toContain("21 PTS · 8 REB · 5 AST · 27 EFF");
  });

  it("keeps viewers read-only and React-escapes stored plain text", () => {
    const html = renderToStaticMarkup(<PlatformMvpPresentationEditor
      contest={{ ...contest, body_text: "<script>alert(1)</script>", sponsor_name: "Synthetic Sponsor" }}
      organizationId="org-a" scopeLabel="Series" canManage={false} onSaved={async () => true} />);
    expect(html).not.toContain("Επεξεργασία παρουσίασης");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("Synthetic Sponsor");
  });
});
