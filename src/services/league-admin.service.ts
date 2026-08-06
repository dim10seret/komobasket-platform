import "server-only";

import regularGames2024 from "@/data/games-2024-25.json";
import regularGames2025 from "@/data/games-2025-26.json";
import { players as legacyPlayers } from "@/data/players";
import { cupGames, playoffGames, playoffSeries } from "@/data/postseason-2024-25";
import {
  finalFour2025,
  playoffSeries2025,
  stratosMylonasCup2025,
} from "@/data/postseason-2025-26";
import { teams as legacyTeams } from "@/data/teams";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import {
  createEntityId,
  findAutomaticPlayerMatch,
  normalizePlayerName,
} from "@/lib/player-matching";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

const HISTORICAL_SEASONS = [
  "2019-20",
  "2021-22",
  "2022-23",
  "2023-24",
  "2024-25",
  "2025-26",
];

type DbRow = Record<string, unknown>;

type HistoricalGame = {
  id: string;
  stage: string;
  homeTeam: string;
  awayTeam: string;
  homeScore?: number;
  awayScore?: number;
  date?: string;
  time?: string;
  venue?: string;
  round?: number | string;
  label?: string;
  note?: string;
};

async function database() {
  const env = await getKomoBasketCloudflareEnv();
  return env?.NEWS_DB ?? null;
}

async function rows<T = DbRow>(db: D1DatabaseBinding, sql: string, values: unknown[] = []) {
  const result = await db.prepare(sql).bind(...values).all<T>();
  return result.results ?? [];
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("el-GR")
    .replace(/[^a-z0-9α-ω]+/g, "-")
    .replace(/^-|-$/g, "");
}

function baseTeamSlug(season: string, slug: string) {
  return slug.startsWith(`${season}-`) ? slug.slice(season.length + 1) : slug;
}

function historicalGameId(season: string, competition: string, externalId: string) {
  return `game_${season.replace(/[^0-9]/g, "")}_${competition}_${slugify(externalId)}`;
}

export async function getLeagueAdminSnapshot() {
  const db = await database();
  if (!db) {
    return {
      mode: "preview" as const,
      seasons: HISTORICAL_SEASONS.map((name) => ({
        id: `season_${name}`, name, slug: name, status: "completed",
      })),
      competitions: HISTORICAL_SEASONS.map((season) => ({
        id: `competition_${season}_league`, season_id: `season_${season}`,
        season_name: season, name: "KomoBasket League", slug: "komobasket-league", type: "league", status: "completed",
      })),
      teams: legacyTeams.map((team) => ({
        id: `team_${baseTeamSlug(team.season, team.slug)}`, name: team.name,
        slug: baseTeamSlug(team.season, team.slug), city: team.city, logo_url: team.logo, active: 1,
      })),
      players: legacyPlayers.slice(0, 100).map((player) => ({
        id: `preview_${player.slug}`, slug: player.slug, display_name: player.name,
        normalized_name: normalizePlayerName(player.name), active: 1,
      })),
      participations: [], rosters: [], movements: [], phases: [], games: [],
      counts: {
        seasons: HISTORICAL_SEASONS.length,
        competitions: HISTORICAL_SEASONS.length,
        teams: legacyTeams.length,
        players: legacyPlayers.length,
      },
    };
  }

  const [seasons, competitions, teams, participations, players, rosters, movements, phases, games] = await Promise.all([
    rows(db, "SELECT * FROM league_seasons ORDER BY name DESC"),
    rows(db, `SELECT c.*, s.name AS season_name FROM league_competitions c JOIN league_seasons s ON s.id=c.season_id ORDER BY s.name DESC, c.name`),
    rows(db, "SELECT * FROM league_teams ORDER BY name"),
    rows(db, `SELECT st.id, st.season_id, st.team_id, st.display_name, st.logo_url,
      s.name AS season_name, t.name AS team_name,
      GROUP_CONCAT(c.name, ', ') AS competition_names
      FROM league_season_teams st
      JOIN league_seasons s ON s.id=st.season_id
      JOIN league_teams t ON t.id=st.team_id
      LEFT JOIN league_competition_teams ct ON ct.season_team_id=st.id
      LEFT JOIN league_competitions c ON c.id=ct.competition_id
      GROUP BY st.id ORDER BY s.name DESC, st.display_name`),
    rows(db, "SELECT * FROM league_players ORDER BY display_name LIMIT 1000"),
    rows(db, `SELECT r.*, p.display_name AS player_name, t.name AS team_name, s.name AS season_name FROM league_roster_memberships r JOIN league_players p ON p.id=r.player_id JOIN league_teams t ON t.id=r.team_id JOIN league_seasons s ON s.id=r.season_id ORDER BY s.name DESC, t.name, p.display_name LIMIT 2000`),
    rows(db, `SELECT m.*, p.display_name AS player_name, ft.name AS from_team_name, tt.name AS to_team_name FROM league_player_movements m JOIN league_players p ON p.id=m.player_id LEFT JOIN league_teams ft ON ft.id=m.from_team_id LEFT JOIN league_teams tt ON tt.id=m.to_team_id ORDER BY m.effective_on DESC LIMIT 500`),
    rows(db, `SELECT p.*, c.name AS competition_name FROM league_phases p JOIN league_competitions c ON c.id=p.competition_id ORDER BY c.name, p.order_index`),
    rows(db, `SELECT g.*, ht.name AS home_team_name, at.name AS away_team_name, p.name AS phase_name FROM league_games g JOIN league_teams ht ON ht.id=g.home_team_id JOIN league_teams at ON at.id=g.away_team_id LEFT JOIN league_phases p ON p.id=g.phase_id ORDER BY COALESCE(g.scheduled_at,'9999') DESC LIMIT 1000`),
  ]);

  return {
    mode: "database" as const, seasons, competitions, teams, participations, players, rosters,
    movements, phases, games,
    counts: {
      seasons: seasons.length, competitions: competitions.length,
      teams: teams.length, players: players.length,
    },
  };
}

