import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  TARGET, CORE_TABLES, timestampFolder, sha256, redactSecrets, backupEnvironment, backupExportEnvironment,
  assertReadOnlySql, createReadOnlyClient, validateCoreCounts, createBackupDirectory,
  exportArguments, validateSqlExport, makeManifest, incompleteReport,
  COUNT_QUERY_BATCH_SIZE, collectSnapshot,
} from "./backup-production.mjs";

test("UTC folder naming has no Windows-unsafe punctuation", () => {
  assert.equal(timestampFolder(new Date("2026-09-07T22:00:00+03:00")), "production-backup-20260907T190000Z");
  assert.throws(() => timestampFolder(new Date("invalid")));
});

test("existing backup folders and their data cannot be overwritten", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "komobasket-backup-test-"));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(tmpdir()));
    assert.ok(path.basename(root).startsWith("komobasket-backup-test-"));
    await rm(root, { recursive: true, force: true });
  });
  const date = new Date("2026-09-07T19:00:00Z");
  const folder = await createBackupDirectory(root, date);
  await writeFile(path.join(folder, "preserved.txt"), "existing backup");
  await assert.rejects(createBackupDirectory(root, date), { code: "EEXIST" });
  assert.equal(await readFile(path.join(folder, "preserved.txt"), "utf8"), "existing backup");
});

test("SHA256 uses exact bytes", () => {
  assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(sha256(Buffer.from("abc")), sha256("abc"));
});

test("credentials are mandatory and never fall back to a write token", () => {
  assert.throws(() => backupEnvironment({ CLOUDFLARE_D1_WRITE_TOKEN: "write-only" }), /required/);
  assert.throws(() => backupEnvironment({ CLOUDFLARE_API_TOKEN: "same", CLOUDFLARE_D1_WRITE_TOKEN: "same" }), /refusing/);
  const child = backupEnvironment({
    PATH: "bin", CLOUDFLARE_API_TOKEN: "read-token", CLOUDFLARE_D1_WRITE_TOKEN: "write-token",
    CLOUDFLARE_ACCESS_WRITE_TOKEN: "access-token", CLOUDFLARE_API_BASE_URL: "https://untrusted.invalid",
    CLOUDFLARE_ENV: "other", NODE_OPTIONS: "--require=untrusted", CLOUDFLARE_API_KEY: "global-key",
  });
  assert.equal(child.CLOUDFLARE_API_TOKEN, "read-token");
  for (const key of ["CLOUDFLARE_D1_WRITE_TOKEN", "CLOUDFLARE_ACCESS_WRITE_TOKEN", "CLOUDFLARE_API_KEY", "CLOUDFLARE_API_BASE_URL", "CLOUDFLARE_ENV", "NODE_OPTIONS"]) assert.equal(child[key], undefined);
  assert.equal(child.CLOUDFLARE_ACCOUNT_ID, TARGET.accountId);
});

test("read-only SQL guard rejects mutation, multi-statements and write PRAGMAs", () => {
  for (const sql of ["SELECT COUNT(*) FROM league_players", "PRAGMA quick_check;", "PRAGMA foreign_key_check;"]) assert.doesNotThrow(() => assertReadOnlySql(sql));
  for (const sql of ["DELETE FROM league_players", "SELECT 1; DROP TABLE league_players", "PRAGMA user_version=4", "PRAGMA journal_mode=WAL", "SELECT load_extension('bad')", "ALTER TABLE league_players ADD COLUMN bad TEXT"]) assert.throws(() => assertReadOnlySql(sql));
});

test("HTTP client makes only approved GETs and guarded zero-write D1 queries", async () => {
  const calls = [];
  const client = createReadOnlyClient("fixture-token", async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ success: true, result: [{ success: true, results: [{ n: 995 }], meta: { rows_written: 0, changed_db: false } }] }));
  });
  assert.deepEqual(await client.query("SELECT COUNT(*) AS n FROM league_players"), [{ n: 995 }]);
  assert.ok(calls[0].url.endsWith(`/d1/database/${TARGET.databaseId}/query`));
  assert.equal(calls[0].options.headers.Authorization, "Bearer fixture-token");
  await assert.rejects(client.query("UPDATE league_players SET active=0"));
  assert.equal(calls.length, 1);
});

