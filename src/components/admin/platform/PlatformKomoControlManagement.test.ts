import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resultPolicyFields, resultPolicySelection } from "./PlatformKomoControlManagement";

const component = readFileSync(new URL("./PlatformKomoControlManagement.tsx", import.meta.url), "utf8");
const adminService = readFileSync(new URL("../../../services/komocontrol-admin.service.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../../../../cloudflare/migrations/0019_komocontrol_foundation.sql", import.meta.url), "utf8");
const packageDownload = readFileSync(new URL("../../../../komocontrol/electron/games/game-package-download.cts", import.meta.url), "utf8");
const matchSetup = readFileSync(new URL("../../../../komocontrol/electron/games/match-setup.cts", import.meta.url), "utf8");
const app = readFileSync(new URL("../../../../komocontrol/src/App.tsx", import.meta.url), "utf8");
const liveControl = readFileSync(new URL("../../../../komocontrol/src/components/LiveControl.tsx", import.meta.url), "utf8");
const gameplayRuntime = readFileSync(new URL("../../../../komocontrol/electron/runs/gameplay-runtime.cts", import.meta.url), "utf8");
const desktopTypes = readFileSync(new URL("../../../../komocontrol/src/types/desktop.d.ts", import.meta.url), "utf8");
const matchEngineBootstrap = readFileSync(new URL("../../../../komocontrol/electron/runs/match-engine-bootstrap.cts", import.meta.url), "utf8");
const matchReport = readFileSync(new URL("../../../services/platform-match-report.service.ts", import.meta.url), "utf8");

const recordingModeSelectors = component.match(/<select name="game_mode"[\s\S]*?<\/select>/g) ?? [];

