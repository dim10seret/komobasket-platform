import { MatchEngine } from "../engine/match-engine";
import type { MatchEvent } from "../types/event";
import type { MatchState } from "../types/match-state";
import type { TeamSide } from "../types/team-side";
import { requireSupabase } from "./supabase-client";

export interface PersistedMatchContext {
  matchId: string;
  periodId: string;
  teamIds: Record<TeamSide, string>;
  playerIds: Record<string, string>;
}

interface PersistedEventRow {
  payload: MatchEvent;
}

export interface MatchEventAuditEntry {
  id: string;
  eventId: string | null;
  action: "UPDATE" | "DELETE";
  previousEvent: MatchEvent;
  nextEvent: MatchEvent | null;
  correctionReason: string | null;
  actorId: string | null;
  createdAt: string;
}

interface PersistedAuditRow {
  id: string;
  event_id: string | null;
  action: "UPDATE" | "DELETE";
  previous_event: MatchEvent;
  next_event: MatchEvent | null;
  correction_reason: string | null;
  actor_id: string | null;
  created_at: string;
}

interface PeriodRow {
  id: string;
}

interface TeamRegistrationRow { id: string; team_id: string; }
interface PlayerRegistrationRow { id: string; player_id: string; }

export class MatchPersistenceService {
  async saveInitialState(matchId: string, initialState: MatchState): Promise<void> {
    const { error } = await requireSupabase()
      .from("match_engine_snapshots")
      .upsert({ match_id: matchId, initial_state: initialState }, { onConflict: "match_id" });
    if (error) throw error;
  }

  async appendEvent(context: PersistedMatchContext, event: MatchEvent): Promise<void> {
    const { error } = await requireSupabase().from("match_events").insert(this.eventRecord(context, event));
    if (error) throw error;
  }

  async correctEvent(context: PersistedMatchContext, event: MatchEvent, reason: string): Promise<void> {
    const correctionReason = this.requireCorrectionReason(reason);
    const { data, error } = await requireSupabase()
      .from("match_events")
      .update({ ...this.eventRecord(context, event), correction_reason: correctionReason })
      .eq("match_id", context.matchId)
      .eq("engine_event_id", event.id)
      .eq("is_deleted", false)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The event could not be corrected or you do not have correction access.");
  }

  async deleteEvent(matchId: string, eventId: string, reason: string): Promise<void> {
    const correctionReason = this.requireCorrectionReason(reason);
    const { data, error } = await requireSupabase()
      .from("match_events")
      .update({ is_deleted: true, correction_reason: correctionReason })
      .eq("match_id", matchId)
      .eq("engine_event_id", eventId)
      .eq("is_deleted", false)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("The event could not be deleted or you do not have correction access.");
  }

  async getContext(matchId: string, state: MatchState): Promise<PersistedMatchContext> {
    const client = requireSupabase();
    const { data: period, error: periodError } = await client
      .from("game_periods")
      .select("id")
      .eq("match_id", matchId)
      .eq("period_number", state.quarter)
      .maybeSingle();
    if (periodError) throw periodError;

    let periodId = (period as PeriodRow | null)?.id;
    if (!periodId) {
      const { data: createdPeriod, error: createPeriodError } = await client
        .from("game_periods")
        .insert({
          match_id: matchId,
          period_number: state.quarter,
          sequence: state.quarter,
          period_type: state.quarter > 4 ? "OT" : "Q",
          status: "live",
          duration_seconds: state.quarter > 4 ? 300 : 600,
          remaining_seconds: state.clock,
          clock_running: state.clockRunning,
        })
        .select("id")
        .single();
      if (createPeriodError) throw createPeriodError;
      periodId = (createdPeriod as PeriodRow).id;
    }

    const registrationIds = [state.home.id, state.away.id];
    const playerRegistrationIds = [...state.home.players, ...state.away.players].map((player) => player.id);
    const [{ data: teams, error: teamsError }, { data: players, error: playersError }] = await Promise.all([
      client.from("team_registrations").select("id,team_id").in("id", registrationIds),
      client.from("player_registrations").select("id,player_id").in("id", playerRegistrationIds),
    ]);
    if (teamsError) throw teamsError;
    if (playersError) throw playersError;
    const teamMap = new Map((teams as TeamRegistrationRow[]).map((team) => [team.id, team.team_id]));
    const playerMap = new Map((players as PlayerRegistrationRow[]).map((player) => [player.id, player.player_id]));
    const homeTeamId = teamMap.get(state.home.id);
    const awayTeamId = teamMap.get(state.away.id);
    if (!homeTeamId || !awayTeamId) throw new Error("Δεν βρέθηκε η πραγματική ομάδα για τον αγώνα.");

    return {
      matchId,
      periodId,
      teamIds: { HOME: homeTeamId, AWAY: awayTeamId },
      playerIds: Object.fromEntries(playerMap),
    };
  }