export async function createLeagueEntity(resource: string, input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η αποθήκευση διοργανώσεων είναι διαθέσιμη στη βάση D1 μετά την εγκατάσταση.");
  const id = createEntityId(resource.replace(/s$/, ""));
  const now = new Date().toISOString();

  if (resource === "seasons") {
    const name = String(input.name ?? "").trim();
    await db.prepare(`INSERT INTO league_seasons (id,name,slug,starts_on,ends_on,status) VALUES (?,?,?,?,?,?)`)
      .bind(id, name, String(input.slug || slugify(name)), input.startsOn || null, input.endsOn || null, input.status || "draft").run();
  } else if (resource === "competitions") {
    const name = String(input.name ?? "").trim();
    await db.prepare(`INSERT INTO league_competitions (id,season_id,name,slug,type,description,status) VALUES (?,?,?,?,?,?,?)`)
      .bind(id, input.seasonId, name, String(input.slug || slugify(name)), input.type || "league", input.description || "", input.status || "draft").run();
  } else if (resource === "teams") {
    const name = String(input.name ?? "").trim();
    await db.prepare(`INSERT INTO league_teams (id,name,slug,city,logo_url,active) VALUES (?,?,?,?,?,1)`)
      .bind(id, name, String(input.slug || slugify(name)), input.city || "Κομοτηνή", input.logoUrl || null).run();
  } else if (resource === "participations") {
    const seasonId = String(input.seasonId ?? "");
    const teamId = String(input.teamId ?? "");
    if (!seasonId || !teamId) throw new Error("Η σεζόν και η ομάδα είναι υποχρεωτικές.");
    const existingSeasonTeam = await db.prepare(
      "SELECT id FROM league_season_teams WHERE season_id=? AND team_id=?",
    ).bind(seasonId, teamId).first<{ id: string }>();
    const seasonTeamId = existingSeasonTeam?.id ?? id;
    if (!existingSeasonTeam) {
      const team = await db.prepare("SELECT name,logo_url FROM league_teams WHERE id=?")
        .bind(teamId).first<{ name: string; logo_url: string | null }>();
      if (!team) throw new Error("Δεν βρέθηκε η ομάδα.");
      await db.prepare(`INSERT INTO league_season_teams
        (id,season_id,team_id,display_name,logo_url) VALUES (?,?,?,?,?)`)
        .bind(seasonTeamId, seasonId, teamId, input.displayName || team.name, input.logoUrl || team.logo_url).run();
    }
    if (input.competitionId) {
      await db.prepare(`INSERT OR IGNORE INTO league_competition_teams
        (id,competition_id,season_team_id,seed,status) VALUES (?,?,?,?,'active')`)
        .bind(createEntityId("entry"), input.competitionId, seasonTeamId, input.seed || null).run();
    }
  } else if (resource === "players") {
    const name = String(input.displayName ?? "").trim();
    const existing = await rows<{ id: string; display_name: string }>(db, "SELECT id,display_name FROM league_players");
    const match = findAutomaticPlayerMatch(name, existing.map((row) => ({ id: row.id, displayName: row.display_name })));
    if (match) {
      await db.prepare(`INSERT OR IGNORE INTO league_player_aliases (id,player_id,alias,normalized_alias,source,confidence) VALUES (?,?,?,?,?,?)`)
        .bind(createEntityId("alias"), match.candidate.id, name, normalizePlayerName(name), "automatic", match.confidence).run();
      return { id: match.candidate.id, automaticallyMatched: true };
    }
    await db.prepare(`INSERT INTO league_players (id,slug,display_name,normalized_name,active) VALUES (?,?,?,?,1)`)
      .bind(id, String(input.slug || slugify(name)), name, normalizePlayerName(name)).run();
  } else if (resource === "rosters") {
    await addRosterMembership(db, id, input);
  } else if (resource === "phases") {
    const name = String(input.name ?? "").trim();
    await db.prepare(`INSERT INTO league_phases (id,competition_id,name,slug,phase_type,order_index) VALUES (?,?,?,?,?,?)`)
      .bind(id, input.competitionId, name, String(input.slug || slugify(name)), input.phaseType || "regular", Number(input.orderIndex || 0)).run();
  } else if (resource === "games") {
    await db.prepare(`INSERT INTO league_games (id,competition_id,phase_id,round_label,scheduled_at,venue,home_team_id,away_team_id,home_score,away_score,status) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, input.competitionId, input.phaseId || null, input.roundLabel || "", input.scheduledAt || null, input.venue || "", input.homeTeamId, input.awayTeamId, input.homeScore ?? null, input.awayScore ?? null, input.status || "scheduled").run();
  } else {
    throw new Error("Μη υποστηριζόμενη ενέργεια.");
  }

  await db.prepare(`INSERT INTO league_audit_log (id,actor_email,action,entity_type,entity_id,details_json,created_at) VALUES (?,?,?,?,?,?,?)`)
    .bind(createEntityId("audit"), actor, "create", resource, id, JSON.stringify(input), now).run();
  return { id, automaticallyMatched: false };
}

async function addRosterMembership(db: D1DatabaseBinding, id: string, input: Record<string, unknown>) {
  const seasonId = String(input.seasonId);
  const playerId = String(input.playerId);
  const teamId = String(input.teamId);
  const current = await db.prepare(`SELECT id,team_id FROM league_roster_memberships WHERE season_id=? AND player_id=? AND status='active' ORDER BY created_at DESC LIMIT 1`)
    .bind(seasonId, playerId).first<{ id: string; team_id: string }>();
  if (current && current.team_id !== teamId) {
    const date = String(input.joinedOn || new Date().toISOString().slice(0, 10));
    await db.prepare(`UPDATE league_roster_memberships SET status='transferred',left_on=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(date, current.id).run();
    await db.prepare(`INSERT INTO league_player_movements (id,player_id,season_id,from_team_id,to_team_id,movement_type,effective_on,note) VALUES (?,?,?,?,?,'transfer',?,?)`)
      .bind(createEntityId("movement"), playerId, seasonId, current.team_id, teamId, date, input.note || "").run();
  }
  await db.prepare(`INSERT INTO league_roster_memberships (id,season_id,competition_id,player_id,team_id,shirt_number,joined_on,status) VALUES (?,?,?,?,?,?,?,'active')`)
    .bind(id, seasonId, input.competitionId || null, playerId, teamId, input.shirtNumber ?? null, input.joinedOn || null).run();
  if (!current) {
    await db.prepare(`INSERT INTO league_player_movements (id,player_id,season_id,from_team_id,to_team_id,movement_type,effective_on,note) VALUES (?,?,?,?,?,'registration',?,?)`)
      .bind(createEntityId("movement"), playerId, seasonId, null, teamId, input.joinedOn || new Date().toISOString().slice(0, 10), input.note || "").run();
  }
}

export async function departPlayer(input: Record<string, unknown>, actor: string) {
  const db = await database();
  if (!db) throw new Error("Η βάση D1 δεν είναι διαθέσιμη.");
  const date = String(input.effectiveOn || new Date().toISOString().slice(0, 10));
  const roster = await db.prepare(`SELECT * FROM league_roster_memberships WHERE id=?`).bind(input.rosterId).first<{ id:string; player_id:string; season_id:string; team_id:string }>();
  if (!roster) throw new Error("Δεν βρέθηκε η εγγραφή ρόστερ.");
  await db.prepare(`UPDATE league_roster_memberships SET status='departed',left_on=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`).bind(date, roster.id).run();
  await db.prepare(`INSERT INTO league_player_movements (id,player_id,season_id,from_team_id,to_team_id,movement_type,effective_on,note) VALUES (?,?,?,?,?,'departure',?,?)`)
    .bind(createEntityId("movement"), roster.player_id, roster.season_id, roster.team_id, null, date, input.note || "").run();
  await db.prepare(`INSERT INTO league_audit_log (id,actor_email,action,entity_type,entity_id,details_json) VALUES (?,?,?,?,?,?)`)
    .bind(createEntityId("audit"), actor, "departure", "rosters", roster.id, JSON.stringify(input)).run();
  return { id: roster.id };
}

export async function migrateHistoricalLeagueData(actor: string) {
  const db = await database();
  if (!db) throw new Error("Η ιστορική μεταφορά εκτελείται μόνο στην εγκατεστημένη βάση D1.");
  const leagueDb: D1DatabaseBinding = db;
  const pendingStatements: D1PreparedStatement[] = [];

  async function flushStatements() {
    if (pendingStatements.length === 0) return;
    const statements = pendingStatements.splice(0, pendingStatements.length);
    await leagueDb.batch(statements);
  }

  async function queue(statement: D1PreparedStatement) {
    pendingStatements.push(statement);
    if (pendingStatements.length >= 40) await flushStatements();
  }

  for (const season of HISTORICAL_SEASONS) {
    const seasonId = `season_${season}`;
    const competitionId = `competition_${season}_league`;
    await queue(db.prepare(`INSERT OR IGNORE INTO league_seasons (id,name,slug,status) VALUES (?,?,?,'completed')`).bind(seasonId, season, season));
    await queue(db.prepare(`INSERT OR IGNORE INTO league_competitions (id,season_id,name,slug,type,status) VALUES (?,?,?,'komobasket-league','league','completed')`).bind(competitionId, seasonId, "KomoBasket League"));
  }

  const teamIds = new Map<string, string>();
  const teamsBySeason = new Map<string, { id: string; displayName: string; seasonTeamId: string }[]>();
  for (const team of legacyTeams) {
    const baseSlug = baseTeamSlug(team.season, team.slug);
    const teamId = `team_${baseSlug}`;
    teamIds.set(team.slug, teamId);
    await queue(db.prepare(`INSERT OR IGNORE INTO league_teams (id,name,slug,city,logo_url) VALUES (?,?,?,?,?)`).bind(teamId, team.name, baseSlug, team.city, team.logo));
    const seasonTeamId = `seasonteam_${team.season}_${baseSlug}`;
    const seasonCandidates = teamsBySeason.get(team.season) ?? [];
    seasonCandidates.push({ id: teamId, displayName: team.name, seasonTeamId });
    teamsBySeason.set(team.season, seasonCandidates);
    await queue(db.prepare(`INSERT OR IGNORE INTO league_season_teams (id,season_id,team_id,display_name,logo_url) VALUES (?,?,?,?,?)`).bind(seasonTeamId, `season_${team.season}`, teamId, team.name, team.logo));
    await queue(db.prepare(`INSERT OR IGNORE INTO league_competition_teams (id,competition_id,season_team_id) VALUES (?,?,?)`).bind(`entry_${team.season}_${baseSlug}`, `competition_${team.season}_league`, seasonTeamId));
  }

  const existing = await rows<{ id:string; display_name:string }>(db, "SELECT id,display_name FROM league_players");
  const candidates = existing.map((row) => ({ id: row.id, displayName: row.display_name }));
  let created = 0;
  let merged = 0;
  for (const player of legacyPlayers) {
    const match = findAutomaticPlayerMatch(player.name, candidates);
    let playerId: string;
    if (match) {
      playerId = match.candidate.id;
      merged += 1;
      await queue(db.prepare(`INSERT OR IGNORE INTO league_player_aliases (id,player_id,alias,normalized_alias,source,confidence) VALUES (?,?,?,?,?,?)`)
        .bind(`alias_${player.slug}`, playerId, player.name, normalizePlayerName(player.name), "historical-auto", match.confidence));
      await queue(db.prepare(`INSERT OR IGNORE INTO league_player_merge_log (id,kept_player_id,merged_player_id,merged_name,reason,confidence,snapshot_json) VALUES (?,?,?,?,?,?,?)`)
        .bind(`merge_${player.slug}`, playerId, player.slug, player.name, match.reason, match.confidence, JSON.stringify(player)));
    } else {
      playerId = `player_${player.slug}`;
      const slug = player.slug;
      await queue(db.prepare(`INSERT OR IGNORE INTO league_players (id,slug,display_name,normalized_name) VALUES (?,?,?,?)`).bind(playerId, slug, player.name, normalizePlayerName(player.name)));
      candidates.push({ id: playerId, displayName: player.name });
      created += 1;
    }
    await queue(db.prepare(`INSERT OR REPLACE INTO league_legacy_player_refs (legacy_slug,player_id,season_id) VALUES (?,?,?)`).bind(player.slug, playerId, `season_${player.season}`));
    const teamId = teamIds.get(player.teamSlug);
    if (teamId) {
      await queue(db.prepare(`INSERT OR IGNORE INTO league_roster_memberships (id,season_id,competition_id,player_id,team_id,shirt_number,status) VALUES (?,?,?,?,?,?, 'active')`)
        .bind(`roster_${player.slug}`, `season_${player.season}`, `competition_${player.season}_league`, playerId, teamId, player.number ?? null));
    }
  }

  const phaseIds = new Map<string, string>();
  const phaseOrder = new Map<string, number>();
  let skippedGames = 0;

  function resolveTeam(season: string, name: string) {
    const candidatesForSeason = teamsBySeason.get(season) ?? [];
    const exact = candidatesForSeason.find(
      (candidate) => normalizePlayerName(candidate.displayName) === normalizePlayerName(name),
    );
    if (exact) return exact;
    const match = findAutomaticPlayerMatch(name, candidatesForSeason);
    if (!match) return null;
    return candidatesForSeason.find((candidate) => candidate.id === match.candidate.id) ?? null;
  }

  async function ensureCompetition(season: string, kind: "league" | "cup") {
    if (kind === "league") return `competition_${season}_league`;
    const competitionId = `competition_${season}_cup`;
    const name = season === "2025-26" ? "Κύπελλο Στράτος Μυλωνά" : "KomoCup";
    await queue(leagueDb.prepare(`INSERT OR IGNORE INTO league_competitions
      (id,season_id,name,slug,type,status) VALUES (?,?,?,?,?,'completed')`)
      .bind(competitionId, `season_${season}`, name, slugify(name), "cup"));
    return competitionId;
  }

  async function ensurePhase(competitionId: string, stage: string) {
    const key = `${competitionId}:${stage}`;
    const existingId = phaseIds.get(key);
    if (existingId) return existingId;
    const phaseId = `phase_${slugify(competitionId)}_${slugify(stage)}`;
    const nextOrder = (phaseOrder.get(competitionId) ?? 0) + 1;
    phaseOrder.set(competitionId, nextOrder);
    phaseIds.set(key, phaseId);
    const phaseType = stage === "Κανονική περίοδος"
      ? "regular"
      : stage.toLocaleLowerCase("el-GR").includes("τελικό") || stage.toLocaleLowerCase("el-GR").includes("final")
        ? "finals"
        : "playoffs";
    await queue(leagueDb.prepare(`INSERT OR IGNORE INTO league_phases
      (id,competition_id,name,slug,phase_type,order_index) VALUES (?,?,?,?,?,?)`)
      .bind(phaseId, competitionId, stage, slugify(stage), phaseType, nextOrder));
    return phaseId;
  }

  async function importHistoricalGame(
    season: string,
    kind: "league" | "cup",
    game: HistoricalGame,
  ) {
    if (game.homeTeam === "Πρόκριση άνευ αγώνα" || game.awayTeam === "Πρόκριση άνευ αγώνα") {
      skippedGames += 1;
      return;
    }
    const homeTeam = resolveTeam(season, game.homeTeam);
    const awayTeam = resolveTeam(season, game.awayTeam);
    if (!homeTeam || !awayTeam) {
      skippedGames += 1;
      return;
    }
    const competitionId = await ensureCompetition(season, kind);
    const phaseId = await ensurePhase(competitionId, game.stage);
    for (const team of [homeTeam, awayTeam]) {
      await queue(leagueDb.prepare(`INSERT OR IGNORE INTO league_competition_teams
        (id,competition_id,season_team_id,status) VALUES (?,?,?,'active')`)
        .bind(`entry_${slugify(competitionId)}_${team.id}`, competitionId, team.seasonTeamId));
    }
    const hasScore = Number.isFinite(game.homeScore) && Number.isFinite(game.awayScore);
    const cancelled = Boolean(game.note?.toLocaleLowerCase("el-GR").includes("δεν διεξήχθη"));
    const scheduledAt = game.date
      ? `${game.date}T${game.time || "00:00"}:00`
      : null;
    const roundLabel = game.round !== undefined
      ? `${game.round}η Αγωνιστική`
      : game.label || game.stage;
    await queue(leagueDb.prepare(`INSERT OR IGNORE INTO league_games
      (id,competition_id,phase_id,round_label,scheduled_at,venue,home_team_id,away_team_id,
       home_score,away_score,status,external_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(
        historicalGameId(season, kind, game.id), competitionId, phaseId, roundLabel,
        scheduledAt, game.venue || "", homeTeam.id, awayTeam.id,
        game.homeScore ?? null, game.awayScore ?? null,
        cancelled ? "cancelled" : hasScore ? "completed" : "scheduled", game.id,
      ));
  }

  const regularSeasonImports: { season: string; games: HistoricalGame[] }[] = [
    { season: "2024-25", games: (regularGames2024 as unknown as HistoricalGame[]).map((game) => ({ ...game, stage: "Κανονική περίοδος" })) },
    { season: "2025-26", games: (regularGames2025 as unknown as HistoricalGame[]).map((game) => ({ ...game, stage: "Κανονική περίοδος" })) },
  ];
  for (const group of regularSeasonImports) {
    for (const game of group.games) await importHistoricalGame(group.season, "league", game);
  }

  const playoffGames2024: HistoricalGame[] = [
    ...playoffSeries.flatMap((series) => series.games
      .filter((game) => !game.label.includes("Κανονική περίοδος"))
      .map((game, index) => ({ ...game, id: `${series.id}-${index + 1}`, stage: series.stage }))),
    ...playoffGames.filter((game) => game.stage.startsWith("Final Four")),
  ];
  for (const game of playoffGames2024) await importHistoricalGame("2024-25", "league", game);
  for (const game of cupGames) await importHistoricalGame("2024-25", "cup", game);

  const playoffGames2025: HistoricalGame[] = [
    ...playoffSeries2025.flatMap((series) => series.games
      .filter((game) => !game.label?.includes("Κανονική περίοδος"))),
    ...finalFour2025.map((game) => ({ ...game, stage: `Final Four · ${game.stage}` })),
  ];
  for (const game of playoffGames2025) await importHistoricalGame("2025-26", "league", game);
  for (const game of stratosMylonasCup2025) await importHistoricalGame("2025-26", "cup", game);

  await flushStatements();

  const historicalCompetitionIds = [
    "competition_2024-25_league", "competition_2024-25_cup",
    "competition_2025-26_league", "competition_2025-26_cup",
  ];
  const placeholders = historicalCompetitionIds.map(() => "?").join(",");
  const gameCount = await db.prepare(
    `SELECT COUNT(*) AS total FROM league_games WHERE competition_id IN (${placeholders})`,
  ).bind(...historicalCompetitionIds).first<{ total: number }>();
  const phaseCount = await db.prepare(
    `SELECT COUNT(*) AS total FROM league_phases WHERE competition_id IN (${placeholders})`,
  ).bind(...historicalCompetitionIds).first<{ total: number }>();
  await db.prepare(`INSERT INTO league_audit_log (id,actor_email,action,entity_type,entity_id,details_json) VALUES (?,?,?,?,?,?)`)
    .bind(createEntityId("audit"), actor, "historical_import", "league", "all", JSON.stringify({
      created, merged, games: gameCount?.total ?? 0, phases: phaseCount?.total ?? 0, skippedGames,
    })).run();
  return {
    created,
    automaticallyMerged: merged,
    total: legacyPlayers.length,
    historicalGames: gameCount?.total ?? 0,
    historicalPhases: phaseCount?.total ?? 0,
    skippedGames,
  };
}
