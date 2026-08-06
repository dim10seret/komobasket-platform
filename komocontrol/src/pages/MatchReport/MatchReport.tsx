import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { MatchEngine } from "../../engine/match-engine";
import { createPlayer } from "../../models/player";
import { MatchPersistenceService } from "../../services/match-persistence.service";
import { downloadMatchExcel, printMatchReport } from "../../services/match-export.service";
import type { MatchEvent } from "../../types/event";
import { EventType } from "../../types/event-type";
import type { Player } from "../../types/player";
import { TeamSide } from "../../types/team-side";
import "./MatchReport.css";

type EventDraft<T extends MatchEvent = MatchEvent> = T extends MatchEvent
  ? Omit<T, "id" | "occurredAt">
  : never;

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
  const add = (event: EventDraft) => engine.process({
    ...event,
    id: `demo-${event.sequence}`,
    occurredAt: Date.now() - (20 - event.sequence) * 60_000,
  } as MatchEvent);

  add({ type: EventType.LINEUP_SET, team: TeamSide.HOME, playerIds: home.slice(0, 5).map(({ id }) => id), sequence: 1 });
  add({ type: EventType.LINEUP_SET, team: TeamSide.AWAY, playerIds: away.slice(0, 5).map(({ id }) => id), sequence: 2 });
  add({ type: EventType.MATCH_START, sequence: 3 });
  add({ type: EventType.TWO_POINT, team: TeamSide.HOME, playerId: "home-1", assistPlayerId: "home-2", sequence: 4 });
  add({ type: EventType.TURNOVER, team: TeamSide.AWAY, playerId: "away-1", sequence: 5 });
  add({ type: EventType.THREE_POINT, team: TeamSide.HOME, playerId: "home-3", sequence: 6 });
  add({ type: EventType.THREE_POINT_MISSED, team: TeamSide.AWAY, playerId: "away-2", sequence: 7 });
  add({ type: EventType.REBOUND, team: TeamSide.HOME, playerId: "home-4", offensive: false, sequence: 8 });
  add({ type: EventType.SHOOTING_FOUL, team: TeamSide.AWAY, playerId: "away-3", fouledPlayerId: "home-1", freeThrows: 2, sequence: 9 });
  add({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-1", made: true, isFinalAttempt: false, sequence: 10 });
  add({ type: EventType.FREE_THROW, team: TeamSide.HOME, playerId: "home-1", made: false, isFinalAttempt: true, sequence: 11 });
  add({ type: EventType.STEAL, team: TeamSide.AWAY, playerId: "away-4", sequence: 12 });
  return engine;
}

function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function playerName(player: Player | undefined): string {
  return player ? `#${player.number} ${player.firstName} ${player.lastName}` : "Άγνωστος παίκτης";
}

function eventText(event: MatchEvent, players: Map<string, Player>): string {
  const player = "playerId" in event && event.playerId ? playerName(players.get(event.playerId)) : "";
  const team = "team" in event ? (event.team === TeamSide.HOME ? "Γηπεδούχοι" : "Φιλοξενούμενοι") : "";
  switch (event.type) {
    case EventType.MATCH_START: return "Έναρξη αγώνα";
    case EventType.MATCH_END: return "Λήξη αγώνα";
    case EventType.TWO_POINT: return `${player} — εύστοχο δίποντο${event.assistPlayerId ? ` (ασίστ ${playerName(players.get(event.assistPlayerId))})` : ""}`;
    case EventType.THREE_POINT: return `${player} — εύστοχο τρίποντο${event.assistPlayerId ? ` (ασίστ ${playerName(players.get(event.assistPlayerId))})` : ""}`;
    case EventType.TWO_POINT_MISSED: return `${player} — άστοχο δίποντο`;
    case EventType.THREE_POINT_MISSED: return `${player} — άστοχο τρίποντο`;
    case EventType.FREE_THROW: return `${player} — ${event.made ? "εύστοχη" : "άστοχη"} βολή`;
    case EventType.REBOUND: return `${player} — ${event.offensive ? "επιθετικό" : "αμυντικό"} ριμπάουντ`;
    case EventType.STEAL: return `${player} — κλέψιμο`;
    case EventType.BLOCK: return `${player} — κόψιμο`;
    case EventType.TURNOVER: return `${player} — λάθος`;
    case EventType.PERSONAL_FOUL: return `${player} — προσωπικό φάουλ`;
    case EventType.SHOOTING_FOUL: return `${player} — φάουλ σε σουτ (${event.freeThrows} βολές)`;
    case EventType.TECHNICAL_FOUL: return `${team} — τεχνική ποινή`;
    case EventType.UNSPORTSMANLIKE_FOUL: return `${player} — αντιαθλητικό φάουλ`;
    case EventType.DISQUALIFYING_FOUL: return `${player} — αποβολή`;
    case EventType.SUBSTITUTION: return `${team} — αλλαγή: ${playerName(players.get(event.playerOutId))} → ${playerName(players.get(event.playerInId))}`;
    case EventType.TIMEOUT: return `${team} — timeout`;
    case EventType.QUARTER_START: return `Έναρξη περιόδου ${event.quarter}`;
    case EventType.QUARTER_END: return `Λήξη περιόδου ${event.quarter}`;
    case EventType.OVERTIME_START: return `Έναρξη παράτασης ${event.quarter - 4}`;
    case EventType.JUMP_BALL: return `Jump ball — κατοχή ${event.possession === TeamSide.HOME ? "γηπεδούχων" : "φιλοξενούμενων"}`;
    case EventType.ALTERNATING_POSSESSION: return "Εναλλασσόμενη κατοχή";
    case EventType.CLOCK_START: return "Έναρξη χρονομέτρου";
    case EventType.CLOCK_STOP: return "Διακοπή χρονομέτρου";
    case EventType.CLOCK_SET: return `Χρονόμετρο: ${formatClock(event.remainingSeconds)}`;
    case EventType.LINEUP_SET: return `${team} — καταχώριση πεντάδας`;
    default: return "Καταχώριση αγώνα";
  }
}

function Shooting({ made, attempts }: { made: number; attempts: number }) {
  return <span>{made}/{attempts}</span>;
}

function TeamBoxScore({ title, players }: { title: string; players: Player[] }) {
  return <section className="report-panel box-score">
    <h2>{title}</h2>
    <div className="table-scroll">
      <table>
        <thead><tr><th>Παίκτης</th><th>PTS</th><th>2PT</th><th>3PT</th><th>FT</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th></tr></thead>
        <tbody>{players.map((player) => {
          const stats = player.statistics;
          return <tr key={player.id} className={player.disqualified ? "disqualified" : ""}>
            <td><strong>#{player.number}</strong> {player.firstName} {player.lastName}{player.disqualified ? " (Απ.)" : ""}</td>
            <td>{stats.points}</td><td><Shooting made={stats.twoPointMade} attempts={stats.twoPointAttempts} /></td>
            <td><Shooting made={stats.threePointMade} attempts={stats.threePointAttempts} /></td><td><Shooting made={stats.freeThrowMade} attempts={stats.freeThrowAttempts} /></td>
            <td>{stats.offensiveRebounds + stats.defensiveRebounds}</td><td>{stats.assists}</td><td>{stats.steals}</td><td>{stats.blocks}</td><td>{stats.turnovers}</td><td>{player.fouls}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  </section>;
}

export default function MatchReport() {
  const [searchParams, setSearchParams] = useSearchParams();
  const matchId = searchParams.get("matchId");
  const [engine, setEngine] = useState(createDemoEngine);
  const [message, setMessage] = useState("Προβάλλονται ενδεικτικά δεδομένα αγώνα.");
  const [matchIdInput, setMatchIdInput] = useState(matchId ?? "");
  const [loading, setLoading] = useState(Boolean(matchId));
  const persistence = useMemo(() => new MatchPersistenceService(), []);
  const state = engine.getState();
  const players = useMemo(() => new Map([...state.home.players, ...state.away.players].map((player) => [player.id, player])), [state]);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    void persistence.replay(matchId).then((loaded) => {
      if (cancelled) return;
      setEngine(loaded);
      setMessage("Η αναφορά δημιουργήθηκε από τα αποθηκευμένα events του αγώνα.");
    }).catch((error: unknown) => {
      if (!cancelled) setMessage(`Δεν ήταν δυνατή η φόρτωση: ${error instanceof Error ? error.message : "άγνωστο σφάλμα"}.`);
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [matchId, persistence]);

  const openMatch = () => {
    const id = matchIdInput.trim();
    if (id) setSearchParams({ matchId: id });
    else setSearchParams({});
  };

  return <main className="match-report">
    <div className="report-topbar">
      <div><p className="eyebrow">KomoControl · Match center</p><h1>Φύλλο αγώνα</h1></div>
      <div className="report-actions"><Link to={matchId ? `/live?matchId=${matchId}` : "/live"}>Live scorer</Link><button onClick={() => printMatchReport(state, engine.getEvents())}>Εκτύπωση / PDF</button><button onClick={() => downloadMatchExcel(state)}>Excel</button></div>
    </div>
    <section className="load-match report-panel"><label htmlFor="report-match-id">Match ID (προαιρετικό)</label><input id="report-match-id" value={matchIdInput} onChange={(event) => setMatchIdInput(event.target.value)} placeholder="UUID αγώνα από Supabase" /><button onClick={openMatch}>Άνοιγμα αγώνα</button></section>
    <p className="report-status">{loading ? "Φόρτωση αναφοράς…" : message}</p>
    <section className="report-scoreboard">
      <div><span>{state.home.name}</span><strong>{state.home.score}</strong></div><section><b>{state.finished ? "ΤΕΛΙΚΟ" : `Q${state.quarter}`}</b><span>{formatClock(state.clock)}</span><small>Κατοχή: {state.possession === TeamSide.HOME ? state.home.name : state.away.name}</small></section><div><span>{state.away.name}</span><strong>{state.away.score}</strong></div>
    </section>
    <section className="summary-grid">
      <article className="report-panel"><h2>Ομαδικά στατιστικά</h2><dl><dt>Ριμπάουντ</dt><dd>{state.home.statistics.offensiveRebounds + state.home.statistics.defensiveRebounds} — {state.away.statistics.offensiveRebounds + state.away.statistics.defensiveRebounds}</dd><dt>Ασίστ</dt><dd>{state.home.statistics.assists} — {state.away.statistics.assists}</dd><dt>Λάθη</dt><dd>{state.home.statistics.turnovers} — {state.away.statistics.turnovers}</dd><dt>Ομαδικά φάουλ</dt><dd>{state.home.teamFouls} — {state.away.teamFouls}</dd></dl></article>
      <article className="report-panel final-sheet"><h2>Τελικό φύλλο</h2><p><strong>{state.home.name} {state.home.score} — {state.away.score} {state.away.name}</strong></p><p>Περίοδος: {state.quarter} · Events: {engine.getEvents().length}</p><p>{state.finished ? "Ο αγώνας έχει ολοκληρωθεί." : "Ο αγώνας βρίσκεται σε εξέλιξη."}</p></article>
    </section>
    <section className="box-grid"><TeamBoxScore title={state.home.name} players={state.home.players} /><TeamBoxScore title={state.away.name} players={state.away.players} /></section>
    <section className="report-panel play-by-play"><h2>Play-by-play</h2><ol>{[...engine.getEvents()].reverse().map((event) => <li key={event.id}><time>#{event.sequence}</time><span>{eventText(event, players)}</span></li>)}</ol></section>
  </main>;
}
