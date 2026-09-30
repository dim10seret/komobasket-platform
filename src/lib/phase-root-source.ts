type PhaseRow = Record<string, string | number | null>;

export type PhaseLineageRow = {
  id: string;
  competition_id: string;
  previous_phase_id?: string | null;
  tournament_name?: string | null;
  name?: string | null;
  phase_order?: string | number | null;
  order_index?: string | number | null;
  lifecycle_status?: string | null;
};

export type PhaseTournamentGraph = {
  phaseById: Map<string, PhaseLineageRow>;
  rootPhaseIdByPhaseId: Map<string, string>;
  descendantPhaseIdsByRootPhaseId: Map<string, string[]>;
  effectiveTournamentNameByRootPhaseId: Map<string, string>;
};

export type PhaseTournamentGroup<T extends PhaseLineageRow = PhaseLineageRow> = {
  rootPhaseId: string;
  tournamentName: string;
  phases: T[];
  finalized: boolean;
};

export class PhaseLineageError extends Error {
  constructor(
    public readonly code: "INVALID_PHASE" | "NON_UNIQUE_PHASE" | "MISSING_PREDECESSOR" | "CROSS_COMPETITION_PREDECESSOR" | "CYCLE",
    message: string,
  ) {
    super(message);
    this.name = "PhaseLineageError";
  }
}

type PhaseSnapshot = {
  organizationContext: { organizationId: string };
  competitions: PhaseRow[];
  teams: PhaseRow[];
  participations: PhaseRow[];
};

export function resolvePhasePredecessorId(input: Record<string, unknown>, current?: { previous_phase_id?: unknown }): string | null {
  return String(input.previousPhaseId ?? input.previous_phase_id ?? current?.previous_phase_id ?? "").trim() || null;
}

