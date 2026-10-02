export type ProgramPhaseTournamentGroup<TPhase> = {
  rootPhaseId: string;
  tournamentName: string;
  phases: TPhase[];
  finalized: boolean;
};

export type ProgramScheduleGroup<TPhase, TSchedule> = ProgramPhaseTournamentGroup<TPhase> & {
  schedules: TSchedule[];
};

export function groupProgramSchedulesByPhaseTournament<
  TPhase extends { id?: unknown },
  TSchedule extends { phase_id?: unknown },
>(
  phaseGroups: ProgramPhaseTournamentGroup<TPhase>[],
  schedules: TSchedule[],
): ProgramScheduleGroup<TPhase, TSchedule>[] {
  const schedulesByPhaseId = new Map<string, TSchedule[]>();
  for (const schedule of schedules) {
    const phaseId = String(schedule.phase_id ?? "");
    const entries = schedulesByPhaseId.get(phaseId) ?? [];
    entries.push(schedule);
    schedulesByPhaseId.set(phaseId, entries);
  }

  return phaseGroups
    .map((group) => ({
      ...group,
      schedules: group.phases.flatMap((phase) => schedulesByPhaseId.get(String(phase.id ?? "")) ?? []),
    }))
    .filter((group) => group.schedules.length > 0);
}
