import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { readMobileCompetitionWithDb } from "@/services/public-mobile-catalogue.service";
import { readAuthoritativePhaseStatisticalGamesWithDb } from "@/services/platform-match-report.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export type MobileOfficialMvp = {
  id: string;
  competitionId: string;
  phaseId: string;
  round: number;
  gameId: string;
  player: { id: string; name: string; photoUrl: string | null };
  team: { id: string; name: string; logoUrl: string | null } | null;
  performance: { points: number; rebounds: number; assists: number; efficiency: number } | null;
  selectedAt: string;
};
export type MobileOfficialMvpResponse = { data: MobileOfficialMvp | null };
export type MobileOfficialMvpInput = { competitionId: string; phaseId: string; round: number };

export class MobileOfficialMvpError extends Error {
  constructor(readonly code: "CONTEXT_NOT_FOUND" | "INVALID_ROUND" | "DATABASE_UNAVAILABLE") {
    super(code);
  }
}

type RoundRow = { id: string };
type SelectionRow = {
  id: string; game_id: string; player_id: string; player_name: string; player_photo_url: string | null;
  home_team_id: string; home_team_name: string; home_logo_url: string | null;
  away_team_id: string; away_team_name: string; away_logo_url: string | null;
  selected_at: string;
};

export async function readMobileOfficialMvpWithDb(
  db: D1DatabaseBinding,
  input: MobileOfficialMvpInput,
): Promise<MobileOfficialMvpResponse> {
  if (!Number.isInteger(input.round) || input.round < 1 || input.round > 10000) {
    throw new MobileOfficialMvpError("INVALID_ROUND");
  }
  const competition = await readMobileCompetitionWithDb(db, input.competitionId);
  if (!competition) throw new MobileOfficialMvpError("CONTEXT_NOT_FOUND");

  // The Platform selects official MVPs only for standings-format matchdays.
  const round = await db.prepare(`SELECT phase.id FROM league_phases phase
    WHERE phase.id=? AND phase.competition_id=? AND phase.format='standings'
      AND phase.lifecycle_status IN ('active','finalized')
      AND EXISTS (SELECT 1 FROM league_games game
        WHERE game.competition_id=phase.competition_id AND game.phase_id=phase.id
          AND game.round_number=? AND game.status IN ('scheduled','completed'))`)
    .bind(input.phaseId, competition.id, input.round).first<RoundRow>();
  if (!round) throw new MobileOfficialMvpError("CONTEXT_NOT_FOUND");

  const selection = await db.prepare(`SELECT selection.id, selection.game_id, selection.player_id,
      player.display_name AS player_name, NULLIF(TRIM(player.photo_url),'') AS player_photo_url,
      home.id AS home_team_id, home.name AS home_team_name, NULLIF(TRIM(home.logo_url),'') AS home_logo_url,
      away.id AS away_team_id, away.name AS away_team_name, NULLIF(TRIM(away.logo_url),'') AS away_logo_url,
      selection.updated_at AS selected_at
    FROM league_matchday_mvp_selections selection
    JOIN league_games game ON game.id=selection.game_id AND game.competition_id=?
      AND game.phase_id=? AND game.round_number=? AND game.status='completed'
    JOIN league_players player ON player.id=selection.player_id AND player.organization_id=?
    JOIN league_teams home ON home.id=game.home_team_id AND home.organization_id=?
    JOIN league_teams away ON away.id=game.away_team_id AND away.organization_id=?
    WHERE selection.organization_id=? AND selection.competition_id=?
      AND selection.phase_id=? AND selection.round_number=?
    LIMIT 1`)
    .bind(competition.id, input.phaseId, input.round, competition.organizationId,
      competition.organizationId, competition.organizationId, competition.organizationId,
      competition.id, input.phaseId, input.round).first<SelectionRow>();
  if (!selection) return { data: null };

  // A missing or invalid finalized report removes only the optional performance, not the stored official choice.
  const games = await readAuthoritativePhaseStatisticalGamesWithDb(
    db, competition.id, competition.organizationId, [input.phaseId], null, selection.game_id,
  );
  const game = games.find((candidate) => candidate.gameId === selection.game_id);
  const homeLine = game?.homePlayers.find((player) => player.canonicalPlayerId === selection.player_id);
  const awayLine = game?.awayPlayers.find((player) => player.canonicalPlayerId === selection.player_id);
  const side = homeLine && !awayLine ? "home" : awayLine && !homeLine ? "away" : null;
  const line = side === "home" ? homeLine : side === "away" ? awayLine : null;
  const team = side === "home" ? {
    id: selection.home_team_id, name: selection.home_team_name, logoUrl: selection.home_logo_url,
  } : side === "away" ? {
    id: selection.away_team_id, name: selection.away_team_name, logoUrl: selection.away_logo_url,
  } : null;
  return { data: {
    id: selection.id, competitionId: competition.id, phaseId: input.phaseId,
    round: input.round, gameId: selection.game_id,
    player: { id: selection.player_id, name: selection.player_name, photoUrl: selection.player_photo_url },
    team,
    performance: line ? {
      points: line.statistics.points, rebounds: line.statistics.rebounds,
      assists: line.statistics.assists, efficiency: line.statistics.efficiency,
    } : null,
    selectedAt: selection.selected_at,
  } };
}

export async function readMobileOfficialMvp(input: MobileOfficialMvpInput): Promise<MobileOfficialMvpResponse> {
  const db = (await getKomoBasketCloudflareEnv())?.NEWS_DB;
  if (!db) throw new MobileOfficialMvpError("DATABASE_UNAVAILABLE");
  return readMobileOfficialMvpWithDb(db, input);
}