describe("KomoControl recording mode propagation", () => {
  it("offers FULL and SIMPLE in both visible recording-mode selectors", () => {
    expect(recordingModeSelectors).toHaveLength(2);
    for (const selector of recordingModeSelectors) {
      expect(selector).toContain('<option value="FULL">Πλήρη στατιστικά</option>');
      expect(selector).toContain('<option value="SIMPLE">Απλό φύλλο αγώνα</option>');
    }
    expect(recordingModeSelectors[0]).toContain('defaultValue={currentSettings.game_mode}');
    expect(recordingModeSelectors[1]).toContain('defaultValue={values.game_mode}');
  });

  it("uses FULL for renderer and application defaults", () => {
    expect(component).toContain('const initial: EffectiveGameSettings = { game_mode: "FULL"');
    expect(adminService).toContain('game_mode: "FULL" as GameMode');
  });

  it("performs no settings write while merely loading an existing competition", () => {
    const loadFlow = component.slice(component.indexOf("const load = useCallback"), component.indexOf("useEffect(() => { void load();"));
    expect(loadFlow).toContain('fetch(endpoint("settings"');
    expect(loadFlow).toContain('cache: "no-store"');
    expect(loadFlow).not.toContain('method: "POST"');
    expect(loadFlow).not.toContain('method: "PATCH"');
  });

  it("posts the selected recording mode only after the organizer explicitly submits either form", () => {
    expect(recordingModeSelectors.every((selector) => selector.includes('name="game_mode"'))).toBe(true);
    expect(component).toContain("async function saveSettings(event: FormEvent<HTMLFormElement>) { event.preventDefault()");
    expect(component).toContain("async function saveGameSettings(event: FormEvent<HTMLFormElement>) { event.preventDefault()");
    expect(component).toContain("Object.fromEntries(f)");
    expect(component).toContain("Object.fromEntries(form)");
  });

  it("keeps backend validation compatible with SIMPLE and FULL", () => {
    expect(adminService).toContain('game_mode !== "SIMPLE" && game_mode !== "FULL"');
    expect(adminService).toContain('type GameMode = "SIMPLE" | "FULL"');
  });

  it("keeps existing SIMPLE database rows and overrides parseable", () => {
    expect(adminService).toContain('input.game_mode === "FULL" ? "FULL" : "SIMPLE"');
    expect(adminService).toContain('value === "SIMPLE" || value === "FULL"');
  });

  it("preserves competition inheritance and nullable game override semantics", () => {
    expect(adminService).toContain("if (override) for (const key of settingKeys) if (override[key] !== null && override[key] !== undefined) merged[key] = override[key]");
    expect(adminService).toContain("game_mode: nullableMode(values.game_mode)");
    expect(adminService).toContain("DELETE FROM league_game_komocontrol_overrides WHERE game_id=?");
  });

  it("keeps the SQL default unchanged because every settings insert supplies game_mode", () => {
    expect(schema).toContain("game_mode TEXT NOT NULL DEFAULT 'SIMPLE'");
    expect(adminService).toContain("(competition_id, game_mode, min_players");
    expect(adminService).toContain("(game_id, game_mode, min_players");
  });

  it("keeps GamePackage schema version one and accepts legacy SIMPLE packages", () => {
    expect(packageDownload).toContain('game_mode: "SIMPLE" | "FULL"');
    expect(packageDownload).toContain('item.game_mode !== "SIMPLE" && item.game_mode !== "FULL"');
    expect(packageDownload).toContain("packageSchemaVersion: 1");
  });

  it("publishes the resolved recording mode without rewriting old packages", () => {
    expect(adminService).toContain("const snapshot: GamePackageV1 = { schemaVersion: 1");
    expect(adminService).toContain("settings: effective");
    expect(adminService).not.toContain("UPDATE league_komocontrol_game_packages SET snapshot_json");
  });

  it("preserves the package mode in Match Setup and displays legacy truth", () => {
    expect(matchSetup).toContain("gameMode: payload.settings.game_mode");
    expect(app).toContain('matchSetup.settings.gameMode === "FULL" ? "Πλήρη στατιστικά" : "Απλό φύλλο αγώνα"');
  });

  it("projects pinned recording mode to LiveControl without introducing MatchEngine branching", () => {
    expect(gameplayRuntime).toContain('gameMode: recovery.setup.settings.gameMode');
    expect(desktopTypes).toContain('gameMode: "SIMPLE" | "FULL"');
    expect(liveControl).toContain('gameplay.gameMode === "FULL" ? "Πλήρη στατιστικά" : "Απλό φύλλο"');
    expect(matchEngineBootstrap).not.toContain("gameMode");
  });

  it("does not introduce recording-mode branching into downstream Match Reports", () => {
    expect(matchReport).not.toContain("game_mode");
    expect(matchReport).not.toContain("gameMode");
  });
});
describe("KomoControl result policy single-choice UI", () => {
  it("maps Απαιτείται νικητής to the existing REQUIRE_WINNER fields", () => {
    expect(resultPolicyFields("REQUIRE_WINNER")).toEqual({ tie_allowed: false, winner_required: true });
  });

  it("maps Επιτρέπεται ισοπαλία to the existing ALLOW_TIE fields", () => {
    expect(resultPolicyFields("ALLOW_TIE")).toEqual({ tie_allowed: true, winner_required: false });
  });

  it("selects Απαιτείται νικητής for existing false/true values", () => {
    expect(resultPolicySelection({ tie_allowed: false, winner_required: true })).toBe("REQUIRE_WINNER");
  });

  it("selects Επιτρέπεται ισοπαλία for existing true/false effective values", () => {
    expect(resultPolicySelection({ tie_allowed: true, winner_required: false })).toBe("ALLOW_TIE");
    expect(component).toContain("const currentSettings = preview?.effective || initial");
  });

  it("uses one required radio group in both forms and cannot emit an incoherent pair", () => {
    expect(component.match(/<ResultPolicyFieldset key=/g)).toHaveLength(2);
    expect(component).toContain('name="result_policy" type="radio" value="REQUIRE_WINNER" required');
    expect(component).toContain('name="result_policy" type="radio" value="ALLOW_TIE" required');
    expect(component).not.toContain('name="tie_allowed" type="checkbox"');
    expect(component).not.toContain('name="winner_required" type="checkbox"');
    for (const value of ["REQUIRE_WINNER", "ALLOW_TIE", null]) {
      const fields = resultPolicyFields(value);
      expect(fields.tie_allowed).not.toBe(fields.winner_required);
    }
  });

  it("keeps REQUIRE_WINNER as the default policy and preserves the backend field names", () => {
    expect(component).toContain('tie_allowed: false, winner_required: true');
    expect(resultPolicyFields(null)).toEqual({ tie_allowed: false, winner_required: true });
    expect(component).toContain('...resultPolicyFields(f.get("result_policy"))');
    expect(component).toContain('...resultPolicyFields(form.get("result_policy"))');
  });
});
