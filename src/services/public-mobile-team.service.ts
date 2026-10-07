import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { aggregateLine, ZERO_STATISTICS } from "@/lib/public-team-statistics";
import { normalizeOptionalJerseyNumber } from "@/lib/jersey-number";
import { readMobileCompetitionWithDb, type CompetitionSummary } from "@/services/public-mobile-catalogue.service";
import { readCompetitionDetailWithDb, readStandingsWithDb } from "@/services/public-mobile-competition.service";
import { readAuthoritativePhaseStatisticalGamesWithDb } from "@/services/platform-match-report.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export type MobileTeamSummary = { id: string; name: string; logoUrl: string | null };
export type MobileRosterPlayer = {
  playerId: string;
  playerName: string;
  photoUrl: string | null;
  jerseyNumber: string | null;
};
export type MobileTeamDetail = MobileTeamSummary & {
  organizationId: string;
  competitionId: string;
  seasonId: string;
  overview: {
    currentPhaseId: string | null;
    standings: { phaseId: string; rank: number; gamesPlayed: number; wins: number; losses: number } | null;
  };
  roster: MobileRosterPlayer[];
};
export type MobileTeamTotals = {
  pointsScored: number;
  pointsAllowed: number;
  twoPointMade: number;
  twoPointAttempts: number;
  threePointMade: number;
  threePointAttempts: number;
  freeThrowMade: number;
  freeThrowAttempts: number;
  offensiveRebounds: number;
  defensiveRebounds: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  turnovers: number;
  fouls: number;
};
export type MobileTeamStatistics = {
  teamId: string;
  competitionId: string;
  phaseIds: string[];
  gamesPlayed: number;
  totals: MobileTeamTotals;
  perGame: MobileTeamTotals;
  shooting: {
    twoPoint: { made: number; attempted: number; percentage: number | null };
    threePoint: { made: number; attempted: number; percentage: number | null };
    freeThrow: { made: number; attempted: number; percentage: number | null };
  };
};

export class MobileTeamError extends Error {
  constructor(readonly code: "COMPETITION_NOT_FOUND" | "TEAM_NOT_FOUND" | "PHASE_NOT_FOUND" | "TOURNAMENT_NOT_FOUND" | "INVALID_PHASES" | "TEAM_DATA_UNAVAILABLE") {
    super(code);
  }
}

type TeamRow = { id: string; name: string; logo_url: string | null };
type RosterRow = { id: string; display_name: string; photo_url: string | null; shirt_number: string | null };
type PhaseRow = { id: string };
const MAX_TEAMS = 200;
const MAX_ROSTER = 500;

async function publicCompetition(db: D1DatabaseBinding, competitionId: string): Promise<CompetitionSummary> {
  const competition = await readMobileCompetitionWithDb(db, competitionId);
  if (!competition) throw new MobileTeamError("COMPETITION_NOT_FOUND");
  return competition;
}

async function participatingTeams(db: D1DatabaseBinding, competition: CompetitionSummary, teamId?: string): Promise<TeamRow[]> {
  const result = await db.prepare(`
    SELECT t.id, COALESCE(NULLIF(TRIM(st.display_name),''),t.name) AS name,
           NULLIF(TRIM(t.logo_url),'') AS logo_url
      FROM league_competition_teams ct
      JOIN league_season_teams st ON st.id=ct.season_team_id AND st.season_id=?
      JOIN league_teams t ON t.id=st.team_id AND t.organization_id=?
     WHERE ct.competition_id=? AND ct.status='active' ${teamId ? "AND t.id=?" : ""}
     ORDER BY name COLLATE NOCASE,t.id LIMIT ?
  `).bind(competition.seasonId, competition.organizationId, competition.id,
    ...(teamId ? [teamId] : []), teamId ? 1 : MAX_TEAMS + 1).all<TeamRow>();
  const rows = result.results ?? [];
  if (rows.length > MAX_TEAMS) throw new MobileTeamError("TEAM_DATA_UNAVAILABLE");
  return rows;
}

