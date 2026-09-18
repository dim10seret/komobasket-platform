import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { CANONICAL_PUBLIC_SEASON_START } from "@/services/public-competition.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export type PublicTeamRosterScope = {
  organizationId: string;
  seasonId: string;
  competitionId: string;
  teamId: string;
};

export type PublicRosterPlayer = {
  id: string;
  displayName: string;
  shirtNumber: number | null;
};

export type PublicTeamRoster = {
  logoUrl: string | null;
  players: PublicRosterPlayer[];
};

type RosterRow = {
  logo_url: string | null;
  player_id: string | null;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  shirt_number: number | null;
};

export async function getPublicTeamRosterWithDb(
  db: D1DatabaseBinding,
  scope: PublicTeamRosterScope,
): Promise<PublicTeamRoster | null> {
  const result = await db.prepare(`
    SELECT NULLIF(TRIM(t.logo_url), '') AS logo_url,
           p.id AS player_id, p.first_name, p.last_name, p.display_name, r.shirt_number
      FROM league_competition_teams ct
      JOIN league_competitions c ON c.id=ct.competition_id
      JOIN league_seasons s ON s.id=c.season_id
      JOIN league_season_teams st ON st.id=ct.season_team_id AND st.season_id=s.id
      JOIN league_teams t ON t.id=st.team_id AND t.organization_id=c.organization_id
      LEFT JOIN league_competition_publication cp ON cp.competition_id=c.id
      LEFT JOIN league_roster_memberships r
        ON r.team_id=t.id AND r.season_id=s.id AND r.competition_id=c.id AND r.status='active'
      LEFT JOIN league_players p ON p.id=r.player_id AND p.organization_id=c.organization_id
     WHERE c.organization_id=? AND s.id=? AND c.id=? AND t.id=? AND ct.status='active'
       AND s.starts_on>=? AND s.status IN ('active','completed')
       AND COALESCE(cp.lifecycle_status,
         CASE c.status WHEN 'active' THEN 'online' WHEN 'completed' THEN 'complete' ELSE 'under_construction' END
       ) IN ('online','complete')
     ORDER BY CASE WHEN r.shirt_number IS NULL THEN 1 ELSE 0 END,
              r.shirt_number ASC, p.display_name COLLATE NOCASE, p.id
  `).bind(scope.organizationId, scope.seasonId, scope.competitionId, scope.teamId, CANONICAL_PUBLIC_SEASON_START).all<RosterRow>();
  const rows = result.results ?? [];
  if (rows.length === 0) return null;
  return {
    logoUrl: rows[0].logo_url,
    players: rows.flatMap((row): PublicRosterPlayer[] => {
      if (!row.player_id) return [];
      const firstName = row.first_name?.trim();
      const lastName = row.last_name?.trim();
      return [{
        id: row.player_id,
        displayName: firstName && lastName ? `${firstName} ${lastName}` : row.display_name?.trim() || "",
        shirtNumber: row.shirt_number,
      }];
    }),
  };
}

export async function getPublicTeamRoster(scope: PublicTeamRosterScope): Promise<PublicTeamRoster | null> {
  const env = await getKomoBasketCloudflareEnv();
  if (!env?.NEWS_DB) throw new Error("Public roster database unavailable");
  return getPublicTeamRosterWithDb(env.NEWS_DB, scope);
}
