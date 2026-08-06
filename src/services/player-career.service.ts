import "server-only";

import { players } from "@/data/players";
import { teams } from "@/data/teams";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { findAutomaticPlayerMatch, normalizePlayerName } from "@/lib/player-matching";
import { getPlayerStats } from "@/services/player-stats.service";
import type { PlayerCareer, PlayerCareerSeason } from "@/types/league";

type DbPlayer = { id: string; slug: string; display_name: string };
type DbCareerRow = {
  season: string;
  team: string;
  competition: string | null;
  status: "active" | "departed" | "transferred";
};
type DbStatRow = {
  season: string;
  team: string;
  competition: string;
  games: number;
  points: number;
  rebounds: number;
  assists: number;
  steals: number;
  blocks: number;
  threes: number;
};

const emptyTotals = () => ({
  games: 0, points: 0, rebounds: 0, assists: 0,
  steals: 0, blocks: 0, threes: 0,
});

function withTotals(playerId: string, slug: string, name: string, seasons: PlayerCareerSeason[]): PlayerCareer {
  const totals = seasons.reduce((sum, season) => ({
    games: sum.games + season.games,
    points: sum.points + season.points,
    rebounds: sum.rebounds + season.rebounds,
    assists: sum.assists + season.assists,
    steals: sum.steals + season.steals,
    blocks: sum.blocks + season.blocks,
    threes: sum.threes + season.threes,
  }), emptyTotals());
  return { playerId, slug, name, seasons, totals };
}

async function fromDatabase(slug: string): Promise<PlayerCareer | null> {
  const env = await getKomoBasketCloudflareEnv();
  const db = env?.NEWS_DB;
  if (!db) return null;

  try {
    const player = await db.prepare(`SELECT DISTINCT p.id,p.slug,p.display_name
      FROM league_players p
      LEFT JOIN league_legacy_player_refs l ON l.player_id=p.id
      WHERE p.slug=? OR l.legacy_slug=? LIMIT 1`)
      .bind(slug, slug).first<DbPlayer>();
    if (!player) return null;

    const careerResult = await db.prepare(`SELECT s.name AS season,t.name AS team,
      c.name AS competition,r.status
      FROM league_roster_memberships r
      JOIN league_seasons s ON s.id=r.season_id
      JOIN league_teams t ON t.id=r.team_id
      LEFT JOIN league_competitions c ON c.id=r.competition_id
      WHERE r.player_id=? ORDER BY s.name DESC,r.created_at`)
      .bind(player.id).all<DbCareerRow>();
    const statResult = await db.prepare(`SELECT s.name AS season,t.name AS team,c.name AS competition,
      COUNT(DISTINCT ps.game_id) AS games,SUM(ps.points) AS points,SUM(ps.rebounds) AS rebounds,
      SUM(ps.assists) AS assists,SUM(ps.steals) AS steals,SUM(ps.blocks) AS blocks,SUM(ps.threes) AS threes
      FROM league_player_game_stats ps
      JOIN league_games g ON g.id=ps.game_id
      JOIN league_competitions c ON c.id=g.competition_id
      JOIN league_seasons s ON s.id=c.season_id
      JOIN league_teams t ON t.id=ps.team_id
      WHERE ps.player_id=? GROUP BY s.id,t.id,c.id`)
      .bind(player.id).all<DbStatRow>();

    const stats = new Map((statResult.results ?? []).map((row) => [
      `${row.season}|${row.team}|${row.competition}`,
      row,
    ]));
    const seasons = (careerResult.results ?? []).map((row) => {
      const competition = row.competition ?? "KomoBasket League";
      const stat = stats.get(`${row.season}|${row.team}|${competition}`);
      return {
        season: row.season, team: row.team, competition, status: row.status,
        games: Number(stat?.games ?? 0), points: Number(stat?.points ?? 0),
        rebounds: Number(stat?.rebounds ?? 0), assists: Number(stat?.assists ?? 0),
        steals: Number(stat?.steals ?? 0), blocks: Number(stat?.blocks ?? 0),
        threes: Number(stat?.threes ?? 0),
      } satisfies PlayerCareerSeason;
    });
    return withTotals(player.id, player.slug, player.display_name, seasons);
  } catch {
    return null;
  }
}

function fromHistoricalFiles(slug: string): PlayerCareer | null {
  const selected = players.find((player) => player.slug === slug);
  if (!selected) return null;

  const canonicalName = normalizePlayerName(selected.name);
  const related = players.filter((player) => {
    if (normalizePlayerName(player.name) === canonicalName) return true;
    const match = findAutomaticPlayerMatch(player.name, [{ displayName: selected.name }]);
    return Boolean(match && match.confidence >= 0.88);
  });

  const unique = new Map<string, PlayerCareerSeason>();
  for (const player of related) {
    const team = teams.find((entry) => entry.slug === player.teamSlug && entry.season === player.season);
    const stat = getPlayerStats(player.slug);
    const key = `${player.season}|${team?.name ?? "—"}`;
    if (!unique.has(key)) {
      unique.set(key, {
        season: player.season,
        team: team?.name ?? "—",
        competition: "KomoBasket League",
        status: "active",
        games: stat?.games ?? 0,
        points: stat?.points ?? 0,
        rebounds: stat?.rebounds ?? 0,
        assists: stat?.assists ?? 0,
        steals: stat?.steals ?? 0,
        blocks: stat?.blocks ?? 0,
        threes: stat?.threes ?? 0,
      });
    }
  }
  return withTotals(selected.slug, selected.slug, selected.name, [...unique.values()].sort((a, b) => b.season.localeCompare(a.season)));
}

export async function getPlayerCareerBySlug(slug: string): Promise<PlayerCareer | null> {
  return (await fromDatabase(slug)) ?? fromHistoricalFiles(slug);
}
