type PhaseRow = Record<string, string | number | null>;

type PhaseSnapshot = {
  organizationContext: { organizationId: string };
  competitions: PhaseRow[];
  teams: PhaseRow[];
  participations: PhaseRow[];
};

export function resolvePhasePredecessorId(input: Record<string, unknown>, current?: { previous_phase_id?: unknown }): string | null {
  return String(input.previousPhaseId ?? input.previous_phase_id ?? current?.previous_phase_id ?? "").trim() || null;
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
