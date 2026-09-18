import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhaseParticipantsBuilder } from "./PhaseParticipantsBuilder";

const data = {
  mode: "database",
  organizationContext: { organizationId: "org-a", slug: "org-a", name: "Org A", logoUrl: null, role: "admin" },
  seasons: [],
  competitions: [{ id: "cup", organization_id: "org-a", season_id: "season" }],
  teams: [
    { id: "team-a", organization_id: "org-a", name: "Άλφα" },
    { id: "team-b", organization_id: "org-a", name: "Βήτα" },
    { id: "not-participating", organization_id: "org-a", name: "Γάμμα" },
    { id: "foreign", organization_id: "org-b", name: "Ξένη" },
  ],
  players: [],
  participations: [
    { competition_id: "cup", season_id: "season", team_id: "team-a", status: "active" },
    { competition_id: "cup", season_id: "season", team_id: "team-b", status: "active" },
    { competition_id: "cup", season_id: "season", team_id: "foreign", status: "active" },
  ],
  rosters: [], movements: [], phases: [], phaseSchedules: [], seriesPlanningSlots: [], games: [], competitionVenues: [],
  counts: { seasons: 0, competitions: 1, teams: 4, players: 0 },
};

const rootPhase = {
  id: "root-phase", competition_id: "cup", format: "series", phase_order: 1, previous_phase_id: null,
  rule_settings_json: JSON.stringify({
    participantConfiguration: { participantSourceType: "competition_participants", participantSourcePhaseId: null },
    bracketConfiguration: { matchups: [{
      id: "matchup-1",
      slotA: { id: "slot-a", type: "manual", teamId: "team-a" },
      slotB: { id: "slot-b", type: "manual", teamId: "team-b" },
    }] },
  }),
};

describe("root series phase UI", () => {
  it("offers Καμία as the real empty predecessor in phase creation", () => {
    const source = readFileSync(new URL("../sections/CompetitionSection.tsx", import.meta.url), "utf8");
    expect(source).toContain('<option value="">Καμία</option>');
  });

  it("reopens a root series using competition participants without a source-phase requirement", () => {
    const html = renderToStaticMarkup(createElement(PhaseParticipantsBuilder, { data, phase: rootPhase, competitionId: "cup", selectedFormat: "series", activeStep: 1 }));
    expect(html).toContain("Πηγή: ενεργές συμμετοχές της διοργάνωσης.");
    expect(html).toContain("2 διαθέσιμες ομάδες");
    expect(html).toContain("Άλφα");
    expect(html).toContain("Βήτα");
    expect(html).not.toContain("Γάμμα");
    expect(html).not.toContain("Ξένη");
    expect(html).not.toContain("Φάση προέλευσης");
    expect(html).not.toContain("Απαιτείται φάση προέλευσης");
    expect(html).toContain("competition_participants");
  });

  it("uses participating canonical Team IDs as root bracket choices", () => {
    const html = renderToStaticMarkup(createElement(PhaseParticipantsBuilder, { data, phase: rootPhase, competitionId: "cup", selectedFormat: "series", activeStep: 2 }));
    expect(html).toContain('value="team-a"');
    expect(html).toContain('value="team-b"');
    expect(html).not.toContain('value="not-participating"');
    expect(html).not.toContain('value="foreign"');
  });

  it("keeps previous-phase advancement controls for a follow-up series", () => {
    const followUp = { ...rootPhase, id: "follow-up", phase_order: 2, previous_phase_id: "group-phase", rule_settings_json: JSON.stringify({ participantConfiguration: { participantSourceType: "standing_positions", participantSourcePhaseId: "group-phase", standingFrom: 1, standingTo: 2 } }) };
    const followUpData = { ...data, phases: [{ id: "group-phase", competition_id: "cup", phase_order: 1, name: "Όμιλοι", format: "standings" }] };
    const html = renderToStaticMarkup(createElement(PhaseParticipantsBuilder, { data: followUpData, phase: followUp, competitionId: "cup", selectedFormat: "series", activeStep: 1 }));
    expect(html).toContain("Φάση προέλευσης");
    expect(html).toContain("Από θέση");
    expect(html).toContain("standing_positions");
    expect(html).not.toContain("Πηγή: ενεργές συμμετοχές της διοργάνωσης.");
  });
});