  async loadEvents(matchId: string): Promise<MatchEvent[]> {
    const { data, error } = await requireSupabase()
      .from("match_events")
      .select("payload")
      .eq("match_id", matchId)
      .eq("is_deleted", false)
      .order("sequence_no", { ascending: true });
    if (error) throw error;
    return (data as PersistedEventRow[]).map((row) => row.payload);
  }

  async loadAuditTrail(matchId: string): Promise<MatchEventAuditEntry[]> {
    const { data, error } = await requireSupabase()
      .from("match_event_audit")
      .select("id, event_id, action, previous_event, next_event, correction_reason, actor_id, created_at")
      .eq("match_id", matchId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as PersistedAuditRow[]).map((row) => ({
      id: row.id,
      eventId: row.event_id,
      action: row.action,
      previousEvent: row.previous_event,
      nextEvent: row.next_event,
      correctionReason: row.correction_reason,
      actorId: row.actor_id,
      createdAt: row.created_at,
    }));
  }

  async replay(matchId: string): Promise<MatchEngine> {
    const client = requireSupabase();
    const { data: snapshot, error: snapshotError } = await client
      .from("match_engine_snapshots")
      .select("initial_state")
      .eq("match_id", matchId)
      .single();
    if (snapshotError) throw snapshotError;

    const engine = MatchEngine.fromInitialState(snapshot.initial_state as MatchState);
    for (const event of await this.loadEvents(matchId)) {
      const result = engine.process(event);
      if (!result.accepted) throw new Error(`Replay rejected event ${event.id}: ${result.reason}`);
    }
    return engine;
  }

  private eventRecord(context: PersistedMatchContext, event: MatchEvent) {
    const primaryPlayerRegistrationId = "playerId" in event ? event.playerId : undefined;
    const secondaryPlayerRegistrationId = "assistPlayerId" in event
      ? event.assistPlayerId
      : "playerInId" in event
        ? event.playerInId
        : undefined;
    return {
      engine_event_id: event.id,
      match_id: context.matchId,
      period_id: context.periodId,
      sequence_no: event.sequence,
      event_time_seconds: 0,
      team_id: "team" in event ? context.teamIds[event.team] : null,
      player_id: primaryPlayerRegistrationId ? context.playerIds[primaryPlayerRegistrationId] ?? null : null,
      secondary_player_id: secondaryPlayerRegistrationId ? context.playerIds[secondaryPlayerRegistrationId] ?? null : null,
      event_type_code: event.type,
      points: event.type === "TWO_POINT" ? 2 : event.type === "THREE_POINT" ? 3 : event.type === "FREE_THROW" && event.made ? 1 : 0,
      payload: event,
    };
  }

  private requireCorrectionReason(reason: string): string {
    const normalized = reason.trim();
    if (!normalized) throw new Error("A correction reason is required.");
    return normalized;
  }
}
