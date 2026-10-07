import { describe, expect, it, vi } from "vitest";
import type { D1DatabaseBinding, D1PreparedStatement } from "@/types/cloudflare";

vi.mock("server-only", () => ({}));
const environment = vi.hoisted(() => ({ current: null as D1DatabaseBinding | null }));
vi.mock("@/lib/cloudflare", () => ({ getKomoBasketCloudflareEnv: async () => ({ NEWS_DB: environment.current }) }));

import { buildGamePackagePreview, publishGamePackage, type GamePackageV1 } from "./komocontrol-admin.service";

type PlayerRow = { id: string; display_name: string; shirt_number: unknown; photo_url: null };

function player(id: string, shirtNumber: unknown): PlayerRow {
  return { id, display_name: id, shirt_number: shirtNumber, photo_url: null };
}

function packageDatabase(homePlayers: PlayerRow[], awayPlayers: PlayerRow[]) {
  let publishedPayload: string | null = null;
  const game = {
    id: "game-1", competition_id: "competition-1", organization_id: "organization-1",
    competition_name: "Competition", season_name: "Season", phase_name: null, round_label: null,
    scheduled_date: "2026-10-09", scheduled_time: "18:00", scheduled_at: null, venue: null,
    status: "scheduled", home_team_id: "home", away_team_id: "away",
    home_team_name: "Home", away_team_name: "Away", home_team_logo_url: null, away_team_logo_url: null,
  };
  const defaults = {
    game_mode: "FULL", min_players: 1, max_players: 12, starting_players: 1,
    regulation_periods: 4, regulation_period_seconds: 600, overtime_seconds: 300,
    tie_allowed: 0, winner_required: 1,
  };
  function statement(sql: string, values: unknown[] = []): D1PreparedStatement {
    return {
      bind: (...bound) => statement(sql, bound),
      first: async <T,>() => {
        let result: unknown;
        if (sql.includes("FROM league_games g")) result = game;
        else if (sql.includes("FROM league_competition_komocontrol_defaults")) result = defaults;
        else if (sql.includes("FROM league_game_komocontrol_overrides")) result = null;
        else if (sql.includes("FROM league_komocontrol_game_runs")) result = null;
        else if (sql.includes("MAX(package_version)")) result = { version: 1 };
        else throw new Error(`Unexpected first query: ${sql}`);
        return (result as T | null) ?? null;
      },
      all: async <T,>() => {
        let results: unknown[];
        if (sql.includes("FROM league_roster_memberships r")) {
          expect(sql).toContain("r.shirt_number");
          results = values[1] === "home" ? homePlayers : awayPlayers;
        } else if (sql.includes("FROM league_staff_memberships m") || sql.includes("FROM league_game_official_assignments a") || sql.includes("FROM league_komocontrol_game_packages")) {
          results = [];
        } else throw new Error(`Unexpected all query: ${sql}`);
        return { results: results as T[] };
      },
      run: async () => {
        if (!sql.startsWith("INSERT INTO league_komocontrol_game_packages")) throw new Error(`Unexpected write: ${sql}`);
        if (typeof values[4] !== "string") throw new Error("Package JSON was not serialized.");
        publishedPayload = values[4];
        return { meta: { changes: 1 } };
      },
    };
  }
  const database: D1DatabaseBinding = {
    prepare: statement,
    batch: async (statements) => Promise.all(statements.map((item) => item.run())),
  };
  return { database, publishedPayload: () => publishedPayload };
}

describe("KomoControl package jersey boundary", () => {
  const cases: Array<[unknown, string | null]> = [
    [0, "0"], [7, "7"], [23, "23"], [null, null],
    ["0", "0"], ["00", "00"], ["23", "23"],
  ];
  it.each(cases)("maps DB jersey %s to package value %s", async (raw, expected) => {
    const fixture = packageDatabase([player("home-player", raw)], [player("away-player", "5")]);
    environment.current = fixture.database;
    const preview = await buildGamePackagePreview("organization-1", "game-1");
    expect(preview.snapshot.teams[0].players[0]).toMatchObject({ id: "home-player", shirtNumber: expected });
  });

  it("preserves player identities and distinct 0/00 in the published package JSON", async () => {
    const fixture = packageDatabase([player("player-zero", "0"), player("player-double-zero", "00")], [player("away-player", 23)]);
    environment.current = fixture.database;
    await expect(publishGamePackage("organization-1", "game-1", "publisher-1")).resolves.toMatchObject({ published: true });
    expect(fixture.publishedPayload()).not.toBeNull();
    const payload = JSON.parse(fixture.publishedPayload() ?? "") as GamePackageV1;
    expect(payload.teams[0].players.map(({ id, shirtNumber }) => [id, shirtNumber])).toEqual([
      ["player-zero", "0"], ["player-double-zero", "00"],
    ]);
    expect(payload.teams[1].players[0]).toMatchObject({ id: "away-player", shirtNumber: "23" });
  });

  it.each([100, -1, 1.5, "01", "000", "001", "100", "-1", "1.0", true, {}, []])("rejects malformed DB jersey %s", async (raw) => {
    const fixture = packageDatabase([player("home-player", raw)], [player("away-player", "5")]);
    environment.current = fixture.database;
    await expect(buildGamePackagePreview("organization-1", "game-1")).rejects.toThrow("Ο αριθμός φανέλας");
    expect(fixture.publishedPayload()).toBeNull();
  });
});
