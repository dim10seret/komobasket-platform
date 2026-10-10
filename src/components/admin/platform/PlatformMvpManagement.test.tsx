import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PlatformMvpManagement, { hasContest, seriesLabel, statusLabel } from "./PlatformMvpManagement";
import OrganizationPlatform from "@/components/user/OrganizationPlatform";

describe("organization Platform MVP navigation", () => {
  it("offers New Poll, Active and History within the shared Platform panel", () => {
    const html = renderToStaticMarkup(<PlatformMvpManagement organizationId="synthetic-org" />);
    expect(html).toContain("Νέα ψηφοφορία");
    expect(html).toContain("Ενεργές");
    expect(html).toContain("Ιστορικό");
    expect(html).toContain("Δημιουργία και διαχείριση ψηφοφοριών ανά οργανισμό");
  });
  it("shows Greek statuses and canonical team names without exposing matchup IDs", () => {
    expect(statusLabel("open")).toBe("Ανοιχτή");
    expect(statusLabel("finalized")).toBe("Οριστικοποιημένη");
    const scope = { phase_id: "series", round_number: null, series_matchup_id: "opaque-id", round_label: "Ημιτελικός",
      home_team_name: "Ομάδα Α", away_team_name: "Ομάδα Β" };
    expect(seriesLabel(scope)).toBe("Ημιτελικός · Ομάδα Α – Ομάδα Β");
    expect(seriesLabel({ ...scope, away_team_name: null })).toContain("Αναμονή ομάδας");
    expect(seriesLabel(scope)).not.toContain("opaque-id");
  });
  it("marks existing round and series scopes independently of status", () => {
    const round = { phase_id: "phase", round_number: 2, series_matchup_id: null, round_label: null,
      home_team_name: null, away_team_name: null };
    const series = { ...round, round_number: null, series_matchup_id: "matchup" };
    const occupied = [
      { phase_id: "phase", scope_type: "round" as const, round_number: 2, matchup_id: null },
      { phase_id: "phase", scope_type: "series" as const, round_number: null, matchup_id: "matchup" },
    ];
    expect(hasContest(round, "standings", occupied)).toBe(true);
    expect(hasContest(series, "series", occupied)).toBe(true);
    expect(hasContest({ ...round, round_number: 3 }, "standings", occupied)).toBe(false);
    expect(hasContest({ ...series, phase_id: "foreign" }, "series", occupied)).toBe(false);
  });
  it("places MVP in the existing organization navigation", () => {
    const membership = { organizationId: "synthetic-org", organizationName: "Synthetic Organization", logoUrl: null,
      role: "admin" as const };
    const html = renderToStaticMarkup(<OrganizationPlatform
      identity={{ user: { id: "operator", email: "operator@example.test", displayName: "Operator" }, memberships: [membership] }}
      membership={membership} csrf="synthetic" onLogout={() => {}} logoutBusy={false} authError="" />);
    expect(html).toContain("Organization Platform");
    expect(html).toContain(">MVP</button>");
  });
});
