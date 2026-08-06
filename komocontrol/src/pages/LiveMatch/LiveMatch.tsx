import { useEffect, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MatchEngine } from "../../engine/match-engine";
import { createPlayer } from "../../models/player";
import { MatchPersistenceService } from "../../services/match-persistence.service";
import { supabase } from "../../services/supabase-client";
import { EventType } from "../../types/event-type";
import type { MatchEvent } from "../../types/event";
import type { MatchState } from "../../types/match-state";
import { Quarter, type Quarter as QuarterValue } from "../../types/quarter";
import { TeamSide } from "../../types/team-side";
import "./LiveMatch.css";

type EventDraft<T extends MatchEvent = MatchEvent> = T extends MatchEvent
  ? Omit<T, "id" | "occurredAt" | "sequence">
  : never;

type BootstrapEventDraft<T extends MatchEvent = MatchEvent> = T extends MatchEvent
  ? Omit<T, "id" | "occurredAt">
  : never;

type GuidedFlow =
  | { kind: "idle" }
  | { kind: "select-player"; action: "made" | "miss" | "turnover" | "personal-foul" | "shooting-foul"; team?: TeamSide; shot?: 2 | 3 }
  | { kind: "shot-outcome"; shot: 2 | 3; team: TeamSide; shooterId: string }
  | { kind: "miss-rebound"; shot: 2 | 3; team: TeamSide; shooterId: string }
  | { kind: "assist"; shot: 2 | 3; team: TeamSide; shooterId: string }
  | { kind: "miss"; shot: 2 | 3; team: TeamSide; shooterId: string }
  | { kind: "block"; shootingTeam: TeamSide }
  | { kind: "rebound"; shootingTeam: TeamSide }
  | { kind: "turnover"; team: TeamSide; playerId: string }
  | { kind: "steal"; turnoverTeam: TeamSide; playerId: string }
  | { kind: "fouled"; foul: "personal" | "shooting"; foulingTeam: TeamSide; foulerId: string }
  | { kind: "shooting-details"; foulingTeam: TeamSide; foulerId: string; shooterId: string };

function createDemoEngine(): MatchEngine {
  const home = ["Ανδρέας", "Μάριος", "Νίκος", "Γιώργος", "Πέτρος", "Στέλιος"].map((name, index) =>
    createPlayer(`home-${index + 1}`, TeamSide.HOME, index + 4, name, "Komo"),
  );
  const away = ["Κώστας", "Θοδωρής", "Αλέξης", "Δημήτρης", "Λευτέρης", "Βασίλης"].map((name, index) =>
    createPlayer(`away-${index + 1}`, TeamSide.AWAY, index + 5, name, "Opponent"),
  );
  const engine = new MatchEngine({
    homeTeam: { id: "home", name: "Komo Basket", players: home },
    awayTeam: { id: "away", name: "Away Team", players: away },
  });
  const bootstrap = (data: BootstrapEventDraft) => engine.process({
    ...data,
    id: crypto.randomUUID(),
    occurredAt: Date.now(),
  } as MatchEvent);

  bootstrap({ type: EventType.LINEUP_SET, team: TeamSide.HOME, playerIds: home.slice(0, 5).map((player) => player.id), sequence: 1 });
  bootstrap({ type: EventType.LINEUP_SET, team: TeamSide.AWAY, playerIds: away.slice(0, 5).map((player) => player.id), sequence: 2 });
  return engine;
}

function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "άγνωστο σφάλμα";
}

function eventLabel(event: MatchEvent): string {
  const labels: Partial<Record<EventType, string>> = {
    [EventType.MATCH_START]: "Έναρξη αγώνα", [EventType.MATCH_END]: "Λήξη αγώνα",
    [EventType.TWO_POINT]: "Εύστοχο δίποντο", [EventType.THREE_POINT]: "Εύστοχο τρίποντο",
    [EventType.TWO_POINT_MISSED]: "Άστοχο δίποντο", [EventType.THREE_POINT_MISSED]: "Άστοχο τρίποντο",
    [EventType.PERSONAL_FOUL]: "Foul", [EventType.SHOOTING_FOUL]: "Shooting foul",
    [EventType.FREE_THROW]: "Βολή", [EventType.REBOUND]: "Rebound", [EventType.TURNOVER]: "Λάθος",
    [EventType.STEAL]: "Κλέψιμο", [EventType.BLOCK]: "Block", [EventType.SUBSTITUTION]: "Αλλαγή",
    [EventType.TIMEOUT]: "Time out", [EventType.ALTERNATING_POSSESSION]: "Εναλλασσόμενη κατοχή",
    [EventType.JUMP_BALL]: "Κατοχή", [EventType.QUARTER_END]: "Λήξη περιόδου", [EventType.QUARTER_START]: "Έναρξη περιόδου",
  };
  return labels[event.type] ?? event.type;
}