function phaseOrder(row: PhaseLineageRow) {
  const value = Number(row.phase_order ?? row.order_index ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function resolvePhaseTournamentGraph(phases: PhaseLineageRow[]): PhaseTournamentGraph {
  const phaseById = new Map<string, PhaseLineageRow>();
  for (const rawPhase of phases) {
    const id = String(rawPhase.id ?? "").trim();
    const competitionId = String(rawPhase.competition_id ?? "").trim();
    if (!id || !competitionId) {
      throw new PhaseLineageError("INVALID_PHASE", "Κάθε φάση πρέπει να έχει id και διοργάνωση.");
    }
    if (phaseById.has(id)) {
      throw new PhaseLineageError("NON_UNIQUE_PHASE", `Η φάση ${id} εμφανίζεται περισσότερες από μία φορές.`);
    }
    phaseById.set(id, {
      ...rawPhase,
      id,
      competition_id: competitionId,
      previous_phase_id: String(rawPhase.previous_phase_id ?? "").trim() || null,
    });
  }

  const state = new Map<string, 0 | 1 | 2>();
  const rootPhaseIdByPhaseId = new Map<string, string>();
  const resolveRoot = (phaseId: string): string => {
    const resolved = rootPhaseIdByPhaseId.get(phaseId);
    if (resolved) return resolved;
    if (state.get(phaseId) === 1) {
      throw new PhaseLineageError("CYCLE", "Η ακολουθία προηγούμενων φάσεων περιέχει κύκλο.");
    }
    const phase = phaseById.get(phaseId);
    if (!phase) {
      throw new PhaseLineageError("MISSING_PREDECESSOR", `Δεν βρέθηκε η φάση ${phaseId}.`);
    }
    state.set(phaseId, 1);
    const previousPhaseId = String(phase.previous_phase_id ?? "").trim();
    let rootPhaseId = phaseId;
    if (previousPhaseId) {
      const predecessor = phaseById.get(previousPhaseId);
      if (!predecessor) {
        throw new PhaseLineageError("MISSING_PREDECESSOR", `Δεν βρέθηκε η προηγούμενη φάση ${previousPhaseId}.`);
      }
      if (predecessor.competition_id !== phase.competition_id) {
        throw new PhaseLineageError("CROSS_COMPETITION_PREDECESSOR", "Η προηγούμενη φάση πρέπει να ανήκει στην ίδια διοργάνωση.");
      }
      rootPhaseId = resolveRoot(previousPhaseId);
    }
    rootPhaseIdByPhaseId.set(phaseId, rootPhaseId);
    state.set(phaseId, 2);
    return rootPhaseId;
  };

  for (const phaseId of phaseById.keys()) resolveRoot(phaseId);

  const descendantPhaseIdsByRootPhaseId = new Map<string, string[]>();
  for (const [phaseId, rootPhaseId] of rootPhaseIdByPhaseId) {
    const entries = descendantPhaseIdsByRootPhaseId.get(rootPhaseId) ?? [];
    entries.push(phaseId);
    descendantPhaseIdsByRootPhaseId.set(rootPhaseId, entries);
  }
  for (const entries of descendantPhaseIdsByRootPhaseId.values()) {
    entries.sort((leftId, rightId) => {
      const left = phaseById.get(leftId)!;
      const right = phaseById.get(rightId)!;
      return phaseOrder(left) - phaseOrder(right) || left.id.localeCompare(right.id);
    });
  }

  const effectiveTournamentNameByRootPhaseId = new Map<string, string>();
  for (const rootPhaseId of descendantPhaseIdsByRootPhaseId.keys()) {
    const root = phaseById.get(rootPhaseId)!;
    effectiveTournamentNameByRootPhaseId.set(
      rootPhaseId,
      String(root.tournament_name ?? "").trim() || String(root.name ?? "").trim() || rootPhaseId,
    );
  }

  return {
    phaseById,
    rootPhaseIdByPhaseId,
    descendantPhaseIdsByRootPhaseId,
    effectiveTournamentNameByRootPhaseId,
  };
}

export function buildPhaseTournamentGroups<T extends PhaseLineageRow>(phases: T[]): PhaseTournamentGroup<T>[] {
  const graph = resolvePhaseTournamentGraph(phases);
  return [...graph.descendantPhaseIdsByRootPhaseId.entries()]
    .map(([rootPhaseId, phaseIds]) => ({
      rootPhaseId,
      tournamentName: graph.effectiveTournamentNameByRootPhaseId.get(rootPhaseId) ?? rootPhaseId,
      phases: phaseIds.map((phaseId) => graph.phaseById.get(phaseId) as T),
      finalized: phaseIds.every((phaseId) => String(graph.phaseById.get(phaseId)?.lifecycle_status ?? "active") === "finalized"),
    }))
    .sort((left, right) => {
      const leftRoot = graph.phaseById.get(left.rootPhaseId)!;
      const rightRoot = graph.phaseById.get(right.rootPhaseId)!;
      return phaseOrder(leftRoot) - phaseOrder(rightRoot) || left.rootPhaseId.localeCompare(right.rootPhaseId);
    });
}

export function getRootPhaseCompetitionTeams(data: PhaseSnapshot, competitionId: string) {
  const competition = data.competitions.find((entry) => String(entry.id ?? "") === competitionId);
  const organizationId = String(competition?.organization_id ?? "").trim();
  if (!organizationId || (data.organizationContext.organizationId && data.organizationContext.organizationId !== organizationId)) return [];

  const teamsById = new Map(data.teams
    .filter((team) => String(team.organization_id ?? "") === organizationId)
    .map((team) => [String(team.id ?? ""), team]));
  const seen = new Set<string>();
  const teams: Array<{ team_id: string; team_name: string }> = [];
  for (const participation of data.participations) {
    if (String(participation.competition_id ?? "") !== competitionId || String(participation.status ?? "") !== "active") continue;
    if (String(participation.season_id ?? "") !== String(competition?.season_id ?? "")) continue;
    const teamId = String(participation.team_id ?? "").trim();
    const team = teamsById.get(teamId);
    if (!teamId || !team || seen.has(teamId)) continue;
    seen.add(teamId);
    teams.push({ team_id: teamId, team_name: String(team.name ?? "—") });
  }
  return teams.sort((left, right) => left.team_name.localeCompare(right.team_name, "el-GR"));
}

export function isEligibleRootSeriesSlot(slot: Record<string, unknown>, activeTeamIds: Set<string>) {
  const type = String(slot.type ?? "").trim();
  if (type === "bye") return true;
  return type === "manual" && activeTeamIds.has(String(slot.teamId ?? "").trim());
}
