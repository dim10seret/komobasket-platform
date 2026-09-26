import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/services/platform-match-report.service", () => ({
  listPlatformMatchReportAvailabilityWithDb: vi.fn(async () => ({})),
  readAuthoritativeTeamStatisticalGamesWithDb: vi.fn(async () => []),
}));
import { getPublicCompetitionContextForOrganizationWithDb } from "./public-competition.service";

function fixture({ organization = "org-a", winsRequired = 2, transferred = false, decided = false } = {}) {
  const competition = `${organization}-competition`;
  const phaseId = `${organization}-phase`;
  const a = `${organization}-a`, b = `${organization}-b`;
  const calls = [];
  const basePhase = { slug: "series", name: "SERIES PHASE", format: "series", phase_type: "series", phase_kind: "series", lifecycle_status: "active", phase_order: 2, previous_phase_id: null, participant_count: 2, round_count: 3, wins_required: winsRequired, carry_over_enabled: transferred ? 1 : 0, carry_over_source_phase_id: transferred ? `${phaseId}-source` : null, settings_json: "{}", standings_presentation_json: "[]" };
  const phases = [{ ...basePhase, id: phaseId, rule_settings_json: JSON.stringify({ participantConfiguration: { sourceType: "competition_participants" }, carryOverMeetingNumbers: [1], bracketConfiguration: { participantCount: 2, matchups: [{ id: "pair", slotA: { type: "fixed_team", teamId: a }, slotB: { type: "fixed_team", teamId: b } }] } }) }];
  if (transferred) phases.unshift({ ...basePhase, id: `${phaseId}-source`, slug: "source", name: "SOURCE PHASE", format: "standings", phase_type: "regular", phase_kind: "regular_season", lifecycle_status: "finalized", phase_order: 1, carry_over_enabled: 0, carry_over_source_phase_id: null, rule_settings_json: '{"gamesPerPairing":1}' });
  const makeGame = (round, status, homeScore, awayScore, reverse = false) => ({
    id: `${organization}-game-${round}`, competition_id: competition, phase_id: phaseId, schedule_id: "schedule", cycle_number: 1, round_number: round, series_round_number: round, game_order: 1, round_label: `ΓΥΡΟΣ ${round}`,
    scheduled_date: null, scheduled_time: null, game_venue: null, venue_id: null, venue_name: null, venue_address: null, venue_map_url: null, home_score: homeScore, away_score: awayScore, status, result_source: status === "completed" ? "manual" : null, gameplay_lifecycle: null, series_matchup_id: "pair", video_url: null,
    home_team_id: reverse ? b : a, home_team_name: reverse ? `${organization} B` : `${organization} A`, home_team_logo_url: null,
    away_team_id: reverse ? a : b, away_team_name: reverse ? `${organization} A` : `${organization} B`, away_team_logo_url: null,
  });
  const games = decided
    ? [makeGame(1, "completed", 40, 70), makeGame(2, "completed", 80, 50, true)]
    : [makeGame(1, "completed", 70, 60), makeGame(2, "scheduled", null, null, true)];
  if (transferred) games[0] = { ...games[0], id: `${organization}-source-game`, phase_id: `${phaseId}-source`, series_matchup_id: null, series_round_number: null };
  const database = {
    prepare(query) {
      let bindings = [];
      const statement = {
        bind(...values) { bindings = values; calls.push({ query, bindings }); return statement; },
        async all() {
          if (query.includes("FROM league_competitions c")) return { results: bindings[0] === organization ? [{ season_id: "season", season_name: "2026-27", season_slug: "2026-27", competition_id: competition, competition_name: "EXAMPLE", competition_slug: "example", competition_type: "cup", lifecycle_status: "online", game_mode: "FULL" }] : [] };
          if (query.includes("FROM league_phases p")) return { results: phases };
          if (query.includes("FROM league_competition_teams ct JOIN")) return { results: [{ id: a, name: `${organization} A`, logo_url: null }, { id: b, name: `${organization} B`, logo_url: null }] };
          if (query.includes("FROM league_games g")) return { results: games };
          return { results: [] };
        },
        async first() { return null; },
        async run() { throw new Error("Read projection must not write"); },
      };
      return statement;
    },
    async batch() { throw new Error("Read projection must not batch writes"); },
  };
  return { database, calls, games, organization, phaseId };
}
const read = (value) => getPublicCompetitionContextForOrganizationWithDb(value.database, value.organization, { phaseSlug: "series" });

describe("canonical public series summary projection", () => {
  it.each([2, 3])("exposes canonical progression for a %i-win series without changing round history", async (winsRequired) => {
    const value = fixture({ winsRequired });
    const result = await read(value);
    const matchup = result.seriesHistory[0];
    expect(matchup.matchupId).toBe("pair");
    expect(matchup.maximumSeriesRounds).toBe(winsRequired * 2 - 1);
    expect(matchup.summary).toEqual({ teamAId: "org-a-a", teamAName: "org-a A", teamBId: "org-a-b", teamBName: "org-a B", winsRequired, currentWinsA: 1, currentWinsB: 0, qualifiedTeamId: null, qualifiedTeamName: null, transferredRoundCount: 0 });
    expect(matchup.rounds[0].game.homeScore).toBe(70);
    expect(matchup.rounds[1].game.publicStatus).toBe("scheduled");
  });
  it("exposes the decided canonical winner and never invents a remaining game", async () => {
    const result = await read(fixture({ decided: true }));
    expect(result.seriesHistory[0].summary).toMatchObject({ currentWinsA: 0, currentWinsB: 2, qualifiedTeamId: "org-a-b", qualifiedTeamName: "org-a B" });
    expect(result.seriesHistory[0].rounds[2]).toMatchObject({ kind: "not_needed", game: null });
  });
  it("includes real transferred results in canonical wins while retaining their source provenance", async () => {
    const result = await read(fixture({ transferred: true }));
    expect(result.seriesHistory[0].summary).toMatchObject({ currentWinsA: 1, currentWinsB: 0, transferredRoundCount: 1 });
    expect(result.seriesHistory[0].rounds[0]).toMatchObject({ kind: "transferred", sourcePhaseName: "SOURCE PHASE", game: { homeScore: 70, awayScore: 60 } });
  });
  it("groups games by canonical matchup identity rather than team-name resemblance", async () => {
    const value = fixture();
    value.games.push({ ...value.games[0], id: "another-matchup", series_matchup_id: "unrelated", home_score: 10, away_score: 90 });
    const result = await read(value);
    expect(result.seriesHistory[0].summary).toMatchObject({ currentWinsA: 1, currentWinsB: 0 });
    expect(JSON.stringify(result.seriesHistory)).not.toContain("another-matchup");
  });
  it.each(["org-a", "org-b"])("keeps %s summary and game reads organization-scoped", async (organization) => {
    const value = fixture({ organization });
    const result = await read(value);
    expect(result.seriesHistory[0].summary.teamAId).toBe(`${organization}-a`);
    expect(value.calls[0].bindings[0]).toBe(organization);
    const gameRead = value.calls.find((call) => /^\s*SELECT\s+g\.id\s*,/i.test(call.query) && call.query.includes("FROM league_games g"));
    expect(gameRead.bindings.filter((binding) => binding === organization)).toHaveLength(2);
    const inaccessible = await getPublicCompetitionContextForOrganizationWithDb(value.database, "foreign-org");
    expect(inaccessible.seriesHistory).toEqual([]);
  });
});