test("permission errors are explicit, redacted, and not retried with other credentials", async () => {
  let calls = 0;
  const client = createReadOnlyClient("fixture-token", async () => {
    calls++;
    return new Response(JSON.stringify({ success: false, errors: [{ code: 10000, message: "Denied fixture-token" }] }), { status: 403 });
  });
  await assert.rejects(client.identity(), (error) => /HTTP 403/.test(error.message) && /10000/.test(error.message) && !error.message.includes("fixture-token"));
  assert.equal(calls, 1);
});

test("D1 responses must explicitly confirm zero writes", async () => {
  const client = createReadOnlyClient("fixture-token", async () => new Response(JSON.stringify({ success: true, result: [{ success: true, results: [], meta: { rows_written: 1, changed_db: true } }] })));
  await assert.rejects(client.query("SELECT 1"), /zero-write/);
});

test("legitimate count increases pass, but absent or zero core counts fail", () => {
  const counts = Object.fromEntries(CORE_TABLES.map((table) => [table, 1001]));
  assert.doesNotThrow(() => validateCoreCounts(counts));
  assert.throws(() => validateCoreCounts({ ...counts, league_players: 0 }), /league_players/);
  assert.throws(() => validateCoreCounts({ ...counts, league_roster_memberships: undefined }), /league_roster_memberships/);
});

test("export command is remote, full, scoped, shell-free and has no mutating operation", () => {
  const args = exportArguments("wrangler.js", path.resolve("backup-fixture"));
  assert.deepEqual(args.slice(0, 5), ["wrangler.js", "d1", "export", "komobasket-news", "--remote"]);
  assert.ok(args.includes("--output"));
  assert.ok(args.includes("--skip-confirmation"));
  for (const forbidden of ["--local", "--table", "--no-schema", "--no-data", "execute", "apply", "deploy", "restore"]) assert.ok(!args.includes(forbidden));
});

const snapshot = {
  schema: [{ type: "table", name: "d1_migrations" }, { type: "index", name: "migration_name_idx" }],
  counts: { d1_migrations: 33, league_players: 995 }, organizations: {},
  migration_count: 33, last_migration: "0033_player_canonical_name_fields.sql",
  quick_check: "ok", foreign_key_violations: 0,
};

test("SQL validation requires schema, populated-table data, and indexes", () => {
  const sql = 'CREATE TABLE "d1_migrations" (name TEXT);\nINSERT INTO "d1_migrations" VALUES (\'0033\');\nCREATE UNIQUE INDEX "migration_name_idx" ON "d1_migrations" (name);\n-- ' + "padding".repeat(200);
  assert.doesNotThrow(() => validateSqlExport(sql, snapshot));
  assert.throws(() => validateSqlExport("", snapshot), /small/);
  assert.throws(() => validateSqlExport(sql.replace('CREATE UNIQUE INDEX "migration_name_idx"', 'CREATE UNIQUE INDEX "other"'), snapshot), /missing a schema object/);
  assert.throws(() => validateSqlExport(sql.replace('INSERT INTO "d1_migrations"', 'INSERT INTO "other"'), snapshot), /missing data/);
});

test("manifest contains revision, counts, checksum and only a credential variable name", () => {
  const manifest = makeManifest({ created: new Date("2026-09-07T19:00:00Z"), snapshot, git: { branch: "main", commit: "abc", dirty: true }, sqlSize: 3000, sqlHash: sha256("sql"), wranglerVersion: "4.115.0" });
  assert.equal(manifest.database_id, TARGET.databaseId);
  assert.equal(manifest.migration_count, 33);
  assert.equal(manifest.git.dirty, true);
  assert.equal(manifest.status, "BACKUP COMPLETE");
  assert.equal(manifest.credentials_source, "CLOUDFLARE_API_TOKEN");
  assert.equal(manifest.export_credentials_source, "CLOUDFLARE_D1_BACKUP_TOKEN");
  assert.equal(manifest.production_writes, false);
  assert.equal(manifest.restore_automatic, false);
  const text = JSON.stringify(manifest, null, 2) + "\n";
  assert.equal(sha256(Buffer.from(text)), sha256(text));
});

test("integrity failures produce a warning rather than a PASS manifest", () => {
  const manifest = makeManifest({ created: new Date(), snapshot: { ...snapshot, foreign_key_violations: 1 }, git: {}, sqlSize: 3000, sqlHash: "hash" });
  assert.equal(manifest.status, "BACKUP CREATED WITH INTEGRITY WARNING");
});

