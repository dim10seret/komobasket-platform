import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({ database: null }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cloudflare", () => ({
  getKomoBasketCloudflareEnv: async () => ({ NEWS_DB: fixture.database }),
}));

import { createAthleteCanonical } from "./league-admin.service.ts";

const ORGANIZATION = "organization_test";

function d1Database(sqlite, options = {}) {
  const queries = [];
  return {
    queries,
    binding: {
      prepare(query) {
        queries.push(query);
        const prepared = sqlite.prepare(query);
        let bindings = [];
        const statement = {
          bind(...values) {
            bindings = values;
            return statement;
          },
          async all() {
            if (options.failSlugLookup && query.includes("SELECT slug FROM league_players")) {
              throw new Error("slug lookup failed");
            }
            return { results: prepared.all(...bindings) };
          },
          async first() {
            return prepared.get(...bindings) ?? null;
          },
          async run() {
            return prepared.run(...bindings);
          },
        };
        return statement;
      },
      async batch(statements) {
        return Promise.all(statements.map((statement) => statement.run()));
      },
    },
  };
}

function seedPlayer(sqlite, {
  id,
  slug,
  organizationId = ORGANIZATION,
  firstName = "Existing",
  lastName = "Player",
}) {
  sqlite.prepare(`INSERT INTO league_players
    (id, organization_id, first_name, last_name, display_name, normalized_name, birth_date, photo_url, active, slug)
    VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?)`)
    .run(id, organizationId, firstName, lastName, `${firstName} ${lastName}`, `${firstName} ${lastName}`, slug);
}

function rows(sqlite) {
  return sqlite.prepare(`SELECT id, organization_id, first_name, last_name, display_name, slug
    FROM league_players ORDER BY rowid`).all();
}

describe("canonical Player slug allocation", () => {
  let sqlite;

  beforeEach(() => {
    sqlite = new DatabaseSync(":memory:");
    sqlite.exec(`CREATE TABLE league_players (
      id TEXT PRIMARY KEY,
      organization_id TEXT NOT NULL,
      first_name TEXT,
      last_name TEXT,
      display_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      birth_date TEXT,
      photo_url TEXT,
      active INTEGER NOT NULL,
      slug TEXT NOT NULL UNIQUE
    )`);
  });

  afterEach(() => {
    fixture.database = null;
    sqlite.close();
  });

  it.each([
    ["John", "Doe", "john-doe"],
    ["ΝΙΚΟΣ", "ΠΑΠ", "νικος-παπ"],
  ])("creates short ASCII and Greek slugs without LIKE/GLOB", async (firstName, lastName, expectedSlug) => {
    const database = d1Database(sqlite);
    fixture.database = database.binding;

    await createAthleteCanonical({ firstName, lastName, organizationId: ORGANIZATION });

    expect(rows(sqlite)[0].slug).toBe(expectedSlug);
    const lookup = database.queries.find((query) => query.includes("SELECT slug FROM league_players"));
    expect(lookup).toContain("substr(slug, 1, length(?) + 1) = ? || '-'");
    expect(lookup).not.toMatch(/\b(?:LIKE|GLOB)\b/i);
  });

  it("creates the reported long Greek Player beside the distinct existing near-match", async () => {
    seedPlayer(sqlite, {
      id: "player_existing",
      slug: "γιωργος-δανδανιδης-του-σταυρ",
      firstName: "ΓΙΩΡΓΟΣ",
      lastName: "ΔΑΝΔΑΝΙΔΗΣ του Σταυρ.",
    });
    const before = rows(sqlite)[0];
    const database = d1Database(sqlite);
    fixture.database = database.binding;

    await createAthleteCanonical({
      firstName: "ΓΙΩΡΓΟΣ",
      lastName: "ΔΑΝΔΑΝΙΔΗΣ του Δημ.",
      organizationId: ORGANIZATION,
    });

    const players = rows(sqlite);
    expect(players).toHaveLength(2);
    expect(players[0]).toEqual(before);
    expect(players[1]).toMatchObject({
      first_name: "ΓΙΩΡΓΟΣ",
      last_name: "ΔΑΝΔΑΝΙΔΗΣ του Δημ.",
      slug: "γιωργος-δανδανιδης-του-δημ",
    });
    expect(Buffer.byteLength(`${players[1].slug}-%`, "utf8")).toBeGreaterThan(50);
  });

  it("creates a substantially longer Unicode slug without a pattern lookup", async () => {
    const database = d1Database(sqlite);
    fixture.database = database.binding;

    await createAthleteCanonical({
      firstName: "ΚΩΝΣΤΑΝΤΙΝΟΣ",
      lastName: "ΠΑΠΑΔΟΠΟΥΛΟΣ ΚΩΝΣΤΑΝΤΙΝΟΥ ΑΛΕΞΑΝΔΡΟΥ",
      organizationId: ORGANIZATION,
    });

    const slug = rows(sqlite)[0].slug;
    expect(Buffer.byteLength(`${slug}-%`, "utf8")).toBeGreaterThan(50);
    expect(database.queries.join("\n")).not.toMatch(/\b(?:LIKE|GLOB)\b/i);
  });

  it("preserves exact -2 and -3 collision allocation", async () => {
    seedPlayer(sqlite, { id: "player_base", slug: "john-doe" });
    const database = d1Database(sqlite);
    fixture.database = database.binding;

    await createAthleteCanonical({ firstName: "John", lastName: "Doe", organizationId: ORGANIZATION });
    await createAthleteCanonical({ firstName: "John", lastName: "Doe", organizationId: ORGANIZATION });

    expect(rows(sqlite).map((player) => player.slug)).toEqual(["john-doe", "john-doe-2", "john-doe-3"]);
  });

  it("preserves gap filling by choosing the first available numbered suffix", async () => {
    seedPlayer(sqlite, { id: "player_base", slug: "john-doe" });
    seedPlayer(sqlite, { id: "player_2", slug: "john-doe-2" });
    seedPlayer(sqlite, { id: "player_4", slug: "john-doe-4" });
    const database = d1Database(sqlite);
    fixture.database = database.binding;

    await createAthleteCanonical({ firstName: "John", lastName: "Doe", organizationId: ORGANIZATION });

    expect(rows(sqlite).at(-1).slug).toBe("john-doe-3");
  });

  it("preserves the existing global slug scope across Organizations", async () => {
    seedPlayer(sqlite, { id: "player_other_org", slug: "john-doe", organizationId: "organization_other" });
    const database = d1Database(sqlite);
    fixture.database = database.binding;

    await createAthleteCanonical({ firstName: "John", lastName: "Doe", organizationId: ORGANIZATION });

    expect(rows(sqlite).at(-1)).toMatchObject({ organization_id: ORGANIZATION, slug: "john-doe-2" });
  });

  it("does not insert a Player when the slug lookup fails", async () => {
    const database = d1Database(sqlite, { failSlugLookup: true });
    fixture.database = database.binding;

    await expect(createAthleteCanonical({
      firstName: "ΓΙΩΡΓΟΣ",
      lastName: "ΔΑΝΔΑΝΙΔΗΣ του Δημ.",
      organizationId: ORGANIZATION,
    })).rejects.toThrow("slug lookup failed");
    expect(rows(sqlite)).toHaveLength(0);
  });
});
