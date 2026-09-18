import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
test("game officials use optional organization-scoped canonical assignments", () => { const service = source("./komocontrol-admin.service.ts"); const migration = source("../../cloudflare/migrations/0031_game_official_assignments.sql"); assert.match(migration, /PRIMARY KEY \(game_id, slot_code\)/); assert.match(migration, /REFERENCES league_referees\(id\)/); assert.match(migration, /REFERENCES league_table_officials\(id\)/); assert.match(service, /organization_id=\? AND active=1/); assert.match(service, /officials, teams/); });
test("Platform exposes all seven optional slots", () => { const component = source("../components/admin/platform/PlatformKomoControlManagement.tsx"); for (const label of ["Διαιτητής Α", "Διαιτητής Β", "Διαιτητής Γ", "Χρονόμετρο", "24''", "Φύλλο Αγώνα", "Κομισάριος"]) assert.ok(component.includes(label)); assert.ok(component.includes('<option value="">— Κανένας —</option>')); });
