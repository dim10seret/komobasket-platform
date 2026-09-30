import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const component = readFileSync(new URL("./CompetitionSection.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../../../services/league-admin.service.ts", import.meta.url), "utf8");

describe("root Tournament identity admin UI contract", () => {
  it("keeps Καμία as a deliberate controlled root selection", () => {
    expect(component).toContain('useState<string | null>(null)');
    expect(component).toContain('value={newPhasePreviousId ?? ""}');
    expect(component).toContain('setNewPhasePreviousId(event.target.value || null)');
    expect(component).toContain('<option value="">Καμία</option>');
    expect(component).not.toContain("fallbackPrevious");
  });

  it("switches between editable root metadata and inherited descendant context", () => {
    expect(component).toContain('buildPhaseTournamentGroups');
    expect(component).toContain('name="previousPhaseId"');
    expect(component).toContain('{!newPhasePreviousId ? (');
    expect(component).toContain('Όνομα Θεσμού / Σειράς Φάσεων');
    expect(component).toContain('name="tournamentName"');
    expect(component).toContain('value={newPhaseTournamentName}');
    expect(component).toContain('tournamentGroupByPhaseId.get(newPhasePreviousId)?.tournamentName');
    expect(component).toContain('value="updateTournamentName"');
    expect(component).toContain('tournamentGroup?.finalized ? "Ολοκληρωμένο" : "Σε εξέλιξη"');
  });

  it("submits the canonical root or descendant ownership fields in one phase create", () => {
    expect(service).toContain("const previousPhaseId = resolvePhasePredecessorId(input, current);");
    expect(service).toContain('const requestedTournamentName = String(input.tournamentName ?? input.tournament_name ?? "").trim();');
    expect(service).toContain("if (becomesNewRoot && !requestedTournamentName)");
    expect(service).toContain("previous_phase_id,tournament_name");
    expect(service).toContain("phase.previousPhaseId,");
    expect(service).toContain("phase.tournamentName,");
  });
});