export default function LiveMatch() {
  const [searchParams, setSearchParams] = useSearchParams();
  const matchId = searchParams.get("matchId");
  const [engine, setEngine] = useState(createDemoEngine);
  const [persistence] = useState(() => new MatchPersistenceService());
  const [state, setState] = useState<MatchState>(() => engine.getState());
  const [team, setTeam] = useState<TeamSide>(TeamSide.HOME);
  const [playerId, setPlayerId] = useState("home-1");
  const [fouledPlayerId, setFouledPlayerId] = useState("away-1");
  const [message, setMessage] = useState("Οι πεντάδες είναι έτοιμες. Ξεκίνα τον αγώνα όταν είναι έτοιμοι οι διαιτητές.");
  const [matchIdInput, setMatchIdInput] = useState(matchId ?? "");
  const [isLoading, setIsLoading] = useState(Boolean(matchId));
  const [isSaving, setIsSaving] = useState(false);
  const [editingEventId, setEditingEventId] = useState("");
  const [editType, setEditType] = useState<EventType>(EventType.TWO_POINT);
  const [correctionReason, setCorrectionReason] = useState("");
  const [guidedFlow, setGuidedFlow] = useState<GuidedFlow>({ kind: "idle" });
  const [subsOpen, setSubsOpen] = useState(false);
  const [subsTeam, setSubsTeam] = useState<TeamSide>(TeamSide.HOME);
  const [subOutId, setSubOutId] = useState("");
  const [subInId, setSubInId] = useState("");
  const [displayClock, setDisplayClock] = useState(state.clock);
  const [teamColors, setTeamColors] = useState<Record<TeamSide, string>>({
    [TeamSide.HOME]: "#e56b1f",
    [TeamSide.AWAY]: "#1e78c8",
  });
  const [startingLineups, setStartingLineups] = useState<Record<TeamSide, string[]>>({
    [TeamSide.HOME]: [],
    [TeamSide.AWAY]: [],
  });
  const [availableSquads, setAvailableSquads] = useState<Record<TeamSide, string[]>>({
    [TeamSide.HOME]: [],
    [TeamSide.AWAY]: [],
  });
  const [captains, setCaptains] = useState<Record<TeamSide, string>>({
    [TeamSide.HOME]: "",
    [TeamSide.AWAY]: "",
  });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const selectedTeam = team === TeamSide.HOME ? state.home : state.away;
  const pendingFreeThrows = state.freeThrowSeries;

  const selectDefaults = (nextState: MatchState) => {
    const homePlayer = nextState.home.players.find((player) => player.onCourt) ?? nextState.home.players[0];
    const awayPlayer = nextState.away.players.find((player) => player.onCourt) ?? nextState.away.players[0];
    setTeam(TeamSide.HOME);
    setPlayerId(homePlayer?.id ?? "");
    setFouledPlayerId(awayPlayer?.id ?? "");
  };

  useEffect(() => {
    if (!matchId) return;

    let cancelled = false;
    void persistence.replay(matchId)
      .then((loadedEngine) => {
        if (cancelled) return;
        const loadedState = loadedEngine.getState();
        setEngine(loadedEngine);
        setState(loadedState);
        setDisplayClock(loadedState.clock);
        setStartingLineups({
          [TeamSide.HOME]: loadedState.home.players.filter((player) => player.onCourt).map((player) => player.id),
          [TeamSide.AWAY]: loadedState.away.players.filter((player) => player.onCourt).map((player) => player.id),
        });
        if (!loadedState.started) {
          setAvailableSquads({ [TeamSide.HOME]: [], [TeamSide.AWAY]: [] });
          setCaptains({ [TeamSide.HOME]: "", [TeamSide.AWAY]: "" });
          setStartingLineups({ [TeamSide.HOME]: [], [TeamSide.AWAY]: [] });
        }
        selectDefaults(loadedState);
        setMessage("Ο πραγματικός αγώνας φορτώθηκε. Κάθε νέα ενέργεια αποθηκεύεται στο Supabase.");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setMessage(`Δεν ήταν δυνατή η φόρτωση του αγώνα: ${error instanceof Error ? error.message : "άγνωστο σφάλμα"}.`);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [matchId, persistence]);

  useEffect(() => {
    if (!state.clockRunning) return;
    const interval = window.setInterval(() => {
      setDisplayClock((current) => Math.max(0, current - 1));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [state.clockRunning]);

  useEffect(() => {
    if (!matchId || !supabase) return;
    const client = supabase;
    const channel = client.channel(`match-events-${matchId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "match_events", filter: `match_id=eq.${matchId}` }, () => {
        void persistence.replay(matchId).then((loadedEngine) => {
          setEngine(loadedEngine);
          const nextState = loadedEngine.getState();
          setState(nextState);
          setDisplayClock(nextState.clock);
          setMessage("Ο αγώνας ενημερώθηκε από άλλη συνδεδεμένη συσκευή.");
        });
      }).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [matchId, persistence]);

  const send = async (data: EventDraft): Promise<boolean> => {
    if (isLoading || isSaving) return false;
    const event = {
      ...data,
      id: crypto.randomUUID(),
      occurredAt: Date.now(),
      sequence: engine.getState().lastProcessedSequence + 1,
    } as MatchEvent;
    const result = engine.process(event);
    if (!result.accepted) {
      setState(result.state);
      setDisplayClock(result.state.clock);
      setMessage(`Η ενέργεια απορρίφθηκε: ${result.reason ?? "άγνωστο σφάλμα"}.`);
      return false;
    }

    if (matchId) {
      setIsSaving(true);
      try {
        await persistence.appendEvent(await persistence.getContext(matchId, result.state), event);
      } catch (error) {
        const rollback = engine.undoLast();
        if (rollback) {
          setState(rollback.state);
          setDisplayClock(rollback.state.clock);
        }
        setMessage(`Η ενέργεια δεν αποθηκεύτηκε: ${errorMessage(error)}.`);
        setIsSaving(false);
        return false;
      }
      setIsSaving(false);
    }

    setState(result.state);
    setDisplayClock(result.state.clock);
    setTeam(result.state.possession);
    setMessage(matchId ? "Η ενέργεια αποθηκεύτηκε στο Supabase." : "Η ενέργεια καταχωρίστηκε στο demo.");
    return true;
  };

  const removePersistedEvent = async (eventId: string) => {
    if (!matchId) return;
    const reason = window.prompt("Αιτιολογία ακύρωσης event:");
    if (!reason?.trim()) return;
    try {
      await persistence.deleteEvent(matchId, eventId, reason);
      const loadedEngine = await persistence.replay(matchId);
      setEngine(loadedEngine);
      setState(loadedEngine.getState());
      setMessage("Το event ακυρώθηκε και καταγράφηκε στο audit trail.");
    } catch (error) {
      setMessage(`Η ακύρωση δεν ολοκληρώθηκε: ${error instanceof Error ? error.message : "άγνωστο σφάλμα"}.`);
    }
  };

  const beginCorrection = (event: MatchEvent) => {
    if (!("team" in event) || !("playerId" in event)) { setMessage("Αυτό το event δεν διορθώνεται από τη φόρμα φάσης. Χρησιμοποίησε ακύρωση και νέα καταχώριση."); return; }
    setEditingEventId(event.id); setEditType(event.type as EventType); setTeam(event.team); setPlayerId(event.playerId ?? ""); setCorrectionReason("");
  };

  const correctPersistedEvent = async () => {
    if (!matchId || !editingEventId || !correctionReason.trim()) { setMessage("Η αιτιολογία διόρθωσης είναι υποχρεωτική."); return; }
    const original = engine.getEvents().find((event) => event.id === editingEventId);
    if (!original) return;
    const base = { id: original.id, occurredAt: original.occurredAt, sequence: original.sequence };
    const replacement = (editType === EventType.TWO_POINT || editType === EventType.THREE_POINT || editType === EventType.TWO_POINT_MISSED || editType === EventType.THREE_POINT_MISSED || editType === EventType.TURNOVER)
      ? { ...base, type: editType, team, playerId } as MatchEvent
      : { ...base, type: EventType.PERSONAL_FOUL, team, playerId, fouledPlayerId } as MatchEvent;
    const preview = engine.correctEvent(editingEventId, replacement);
    if (!preview.accepted) { setMessage(`Η διόρθωση απορρίφθηκε: ${preview.reason ?? "άγνωστο σφάλμα"}.`); return; }
    try {
      await persistence.correctEvent(await persistence.getContext(matchId, preview.state), replacement, correctionReason);
      const loadedEngine = await persistence.replay(matchId);
      setEngine(loadedEngine); setState(loadedEngine.getState()); setEditingEventId(""); setCorrectionReason("");
      setMessage("Η διόρθωση αποθηκεύτηκε και καταγράφηκε στο audit trail.");
    } catch (error) { setMessage(`Η διόρθωση δεν ολοκληρώθηκε: ${error instanceof Error ? error.message : "άγνωστο σφάλμα"}.`); }
  };

  const resetDemoMatch = () => {
    if (matchId) setSearchParams({});
    setIsLoading(false);
    const nextEngine = createDemoEngine();
    setEngine(nextEngine);
    setState(nextEngine.getState());
    setTeam(TeamSide.HOME);
    setPlayerId("home-1");
    setFouledPlayerId("away-1");
    setDisplayClock(600);
    setStartingLineups({
      [TeamSide.HOME]: nextEngine.getState().home.players.filter((player) => player.onCourt).map((player) => player.id),
      [TeamSide.AWAY]: nextEngine.getState().away.players.filter((player) => player.onCourt).map((player) => player.id),
    });
    setAvailableSquads({
      [TeamSide.HOME]: nextEngine.getState().home.players.map((player) => player.id),
      [TeamSide.AWAY]: nextEngine.getState().away.players.map((player) => player.id),
    });
    setCaptains({ [TeamSide.HOME]: "", [TeamSide.AWAY]: "" });
    setMessage("Δημιουργήθηκε νέος demo αγώνας. Οι πεντάδες είναι έτοιμες για tip-off.");
  };

  const undoLast = () => {
    if (matchId) {
      setMessage("Η αναίρεση πραγματικού αγώνα θα προστεθεί με ασφαλή συγχρονισμό στο Supabase.");
      return;
    }
    const result = engine.undoLast();
    if (!result) {
      setMessage("Δεν υπάρχει event για αναίρεση.");
      return;
    }
    setState(result.state);
    setDisplayClock(result.state.clock);
    setMessage(result.accepted ? "Το τελευταίο event αναιρέθηκε." : `Η αναίρεση απέτυχε: ${result.reason}.`);
  };

  const nextPeriod = (state.quarter + 1) as QuarterValue;

  const toggleClock = async () => {
    if (!state.started || state.finished) return;
    if (!state.clockRunning) {
      await send({ type: EventType.CLOCK_START });
      return;
    }
    const savedClock = Math.max(0, displayClock);
    const clockSaved = await send({ type: EventType.CLOCK_SET, remainingSeconds: savedClock });
    if (clockSaved && savedClock > 0) await send({ type: EventType.CLOCK_STOP });
  };

  const editClock = () => {
    const nextValue = window.prompt("Νέος χρόνος περιόδου σε δευτερόλεπτα:", String(displayClock));
    if (nextValue === null) return;
    const seconds = Number(nextValue);
    if (!Number.isInteger(seconds) || seconds < 0) { setMessage("Ο χρόνος πρέπει να είναι ακέραιος αριθμός δευτερολέπτων."); return; }
    void send({ type: EventType.CLOCK_SET, remainingSeconds: seconds });
  };

  const endQuarter = async () => {
    if (displayClock > 0) {
      setMessage("Για λήξη περιόδου, σταμάτησε πρώτα το χρονόμετρο στο 0:00.");
      return;
    }
    if (state.clock !== 0 && !await send({ type: EventType.CLOCK_SET, remainingSeconds: 0 })) return;
    await send({ type: EventType.QUARTER_END, quarter: state.quarter });
  };

  const toggleStarter = (side: TeamSide, playerIdToToggle: string) => {
    if (!availableSquads[side].includes(playerIdToToggle)) return;
    setStartingLineups((current) => {
      const selected = current[side];
      if (selected.includes(playerIdToToggle)) return { ...current, [side]: selected.filter((id) => id !== playerIdToToggle) };
      if (selected.length === 5) return current;
      return { ...current, [side]: [...selected, playerIdToToggle] };
    });
  };

  const toggleAvailablePlayer = (side: TeamSide, playerIdToToggle: string) => {
    setAvailableSquads((current) => {
      const selected = current[side];
      if (selected.includes(playerIdToToggle)) {
        setStartingLineups((lineups) => ({ ...lineups, [side]: lineups[side].filter((id) => id !== playerIdToToggle) }));
        setCaptains((currentCaptains) => currentCaptains[side] === playerIdToToggle ? { ...currentCaptains, [side]: "" } : currentCaptains);
        return { ...current, [side]: selected.filter((id) => id !== playerIdToToggle) };
      }
      if (selected.length === 12) return current;
      return { ...current, [side]: [...selected, playerIdToToggle] };
    });
  };

  const saveMatchRoster = async (): Promise<boolean> => {
    if (!matchId || !supabase) return true;
    const updates = ([TeamSide.HOME, TeamSide.AWAY] as TeamSide[]).flatMap((side) => {
      const players = side === TeamSide.HOME ? state.home.players : state.away.players;
      return players.map((player) => ({
        playerId: player.id,
        available: availableSquads[side].includes(player.id),
        captain: captains[side] === player.id,
        starter: startingLineups[side].includes(player.id),
      }));
    });
    setIsSaving(true);
    try {
      // Clear previous starters first: the database correctly prevents a sixth
      // starter, so selecting a new five must be a two-phase update.
      for (const update of updates) {
        const { error } = await supabase.from("match_players").update({
          is_available: update.available,
          is_captain: update.captain,
          is_starting_five: false,
        }).eq("match_id", matchId).eq("player_registration_id", update.playerId);
        if (error) throw error;
      }
      for (const update of updates.filter((item) => item.starter)) {
        const { error } = await supabase.from("match_players").update({ is_starting_five: true })
          .eq("match_id", matchId).eq("player_registration_id", update.playerId);
        if (error) throw error;
      }
      return true;
    } catch (error) {
      setMessage(`Δεν αποθηκεύτηκε το roster: ${errorMessage(error)}.`);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  const startMatch = async () => {
    const home = startingLineups[TeamSide.HOME];
    const away = startingLineups[TeamSide.AWAY];
    if (home.length !== 5 || away.length !== 5) {
      setMessage("Επίλεξε ακριβώς 5 αρχικούς παίκτες για κάθε ομάδα.");
      return;
    }
    if (availableSquads[TeamSide.HOME].length === 0 || availableSquads[TeamSide.AWAY].length === 0 || !captains[TeamSide.HOME] || !captains[TeamSide.AWAY]) {
      setMessage("Επίλεξε τους διαθέσιμους παίκτες και έναν αρχηγό για κάθε ομάδα.");
      return;
    }
    if (!await saveMatchRoster()) return;
    if (!await send({ type: EventType.LINEUP_SET, team: TeamSide.HOME, playerIds: home })) return;
    if (!await send({ type: EventType.LINEUP_SET, team: TeamSide.AWAY, playerIds: away })) return;
    await send({ type: EventType.MATCH_START });
  };

  const openMatch = () => {
    const trimmedMatchId = matchIdInput.trim();
    if (!trimmedMatchId) {
      setMessage("Συμπλήρωσε το Match ID για να φορτώσεις πραγματικό αγώνα.");
      return;
    }
    setIsLoading(true);
    setMessage("Φόρτωση αγώνα από Supabase…");
    setSearchParams({ matchId: trimmedMatchId });
  };

  return (
    <main className="live-match">
      <header className="scoreboard">
        <section style={{ borderColor: teamColors[TeamSide.HOME] }}><button className="settings-button" onClick={() => setSettingsOpen(true)} title="Ρυθμίσεις αγώνα">⚙</button><span>{state.home.name}</span><strong>{state.home.score}</strong></section>
        <button className={`game-meta clock-button ${state.clockRunning ? "running" : ""}`} disabled={!state.started || state.finished || isSaving} onClick={() => void toggleClock()} onContextMenu={(event) => { event.preventDefault(); editClock(); }} title="Κλικ: έναρξη/παύση · δεξί κλικ: διόρθωση χρόνου"><b>Q{state.quarter}</b><strong>{formatClock(displayClock)}</strong><small>{state.clockRunning ? "ΠΑΤΗΣΕ ΓΙΑ ΠΑΥΣΗ" : "ΠΑΤΗΣΕ ΓΙΑ ΕΝΑΡΞΗ"}</small></button>
        <section style={{ borderColor: teamColors[TeamSide.AWAY] }}><span>{state.away.name}</span><strong>{state.away.score}</strong></section>
      </header>


      <section className="panel match-connection">
        <h2>Σύνδεση αγώνα</h2>
        <div className="flow-actions">
          <label>Match ID από Supabase
            <input value={matchIdInput} onChange={(event) => setMatchIdInput(event.target.value)} placeholder="UUID αγώνα" />
          </label>
          <button className="primary" disabled={isLoading || isSaving} onClick={openMatch}>Φόρτωση αγώνα</button>
          {matchId && <button disabled={isLoading || isSaving} onClick={resetDemoMatch}>Επιστροφή στο demo</button>}
        </div>
        <small>{isLoading ? "Φόρτωση…" : matchId ? `Συνδεδεμένος αγώνας: ${matchId}` : "Demo mode — κανένα event δεν αποθηκεύεται."}</small>
      </section>

      <p className="status">{message} · <Link to={matchId ? `/report?matchId=${matchId}` : "/report"}>Φύλλο αγώνα / PDF / Excel</Link></p>
      <p className="possession">Κατοχή: <b>{state.possession === TeamSide.HOME ? state.home.name : state.away.name}</b> · Βέλος εναλλασσόμενης κατοχής: <b>{state.alternatingPossession === TeamSide.HOME ? state.home.name : state.away.name}</b></p>

      <section className="panel game-flow">
        <h2>Ροή αγώνα</h2>
        <div className="flow-actions">
          <button onClick={resetDemoMatch}>Νέος demo αγώνας</button>
          {!state.started && <button className="primary" disabled={startingLineups[TeamSide.HOME].length !== 5 || startingLineups[TeamSide.AWAY].length !== 5 || !captains[TeamSide.HOME] || !captains[TeamSide.AWAY] || isSaving} onClick={() => void startMatch()}>Έναρξη αγώνα</button>}
          {state.started && !state.finished && <>
            <button onClick={() => send({ type: EventType.JUMP_BALL, possession: TeamSide.HOME })}>Jump ball: {state.home.name}</button>
            <button onClick={() => send({ type: EventType.JUMP_BALL, possession: TeamSide.AWAY })}>Jump ball: {state.away.name}</button>
            {!matchId && <button onClick={undoLast}>Αναίρεση τελευταίου</button>}
          </>}
        </div>
        {!state.started && <section className="starting-lineups">
          <h3>Προετοιμασία αγώνα</h3>
          <p>1. Επίλεξε έως 12 διαθέσιμους. 2. Όρισε αρχηγό. 3. Διάλεξε την αρχική πεντάδα.</p>
          <div className="lineup-teams">
            {[TeamSide.HOME, TeamSide.AWAY].map((side) => {
              const roster = side === TeamSide.HOME ? state.home : state.away;
              const available = availableSquads[side];
              const starters = startingLineups[side];
              return <div key={side} className="lineup-team" style={{ borderColor: teamColors[side] }}>
                <header><b>{roster.name}</b><span>{available.length}/12 διαθέσιμοι · {starters.length}/5 αρχικοί</span></header>
                <div className="preparation-list">{roster.players.filter((player) => !player.disqualified).map((player) => <div key={player.id} className="preparation-player"><button className={available.includes(player.id) ? "active" : ""} onClick={() => toggleAvailablePlayer(side, player.id)}>#{player.number} {player.firstName} {player.lastName}</button>{available.includes(player.id) && <><button className={`captain-button ${captains[side] === player.id ? "active" : ""}`} onClick={() => setCaptains((current) => ({ ...current, [side]: player.id }))}>C</button><button className={`starter-button ${starters.includes(player.id) ? "active" : ""}`} onClick={() => toggleStarter(side, player.id)}>5</button></>}</div>)}</div>
              </div>;
            })}
          </div>
          <small>Το «C» ορίζει αρχηγό. Το «5» προσθέτει ή αφαιρεί παίκτη από την αρχική πεντάδα.</small>
        </section>}
        {state.started && !state.finished && <div className="flow-actions period-controls">
          <button onClick={() => void endQuarter()} disabled={state.clockRunning}>End Q{state.quarter}</button>
          {state.clock === 0 && state.quarter < Quarter.Q4 && <button className="primary" onClick={() => void send({ type: EventType.QUARTER_START, quarter: nextPeriod })}>Start Q{nextPeriod}</button>}
          {state.clock === 0 && state.quarter >= Quarter.Q4 && state.home.score === state.away.score && <button className="primary" onClick={() => void send({ type: EventType.OVERTIME_START, quarter: nextPeriod })}>Start overtime</button>}
          {state.clock === 0 && state.quarter >= Quarter.Q4 && state.home.score !== state.away.score && <button className="primary" onClick={() => void send({ type: EventType.MATCH_END })}>End match</button>}
        </div>}
      </section>

      {pendingFreeThrows && <section className="panel free-throw-series">
        <h2>Σειρά βολών</h2>
        <p>{pendingFreeThrows.remainingAttempts} βολή/ές απομένουν για τον παίκτη της {pendingFreeThrows.shootingTeam === TeamSide.HOME ? state.home.name : state.away.name}.</p>
        <div className="actions">
          <button className="primary" onClick={() => void send({ type: EventType.FREE_THROW, team: pendingFreeThrows.shootingTeam, playerId: pendingFreeThrows.shooterId, made: true, isFinalAttempt: pendingFreeThrows.remainingAttempts === 1 })}>Εύστοχη βολή</button>
          <button onClick={() => void send({ type: EventType.FREE_THROW, team: pendingFreeThrows.shootingTeam, playerId: pendingFreeThrows.shooterId, made: false, isFinalAttempt: pendingFreeThrows.remainingAttempts === 1 }).then((ok) => { if (ok && pendingFreeThrows.remainingAttempts === 1 && pendingFreeThrows.possessionAfter === "LIVE_BALL") setGuidedFlow({ kind: "rebound", shootingTeam: pendingFreeThrows.shootingTeam }); })}>Άστοχη βολή</button>
        </div>
      </section>}

      <section className="court-layout">
        {[TeamSide.HOME, TeamSide.AWAY].map((side) => {
          const roster = side === TeamSide.HOME ? state.home : state.away;
          const card = (id: string) => {
            const player = roster.players.find((candidate) => candidate.id === id)!;
            const isSelected = team === side && playerId === id;
            return <button key={id} style={{ "--team-color": teamColors[side] } as CSSProperties} className={`player-card ${isSelected ? "selected" : ""}`} onClick={() => {
              if (guidedFlow.kind === "select-player") {
                if (guidedFlow.team && side !== guidedFlow.team) return;
                if (guidedFlow.action === "made" && guidedFlow.shot) { setGuidedFlow({ kind: "shot-outcome", shot: guidedFlow.shot, team: side, shooterId: id }); return; }
                if (guidedFlow.action === "miss" && guidedFlow.shot) { setGuidedFlow({ kind: "miss", shot: guidedFlow.shot, team: side, shooterId: id }); return; }
                if (guidedFlow.action === "turnover") { setGuidedFlow({ kind: "turnover", team: side, playerId: id }); return; }
                if (guidedFlow.action === "personal-foul") { setGuidedFlow({ kind: "fouled", foul: "personal", foulingTeam: side, foulerId: id }); return; }
                if (guidedFlow.action === "shooting-foul") { setGuidedFlow({ kind: "fouled", foul: "shooting", foulingTeam: side, foulerId: id }); return; }
                return;
              }
              if (guidedFlow.kind === "fouled" && side !== guidedFlow.foulingTeam) { setGuidedFlow(guidedFlow.foul === "personal" ? { kind: "idle" } : { kind: "shooting-details", foulingTeam: guidedFlow.foulingTeam, foulerId: guidedFlow.foulerId, shooterId: id }); if (guidedFlow.foul === "personal") void send({ type: EventType.PERSONAL_FOUL, team: guidedFlow.foulingTeam, playerId: guidedFlow.foulerId, fouledPlayerId: id }); return; }
              if (guidedFlow.kind === "steal" && side !== guidedFlow.turnoverTeam) { void send({ type: EventType.STEAL, team: side, playerId: id }).then((ok) => ok && setGuidedFlow({ kind: "idle" })); return; }
              if (guidedFlow.kind === "block" && side !== guidedFlow.shootingTeam) { void send({ type: EventType.BLOCK, team: side, playerId: id }).then((ok) => ok && setGuidedFlow({ kind: "rebound", shootingTeam: guidedFlow.shootingTeam })); return; }
              if (guidedFlow.kind === "rebound") { void send({ type: EventType.REBOUND, team: side, playerId: id, offensive: side === guidedFlow.shootingTeam }).then((ok) => ok && setGuidedFlow({ kind: "idle" })); return; }
              setTeam(side); setPlayerId(id);
            }}><b>#{player.number}</b><span>Fouls {player.fouls}</span></button>;
          };
          return <aside key={side} className={`panel roster ${side === TeamSide.AWAY ? "away-roster" : ""}`} style={{ borderColor: teamColors[side] }}><h2>{roster.name}</h2><small>ΕΝΕΡΓΟΙ ΠΑΙΚΤΕΣ</small>{roster.players.filter((p) => p.onCourt).map((p) => card(p.id))}</aside>;
        })}
        <section className="panel live-timeline"><h2>Ροή φάσης</h2><p className="flow-prompt">{guidedFlow.kind === "idle" ? "Πάτησε πρώτα την ενέργεια." : guidedFlow.kind === "select-player" ? "Διάλεξε τώρα τον αριθμό του παίκτη που έκανε τη φάση." : guidedFlow.kind === "shot-outcome" ? "Διάλεξε εύστοχο ή άστοχο στο κεντρικό παράθυρο." : guidedFlow.kind === "miss-rebound" ? "Διάλεξε rebound ή κατοχή εκτός." : guidedFlow.kind === "assist" ? "Επίλεξε assist ή no assist στο κεντρικό παράθυρο." : guidedFlow.kind === "miss" ? "Η προσπάθεια ήταν άστοχη: rebound ή block;" : guidedFlow.kind === "block" ? "Διάλεξε τον παίκτη που έκανε block." : guidedFlow.kind === "rebound" ? "Διάλεξε τον παίκτη που πήρε το rebound." : guidedFlow.kind === "turnover" ? "Υπήρξε steal;" : guidedFlow.kind === "steal" ? "Διάλεξε τον παίκτη που έκανε steal." : guidedFlow.kind === "fouled" ? "Διάλεξε τον παίκτη που κέρδισε το foul." : "Shooting foul: επίλεξε αποτέλεσμα προσπάθειας."}</p><ol>{engine.getEvents().slice(-7).reverse().map((event) => <li key={event.id}>#{event.sequence} · {eventLabel(event)}</li>)}</ol></section>
      </section>

      {guidedFlow.kind === "shot-outcome" && <section className="assist-modal" role="dialog" aria-label="Αποτέλεσμα προσπάθειας">
        <div className="panel"><h2>{guidedFlow.shot}PT προσπάθεια</h2><p>Ήταν εύστοχη ή άστοχη;</p><div className="assist-choices"><button className="primary" onClick={() => setGuidedFlow({ kind: "assist", shot: guidedFlow.shot, team: guidedFlow.team, shooterId: guidedFlow.shooterId })}>Εύστοχο</button><button onClick={() => setGuidedFlow({ kind: "miss-rebound", shot: guidedFlow.shot, team: guidedFlow.team, shooterId: guidedFlow.shooterId })}>Άστοχο</button></div><button className="modal-cancel" onClick={() => setGuidedFlow({ kind: "idle" })}>Ακύρωση</button></div>
      </section>}

      {guidedFlow.kind === "miss-rebound" && <section className="assist-modal" role="dialog" aria-label="Rebound ή μπάλα εκτός">
        <div className="panel"><h2>Άστοχο {guidedFlow.shot}PT</h2><p>Διάλεξε rebound ή κατοχή αν η μπάλα βγήκε εκτός.</p><div className="rebound-choices">{[TeamSide.HOME, TeamSide.AWAY].flatMap((side) => (side === TeamSide.HOME ? state.home : state.away).players.filter((player) => player.onCourt).map((player) => <button key={player.id} style={{ "--team-color": teamColors[side] } as CSSProperties} className="rebound-player" onClick={async () => { const missed = await send({ type: guidedFlow.shot === 2 ? EventType.TWO_POINT_MISSED : EventType.THREE_POINT_MISSED, team: guidedFlow.team, playerId: guidedFlow.shooterId }); if (missed) { await send({ type: EventType.REBOUND, team: side, playerId: player.id, offensive: side === guidedFlow.team }); setGuidedFlow({ kind: "idle" }); } }}><b>#{player.number}</b><span>{side === TeamSide.HOME ? state.home.name : state.away.name}</span></button>))}</div><div className="out-of-bounds"><button onClick={async () => { const missed = await send({ type: guidedFlow.shot === 2 ? EventType.TWO_POINT_MISSED : EventType.THREE_POINT_MISSED, team: guidedFlow.team, playerId: guidedFlow.shooterId }); if (missed) { await send({ type: EventType.JUMP_BALL, possession: TeamSide.HOME }); setGuidedFlow({ kind: "idle" }); } }}>A · {state.home.name}</button><button onClick={async () => { const missed = await send({ type: guidedFlow.shot === 2 ? EventType.TWO_POINT_MISSED : EventType.THREE_POINT_MISSED, team: guidedFlow.team, playerId: guidedFlow.shooterId }); if (missed) { await send({ type: EventType.JUMP_BALL, possession: TeamSide.AWAY }); setGuidedFlow({ kind: "idle" }); } }}>B · {state.away.name}</button></div><button className="modal-cancel" onClick={() => setGuidedFlow({ kind: "idle" })}>Ακύρωση</button></div>
      </section>}

      {guidedFlow.kind === "assist" && <section className="assist-modal" role="dialog" aria-label="Επιλογή assist">
        <div className="panel">
          <h2>Assist;</h2><p>Επίλεξε συμπαίκτη ή καταχώρισε no assist.</p>
          <div className="assist-choices">
            <button className="primary" onClick={() => void send({ type: guidedFlow.shot === 2 ? EventType.TWO_POINT : EventType.THREE_POINT, team: guidedFlow.team, playerId: guidedFlow.shooterId }).then((ok) => ok && setGuidedFlow({ kind: "idle" }))}>No assist</button>
            {(guidedFlow.team === TeamSide.HOME ? state.home : state.away).players.filter((player) => player.onCourt && player.id !== guidedFlow.shooterId).map((player) => <button key={player.id} onClick={() => void send({ type: guidedFlow.shot === 2 ? EventType.TWO_POINT : EventType.THREE_POINT, team: guidedFlow.team, playerId: guidedFlow.shooterId, assistPlayerId: player.id }).then((ok) => ok && setGuidedFlow({ kind: "idle" }))}>#{player.number} {player.firstName}</button>)}
          </div>
          <button className="modal-cancel" onClick={() => setGuidedFlow({ kind: "idle" })}>Ακύρωση</button>
        </div>
      </section>}

      {settingsOpen && <section className="assist-modal" role="dialog" aria-label="Ρυθμίσεις αγώνα"><div className="panel settings-modal"><h2>Ρυθμίσεις αγώνα</h2><p>Αλλαγή χρωμάτων και διαθέσιμων παικτών. Ο νέος διαθέσιμος παίκτης θα εμφανιστεί στις αλλαγές.</p><div className="settings-teams">{[TeamSide.HOME, TeamSide.AWAY].map((side) => { const roster = side === TeamSide.HOME ? state.home : state.away; return <section key={side}><h3>{roster.name} <input type="color" value={teamColors[side]} onChange={(event) => setTeamColors((colors) => ({ ...colors, [side]: event.target.value }))} /></h3>{roster.players.filter((player) => !player.disqualified).map((player) => <button key={player.id} className={availableSquads[side].includes(player.id) ? "active" : ""} onClick={() => toggleAvailablePlayer(side, player.id)}>#{player.number} {player.firstName} {player.lastName}</button>)}</section>; })}</div><div className="quick-actions"><button className="primary" onClick={() => void saveMatchRoster().then((ok) => ok && setSettingsOpen(false))}>Αποθήκευση</button><button onClick={() => setSettingsOpen(false)}>Κλείσιμο</button></div></div></section>}

      <section className="panel action-panel">
        <h2>Ενέργειες · {selectedTeam.players.find((p) => p.id === playerId)?.firstName ?? "διάλεξε παίκτη"}</h2>
        {guidedFlow.kind === "idle" && <div className="quick-actions"><button onClick={() => setGuidedFlow({ kind: "select-player", action: "made", team: state.possession, shot: 2 })}>2PT</button><button onClick={() => setGuidedFlow({ kind: "select-player", action: "made", team: state.possession, shot: 3 })}>3PT</button><button onClick={() => setGuidedFlow({ kind: "select-player", action: "turnover", team: state.possession })}>Turnover</button><button onClick={() => setGuidedFlow({ kind: "select-player", action: "personal-foul" })}>Foul</button><button onClick={() => setGuidedFlow({ kind: "select-player", action: "shooting-foul" })}>Shooting foul</button><button onClick={() => setSubsOpen(true)}>Subs</button><button onClick={() => void send({ type: EventType.TIMEOUT, team: state.possession })}>Time out</button></div>}
        {guidedFlow.kind === "select-player" && <div className="quick-actions"><button onClick={() => setGuidedFlow({ kind: "idle" })}>Ακύρωση</button></div>}
        {guidedFlow.kind === "miss" && <div className="quick-actions"><button className="primary" onClick={() => void send({ type: guidedFlow.shot === 2 ? EventType.TWO_POINT_MISSED : EventType.THREE_POINT_MISSED, team: guidedFlow.team, playerId: guidedFlow.shooterId }).then((ok) => ok && setGuidedFlow({ kind: "rebound", shootingTeam: guidedFlow.team }))}>Rebound</button><button onClick={() => void send({ type: guidedFlow.shot === 2 ? EventType.TWO_POINT_MISSED : EventType.THREE_POINT_MISSED, team: guidedFlow.team, playerId: guidedFlow.shooterId }).then((ok) => ok && setGuidedFlow({ kind: "block", shootingTeam: guidedFlow.team }))}>Block</button><button onClick={() => setGuidedFlow({ kind: "idle" })}>Ακύρωση</button></div>}
        {guidedFlow.kind === "turnover" && <div className="quick-actions"><button className="primary" onClick={() => void send({ type: EventType.TURNOVER, team: guidedFlow.team, playerId: guidedFlow.playerId }).then((ok) => ok && setGuidedFlow({ kind: "idle" }))}>Χωρίς steal</button><button onClick={() => setGuidedFlow({ kind: "steal", turnoverTeam: guidedFlow.team, playerId: guidedFlow.playerId })}>Steal</button><button onClick={() => setGuidedFlow({ kind: "idle" })}>Ακύρωση</button></div>}
        {guidedFlow.kind === "shooting-details" && <div className="quick-actions"><button onClick={() => void send({ type: EventType.SHOOTING_FOUL, team: guidedFlow.foulingTeam, playerId: guidedFlow.foulerId, fouledPlayerId: guidedFlow.shooterId, freeThrows: 2 }).then((ok) => ok && setGuidedFlow({ kind: "idle" }))}>2PT άστοχο · 2 βολές</button><button onClick={() => void send({ type: EventType.SHOOTING_FOUL, team: guidedFlow.foulingTeam, playerId: guidedFlow.foulerId, fouledPlayerId: guidedFlow.shooterId, freeThrows: 3 }).then((ok) => ok && setGuidedFlow({ kind: "idle" }))}>3PT άστοχο · 3 βολές</button><button onClick={async () => { const made = await send({ type: EventType.TWO_POINT, team: guidedFlow.foulingTeam === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME, playerId: guidedFlow.shooterId }); if (made) { await send({ type: EventType.SHOOTING_FOUL, team: guidedFlow.foulingTeam, playerId: guidedFlow.foulerId, fouledPlayerId: guidedFlow.shooterId, freeThrows: 1 }); setGuidedFlow({ kind: "idle" }); } }}>2PT εύστοχο · 1 βολή</button><button onClick={async () => { const made = await send({ type: EventType.THREE_POINT, team: guidedFlow.foulingTeam === TeamSide.HOME ? TeamSide.AWAY : TeamSide.HOME, playerId: guidedFlow.shooterId }); if (made) { await send({ type: EventType.SHOOTING_FOUL, team: guidedFlow.foulingTeam, playerId: guidedFlow.foulerId, fouledPlayerId: guidedFlow.shooterId, freeThrows: 1 }); setGuidedFlow({ kind: "idle" }); } }}>3PT εύστοχο · 1 βολή</button></div>}
        {guidedFlow.kind !== "idle" && guidedFlow.kind !== "assist" && guidedFlow.kind !== "miss" && guidedFlow.kind !== "turnover" && guidedFlow.kind !== "shooting-details" && <button onClick={() => setGuidedFlow({ kind: "idle" })}>Ακύρωση τρέχουσας φάσης</button>}
      </section>

      {subsOpen && <section className="panel substitution-overlay"><h2>Αλλαγή παίκτη</h2><div className="team-tabs"><button className={subsTeam === TeamSide.HOME ? "active" : ""} onClick={() => { setSubsTeam(TeamSide.HOME); setSubOutId(""); setSubInId(""); }}>{state.home.name}</button><button className={subsTeam === TeamSide.AWAY ? "active" : ""} onClick={() => { setSubsTeam(TeamSide.AWAY); setSubOutId(""); setSubInId(""); }}>{state.away.name}</button></div><div className="sub-columns"><div><b>OUT</b>{(subsTeam === TeamSide.HOME ? state.home : state.away).players.filter((p) => p.onCourt).map((p) => <button key={p.id} className={subOutId === p.id ? "active" : ""} onClick={() => setSubOutId(p.id)}>#{p.number} {p.firstName}</button>)}</div><div><b>IN</b>{(subsTeam === TeamSide.HOME ? state.home : state.away).players.filter((p) => !p.onCourt && !p.disqualified && availableSquads[subsTeam].includes(p.id)).map((p) => <button key={p.id} className={subInId === p.id ? "active" : ""} onClick={() => setSubInId(p.id)}>#{p.number} {p.firstName}</button>)}</div></div><div className="quick-actions"><button className="primary" disabled={!subOutId || !subInId} onClick={() => void send({ type: EventType.SUBSTITUTION, team: subsTeam, playerOutId: subOutId, playerInId: subInId }).then((ok) => { if (ok) { setSubOutId(""); setSubInId(""); } })}>Επιβεβαίωση αλλαγής</button><button onClick={() => setSubsOpen(false)}>Κλείσιμο</button></div></section>}

      <section className="panel event-log">
        <h2>Event log</h2>
        <ol>{engine.getEvents().map((event) => <li key={event.id}>#{event.sequence} — {event.type} {matchId && <><button onClick={() => beginCorrection(event)}>Επεξεργασία</button><button onClick={() => void removePersistedEvent(event.id)}>Ακύρωση</button></>}</li>)}</ol>
      </section>
      {editingEventId && <section className="panel">
        <h2>Διόρθωση event</h2><p>Η αλλαγή θα ελεγχθεί με replay πριν αποθηκευτεί.</p>
        <label>Νέος τύπος<select value={editType} onChange={(event) => setEditType(event.target.value as EventType)}><option value={EventType.TWO_POINT}>Εύστοχο 2PT</option><option value={EventType.THREE_POINT}>Εύστοχο 3PT</option><option value={EventType.TWO_POINT_MISSED}>Άστοχο 2PT</option><option value={EventType.THREE_POINT_MISSED}>Άστοχο 3PT</option><option value={EventType.TURNOVER}>Turnover</option><option value={EventType.PERSONAL_FOUL}>Personal foul</option></select></label>
        <label>Αιτιολογία<input value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="π.χ. λανθασμένη καταχώριση παίκτη" /></label>
        <div className="actions"><button className="primary" onClick={() => void correctPersistedEvent()}>Αποθήκευση διόρθωσης</button><button onClick={() => setEditingEventId("")}>Ακύρωση</button></div>
      </section>}
    </main>
  );
}