async function publicTeam(db: D1DatabaseBinding, competition: CompetitionSummary, teamId: string): Promise<TeamRow> {
  const team = (await participatingTeams(db, competition, teamId))[0];
  if (!team) throw new MobileTeamError("TEAM_NOT_FOUND");
  return team;
}

export async function listMobileTeamsWithDb(db: D1DatabaseBinding, competitionId: string): Promise<MobileTeamSummary[]> {
  const competition = await publicCompetition(db, competitionId);
  const teams = await participatingTeams(db, competition);
  return teams.map((team) => ({ id: team.id, name: team.name, logoUrl: team.logo_url }));
}

export async function readMobileTeamWithDb(
  db: D1DatabaseBinding,
  competitionId: string,
  teamId: string,
  rootPhaseId?: string,
): Promise<MobileTeamDetail> {
  const competition = await publicCompetition(db, competitionId);
  const team = await publicTeam(db, competition, teamId);
  // Match the Platform/B1 current-membership rule: latest active membership in this season and competition.
  const [rosterResult, detail] = await Promise.all([
    db.prepare(`
      WITH current_membership AS (
        SELECT r.player_id, r.team_id, r.shirt_number,
               ROW_NUMBER() OVER (
                 PARTITION BY r.player_id
                 ORDER BY r.joined_on DESC, r.updated_at DESC, r.id DESC
               ) AS membership_rank
          FROM league_roster_memberships r
         WHERE r.season_id=? AND r.competition_id=? AND r.status='active'
      )
      SELECT p.id, p.display_name, NULLIF(TRIM(p.photo_url),'') AS photo_url,
             r.shirt_number
        FROM current_membership r
        JOIN league_players p ON p.id=r.player_id AND p.organization_id=?
       WHERE r.membership_rank=1 AND r.team_id=?
       ORDER BY CASE WHEN r.shirt_number IS NULL THEN 1 ELSE 0 END,
                CASE WHEN r.shirt_number='0' THEN 0 WHEN r.shirt_number='00' THEN 1 ELSE CAST(r.shirt_number AS INTEGER)+1 END,
                p.display_name COLLATE NOCASE,p.id
       LIMIT ?
    `).bind(competition.seasonId, competition.id, competition.organizationId, team.id, MAX_ROSTER + 1).all<RosterRow>(),
    readCompetitionDetailWithDb(db, competition.id),
  ]);
  const rosterRows = rosterResult.results ?? [];
  if (rosterRows.length > MAX_ROSTER) throw new MobileTeamError("TEAM_DATA_UNAVAILABLE");
  const group = rootPhaseId ? detail.tournamentGroups.find((item) => item.id === rootPhaseId) : null;
  if (rootPhaseId && !group) throw new MobileTeamError("TOURNAMENT_NOT_FOUND");
  const currentPhaseId = group ? group.currentPhaseId : detail.currentPhaseId;
  const currentPhase = detail.phases.find((phase) => phase.id === currentPhaseId);
  const standing = currentPhase?.availableViews.includes("standings")
    ? (await readStandingsWithDb(db, competition.id, currentPhase.id)).find((row) => row.teamId === team.id)
    : undefined;
  return {
    id: team.id, name: team.name, logoUrl: team.logo_url,
    organizationId: competition.organizationId, competitionId: competition.id, seasonId: competition.seasonId,
    overview: {
      currentPhaseId,
      standings: currentPhase && standing ? {
        phaseId: currentPhase.id, rank: standing.rank, gamesPlayed: standing.gamesPlayed,
        wins: standing.wins, losses: standing.losses,
      } : null,
    },
    roster: rosterRows.map((row) => ({
      playerId: row.id, playerName: row.display_name, photoUrl: row.photo_url, jerseyNumber: normalizeOptionalJerseyNumber(row.shirt_number),
    })),
  };
}

function canonicalPhaseIds(phaseIds: readonly string[]): string[] {
  const canonical = [...new Set(phaseIds)].sort();
  if (!canonical.length || canonical.length > 12 || canonical.some((id) => !id || id.length > 200)) {
    throw new MobileTeamError("INVALID_PHASES");
  }
  return canonical;
}

