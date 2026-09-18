import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, lstat, mkdir, readFile, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const exec = promisify(execFile);
const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL("../", import.meta.url));
export const TARGET = Object.freeze({
  accountId: "0e9703e1d62770c3c93a8cc7f827ff22",
  databaseId: "d7947fb0-124a-4bc0-bdff-a7e1e9664a70",
  databaseName: "komobasket-news",
});
export const CORE_TABLES = Object.freeze([
  "d1_migrations", "league_organizations", "league_players", "league_player_profiles",
  "league_teams", "league_competitions", "league_phases", "league_games", "league_roster_memberships",
]);
const ORGANIZATIONS = [
  "organization_komobasket",
  "organization_e58629e8-8877-42a2-9a1d-92ba1a4e820b",
  "organization_4320e36a-c39a-47f1-af1f-189588117556",
];
const SQL_FILE = "komobasket-news-production-full.sql";
export const COUNT_QUERY_BATCH_SIZE = 5;
const API = "https://api.cloudflare.com/client/v4";
const DB_PATH = `/accounts/${TARGET.accountId}/d1/database/${TARGET.databaseId}`;
const WORKER_PATH = `/accounts/${TARGET.accountId}/workers/scripts/komobasket/deployments`;
const quoteIdentifier = (s) => `"${s.replaceAll('"', '""')}"`;
const quoteLiteral = (s) => `'${s.replaceAll("'", "''")}'`;

