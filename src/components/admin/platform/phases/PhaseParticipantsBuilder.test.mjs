import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, test } from "vitest";
import { deriveSeriesMatchupSourceConfiguration, PhaseParticipantsBuilder } from "./PhaseParticipantsBuilder";

const source = readFileSync(new URL("./PhaseParticipantsBuilder.tsx", import.meta.url), "utf8");

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
  rosters: [], movements: [], phases: [], phaseSchedules: [], seriesPlanningSlots: [], roundRobinPlanningSlots: [], games: [], competitionVenues: [],
  counts: { seasons: 0, competitions: 1, teams: 4, players: 0 },
};

test("future standings phases expose standing-position participants", () => {
  assert.match(source, /option\.value === "standing_positions"/);
  assert.match(source, /participantSourceType === "standing_positions"/);
  assert.match(source, /name="standingFrom"/);
  assert.match(source, /name="standingTo"/);
  assert.equal(
    deriveSeriesMatchupSourceConfiguration([], "standing_positions").participantSourceType,
    "standing_positions",
  );
});

test("standing-position preview projects the inclusive symbolic range", async () => {
  const { buildStandingPositionPreview } = await import("./PhaseParticipantsBuilder.tsx");
  const slots = buildStandingPositionPreview("phase_regular", "Regular Season", 9, 15);

  assert.equal(slots.length, 7);
  assert.deepEqual(
    slots.map((slot) => slot.key),
    Array.from({ length: 7 }, (_, index) => `standing:phase_regular:position:${index + 9}`),
  );
  assert.deepEqual(
    slots.map((slot) => slot.label),
    Array.from({ length: 7 }, (_, index) => `${index + 9}η θέση Regular Season`),
  );
  assert.equal(slots.some((slot) => slot.label.includes("Όλες οι ομάδες της διοργάνωσης")), false);
});

test("standing-position mode drives availability and preview without stale all-team projection", () => {
  assert.match(source, /participantSourceType === "standing_positions"\) return standingPositionPreview\.length/);
  assert.match(source, /data-testid="standing-position-preview"/);
  assert.match(source, /Θέσεις από/);
  assert.match(source, /\[participantSourceType, sourcePhase, standingFrom, standingTo\]/);
  assert.match(source, /participantSourceType === "competition_participants"\) return competitionTeams\.length/);
});

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

describe("series loser participant outputs", () => {
  const semifinalPhase = {
    id: "semifinals", competition_id: "cup", name: "Ημιτελικά", format: "series", phase_order: 1,
    rule_settings_json: JSON.stringify({
      bracketConfiguration: { matchups: [
        {
          id: "sf-1",
          slotA: { id: "sf-1-a", type: "manual", teamId: "team-a" },
          slotB: { id: "sf-1-b", type: "manual", teamId: "team-b" },
        },
        {
          id: "sf-2",
          slotA: { id: "sf-2-a", type: "manual", teamId: "team-c" },
          slotB: { id: "sf-2-b", type: "manual", teamId: "team-d" },
        },
      ] },
    }),
  };
  const smallFinalPhase = {
    id: "small-final", competition_id: "cup", name: "ΜΙΚΡΟΣ ΤΕΛΙΚΟΣ", format: "series", phase_order: 2,
    previous_phase_id: "semifinals", wins_required: 2,
    rule_settings_json: JSON.stringify({
      participantConfiguration: {
        participantSourceType: "matchup_losers",
        participantSourcePhaseId: "semifinals",
        sourceMatchupIds: ["sf-1", "sf-2"],
      },
      bracketConfiguration: { matchups: [{
        id: "small-final-matchup",
        slotA: { id: "small-a", type: "matchup_loser", matchupId: "sf-1" },
        slotB: { id: "small-b", type: "matchup_loser", matchupId: "sf-2" },
      }] },
    }),
  };

  it("derives and serializes canonical matchup_losers configuration", () => {
    const result = deriveSeriesMatchupSourceConfiguration([
      {
        id: "small-final-matchup",
        slotA: { id: "small-a", type: "matchup_loser", position: "", teamId: "", matchupId: "sf-1" },
        slotB: { id: "small-b", type: "matchup_loser", position: "", teamId: "", matchupId: "sf-2" },
      },
    ], "standing_positions");
    expect(result).toEqual({ participantSourceType: "matchup_losers", sourceMatchupIds: ["sf-1", "sf-2"] });
  });

  it("reopens loser selections and exposes both canonical loser outputs", () => {
    const html = renderToStaticMarkup(createElement(PhaseParticipantsBuilder, {
      data: { ...data, phases: [semifinalPhase, smallFinalPhase] },
      phase: smallFinalPhase,
      competitionId: "cup",
      selectedFormat: "series",
      activeStep: 2,
    }));
    expect(html).toContain('value="loser:sf-1"');
    expect(html).toContain('value="loser:sf-2"');
    expect(html).toContain("Ηττημένος");
    expect(html).toContain("matchup_losers");
  });

  it("shows the optional Small Final control only through the structural action", () => {
    const competitionSource = readFileSync(new URL("../sections/CompetitionSection.tsx", import.meta.url), "utf8");
    expect(competitionSource).toContain("Δημιουργία Μικρού Τελικού");
    expect(competitionSource).toContain("getCompetitiveSeriesSourceMatchupIds");
    expect(competitionSource).toContain('value="createFinalSeriesPhases"');
  });
});
