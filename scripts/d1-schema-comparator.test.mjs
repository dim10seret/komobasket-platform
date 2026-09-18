import assert from "node:assert/strict";
import test from "node:test";
import { compareApplicationSchemas } from "./d1-schema-comparator.mjs";

const table = (name, sql = `CREATE TABLE ${name} (id TEXT PRIMARY KEY)`) =>
  ({ type: "table", name, tbl_name: name, sql });
const players = table("league_players");
const internal = table("_cf_KV");
const credentials = table("league_user_credentials");
const sessions = table("league_user_sessions");

test("A: baseline without _cf_KV matches production containing _cf_KV", () => {
  const result = compareApplicationSchemas([players], [players, internal]);
  assert.equal(result.status, "PASS");
  assert.deepEqual(result.excludedActual, [{ type: "table", name: "_cf_KV" }]);
});

test("B: a missing real application table fails", () => {
  const result = compareApplicationSchemas([players], [internal]);
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.missing, [players]);
});

test("C: an unexpected real application table fails", () => {
  const extra = table("league_unapproved");
  const result = compareApplicationSchemas([players], [players, internal, extra]);
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.unexpected, [extra]);
});

test("D: credentials and sessions remain visible and require explicit approval", () => {
  const actual = [players, internal, credentials, sessions];
  const unapproved = compareApplicationSchemas([players], actual);
  assert.equal(unapproved.status, "FAIL");
  assert.deepEqual(unapproved.unexpected, [credentials, sessions]);
  const approved = compareApplicationSchemas([players], actual, {
    approvedAdditions: [credentials, sessions],
  });
  assert.equal(approved.status, "PASS");
  assert.deepEqual(approved.intentionalAdditions, [credentials, sessions]);
});

test("backup, production, rehearsal and future comparisons use symmetric filtering", () => {
  const sqlite = { type: "index", name: "sqlite_autoindex_league_players_1",
    tbl_name: "league_players", sql: null };
  const snapshots = [[players], [internal, players], [players, sqlite, internal]];
  for (const baseline of snapshots) {
    for (const actual of snapshots) {
      assert.equal(compareApplicationSchemas(baseline, actual).status, "PASS");
    }
  }
});

test("unknown _cf_* objects are not broadly ignored", () => {
  const extra = table("_cf_unapproved_application_table");
  const result = compareApplicationSchemas([players], [players, extra]);
  assert.equal(result.status, "FAIL");
  assert.deepEqual(result.unexpected, [extra]);
});

test("changed application SQL and changed approved-addition SQL fail", () => {
  const changed = table("league_players", "CREATE TABLE league_players (id INTEGER)");
  assert.equal(compareApplicationSchemas([players], [changed]).status, "FAIL");
  const changedSessions = table("league_user_sessions", "CREATE TABLE league_user_sessions (id INTEGER)");
  assert.equal(compareApplicationSchemas([players], [players, changedSessions], {
    approvedAdditions: [sessions],
  }).status, "FAIL");
});

test("missing approved additions and duplicate schema objects fail closed", () => {
  assert.equal(compareApplicationSchemas([players], [players], {
    approvedAdditions: [credentials, sessions],
  }).status, "FAIL");
  assert.throws(() => compareApplicationSchemas([players], [players, players]), /DUPLICATE_SCHEMA_OBJECT/);
  assert.throws(() => compareApplicationSchemas([players], [players], {
    approvedAdditions: [internal],
  }), /INTERNAL_OBJECT_CANNOT_BE_APPROVED_ADDITION/);
});