test("incomplete failure reports retain metadata but no credential values or signed URLs", () => {
  const env = { CLOUDFLARE_API_TOKEN: "read-token", CLOUDFLARE_D1_BACKUP_TOKEN: "backup-token", CLOUDFLARE_D1_WRITE_TOKEN: "write-token" };
  const error = new Error("Denied read-token backup-token write-token Bearer other-token https://example.invalid/export?secret=signed-token");
  const report = incompleteReport("export", error, snapshot, { commit: "abc" }, env);
  const text = JSON.stringify(report);
  assert.equal(report.status, "INCOMPLETE");
  assert.equal(report.failed_step, "export");
  assert.equal(report.snapshot.migration_count, 33);
  for (const secret of ["read-token", "backup-token", "write-token", "other-token", "signed-token"]) assert.ok(!text.includes(secret));
  assert.equal(redactSecrets("Bearer hidden"), "Bearer [REDACTED]");
});

function snapshotClientFixture({ extraTables = [], omittedTables = [], failTable } = {}) {
  const names = [...CORE_TABLES, ...extraTables].filter((name) => !omittedTables.includes(name)).sort();
  const expectedCounts = Object.fromEntries(names.map((name, index) => [name, name === "league_player_movements" ? 0 : index + 1]));
  const batches = [];
  const queries = [];
  const failure = new Error("Fixture D1 count query failure");
  const client = {
    identity: async () => ({ uuid: TARGET.databaseId, name: TARGET.databaseName }),
    deployment: async () => ({ deployments: [] }),
    query: async (sql) => {
      assertReadOnlySql(sql);
      queries.push(sql);
      if (sql.startsWith("SELECT type, name, tbl_name FROM sqlite_master")) {
        return names.map((name) => ({ type: "table", name, tbl_name: name }));
      }
      if (sql.includes(" AS table_name, COUNT(*) AS row_count FROM ")) {
        const terms = [...sql.matchAll(/SELECT '([^']+)' AS table_name, COUNT\(\*\) AS row_count FROM "([^"]+)"/g)];
        assert.equal(terms.length, sql.split(" UNION ALL ").length);
        assert.ok(terms.length <= 5, "D1 accepts at most 5 compound SELECT terms");
        const batch = terms.map((match) => {
          assert.equal(match[1], match[2]);
          return match[1];
        });
        batches.push(batch);
        if (batch.includes(failTable)) throw failure;
        return batch.map((name) => ({ table_name: name, row_count: expectedCounts[name] }));
      }
      if (sql === "SELECT name FROM d1_migrations ORDER BY id") return [{ name: "0033_player_canonical_name_fields.sql" }];
      if (sql.startsWith("SELECT o.id, o.name, COUNT(p.id)")) return [];
      if (sql === "PRAGMA quick_check;") return [{ quick_check: "ok" }];
      if (sql === "PRAGMA foreign_key_check;") return [];
      throw new Error(`Unexpected fixture query: ${sql}`);
    },
  };
  return { client, names, expectedCounts, batches, queries, failure };
}

test("snapshot counts support more than 500 tables through deterministic batches of at most 5", async () => {
  const extraTables = Array.from({ length: 600 }, (_, index) => `fixture_table_${String(index).padStart(4, "0")}`);
  const fixture = snapshotClientFixture({ extraTables });
  const result = await collectSnapshot(fixture.client);
  assert.equal(COUNT_QUERY_BATCH_SIZE, 5);
  assert.ok(fixture.names.length > 500);
  assert.equal(fixture.batches.length, Math.ceil(fixture.names.length / COUNT_QUERY_BATCH_SIZE));
  assert.ok(fixture.batches.every((batch) => batch.length > 0 && batch.length <= COUNT_QUERY_BATCH_SIZE));
  assert.deepEqual(fixture.batches.flat(), fixture.names);
  assert.deepEqual(result.counts, fixture.expectedCounts);
  assert.equal(result.quick_check, "ok");
  for (const sql of fixture.queries) assert.doesNotThrow(() => assertReadOnlySql(sql));
});

test("a failed required count batch rejects the snapshot and prevents subsequent batches", async () => {
  const fixture = snapshotClientFixture({
    extraTables: Array.from({ length: 25 }, (_, i) => `z_optional_${i}`),
    failTable: "league_players",
  });
  await assert.rejects(collectSnapshot(fixture.client), (error) => error === fixture.failure);
  assert.equal(fixture.batches.length, Math.floor(fixture.names.indexOf("league_players") / COUNT_QUERY_BATCH_SIZE) + 1);
  assert.ok(!fixture.queries.includes("PRAGMA quick_check;"));
});

