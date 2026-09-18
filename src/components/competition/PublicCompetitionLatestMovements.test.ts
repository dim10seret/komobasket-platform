import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { selectCompetitionLatestMovements } from "@/lib/competition-latest-movements";

const component = readFileSync(new URL("./PublicCompetitionLatestMovements.tsx", import.meta.url), "utf8");
const view = readFileSync(new URL("./PublicCompetitionsView.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../services/public-competition.service.ts", import.meta.url), "utf8");
const scope = { organizationId: "organization-a", seasonId: "season-a", competitionId: "competition-a" };
const row = (overrides: Record<string, unknown> = {}) => ({ id: "addition", organization_id: "organization-a", season_id: "season-a", competition_id: "competition-a", movement_type: "addition", effective_on: "2026-09-05", created_at: "2026-09-05T10:00:00Z", ...overrides });

describe("public Competition latest movements", () => {
  it("shows addition, transfer and departure newest first", () => {
    const result = selectCompetitionLatestMovements([
      row({ id: "departure", movement_type: "departure", effective_on: "2026-08-28" }),
      row({ id: "transfer", movement_type: "transfer", effective_on: "2026-09-03" }),
      row(),
    ], scope);
    expect(result.map((movement) => movement.id)).toEqual(["addition", "transfer", "departure"]);
  });

  it("excludes another Competition, unsupported types, NULL lineage and foreign Organizations", () => {
    const result = selectCompetitionLatestMovements([
      row({ id: "valid" }), row({ id: "competition-b", competition_id: "competition-b" }),
      row({ id: "registration", movement_type: "registration" }), row({ id: "return", movement_type: "return" }),
      row({ id: "legacy", competition_id: null }), row({ id: "foreign", organization_id: "organization-b" }),
    ], scope);
    expect(result.map((movement) => movement.id)).toEqual(["valid"]);
  });

  it("follows Competition changes and remains independent from Phase", () => {
    const movements = [row({ id: "a" }), row({ id: "b", competition_id: "competition-b" })];
    expect(selectCompetitionLatestMovements(movements, scope).map((movement) => movement.id)).toEqual(["a"]);
    expect(selectCompetitionLatestMovements(movements, { ...scope, competitionId: "competition-b" }).map((movement) => movement.id)).toEqual(["b"]);
  });

  it("uses a filter-free public modal and no admin API", () => {
    expect(view).toContain("PublicCompetitionLatestMovements");
    expect(component).toContain("Τελευταίες Κινήσεις");
    expect(component).toContain("Δεν υπάρχουν καταγεγραμμένες κινήσεις για αυτή τη διοργάνωση.");
    expect(component).not.toContain("/api/admin/");
    expect(component).not.toMatch(/<select|type="search"/);
    expect(service).toContain("JOIN league_competitions c ON c.id=m.competition_id");
    expect(service).toContain("m.movement_type IN ('addition','departure','transfer')");
    expect(service).toContain("ORDER BY m.effective_on DESC, m.created_at DESC, m.id DESC");
  });
});
