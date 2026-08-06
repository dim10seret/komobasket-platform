import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MatchEngine } from "../../engine/match-engine";
import { createPlayer } from "../../models/player";
import { MatchPersistenceService } from "../../services/match-persistence.service";
import { requireSupabase } from "../../services/supabase-client";
import { TeamSide } from "../../types/team-side";

type Option = { id: string; name: string; competition_id?: string; team_id?: string; teams?: { name: string } };
type Registration = { id: string; team_id: string; teams: { name: string } };
type RosterRow = { id: string; jersey_number: number; captain: boolean; players: { first_name: string; last_name: string } };

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) return String(error.message);
  return "άγνωστο σφάλμα";
}

export default function Matches() {
  const navigate = useNavigate();
  const [competitions, setCompetitions] = useState<Option[]>([]);
  const [seasons, setSeasons] = useState<Option[]>([]);
  const [registrations, setRegistrations] = useState<Registration[]>([]);
  const [competitionId, setCompetitionId] = useState(""); const [seasonId, setSeasonId] = useState("");
  const [homeId, setHomeId] = useState(""); const [awayId, setAwayId] = useState(""); const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState("Φόρτωση διαθέσιμων διοργανώσεων…");

  useEffect(() => { void (async () => {
    try { const client = requireSupabase(); const [c, s] = await Promise.all([client.from("competitions").select("id,name"), client.from("seasons").select("id,name,competition_id")]); if (c.error) throw c.error; if (s.error) throw s.error; setCompetitions(c.data as Option[]); setSeasons(s.data as Option[]); setMessage("Επίλεξε διοργάνωση, σεζόν και ομάδες."); } catch (error) { setMessage(error instanceof Error ? error.message : "Αδυναμία φόρτωσης."); }
  })(); }, []);
  useEffect(() => { if (!seasonId) return; void (async () => { const { data, error } = await requireSupabase().from("team_registrations").select("id,team_id,teams(name)").eq("season_id", seasonId).eq("active", true); if (error) { setMessage(error.message); return; } setRegistrations(data as unknown as Registration[]); })(); }, [seasonId]);

  const createMatch = async () => {
    if (!competitionId || !seasonId || !homeId || !awayId || homeId === awayId) { setMessage("Συμπλήρωσε σωστά όλα τα στοιχεία του αγώνα."); return; }
    try {
      const client = requireSupabase();
      const { data: match, error } = await client.from("matches").insert({ competition_id: competitionId, season_id: seasonId, home_team_registration_id: homeId, away_team_registration_id: awayId, match_date: date, status: "scheduled" }).select("id").single();
      if (error) throw error;
      const { data: roster, error: rosterError } = await client.from("player_registrations").select("id,jersey_number,captain,team_registration_id,players(first_name,last_name)").in("team_registration_id", [homeId, awayId]).eq("active", true);
      if (rosterError) throw rosterError;
      const rosterRows = roster as unknown as Array<RosterRow & { team_registration_id: string }>;
      const homeName = registrations.find((item) => item.id === homeId)?.teams.name ?? "Home"; const awayName = registrations.find((item) => item.id === awayId)?.teams.name ?? "Away";
      const homePlayers = rosterRows.filter((item) => item.team_registration_id === homeId).map((item) => createPlayer(item.id, TeamSide.HOME, item.jersey_number, item.players.first_name, item.players.last_name));
      const awayPlayers = rosterRows.filter((item) => item.team_registration_id === awayId).map((item) => createPlayer(item.id, TeamSide.AWAY, item.jersey_number, item.players.first_name, item.players.last_name));
      const engine = new MatchEngine({ id: match.id, homeTeam: { id: homeId, name: homeName, players: homePlayers }, awayTeam: { id: awayId, name: awayName, players: awayPlayers } });
      await client.from("match_players").insert(rosterRows.map((item) => ({ match_id: match.id, team_registration_id: item.team_registration_id, player_registration_id: item.id, jersey_number: item.jersey_number, is_captain: item.captain })));
      await new MatchPersistenceService().saveInitialState(match.id, engine.getState());
      navigate(`/live?matchId=${match.id}`);
    } catch (error) { setMessage(`Δεν δημιουργήθηκε ο αγώνας: ${errorMessage(error)}. Αν αναφέρει RLS ή permission, συνδέσου ως admin από τις Ρυθμίσεις.`); }
  };
  const filteredSeasons = seasons.filter((season) => season.competition_id === competitionId);
  return <main className="live-match"><h1>Δημιουργία αγώνα και ρόστερ</h1><p className="status">Χρειάζεσαι σύνδεση admin. <Link to="/settings">Άνοιγμα Ρυθμίσεων</Link></p><section className="panel"><label>Διοργάνωση<select value={competitionId} onChange={(event) => { setCompetitionId(event.target.value); setSeasonId(""); }}><option value="">Επίλεξε</option>{competitions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Σεζόν<select value={seasonId} onChange={(event) => setSeasonId(event.target.value)}><option value="">Επίλεξε</option>{filteredSeasons.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Ημερομηνία<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Γηπεδούχος<select value={homeId} onChange={(event) => setHomeId(event.target.value)}><option value="">Επίλεξε</option>{registrations.map((item) => <option key={item.id} value={item.id}>{item.teams.name}</option>)}</select></label><label>Φιλοξενούμενος<select value={awayId} onChange={(event) => setAwayId(event.target.value)}><option value="">Επίλεξε</option>{registrations.map((item) => <option key={item.id} value={item.id}>{item.teams.name}</option>)}</select></label><button className="primary" onClick={() => void createMatch()}>Δημιουργία αγώνα και snapshot ρόστερ</button><p className="status">{message}</p></section></main>;
}