function shooting(made: number, attempted: number) {
  return { made, attempted, percentage: attempted === 0 ? null : made / attempted * 100 };
}

function perGame(totals: MobileTeamTotals, gamesPlayed: number): MobileTeamTotals {
  return Object.fromEntries(Object.entries(totals).map(([key, value]) =>
    [key, gamesPlayed ? value / gamesPlayed : 0])) as MobileTeamTotals;
}

export async function readMobileTeamStatisticsWithDb(
  db: D1DatabaseBinding,
  competitionId: string,
  teamId: string,
  selectedPhaseIds: readonly string[],
): Promise<MobileTeamStatistics> {
  const competition = await publicCompetition(db, competitionId);
  await publicTeam(db, competition, teamId);
  const phaseIds = canonicalPhaseIds(selectedPhaseIds);
  const phases = await db.prepare(`SELECT id FROM league_phases
    WHERE competition_id=? AND lifecycle_status IN ('active','finalized')
      AND id IN (SELECT value FROM json_each(?))`)
    .bind(competition.id, JSON.stringify(phaseIds)).all<PhaseRow>();
  if ((phases.results ?? []).length !== phaseIds.length) throw new MobileTeamError("PHASE_NOT_FOUND");

  const games = await readAuthoritativePhaseStatisticalGamesWithDb(
    db, competition.id, competition.organizationId, phaseIds, teamId,
  );
  const seenGames = new Set<string>();
  let gamesPlayed = 0;
  let pointsScored = 0;
  let pointsAllowed = 0;
  let line = { ...ZERO_STATISTICS };
  for (const game of games) {
    if (seenGames.has(game.gameId)) continue;
    seenGames.add(game.gameId);
    const isHome = game.homeTeamId === teamId;
    const isAway = game.awayTeamId === teamId;
    if (isHome === isAway) throw new MobileTeamError("TEAM_DATA_UNAVAILABLE");
    gamesPlayed++;
    pointsScored += isHome ? game.homeScore : game.awayScore;
    pointsAllowed += isHome ? game.awayScore : game.homeScore;
    line = aggregateLine(line, isHome ? game.homeTeamStatistics : game.awayTeamStatistics);
  }
  const totals: MobileTeamTotals = {
    pointsScored, pointsAllowed,
    twoPointMade: line.twoPointMade, twoPointAttempts: line.twoPointAttempts,
    threePointMade: line.threePointMade, threePointAttempts: line.threePointAttempts,
    freeThrowMade: line.freeThrowMade, freeThrowAttempts: line.freeThrowAttempts,
    offensiveRebounds: line.offensiveRebounds, defensiveRebounds: line.defensiveRebounds,
    rebounds: line.rebounds, assists: line.assists, steals: line.steals, blocks: line.blocks,
    turnovers: line.turnovers, fouls: line.fouls,
  };
  return {
    teamId, competitionId: competition.id, phaseIds, gamesPlayed, totals, perGame: perGame(totals, gamesPlayed),
    shooting: {
      twoPoint: shooting(line.twoPointMade, line.twoPointAttempts),
      threePoint: shooting(line.threePointMade, line.threePointAttempts),
      freeThrow: shooting(line.freeThrowMade, line.freeThrowAttempts),
    },
  };
}

async function mobileDb(): Promise<D1DatabaseBinding> {
  const db = (await getKomoBasketCloudflareEnv())?.NEWS_DB;
  if (!db) throw new MobileTeamError("TEAM_DATA_UNAVAILABLE");
  return db;
}

export async function listMobileTeams(competitionId: string) {
  return listMobileTeamsWithDb(await mobileDb(), competitionId);
}

export async function readMobileTeam(competitionId: string, teamId: string, rootPhaseId?: string) {
  return readMobileTeamWithDb(await mobileDb(), competitionId, teamId, rootPhaseId);
}

export async function readMobileTeamStatistics(competitionId: string, teamId: string, phaseIds: readonly string[]) {
  return readMobileTeamStatisticsWithDb(await mobileDb(), competitionId, teamId, phaseIds);
}
