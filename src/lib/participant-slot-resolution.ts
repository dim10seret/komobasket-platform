import { resolveFinalizedStandingsPositions, type SeriesCarryOverGameLike, type SeriesCarryOverPhaseLike, type SeriesCarryOverTeamLike } from "@/lib/series-carry-over";
import { resolveFinalizedSeriesOutcomeReference } from "@/lib/series-phase-completion";

export type ParticipantSlotReferenceLike = {
  type?: string | null;
  position?: string | number | null;
  teamId?: string | null;
  matchupId?: string | null;
};

export type ParticipantSlotResolution = {
  state: "resolved" | "pending" | "error" | "bye";
  teamId: string | null;
  teamName: string | null;
  displayLabel: string | null;
  message: string;
};

const resolveTeam = (
  teams: SeriesCarryOverTeamLike[],
  teamId?: string | null,
): ParticipantSlotResolution => {
  const id = String(teamId ?? "").trim();
  const team = teams.find((entry) => String(entry.id ?? "").trim() === id);
  if (!id || !team) {
    return { state: "pending", teamId: null, teamName: null, displayLabel: null, message: "Σε αναμονή προσδιορισμού ομάδας." };
  }
  const teamName = String(team.name ?? "—");
  return { state: "resolved", teamId: id, teamName, displayLabel: teamName, message: "" };
};

export function resolveParticipantSlotReference(
  phases: SeriesCarryOverPhaseLike[],
  games: SeriesCarryOverGameLike[],
  teams: SeriesCarryOverTeamLike[],
  sourcePhaseId: string | null | undefined,
  slot: ParticipantSlotReferenceLike,
): ParticipantSlotResolution {
  const type = String(slot.type ?? "").trim().toLowerCase();

  if (type === "bye") {
    return { state: "bye", teamId: null, teamName: null, displayLabel: "BYE", message: "Άμεση πρόκριση χωρίς αγώνα." };
  }

  if (type === "fixed_team" || type === "manual") {
    return resolveTeam(teams, slot.teamId);
  }

  if (type === "standing_position") {
    const rawPosition = String(slot.position ?? "").trim();
    const position = Number(rawPosition.startsWith("direct:") ? rawPosition.slice("direct:".length) : rawPosition);
    if (!Number.isInteger(position) || position < 1) {
      return { state: "pending", teamId: null, teamName: null, displayLabel: null, message: "Μη έγκυρη θέση βαθμολογίας." };
    }
    const standings = resolveFinalizedStandingsPositions(phases, games, teams, sourcePhaseId);
    const resolved = standings.positions.find((entry) => entry.position === position);
    if (!resolved) {
      return { state: standings.state, teamId: null, teamName: null, displayLabel: null, message: standings.message };
    }
    return {
      state: "resolved",
      teamId: resolved.teamId,
      teamName: resolved.teamName,
      displayLabel: `#${position} ${resolved.teamName}`,
      message: "",
    };
  }

  if (type === "matchup_winner" || type === "matchup_loser") {
    const outcome = resolveFinalizedSeriesOutcomeReference(
      phases,
      games,
      teams,
      sourcePhaseId,
      slot.matchupId,
      type === "matchup_winner" ? "winner" : "loser",
    );
    return {
      state: outcome.state,
      teamId: outcome.teamId,
      teamName: outcome.teamName,
      displayLabel: outcome.state === "resolved" ? outcome.teamName : null,
      message: outcome.message,
    };
  }

  return { state: "pending", teamId: null, teamName: null, displayLabel: null, message: "Μη υποστηριζόμενη πηγή συμμετοχής." };
}