export function timestampFolder(date = new Date()) {
  return `production-backup-${date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}`;
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function redactSecrets(value, env = process.env) {
  let text = String(value).replace(/\u001b\[[0-9;]*m/g, "");
  for (const [name, secret] of Object.entries(env)) {
    if (/TOKEN|SECRET|PASSWORD|API_KEY/i.test(name) && secret) text = text.split(secret).join("[REDACTED]");
  }
  return text.replace(/Bearer\s+[^\s"']+/gi, "Bearer [REDACTED]")
    .replace(/(https?:\/\/[^\s"'<>?]+)\?[^\s"'<>]*/g, "$1?[REDACTED]");
}

export function backupEnvironment(env = process.env) {
  const token = env.CLOUDFLARE_API_TOKEN?.trim();
  if (!token) throw new Error("CLOUDFLARE_API_TOKEN is required. OAuth and write-token fallback are disabled.");
  if (env.CLOUDFLARE_D1_WRITE_TOKEN?.trim() === token) {
    throw new Error("CLOUDFLARE_API_TOKEN matches the dedicated D1 write token; refusing to use it.");
  }
  // Do not inherit alternate credentials, API endpoints, named environments, or NODE_OPTIONS.
  const allowed = /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|LANG|LC_ALL)$/i;
  return {
    ...Object.fromEntries(Object.entries(env).filter(([key]) => allowed.test(key))),
    CLOUDFLARE_API_TOKEN: token,
    CLOUDFLARE_ACCOUNT_ID: TARGET.accountId,
    CI: "1", NO_COLOR: "1", WRANGLER_SEND_METRICS: "false", WRANGLER_LOG: "error",
    GIT_OPTIONAL_LOCKS: "0",
  };
}

export function backupExportEnvironment(env = process.env) {
  const token = env.CLOUDFLARE_D1_BACKUP_TOKEN?.trim();
  if (!token) throw new Error("Dedicated production backup token is required.");
  if (env.CLOUDFLARE_D1_WRITE_TOKEN?.trim() === token) {
    throw new Error("The dedicated backup token must not be the migration/write token.");
  }
  return { ...backupEnvironment(env), CLOUDFLARE_API_TOKEN: token };
}

export function assertReadOnlySql(sql) {
  const statement = sql.trim().replace(/;$/, "").trim();
  if (/^PRAGMA\s+(quick_check|foreign_key_check)$/i.test(statement)) return;
  if (!/^SELECT\b/i.test(statement) || statement.includes(";") ||
      /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|REPLACE|ATTACH|DETACH|VACUUM|REINDEX|load_extension)\b/i.test(statement)) {
    throw new Error("Refusing a non-read-only SQL statement.");
  }
}

export function createReadOnlyClient(token, fetchImpl = globalThis.fetch) {
  async function request(endpoint, sql) {
    if (sql !== undefined) {
      if (endpoint !== `${DB_PATH}/query`) throw new Error("Query endpoint is not allowlisted.");
      assertReadOnlySql(sql);
    } else if (![DB_PATH, WORKER_PATH].includes(endpoint)) {
      throw new Error("GET endpoint is not allowlisted.");
    }
    const response = await fetchImpl(API + endpoint, {
      method: sql === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, ...(sql === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(sql === undefined ? {} : { body: JSON.stringify({ sql, params: [] }) }),
      redirect: "error", signal: AbortSignal.timeout(60_000),
    });
    const body = await response.json();
    if (!response.ok || body.success !== true) {
      const details = (body.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ");
      throw new Error(redactSecrets(`Cloudflare HTTP ${response.status}: ${details}`, { CLOUDFLARE_API_TOKEN: token }));
    }
    return body.result;
  }
  return {
    identity: () => request(DB_PATH),
    deployment: () => request(WORKER_PATH),
    query: async (sql) => {
      const results = await request(`${DB_PATH}/query`, sql);
      if (results.length !== 1 || results.some((r) => !r.success || r.meta?.rows_written !== 0 || r.meta?.changed_db === true)) {
        throw new Error("D1 did not confirm a successful, zero-write read operation.");
      }
      return results[0].results;
    },
  };
}

export function validateCoreCounts(counts) {
  for (const table of CORE_TABLES) {
    if (!Number.isSafeInteger(counts[table]) || counts[table] <= 0) {
      throw new Error(`Required core table missing or unexpectedly empty: ${table}`);
    }
  }
}

export async function collectSnapshot(client) {
  const started = new Date().toISOString();
  const identity = await client.identity();
  if (identity.uuid !== TARGET.databaseId || identity.name !== TARGET.databaseName) {
    throw new Error("Remote database identity does not match the pinned production target.");
  }
  const schema = await client.query("SELECT type, name, tbl_name FROM sqlite_master WHERE sql IS NOT NULL AND substr(name, 1, 7) <> 'sqlite_' AND substr(name, 1, 4) <> '_cf_' ORDER BY type, name");
  const tables = schema.filter((r) => r.type === "table").map((r) => r.name);
  for (const name of CORE_TABLES) if (!tables.includes(name)) throw new Error(`Required core table missing: ${name}`);
  const countRows = [];
  for (let offset = 0; offset < tables.length; offset += COUNT_QUERY_BATCH_SIZE) {
    const batch = tables.slice(offset, offset + COUNT_QUERY_BATCH_SIZE);
    const rows = await client.query(batch.map((name) =>
      `SELECT ${quoteLiteral(name)} AS table_name, COUNT(*) AS row_count FROM ${quoteIdentifier(name)}`).join(" UNION ALL "));
    countRows.push(...rows);
  }
  const counts = Object.fromEntries(countRows.map((r) => [r.table_name, r.row_count]));
  validateCoreCounts(counts);
  const migrations = await client.query("SELECT name FROM d1_migrations ORDER BY id");
  const organizations = await client.query(`SELECT o.id, o.name, COUNT(p.id) AS player_count FROM league_organizations o LEFT JOIN league_players p ON p.organization_id=o.id WHERE o.id IN (${ORGANIZATIONS.map(quoteLiteral).join(",")}) GROUP BY o.id, o.name ORDER BY o.id`);
  const quick = await client.query("PRAGMA quick_check;");
  const fk = await client.query("PRAGMA foreign_key_check;");
  let worker = null;
  try {
    const result = await client.deployment();
    const active = result.deployments?.[0];
    if (active) worker = { deployment_id: active.id, versions: active.versions, observed_at_utc: new Date().toISOString() };
  } catch { /* Worker metadata is optional and never requires broader permissions. */ }
  return {
    counts, schema, organizations: Object.fromEntries(organizations.map((o) => [o.id, { name: o.name, players: o.player_count }])),
    migration_count: migrations.length, last_migration: migrations.at(-1)?.name ?? null,
    migration_names: migrations.map((m) => m.name), quick_check: quick.map((r) => r.quick_check).join("; "),
    foreign_key_violations: fk.length, worker,
    metadata_started_at_utc: started, metadata_completed_at_utc: new Date().toISOString(),
    counts_source: "Remote read-only queries before export; concurrent production activity can differ from the export snapshot.",
  };
}

export async function createBackupDirectory(root, date = new Date()) {
  const canonicalRoot = await realpath(root);
  const parent = path.join(canonicalRoot, ".production-backups");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  if ((await lstat(parent)).isSymbolicLink() || await realpath(parent) !== parent) {
    throw new Error("Backup root must be a real directory inside this repository, not a link.");
  }
  const directory = path.join(parent, timestampFolder(date));
  await mkdir(directory, { mode: 0o700 }); // EEXIST is intentionally fatal: never overwrite a backup.
  return directory;
}

export function exportArguments(wrangler, directory) {
  return [wrangler, "d1", "export", TARGET.databaseName, "--remote", "--output",
    path.join(directory, SQL_FILE), "--config", path.join(directory, "wrangler-backup.json"), "--skip-confirmation"];
}

export function validateSqlExport(sql, snapshot) {
  if (Buffer.byteLength(sql) < 1024 || !/CREATE\s+TABLE\b/i.test(sql) || !/INSERT\s+INTO\b/i.test(sql)) {
    throw new Error("SQL export is empty, implausibly small, or lacks full schema/data.");
  }
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const object of snapshot.schema) {
    const name = escape(object.name);
    const identifier = `[\"\x60\\[]?${name}(?:[\"\x60\\]\\s(])`;
    if (!new RegExp(`CREATE\\s+(?:UNIQUE\\s+)?${object.type}\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${identifier}`, "i").test(sql)) {
      throw new Error(`SQL export is missing a schema object: ${object.type} ${object.name}`);
    }
    if (object.type === "table" && snapshot.counts[object.name] > 0 && !new RegExp(`INSERT\\s+INTO\\s+${identifier}`, "i").test(sql)) {
      throw new Error(`SQL export is missing data for populated table: ${object.name}`);
    }
  }
}

export function makeManifest({ created, snapshot, git, sqlSize, sqlHash, wranglerVersion, exportStarted, exportCompleted }) {
  const warning = snapshot.quick_check !== "ok" || snapshot.foreign_key_violations !== 0;
  return {
    backup_type: "production-d1-full", status: warning ? "BACKUP CREATED WITH INTEGRITY WARNING" : "BACKUP COMPLETE",
    database_name: TARGET.databaseName, database_id: TARGET.databaseId, account_id: TARGET.accountId,
    created_at_utc: created.toISOString(), export_started_at_utc: exportStarted, export_completed_at_utc: exportCompleted,
    sql_file: SQL_FILE, sql_size_bytes: sqlSize, sql_sha256: sqlHash,
    ...snapshot, git, wrangler_version: wranglerVersion, credentials_source: "CLOUDFLARE_API_TOKEN",
    export_credentials_source: "CLOUDFLARE_D1_BACKUP_TOKEN",
    production_writes: false, restore_automatic: false,
    scope: "D1 SQL only. R2, Cloudflare Images, Worker artifacts and Access configuration are not backed up.",
  };
}

export function incompleteReport(step, error, snapshot, git, env) {
  return { status: "INCOMPLETE", failed_step: step,
    error: redactSecrets(error.message ?? error, env).slice(0, 6000), snapshot, git,
    production_writes: false, completed_at_utc: new Date().toISOString() };
}

async function gitMetadata(root, env) {
  const read = async (args) => (await exec("git", ["--no-optional-locks", "-C", root, ...args],
    { env, windowsHide: true, timeout: 60_000, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
  const commit = await read(["rev-parse", "--verify", "HEAD"]);
  const branch = await read(["rev-parse", "--abbrev-ref", "HEAD"]);
  const dirty = (await read(["status", "--porcelain=v1", "--untracked-files=normal"])).length > 0;
  return { branch, commit, dirty };
}

export async function runBackup(args = process.argv.slice(2)) {
  let step = "preflight", directory, snapshot, git;
  try {
    if (args.some((a) => a !== "--check") || args.length > 1) throw new Error("Only the optional --check argument is accepted.");
    const env = backupEnvironment();
    const ts = require("typescript");
    const configPath = path.join(ROOT, "wrangler.jsonc");
    const parsed = ts.parseConfigFileTextToJson(configPath, await readFile(configPath, "utf8"));
    if (parsed.error) throw new Error("The project's Wrangler JSONC config could not be parsed.");
    const binding = parsed.config.d1_databases?.find((b) => b.binding === "NEWS_DB");
    if (binding?.database_id !== TARGET.databaseId || binding.database_name !== TARGET.databaseName ||
        (parsed.config.account_id && parsed.config.account_id !== TARGET.accountId)) {
      throw new Error("Project NEWS_DB binding does not match the pinned production backup target.");
    }
    const wrangler = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
    await access(wrangler);
    const wranglerVersion = JSON.parse(await readFile(path.join(ROOT, "node_modules", "wrangler", "package.json"), "utf8")).version;
    const help = await exec(process.execPath, [wrangler, "d1", "export", "--help"], { cwd: ROOT, env, windowsHide: true, timeout: 60_000 });
    if (!["--remote", "--output", "--skip-confirmation", "--no-schema", "--no-data"].every((flag) => help.stdout.includes(flag))) {
      throw new Error("Installed Wrangler does not expose the audited full remote SQL export command.");
    }
    step = "read-only production identity, counts and integrity";
    console.log(`KomoBasket Production Backup\nDatabase: ${TARGET.databaseName}\nReading production metadata...`);
    snapshot = await collectSnapshot(createReadOnlyClient(env.CLOUDFLARE_API_TOKEN));
    git = await gitMetadata(ROOT, env);
    console.log(`Players: ${snapshot.counts.league_players}\nTeams: ${snapshot.counts.league_teams}\nCompetitions: ${snapshot.counts.league_competitions}\nGames: ${snapshot.counts.league_games}\nMigrations: ${snapshot.migration_count}\nquick_check: ${snapshot.quick_check}\nFK violations: ${snapshot.foreign_key_violations}`);
    if (args.includes("--check")) {
      console.log("CHECK COMPLETE. Export permission has NOT been tested; no backup folder was created.");
      return snapshot.quick_check === "ok" && snapshot.foreign_key_violations === 0 ? 0 : 2;
    }
    step = "dedicated production export credential";
    const exportEnv = backupExportEnvironment();
    step = "create isolated, non-overwriting backup directory";
    const created = new Date();
    directory = await createBackupDirectory(ROOT, created);
    const marker = path.join(directory, "INCOMPLETE.json");
    await writeFile(marker, JSON.stringify({ status: "INCOMPLETE", snapshot, git }, null, 2), { flag: "wx", mode: 0o600 });
    // A D1-only config in the new backup folder prevents project .env files, named environments,
    // service bindings, or deploy configuration from redirecting the export.
    await writeFile(path.join(directory, "wrangler-backup.json"), JSON.stringify({
      account_id: TARGET.accountId,
      d1_databases: [{ binding: "NEWS_DB", database_name: TARGET.databaseName, database_id: TARGET.databaseId }],
    }, null, 2), { flag: "wx", mode: 0o600 });
    step = "Wrangler full remote D1 SQL export using CLOUDFLARE_D1_BACKUP_TOKEN";
    const exportStarted = new Date().toISOString();
    console.log("Exporting full production SQL with CLOUDFLARE_D1_BACKUP_TOKEN only...");
    try {
      await exec(process.execPath, exportArguments(wrangler, directory), {
        cwd: directory, env: exportEnv, windowsHide: true, timeout: 15 * 60_000, maxBuffer: 8 * 1024 * 1024,
      });
    } catch (error) {
      const details = redactSecrets(`${error.stdout ?? ""}\n${error.stderr ?? ""}`, process.env).trim();
      throw new Error(`Wrangler export failed (exit ${error.code ?? "unknown"}). ${details || "No diagnostic output."}\nNo OAuth or migration/write-token fallback was attempted.`);
    }
    const exportCompleted = new Date().toISOString();
    step = "validate full SQL export and write manifest/checksums";
    const sqlPath = path.join(directory, SQL_FILE);
    const info = await stat(sqlPath);
    if (!info.isFile() || info.size < 1024) throw new Error("Export file is absent, empty or implausibly small.");
    const sqlBytes = await readFile(sqlPath);
    validateSqlExport(sqlBytes.toString("utf8"), snapshot);
    const manifest = makeManifest({ created, snapshot, git, sqlSize: info.size, sqlHash: sha256(sqlBytes), wranglerVersion, exportStarted, exportCompleted });
    const manifestText = JSON.stringify(manifest, null, 2) + "\n";
    const readme = [
      "KomoBasket Production D1 Backup", `Status: ${manifest.status}`,
      `Database: ${TARGET.databaseName}`, `Database ID: ${TARGET.databaseId}`, `UTC: ${manifest.created_at_utc}`,
      `SQL: ${SQL_FILE}`, `SQL SHA-256: ${manifest.sql_sha256}`, `Git commit: ${git.commit}`,
      `Migrations: ${snapshot.migration_count}`, `quick_check: ${snapshot.quick_check}`, `FK violations: ${snapshot.foreign_key_violations}`,
      "Verify SHA256SUMS.txt before a separately reviewed restore rehearsal.",
      "Live metadata counts were collected before export; they are not an atomic export-time snapshot.",
      "An INCOMPLETE.json marker means this folder is NOT a successful backup.",
      "RESTORE IS NOT AUTOMATIC.",
      "Do not import this SQL into production without a separate reviewed restore procedure and a fresh Time Travel checkpoint.",
      "R2 and Cloudflare Images are outside this D1-only backup. Keep backups private and access-controlled.",
    ].join("\n") + "\n";
    await writeFile(path.join(directory, "README.txt"), readme, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(directory, "manifest.json"), manifestText, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(directory, "SHA256SUMS.txt"), `${manifest.sql_sha256}  ${SQL_FILE}\n${sha256(manifestText)}  manifest.json\n`, { flag: "wx", mode: 0o600 });
    await unlink(marker);
    console.log(`Created: ${manifest.created_at_utc}\nSQL: ${path.relative(ROOT, sqlPath)}\nBytes: ${info.size}\nSHA256: ${manifest.sql_sha256}\nManifest SHA256: ${sha256(manifestText)}\n${manifest.status}`);
    return manifest.status === "BACKUP COMPLETE" ? 0 : 2;
  } catch (error) {
    const report = incompleteReport(step, error, snapshot, git, process.env);
    if (directory) {
      try { await writeFile(path.join(directory, "INCOMPLETE.json"), JSON.stringify(report, null, 2), { mode: 0o600 }); }
      catch { console.error("Could not update the INCOMPLETE marker. Do not treat the new folder as a successful backup."); }
      console.error(`Incomplete backup: ${path.relative(ROOT, directory)}`);
    }
    console.error(`HARD STOP\nStep: ${step}\n${report.error}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runBackup();
}