test("optional absent tables stay omitted while existing empty optional tables retain zero", async () => {
  const absent = snapshotClientFixture();
  const absentResult = await collectSnapshot(absent.client);
  assert.equal(absentResult.counts.league_player_movements, undefined);
  assert.equal(absentResult.counts.league_komocontrol_game_packages, undefined);
  assert.ok(!absent.batches.flat().includes("league_player_movements"));
  const present = snapshotClientFixture({ extraTables: ["league_player_movements"] });
  assert.equal((await collectSnapshot(present.client)).counts.league_player_movements, 0);
});

test("a missing core table still fails before any count batch", async () => {
  const fixture = snapshotClientFixture({ omittedTables: ["league_players"] });
  await assert.rejects(collectSnapshot(fixture.client), /Required core table missing: league_players/);
  assert.equal(fixture.batches.length, 0);
});

test("genuine errors from an existing optional table are not silently swallowed", async () => {
  const fixture = snapshotClientFixture({ extraTables: ["league_player_movements"], failTable: "league_player_movements" });
  await assert.rejects(collectSnapshot(fixture.client), (error) => error === fixture.failure);
});

test("dedicated export credentials are substituted only in a fresh child environment", () => {
  const globalTokenBefore = process.env.CLOUDFLARE_API_TOKEN;
  const input = Object.freeze({
    PATH: "bin", CLOUDFLARE_API_TOKEN: "audit-fixture-token",
    CLOUDFLARE_D1_BACKUP_TOKEN: "backup-fixture-token", CLOUDFLARE_D1_WRITE_TOKEN: "migration-fixture-token",
  });
  const auditEnv = backupEnvironment(input);
  const exportEnv = backupExportEnvironment(input);
  assert.equal(auditEnv.CLOUDFLARE_API_TOKEN, "audit-fixture-token");
  assert.equal(exportEnv.CLOUDFLARE_API_TOKEN, "backup-fixture-token");
  assert.notEqual(auditEnv, exportEnv);
  assert.equal(input.CLOUDFLARE_API_TOKEN, "audit-fixture-token");
  assert.ok(process.env.CLOUDFLARE_API_TOKEN === globalTokenBefore);
  for (const env of [auditEnv, exportEnv]) {
    assert.equal(env.CLOUDFLARE_D1_BACKUP_TOKEN, undefined);
    assert.equal(env.CLOUDFLARE_D1_WRITE_TOKEN, undefined);
  }
  const command = exportArguments("wrangler.js", path.resolve("backup-fixture")).join(" ");
  for (const secret of [input.CLOUDFLARE_API_TOKEN, input.CLOUDFLARE_D1_BACKUP_TOKEN, input.CLOUDFLARE_D1_WRITE_TOKEN]) assert.ok(!command.includes(secret));
});

test("missing dedicated backup credentials fail without audit-token or write-token fallback", () => {
  for (const value of [undefined, "", "   "]) {
    const input = { CLOUDFLARE_API_TOKEN: "audit-fixture-token", CLOUDFLARE_D1_WRITE_TOKEN: "migration-fixture-token", CLOUDFLARE_D1_BACKUP_TOKEN: value };
    assert.doesNotThrow(() => backupEnvironment(input));
    assert.throws(() => backupExportEnvironment(input), /Dedicated production backup token is required/);
  }
});

test("a migration token cannot be aliased as the dedicated backup credential", () => {
  assert.throws(() => backupExportEnvironment({
    CLOUDFLARE_API_TOKEN: "audit-fixture-token", CLOUDFLARE_D1_BACKUP_TOKEN: "migration-fixture-token", CLOUDFLARE_D1_WRITE_TOKEN: "migration-fixture-token",
  }), /must not be the migration\/write token/);
});

test("audit API requests keep using the read-only token even when a backup token is available", async () => {
  const input = { CLOUDFLARE_API_TOKEN: "audit-fixture-token", CLOUDFLARE_D1_BACKUP_TOKEN: "backup-fixture-token" };
  const env = backupEnvironment(input);
  const client = createReadOnlyClient(env.CLOUDFLARE_API_TOKEN, async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer audit-fixture-token");
    assert.ok(!JSON.stringify(options).includes("backup-fixture-token"));
    return new Response(JSON.stringify({ success: true, result: [{ success: true, results: [{ n: 995 }], meta: { rows_written: 0, changed_db: false } }] }));
  });
  assert.deepEqual(await client.query("SELECT COUNT(*) AS n FROM league_players"), [{ n: 995 }]);
});
