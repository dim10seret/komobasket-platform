import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ database: null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloudflare", () => ({
  getKomoBasketCloudflareEnv: async () => ({ NEWS_DB: fixture.database }),
}));

import {
  requireCompetitionAccess,
  requireGameAccess,
  requireOrganizationAccess,
  requireParticipationAccess,
  requirePlayerAccess,
  requireRosterMembershipAccess,
  requireRosterRelationshipAccess,
  requireTeamAccess,
  requireTeamCompetitionAccess,
} from "@/lib/platform-authorization";
import {
  buildGamePackagePreview,
  publishGamePackage,
} from "@/services/komocontrol-admin.service";
import { getLeagueAdminSnapshot } from "@/services/league-admin.service";
import { downloadScorerGamePackage } from "@/services/komocontrol-game-package-download.service";
import { listScorerAvailableGames } from "@/services/komocontrol-game-discovery.service";
import {
  listPlatformMatchReportAvailabilityWithDb,
  readAuthoritativeCompetitionStatisticalGamesWithDb,
  readPlatformMatchReportWithDb,
} from "@/services/platform-match-report.service";

const KOMOBASKET = "organization_komobasket";
const RUNBASKET = "organization_runbasket";

function d1Database(sqlite) {
  return {
    prepare(query) {
      let bindings = [];
      const statement = {
        bind(...values) {
          bindings = values;
          return statement;
        },
        async first() {
          return sqlite.prepare(query).get(...bindings) ?? null;
        },
        async all() {
          return { results: sqlite.prepare(query).all(...bindings) };
        },
        async run() {
          const result = sqlite.prepare(query).run(...bindings);
          return { meta: { changes: Number(result.changes) } };
        },
        _run() {
          const result = sqlite.prepare(query).run(...bindings);
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
    async batch(statements) {
      sqlite.exec("BEGIN");
      try {
        const results = statements.map((statement) => statement._run());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function insert(sqlite, sql, ...bindings) {
  sqlite.prepare(sql).run(...bindings);
}

function seed(sqlite) {
  sqlite.exec(readFileSync(new URL("../../cloudflare/league-schema.sql", import.meta.url), "utf8"));
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS league_phase_schedules (
      id TEXT PRIMARY KEY,
      competition_id TEXT NOT NULL REFERENCES league_competitions(id) ON DELETE CASCADE,
      phase_id TEXT NOT NULL UNIQUE REFERENCES league_phases(id) ON DELETE RESTRICT,
      lifecycle_status TEXT NOT NULL DEFAULT 'draft'
        CHECK (lifecycle_status IN ('draft', 'published')),
      published_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS league_competition_publication (
      competition_id TEXT PRIMARY KEY REFERENCES league_competitions(id) ON DELETE CASCADE,
      lifecycle_status TEXT NOT NULL DEFAULT 'under_construction'
        CHECK (lifecycle_status IN ('under_construction', 'online', 'complete')),
      published_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS league_competition_formats (
      competition_id TEXT PRIMARY KEY REFERENCES league_competitions(id) ON DELETE CASCADE,
      expected_team_count INTEGER,
      regular_season_meetings INTEGER NOT NULL DEFAULT 1,
      win_points INTEGER NOT NULL DEFAULT 2,
      loss_points INTEGER NOT NULL DEFAULT 1,
      forfeit_points INTEGER NOT NULL DEFAULT 0,
      tiebreakers_json TEXT NOT NULL DEFAULT '[]',
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS league_phase_rules (
      phase_id TEXT PRIMARY KEY REFERENCES league_phases(id) ON DELETE CASCADE,
      phase_kind TEXT NOT NULL DEFAULT 'custom',
      bracket_size INTEGER,
      best_of INTEGER,
      wins_required INTEGER,
      carry_over_enabled INTEGER NOT NULL DEFAULT 0,
      carry_over_source_phase_id TEXT REFERENCES league_phases(id) ON DELETE SET NULL,
      settings_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  insert(sqlite, "INSERT INTO league_organizations (id, slug, name, status, publication_status) VALUES (?, ?, ?, 'active', 'published')", KOMOBASKET, "komobasket", "KomoBasket");
  insert(sqlite, "INSERT INTO league_organizations (id, slug, name, status, publication_status) VALUES (?, ?, ?, 'active', 'published')", RUNBASKET, "runbasket", "RunBasket");

  for (const [id, email, superAdmin] of [
    ["user_super", "super@example.test", 1],
    ["user_komobasket_admin", "komobasket@example.test", 0],
    ["user_runbasket_admin", "runbasket@example.test", 0],
    ["user_runbasket_viewer", "viewer@example.test", 0],
  ]) {
    insert(sqlite, "INSERT INTO league_app_users (id, email, normalized_email, status, is_super_admin) VALUES (?, ?, ?, 'active', ?)", id, email, email, superAdmin);
  }
  insert(sqlite, "INSERT INTO league_organization_memberships (id, organization_id, user_id, role, status) VALUES ('membership_ka', ?, 'user_komobasket_admin', 'admin', 'active')", KOMOBASKET);
  insert(sqlite, "INSERT INTO league_organization_memberships (id, organization_id, user_id, role, status) VALUES ('membership_ra', ?, 'user_runbasket_admin', 'admin', 'active')", RUNBASKET);
  insert(sqlite, "INSERT INTO league_organization_memberships (id, organization_id, user_id, role, status) VALUES ('membership_rv', ?, 'user_runbasket_viewer', 'viewer', 'active')", RUNBASKET);

  insert(sqlite, "INSERT INTO league_seasons (id, name, slug, starts_on, status) VALUES ('season_v1', 'V1 Season', 'v1-season', '2026-09-01', 'active')");
  for (const [id, organizationId, name, slug] of [
    ["competition_komobasket", KOMOBASKET, "KomoBasket Competition A", "komobasket-a"],
    ["competition_runbasket", RUNBASKET, "RunBasket Competition B", "runbasket-b"],
  ]) {
    insert(sqlite, "INSERT INTO league_competitions (id, organization_id, season_id, name, slug, status) VALUES (?, ?, 'season_v1', ?, ?, 'active')", id, organizationId, name, slug);
  }

  const teams = [
    ["team_komobasket_home", KOMOBASKET, "KomoBasket Home", "komobasket-home"],
    ["team_komobasket_away", KOMOBASKET, "KomoBasket Away", "komobasket-away"],
    ["team_runbasket_home", RUNBASKET, "RunBasket Home", "runbasket-home"],
    ["team_runbasket_away", RUNBASKET, "RunBasket Away", "runbasket-away"],
  ];
  for (const [id, organizationId, name, slug] of teams) {
    insert(sqlite, "INSERT INTO league_teams (id, organization_id, name, slug) VALUES (?, ?, ?, ?)", id, organizationId, name, slug);
    insert(sqlite, "INSERT INTO league_season_teams (id, season_id, team_id, display_name) VALUES (?, 'season_v1', ?, ?)", `season_${id}`, id, name);
  }
  for (const [id, competitionId, teamId] of [
    ["participation_kh", "competition_komobasket", "team_komobasket_home"],
    ["participation_ka", "competition_komobasket", "team_komobasket_away"],
    ["participation_rh", "competition_runbasket", "team_runbasket_home"],
    ["participation_ra", "competition_runbasket", "team_runbasket_away"],
  ]) {
    insert(sqlite, "INSERT INTO league_competition_teams (id, competition_id, season_team_id, status) VALUES (?, ?, ?, 'active')", id, competitionId, `season_${teamId}`);
  }

  const players = [
    ["player_komobasket_home", KOMOBASKET, "KomoBasket Player Home", "komobasket-player-home", "team_komobasket_home", "competition_komobasket", 4],
    ["player_komobasket_away", KOMOBASKET, "KomoBasket Player Away", "komobasket-player-away", "team_komobasket_away", "competition_komobasket", 5],
    ["player_runbasket_home", RUNBASKET, "RunBasket Player Home", "runbasket-player-home", "team_runbasket_home", "competition_runbasket", 6],
    ["player_runbasket_away", RUNBASKET, "RunBasket Player Away", "runbasket-player-away", "team_runbasket_away", "competition_runbasket", 7],
  ];
  for (const [id, organizationId, name, slug, teamId, competitionId, shirt] of players) {
    insert(sqlite, "INSERT INTO league_players (id, organization_id, slug, display_name, normalized_name) VALUES (?, ?, ?, ?, ?)", id, organizationId, slug, name, name.toLowerCase());
    insert(sqlite, "INSERT INTO league_roster_memberships (id, season_id, competition_id, player_id, team_id, shirt_number, status) VALUES (?, 'season_v1', ?, ?, ?, ?, 'active')", `roster_${id}`, competitionId, id, teamId, shirt);
  }
  insert(sqlite, "INSERT INTO league_phases (id, competition_id, name, slug, format) VALUES ('phase_komobasket', 'competition_komobasket', 'Regular', 'regular', 'standings')");
  insert(sqlite, "INSERT INTO league_phases (id, competition_id, name, slug, format) VALUES ('phase_runbasket', 'competition_runbasket', 'Regular', 'regular', 'standings')");
  insert(sqlite, "INSERT INTO league_games (id, competition_id, phase_id, round_number, game_order, scheduled_date, scheduled_time, home_team_id, away_team_id, status) VALUES ('game_komobasket', 'competition_komobasket', 'phase_komobasket', 1, 1, '2026-09-10', '18:00', 'team_komobasket_home', 'team_komobasket_away', 'scheduled')");
  insert(sqlite, "INSERT INTO league_games (id, competition_id, phase_id, round_number, game_order, scheduled_date, scheduled_time, home_team_id, away_team_id, status) VALUES ('game_runbasket', 'competition_runbasket', 'phase_runbasket', 1, 1, '2026-09-10', '20:00', 'team_runbasket_home', 'team_runbasket_away', 'scheduled')");

  for (const competitionId of ["competition_komobasket", "competition_runbasket"]) {
    insert(sqlite, "INSERT INTO league_competition_komocontrol_defaults (competition_id, game_mode, min_players, max_players, starting_players, regulation_periods, regulation_period_seconds, overtime_seconds, tie_allowed, winner_required) VALUES (?, 'FULL', 1, 20, 1, 4, 600, 300, 0, 1)", competitionId);
  }
}

const users = {
  superAdmin: { userId: "user_super", email: "super@example.test", displayName: null, isSuperAdmin: true, isLocal: false },
  komobasketAdmin: { userId: "user_komobasket_admin", email: "komobasket@example.test", displayName: null, isSuperAdmin: false, isLocal: false },
  runbasketAdmin: { userId: "user_runbasket_admin", email: "runbasket@example.test", displayName: null, isSuperAdmin: false, isLocal: false },
  runbasketViewer: { userId: "user_runbasket_viewer", email: "viewer@example.test", displayName: null, isSuperAdmin: false, isLocal: false },
};

describe("V1 hosted Organization tenant isolation", () => {
  let sqlite;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec("PRAGMA foreign_keys = ON");
    seed(sqlite);
    fixture.database = d1Database(sqlite);
  });

  afterEach(() => {
    fixture.database = null;
    sqlite.close();
  });

  it("fails closed for cross-Organization admin resource IDs and relationship injection", async () => {
    await expect(requireOrganizationAccess(users.runbasketAdmin, RUNBASKET, "manage")).resolves.toMatchObject({ organizationId: RUNBASKET, role: "admin" });
    await expect(requireOrganizationAccess(users.runbasketAdmin, KOMOBASKET, "manage")).rejects.toMatchObject({ code: "inaccessible_organization" });
    await expect(requireOrganizationAccess(users.runbasketViewer, RUNBASKET, "read")).resolves.toMatchObject({ role: "viewer" });
    await expect(requireOrganizationAccess(users.runbasketViewer, RUNBASKET, "manage")).rejects.toMatchObject({ code: "insufficient_permission" });
    await expect(requireCompetitionAccess(users.superAdmin, "competition_komobasket", "manage")).resolves.toMatchObject({ organizationId: KOMOBASKET });
    await expect(requireCompetitionAccess(users.superAdmin, "competition_runbasket", "manage")).resolves.toMatchObject({ organizationId: RUNBASKET });

    await expect(requireCompetitionAccess(users.runbasketAdmin, "competition_runbasket", "manage")).resolves.toMatchObject({ organizationId: RUNBASKET });
    await expect(requireCompetitionAccess(users.runbasketAdmin, "competition_komobasket", "manage")).rejects.toMatchObject({ code: "resource_unavailable" });
    await expect(requireTeamAccess(users.runbasketAdmin, "team_komobasket_home", "manage")).rejects.toMatchObject({ code: "resource_unavailable" });
    await expect(requirePlayerAccess(users.runbasketAdmin, "player_komobasket_home", "manage")).rejects.toMatchObject({ code: "resource_unavailable" });
    await expect(requireGameAccess(users.runbasketAdmin, "game_komobasket", "manage")).rejects.toMatchObject({ code: "resource_unavailable" });
    await expect(requireParticipationAccess(users.runbasketAdmin, "participation_kh", "manage")).rejects.toMatchObject({ code: "resource_unavailable" });

    await expect(requireTeamCompetitionAccess(users.runbasketAdmin, { competitionId: "competition_runbasket", teamId: "team_komobasket_home" }, "manage")).rejects.toMatchObject({ code: "resource_unavailable" });
    await expect(requireRosterRelationshipAccess(users.runbasketAdmin, { competitionId: "competition_runbasket", teamId: "team_runbasket_home", playerId: "player_komobasket_home" }, "manage")).rejects.toMatchObject({ code: "resource_unavailable" });
    await expect(requireRosterMembershipAccess(users.runbasketAdmin, "roster_cross_org", "manage")).rejects.toMatchObject({ code: "resource_unavailable" });
    await expect(requireRosterMembershipAccess(users.runbasketAdmin, "roster_player_runbasket_home", "manage")).resolves.toMatchObject({ organizationId: RUNBASKET });
  });

  it("returns an Organization-pure Platform snapshot", async () => {
    const snapshot = await getLeagueAdminSnapshot(RUNBASKET);
    expect(snapshot.competitions.map((row) => row.id)).toEqual(["competition_runbasket"]);
    expect(snapshot.teams.map((row) => row.id).sort()).toEqual(["team_runbasket_away", "team_runbasket_home"]);
    expect(snapshot.players.map((row) => row.id).sort()).toEqual(["player_runbasket_away", "player_runbasket_home"]);
    expect(snapshot.participations.map((row) => row.id).sort()).toEqual(["participation_ra", "participation_rh"]);
    expect(snapshot.games.map((row) => row.id)).toEqual(["game_runbasket"]);
    expect(JSON.stringify(snapshot)).not.toContain("komobasket_home");
    expect(JSON.stringify(snapshot)).not.toContain("competition_komobasket");
  });

  it("publishes, discovers, and downloads only the owning Organization GamePackage", async () => {
    const preview = await buildGamePackagePreview(RUNBASKET, "game_runbasket");
    expect(preview.snapshot.game).toMatchObject({ id: "game_runbasket", organizationId: RUNBASKET, competitionId: "competition_runbasket" });
    expect(preview.snapshot.teams.flatMap((team) => team.players.map((player) => player.id)).sort()).toEqual(["player_runbasket_away", "player_runbasket_home"]);
    await expect(buildGamePackagePreview(KOMOBASKET, "game_runbasket")).rejects.toMatchObject({ status: 404 });

    const published = await publishGamePackage(RUNBASKET, "game_runbasket", "user_super");
    expect(published).toMatchObject({ published: true, packageVersion: 1 });
    const stored = sqlite.prepare("SELECT organization_id, game_id, package_version, snapshot_json, snapshot_hash FROM league_komocontrol_game_packages WHERE id=?").get(published.packageId);
    expect(stored).toMatchObject({ organization_id: RUNBASKET, game_id: "game_runbasket", package_version: 1 });
    expect(JSON.parse(stored.snapshot_json).game.organizationId).toBe(RUNBASKET);
    expect(stored.snapshot_hash).toMatch(/^[0-9a-f]{64}$/);

    await expect(listScorerAvailableGames(RUNBASKET)).resolves.toEqual([expect.objectContaining({ gameId: "game_runbasket", packageId: published.packageId })]);
    await expect(listScorerAvailableGames(KOMOBASKET)).resolves.toEqual([]);
    await expect(downloadScorerGamePackage(RUNBASKET, "game_runbasket")).resolves.toMatchObject({ gameId: "game_runbasket", packageId: published.packageId, packageVersion: 1 });
    await expect(downloadScorerGamePackage(KOMOBASKET, "game_runbasket")).rejects.toMatchObject({ code: "PACKAGE_UNAVAILABLE" });
  });

  it("keeps Match Report availability and authoritative statistics behind Organization boundaries", async () => {
    const runbasketAvailability = await listPlatformMatchReportAvailabilityWithDb(fixture.database, RUNBASKET);
    const komobasketAvailability = await listPlatformMatchReportAvailabilityWithDb(fixture.database, KOMOBASKET);
    expect(Object.keys(runbasketAvailability)).toEqual(["game_runbasket"]);
    expect(Object.keys(komobasketAvailability)).toEqual(["game_komobasket"]);

    await expect(readPlatformMatchReportWithDb(fixture.database, "game_runbasket", KOMOBASKET)).resolves.toMatchObject({ kind: "unavailable" });
    await expect(readPlatformMatchReportWithDb(fixture.database, "game_komobasket", RUNBASKET)).resolves.toMatchObject({ kind: "unavailable" });
    await expect(readAuthoritativeCompetitionStatisticalGamesWithDb(fixture.database, "competition_runbasket", KOMOBASKET)).resolves.toEqual([]);
    await expect(readAuthoritativeCompetitionStatisticalGamesWithDb(fixture.database, "competition_komobasket", RUNBASKET)).resolves.toEqual([]);
  });
});
