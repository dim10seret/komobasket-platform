import { beforeEach, describe, expect, it, vi } from "vitest";

const reports = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/services/platform-match-report.service", () => ({ readAuthoritativeCompetitionStatisticalGamesWithDb: reports.read }));

import { readPublicCompetitionStatisticsForOrganizationWithDb } from "./public-competition-statistics.service";

const line = (points, efficiency) => ({ points, twoPointMade: points / 2, twoPointAttempts: points / 2, threePointMade: 0, threePointAttempts: 0, freeThrowMade: 0, freeThrowAttempts: 0, offensiveRebounds: 0, defensiveRebounds: 0, rebounds: 0, assists: 0, steals: 0, blocks: 0, turnovers: 0, fouls: 0, efficiency });
const game = (prefix, playerName, points, efficiency) => ({ gameId: `game_${prefix}`, scheduledDate: "2026-09-04", scheduledTime: "18:00", homeTeamId: `team_${prefix}`, homeTeamName: `${prefix} team`, awayTeamId: `opponent_${prefix}`, awayTeamName: `${prefix} opponent`, homeScore: points, awayScore: 0, homePlayers: [{ canonicalPlayerId: `player_${prefix}`, displayName: playerName, shirtNumber: "4", statistics: line(points, efficiency) }], awayPlayers: [] });

function database() {
  const calls = [];
  return { calls, binding: { prepare(query) {
    let values = [];
    const statement = {
      bind(...next) { values = next; calls.push({ query, values }); return statement; },
      async first() { return null; },
      async run() { return {}; },
      async all() {
        if (query.includes("FROM league_competitions")) {
          const prefix = values[0] === "organization_runbasket" ? "runbasket" : "komobasket";
          return { results: [{ season_id: `season_${prefix}`, season_name: "2026-27", season_slug: "2026-27", starts_on: "2026-08-01", competition_id: `competition_${prefix}`, competition_name: `${prefix} competition`, competition_slug: `${prefix}-competition` }] };
        }
        if (query.includes("FROM league_phases WHERE")) {
          const prefix = values[0].replace("competition_", "");
          return { results: [
            { id: `phase_${prefix}`, slug: "league", name: "League Phase", previous_phase_id: null, tournament_name: "League", phase_order: 1, lifecycle_status: "active" },
            { id: `phase_${prefix}_league_final`, slug: "league-final", name: "League Final", previous_phase_id: `phase_${prefix}`, tournament_name: null, phase_order: 2, lifecycle_status: "active" },
            { id: `phase_${prefix}_cup`, slug: "cup", name: "Cup Phase", previous_phase_id: null, tournament_name: null, phase_order: 3, lifecycle_status: "active" },
          ] };
        }
        if (query.includes("FROM league_games") && !query.includes("league_matchday_mvp_selections")) {
          const prefix = values[0].replace("competition_", "");
          return { results: [
            { game_id: `game_${prefix}`, phase_id: `phase_${prefix}`, round_number: 1, round_label: "1η Αγωνιστική" },
            { game_id: `game_${prefix}_league_final`, phase_id: `phase_${prefix}_league_final`, round_number: 1, round_label: "1η Αγωνιστική" },
            { game_id: `game_${prefix}_cup`, phase_id: `phase_${prefix}_cup`, round_number: 1, round_label: "1η Αγωνιστική" },
          ] };
        }
        if (query.includes("FROM league_matchday_mvp_selections")) {
          const prefix = values[0] === "organization_runbasket" ? "runbasket" : "komobasket";
          return { results: [
            { id: `mvp_${prefix}`, organization_id: `organization_${prefix}`, competition_id: `competition_${prefix}`, phase_id: `phase_${prefix}`, round_number: 1, game_id: `game_${prefix}`, player_id: `player_${prefix}`, created_at: "2026-09-24T10:00:00Z", updated_at: "2026-09-24T10:00:00Z" },
            { id: `mvp_${prefix}_league_final`, organization_id: `organization_${prefix}`, competition_id: `competition_${prefix}`, phase_id: `phase_${prefix}_league_final`, round_number: 1, game_id: `game_${prefix}_league_final`, player_id: `player_${prefix}_league_final`, created_at: "2026-09-24T10:01:00Z", updated_at: "2026-09-24T10:01:00Z" },
            { id: `mvp_${prefix}_cup`, organization_id: `organization_${prefix}`, competition_id: `competition_${prefix}`, phase_id: `phase_${prefix}_cup`, round_number: 1, game_id: `game_${prefix}_cup`, player_id: `player_${prefix}_cup`, created_at: "2026-09-24T10:02:00Z", updated_at: "2026-09-24T10:02:00Z" },
          ] };
        }
        return { results: [] };
      },
    };
    return statement;
  }, async batch() { return []; } } };
}

