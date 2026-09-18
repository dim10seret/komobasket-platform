import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const service = readFileSync(new URL("./platform-match-report.service.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/admin/match-reports/[gameId]/route.ts", import.meta.url), "utf8");

describe("Platform Match Report service boundary", () => {
  it("loads list availability in one organization-scoped batch", () => { expect(service).toContain("listPlatformMatchReportAvailabilityWithDb"); expect(service).toContain("WHERE competition.organization_id=?"); expect(service).not.toContain("Promise.all(gameIds"); });
  it("does not require an auxiliary game-runs row", () => expect(service).not.toContain("league_komocontrol_game_runs"));
  it("uses authoritative finalized tables", () => { for (const table of ["league_komocontrol_gameplay_game_claims", "league_komocontrol_gameplay_heads", "league_komocontrol_match_finalizations_v1", "league_komocontrol_match_engine_snapshots_v1", "league_komocontrol_match_events_v2"]) expect(service).toContain(table); });
  it("replays complete canonical history for detail", () => { expect(service).toContain("projectPublicLiveGame"); expect(service).toContain("ORDER BY sequence, event_id"); });
  it("projects statistics from the finalized and initial Run snapshots", () => { expect(service).toContain("projectPlatformMatchReportStatistics"); expect(service).toContain("row.initial_state_json"); expect(service).toContain("row.final_state_json"); });
  it("projects recording mode from the immutable package pinned to the Run snapshot", () => { expect(service).toContain("game_package.id=snapshot.package_id"); expect(service).toContain("game_package.snapshot_json AS package_snapshot_json"); expect(service).toContain("mode: platformMatchReportMode(row.package_snapshot_json)"); });
  it("exposes finalized immutable artifacts only to the server-side Game Sheet projection", () => { expect(service).toContain("readPlatformMatchReportFinalizedSourceWithDb"); expect(service).toContain("currentConfigurationJson: row.configuration_json"); expect(service).toContain("eventJson: events.map"); });
  it("does not read today's mutable league roster for box-score rows", () => expect(service).not.toContain("league_players"));
  it("keeps private persistence metadata out of the public DTO", () => { const types = readFileSync(new URL("../lib/platform-match-report.ts", import.meta.url), "utf8"); const dto = types.slice(types.indexOf("export type PlatformMatchReport ="), types.indexOf("export type PlatformMatchReportConsistencySource =")); expect(dto).not.toContain("scorerId"); expect(dto).not.toContain("deviceId"); expect(dto).not.toContain("historyHash:"); expect(dto).not.toContain("finalizationHash:"); });
  it("provides batch fail-closed availability to public competition cards", () => { const competition = readFileSync(new URL("./public-competition.service.ts", import.meta.url), "utf8"); expect(competition).toContain("listPlatformMatchReportAvailabilityWithDb"); expect(competition).toContain("finalizedStatisticsAvailable"); });
  it("exposes a protected read-only GET route", () => { expect(route).toContain("requireAdmin(request)"); expect(route).toContain('requireGameAccess(user, gameId, "read")'); expect(route).toContain("export async function GET"); expect(route).not.toContain("export async function POST"); expect(route).not.toContain(".run("); });
  it("returns an explicit fail-closed unavailable response", () => { expect(route).toContain("MATCH_REPORT_UNAVAILABLE"); expect(route).toContain("status: 409"); });
});
