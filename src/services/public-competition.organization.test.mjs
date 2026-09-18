import { beforeEach, describe, expect, it, vi } from "vitest";

const reportMocks = vi.hoisted(() => ({ availability: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/services/platform-match-report.service", () => ({
  listPlatformMatchReportAvailabilityWithDb: reportMocks.availability,
  readAuthoritativeTeamStatisticalGamesWithDb: vi.fn(async () => []),
}));

import { getPublicCompetitionContextForOrganizationWithDb } from "./public-competition.service";

const organizations = {
  organization_komobasket: { prefix: "komobasket", name: "KomoBasket Competition" },
  organization_runbasket: { prefix: "runbasket", name: "RunBasket Competition" },
};

function databaseFixture() {
  const calls = [];
  const database = {
    prepare(query) {
      let bindings = [];
      const statement = {
        bind(...values) { bindings = values; calls.push({ query, bindings }); return statement; },
        async first() { return null; },
        async run() { return {}; },
        async all() {
          if (query.includes("FROM league_competitions c")) {
            const organization = organizations[bindings[0]];
            if (!organization) return { results: [] };
            return { results: [{
              season_id: `season_${organization.prefix}`,
              season_name: `${organization.prefix} season`,
              season_slug: `${organization.prefix}-season`,
              competition_id: `competition_${organization.prefix}`,
              competition_name: organization.name,
              competition_slug: `${organization.prefix}-competition`,
              competition_type: "league",
              lifecycle_status: "online",
              game_mode: "FULL",
            }] };
          }
          if (query.includes("FROM league_phases p")) {
            const prefix = String(bindings[0]).replace("competition_", "");
            return { results: [{
              id: `phase_${prefix}`,
              slug: "regular-season",
              name: "Regular Season",
              format: "custom",
              phase_type: "regular",
              phase_kind: null,
              lifecycle_status: "active",
              phase_order: 1,
              previous_phase_id: null,
              participant_count: 2,
              round_count: 1,
              wins_required: null,
              carry_over_enabled: null,
              carry_over_source_phase_id: null,
              settings_json: "{}",
              rule_settings_json: "{}",
              standings_presentation_json: "[]",
            }] };
          }
          if (query.includes("FROM league_competition_teams ct JOIN")) {
            const prefix = String(bindings[0]).replace("competition_", "");
            return { results: [
              { id: `team_${prefix}_home`, name: `${prefix} home`, logo_url: null },
              { id: `team_${prefix}_away`, name: `${prefix} away`, logo_url: null },
            ] };
          }
          if (query.includes("FROM league_games g")) {
            const prefix = String(bindings[0]).replace("competition_", "");
            return { results: [{
              id: `game_${prefix}`,
              competition_id: `competition_${prefix}`,
              phase_id: `phase_${prefix}`,
              schedule_id: null,
              cycle_number: 1,
              round_number: 1,
              series_round_number: null,
              game_order: 1,
              round_label: "1η Αγωνιστική",
              scheduled_date: "2026-09-04",
              scheduled_time: "18:00",
              game_venue: null,
              venue_id: null,
              venue_name: null,
              venue_address: null,
              venue_map_url: null,
              home_score: null,
              away_score: null,
              status: "scheduled",
              result_source: null,
              gameplay_lifecycle: null,
              series_matchup_id: null,
              video_url: null,
              home_team_id: `team_${prefix}_home`,
              home_team_name: `${prefix} home`,
              home_team_logo_url: null,
              away_team_id: `team_${prefix}_away`,
              away_team_name: `${prefix} away`,
              away_team_logo_url: null,
            }] };
          }
          return { results: [] };
        },
      };
      return statement;
    },
    async batch() { return []; },
  };
  return { database, calls };
}

describe("public competition organization isolation", () => {
  beforeEach(() => reportMocks.availability.mockResolvedValue({}));

  it.each([
    ["organization_komobasket", "komobasket"],
    ["organization_runbasket", "runbasket"],
  ])("returns only %s competition data", async (organizationId, prefix) => {
    const fixture = databaseFixture();
    const context = await getPublicCompetitionContextForOrganizationWithDb(fixture.database, organizationId);
    expect(context.competitions.map((competition) => competition.id)).toEqual([`competition_${prefix}`]);
    expect(context.games.map((game) => game.id)).toEqual([`game_${prefix}`]);
    expect(fixture.calls[0].bindings[0]).toBe(organizationId);
    expect(fixture.calls.some((call) => call.bindings.includes(organizationId))).toBe(true);
  });

  it("does not expose a KomoBasket competition injected into RunBasket query state", async () => {
    const fixture = databaseFixture();
    const context = await getPublicCompetitionContextForOrganizationWithDb(
      fixture.database,
      "organization_runbasket",
      { competitionSlug: "komobasket-competition", teamId: "team_komobasket_home" },
    );
    expect(context.selectedCompetition?.id).toBe("competition_runbasket");
    expect(context.competitions.some((competition) => competition.id === "competition_komobasket")).toBe(false);
    expect(context.games.some((game) => game.id === "game_komobasket")).toBe(false);
    expect(context.teamView).toBeNull();
  });
});