describe("public competition statistics organization isolation", () => {
  beforeEach(() => reports.read.mockImplementation(async (_db, competitionId, organizationId) => organizationId === "organization_runbasket" ? [game("runbasket", "RUNBASKET MVP", 20, 20)] : [game("komobasket", "KOMOBASKET MVP", 50, 50)]));
  it("keeps a higher KomoBasket fixture out of RunBasket MVP", async () => { const fixture = database(); const result = await readPublicCompetitionStatisticsForOrganizationWithDb(fixture.binding, "organization_runbasket"); expect(result.competitions).toEqual([{ slug: "runbasket-competition", name: "runbasket competition" }]); expect(result.statistics?.leaders.points?.displayName).toBe("RUNBASKET MVP"); expect(result.statistics?.matchdays[0]?.mvp?.player.displayName).toBe("RUNBASKET MVP"); expect(JSON.stringify(result)).not.toContain("KOMOBASKET MVP"); expect(reports.read).toHaveBeenCalledWith(fixture.binding, "competition_runbasket", "organization_runbasket"); });
  it("keeps RunBasket out of the central organization result", async () => { const fixture = database(); const result = await readPublicCompetitionStatisticsForOrganizationWithDb(fixture.binding, "organization_komobasket"); expect(result.statistics?.leaders.points?.displayName).toBe("KOMOBASKET MVP"); expect(JSON.stringify(result)).not.toContain("RUNBASKET MVP"); });
  it("sanitizes cross-organization competition query injection", async () => { const fixture = database(); const result = await readPublicCompetitionStatisticsForOrganizationWithDb(fixture.binding, "organization_runbasket", { competitionSlug: "komobasket-competition" }); expect(result.selectedCompetition?.slug).toBe("runbasket-competition"); expect(result.competitions).not.toContainEqual({ slug: "komobasket-competition", name: "komobasket competition" }); });
  it("exposes canonical root tournaments and uses the root-name fallback", async () => { const fixture = database(); const result = await readPublicCompetitionStatisticsForOrganizationWithDb(fixture.binding, "organization_runbasket"); expect(result.tournaments.map((entry) => [entry.slug, entry.name])).toEqual([["league", "League"], ["cup", "Cup Phase"]]); expect(result.selectedTournament?.slug).toBe("league"); });
  it("isolates statistics to the selected root tournament", async () => { reports.read.mockResolvedValueOnce([game("runbasket", "LEAGUE PLAYER", 20, 20), { ...game("runbasket_cup", "CUP PLAYER", 40, 40), gameId: "game_runbasket_cup" }]); const fixture = database(); const result = await readPublicCompetitionStatisticsForOrganizationWithDb(fixture.binding, "organization_runbasket", { tournamentSlug: "cup" }); expect(result.selectedTournament?.slug).toBe("cup"); expect(result.statistics?.leaders.points?.displayName).toBe("CUP PLAYER"); expect(JSON.stringify(result.statistics)).not.toContain("LEAGUE PLAYER"); });
  it("keeps same-round public MVP and Top Performance isolated across root Tournaments", async () => {
    const authoritative = [game("runbasket", "LEAGUE MVP", 20, 20), game("runbasket_cup", "CUP MVP", 40, 40)];
    reports.read.mockResolvedValue(authoritative);
    const league = await readPublicCompetitionStatisticsForOrganizationWithDb(database().binding, "organization_runbasket", { tournamentSlug: "league" });
    const cup = await readPublicCompetitionStatisticsForOrganizationWithDb(database().binding, "organization_runbasket", { tournamentSlug: "cup" });
    expect(league.statistics?.matchdays.find((entry) => entry.phaseId === "phase_runbasket")).toMatchObject({ id: "phase_runbasket-round-1", mvp: { player: { displayName: "LEAGUE MVP" } }, topPerformance: { player: { displayName: "LEAGUE MVP" } } });
    expect(JSON.stringify(league.statistics)).not.toContain("CUP MVP");
    expect(cup.statistics?.matchdays).toEqual([expect.objectContaining({ id: "phase_runbasket_cup-round-1", mvp: expect.objectContaining({ player: expect.objectContaining({ displayName: "CUP MVP" }) }), topPerformance: expect.objectContaining({ player: expect.objectContaining({ displayName: "CUP MVP" }) }) })]);
    expect(JSON.stringify(cup.statistics)).not.toContain("LEAGUE MVP");
  });
  it("keeps identical round numbers phase-aware inside one Tournament", async () => {
    reports.read.mockResolvedValue([
      game("runbasket", "LEAGUE ROOT MVP", 20, 20),
      game("runbasket_league_final", "LEAGUE FINAL MVP", 30, 30),
    ]);
    const result = await readPublicCompetitionStatisticsForOrganizationWithDb(database().binding, "organization_runbasket", { tournamentSlug: "league" });
    expect(result.statistics?.matchdays.map((entry) => [entry.id, entry.mvp?.player.displayName, entry.topPerformance?.player.displayName])).toEqual([
      ["phase_runbasket-round-1", "LEAGUE ROOT MVP", "LEAGUE ROOT MVP"],
      ["phase_runbasket_league_final-round-1", "LEAGUE FINAL MVP", "LEAGUE FINAL MVP"],
    ]);
  });
});
