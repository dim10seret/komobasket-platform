import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { selectCompetitionLatestMovements } from "../../../../lib/competition-latest-movements.ts";

const source = (relativePath) => fs.readFileSync(path.resolve(import.meta.dirname, relativePath), "utf8");
const scope = { organizationId: "organization-a", seasonId: "season-2026", competitionId: "competition-a" };

const movement = (overrides = {}) => ({
  id: "movement-default",
  organization_id: "organization-a",
  season_id: "season-2026",
  competition_id: "competition-a",
  movement_type: "addition",
  effective_on: "2026-09-05",
  created_at: "2026-09-05T10:00:00Z",
  player_name: "Player",
  from_team_name: null,
  to_team_name: "Team",
  ...overrides,
});

describe("Competition latest movements", () => {
  it("returns all supported movements newest first with deterministic ties", () => {
    const result = selectCompetitionLatestMovements([
      movement({ id: "departure", movement_type: "departure", effective_on: "2026-08-28" }),
      movement({ id: "transfer", movement_type: "transfer", effective_on: "2026-09-03" }),
      movement({ id: "addition-old", created_at: "2026-09-05T09:00:00Z" }),
      movement({ id: "addition-new", created_at: "2026-09-05T11:00:00Z" }),
    ], scope);
    expect(result.map((row) => row.id)).toEqual(["addition-new", "addition-old", "transfer", "departure"]);
  });

  it("excludes other Competitions, Organizations, unsupported types and legacy null lineage", () => {
    const result = selectCompetitionLatestMovements([
      movement({ id: "valid" }),
      movement({ id: "other-competition", competition_id: "competition-b" }),
      movement({ id: "registration", movement_type: "registration" }),
      movement({ id: "return", movement_type: "return" }),
      movement({ id: "legacy-null", competition_id: null }),
      movement({ id: "foreign", organization_id: "organization-b" }),
    ], scope);
    expect(result.map((row) => row.id)).toEqual(["valid"]);
  });

  it("returns an empty list when the selected Competition has no movements", () => {
    expect(selectCompetitionLatestMovements([], scope)).toEqual([]);
  });

  it("keeps the view read-only, filter-free and backed by canonical Competition lineage", () => {
    const component = source("./CompetitionSection.tsx");
    const api = source("../../../../app/api/admin/league/route.ts");
    const service = source("../../../../services/league-admin.service.ts");
    expect(component).toContain("Τελευταίες Κινήσεις");
    expect(component).toContain("Δεν υπάρχουν καταγεγραμμένες κινήσεις για αυτή τη διοργάνωση.");
    expect(component).toContain("selectedCompetition && selectedSeason");
    expect(api).toContain('view === "competition-latest-movements"');
    expect(service).toContain("WHERE m.competition_id=?");
    expect(service).toContain("m.movement_type IN ('addition','departure','transfer')");
    expect(service).toContain("ORDER BY m.effective_on DESC, m.created_at DESC, m.id DESC");
    expect(service).not.toContain("m.competition_id IS NULL");
  });
});
