"use client";

import { usePlatformContext, PlatformButton, PlatformForm, PlatformFileInput } from "@/components/admin/platform/shared/platform-context";
import { useEffect, useMemo, useState } from "react";
import { getCanonicalMovementCompetitionId, getCanonicalMovementCompetitionName, movementMatchesCompetition } from "@/lib/player-movement-lineage";
import { selectEligibleAdditionPlayers } from "@/lib/player-movement-addition";
import { Field, Panel, Row, Snapshot, buttonClass, inputClass, parseDateForDisplay } from "../shared/admin-core";

type MovementMode = "addition" | "departure" | "transfer";

type MovementRow = Row & {
  player_name?: string | null;
  from_team_name?: string | null;
  to_team_name?: string | null;
  season_name?: string | null;
  competition_name?: string | null;
};

type Props = {
  data: Snapshot;
  add: (payload: Record<string, unknown>) => Promise<boolean>;
  depart: (payload: Record<string, unknown>) => Promise<boolean>;
  transfer: (payload: Record<string, unknown>) => Promise<boolean>;
  busy: boolean;
};

const movementTypeLabels: Record<string, string> = {
  addition: "Προσθήκη",
  departure: "Αποχώρηση",
  transfer: "Μεταγραφή",
};

function asString(value: unknown) {
  return String(value ?? "").trim();
}

function compareLabel(a: string, b: string) {
  return a.localeCompare(b, "el-GR", { sensitivity: "base", numeric: true });
}

function uniqueBy<T extends Row>(rows: T[], key: string) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const value = asString(row[key]);
    if (!value || seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}

function uniqueSortedLabelOptions(rows: Row[], idKey: string, labelKey: string) {
  return uniqueBy(rows, idKey)
    .map((row) => ({ id: asString(row[idKey]), name: asString(row[labelKey]) || "—" }))
    .sort((a, b) => compareLabel(a.name, b.name));
}

export function Movements({
  data,
  add,
  depart,
  transfer,
  busy,
}: Props) {
  const [mode, setMode] = useState<MovementMode>("addition");

  const [additionSeasonId, setAdditionSeasonId] = useState("");
  const [additionCompetitionId, setAdditionCompetitionId] = useState("");
  const [additionTeamId, setAdditionTeamId] = useState("");
  const [additionPlayerId, setAdditionPlayerId] = useState("");
  const [additionDate, setAdditionDate] = useState("");
  const [additionNote, setAdditionNote] = useState("");

  const [departureSeasonId, setDepartureSeasonId] = useState("");
  const [departureCompetitionId, setDepartureCompetitionId] = useState("");
  const [departureTeamId, setDepartureTeamId] = useState("");
  const [departureRosterId, setDepartureRosterId] = useState("");
  const [departureDate, setDepartureDate] = useState("");
  const [departureNote, setDepartureNote] = useState("");
  const [departureConfirmed, setDepartureConfirmed] = useState(false);

  const [transferSeasonId, setTransferSeasonId] = useState("");
  const [transferCompetitionId, setTransferCompetitionId] = useState("");
  const [transferFromTeamId, setTransferFromTeamId] = useState("");
  const [transferPlayerId, setTransferPlayerId] = useState("");
  const [transferToTeamId, setTransferToTeamId] = useState("");
  const [transferShirtNumber, setTransferShirtNumber] = useState("");
  const [transferDate, setTransferDate] = useState("");
  const [transferNote, setTransferNote] = useState("");
  const [transferConfirmed, setTransferConfirmed] = useState(false);

  const [historySeasonId, setHistorySeasonId] = useState("");
  const [historyCompetitionId, setHistoryCompetitionId] = useState("");

  const seasonOptions = useMemo(
    () => uniqueSortedLabelOptions(data.seasons, "id", "name"),
    [data.seasons],
  );

  const departureCompetitionOptions = useMemo(() => {
    if (!departureSeasonId) return [];
    const rows = data.participations.filter((row) => asString(row.season_id) === departureSeasonId);
    return uniqueSortedLabelOptions(rows, "competition_id", "competition_name");
  }, [data.participations, departureSeasonId]);

  const additionCompetitionOptions = useMemo(() => {
    if (!additionSeasonId) return [];
    return uniqueSortedLabelOptions(
      data.participations.filter((row) => asString(row.season_id) === additionSeasonId),
      "competition_id",
      "competition_name",
    );
  }, [additionSeasonId, data.participations]);

  const transferCompetitionOptions = useMemo(() => {
    if (!transferSeasonId) return [];
    const rows = data.participations.filter((row) => asString(row.season_id) === transferSeasonId);
    return uniqueSortedLabelOptions(rows, "competition_id", "competition_name");
  }, [data.participations, transferSeasonId]);

  const historyCompetitionOptions = useMemo(() => {
    if (!historySeasonId) return uniqueSortedLabelOptions(data.competitions, "id", "name");
    const rows = data.participations.filter((row) => asString(row.season_id) === historySeasonId);
    return uniqueSortedLabelOptions(rows, "competition_id", "competition_name");
  }, [data.competitions, data.participations, historySeasonId]);

  const departureTeamOptions = useMemo(() => {
    if (!departureSeasonId || !departureCompetitionId) return [];
    const rows = data.participations.filter(
      (row) => asString(row.season_id) === departureSeasonId && asString(row.competition_id) === departureCompetitionId,
    );
    return uniqueSortedLabelOptions(rows, "team_id", "team_name");
  }, [data.participations, departureCompetitionId, departureSeasonId]);

  const additionTeamOptions = useMemo(() => {
    if (!additionSeasonId || !additionCompetitionId) return [];
    return uniqueSortedLabelOptions(data.participations.filter((row) => (
      asString(row.season_id) === additionSeasonId
      && asString(row.competition_id) === additionCompetitionId
    )), "team_id", "team_name");
  }, [additionCompetitionId, additionSeasonId, data.participations]);

  const eligibleAdditionPlayers = useMemo(
    () => selectEligibleAdditionPlayers(data.players, data.rosters, additionSeasonId, additionCompetitionId),
    [additionCompetitionId, additionSeasonId, data.players, data.rosters],
  );

  const transferFromTeamOptions = useMemo(() => {
    if (!transferSeasonId || !transferCompetitionId) return [];
    const rows = data.participations.filter(
      (row) => asString(row.season_id) === transferSeasonId && asString(row.competition_id) === transferCompetitionId,
    );
    return uniqueSortedLabelOptions(rows, "team_id", "team_name");
  }, [data.participations, transferCompetitionId, transferSeasonId]);

  const transferToTeamOptions = useMemo(() => {
    if (!transferSeasonId || !transferCompetitionId || !transferFromTeamId) return [];
    const rows = data.participations.filter(
      (row) =>
        asString(row.season_id) === transferSeasonId
        && asString(row.competition_id) === transferCompetitionId
        && asString(row.team_id) !== transferFromTeamId,
    );
    return uniqueSortedLabelOptions(rows, "team_id", "team_name");
  }, [data.participations, transferCompetitionId, transferFromTeamId, transferSeasonId]);

  const departurePlayers = useMemo(() => {
    if (!departureSeasonId || !departureCompetitionId || !departureTeamId) return [];
    return data.rosters
      .filter((row) => asString(row.season_id) === departureSeasonId)
      .filter((row) => asString(row.competition_id) === departureCompetitionId)
      .filter((row) => asString(row.team_id) === departureTeamId)
      .filter((row) => asString(row.status) === "active")
      .sort((a, b) => compareLabel(asString(a.player_name), asString(b.player_name)));
  }, [data.rosters, departureCompetitionId, departureSeasonId, departureTeamId]);

  const transferPlayers = useMemo(() => {
    if (!transferSeasonId || !transferCompetitionId || !transferFromTeamId) return [];
    return data.rosters
      .filter((row) => asString(row.season_id) === transferSeasonId)
      .filter((row) => asString(row.competition_id) === transferCompetitionId)
      .filter((row) => asString(row.team_id) === transferFromTeamId)
      .filter((row) => asString(row.status) === "active")
      .sort((a, b) => compareLabel(asString(a.player_name), asString(b.player_name)));
  }, [data.rosters, transferCompetitionId, transferFromTeamId, transferSeasonId]);

  const movementRows = useMemo(() => {
    return (data.movements as MovementRow[])
      .map((row) => {
        const seasonId = asString(row.season_id);
        const competitionId = getCanonicalMovementCompetitionId(row);
        return {
          id: asString(row.id),
          season_id: seasonId,
          competition_id: competitionId,
          effective_on: asString(row.effective_on),
          player_name: asString(row.player_name),
          movement_type: movementTypeLabels[asString(row.movement_type)] ?? (asString(row.movement_type) || "—"),
          from_team_name: asString(row.from_team_name) || "—",
          to_team_name: asString(row.to_team_name) || "—",
          season_name: asString(data.seasons.find((season) => asString(season.id) === seasonId)?.name) || "—",
          competition_name: getCanonicalMovementCompetitionName(row, data.competitions),
        };
      })
      .filter((row) => {
        if (historySeasonId && row.season_id !== historySeasonId) return false;
        if (!movementMatchesCompetition(row, historyCompetitionId)) return false;
        return true;
      })
      .sort((a, b) => compareLabel(b.effective_on, a.effective_on));
  }, [data.competitions, data.movements, data.seasons, historyCompetitionId, historySeasonId]);

  useEffect(() => {
    setAdditionCompetitionId("");
    setAdditionTeamId("");
    setAdditionPlayerId("");
  }, [additionSeasonId]);

  useEffect(() => {
    setAdditionTeamId("");
    setAdditionPlayerId("");
  }, [additionCompetitionId]);

  useEffect(() => {
    setDepartureCompetitionId("");
    setDepartureTeamId("");
    setDepartureRosterId("");
    setDepartureConfirmed(false);
  }, [departureSeasonId]);

  useEffect(() => {
    setDepartureTeamId("");
    setDepartureRosterId("");
    setDepartureConfirmed(false);
  }, [departureCompetitionId]);

  useEffect(() => {
    setDepartureRosterId("");
    setDepartureConfirmed(false);
  }, [departureTeamId]);

  useEffect(() => {
    setTransferCompetitionId("");
    setTransferFromTeamId("");
    setTransferPlayerId("");
    setTransferToTeamId("");
    setTransferShirtNumber("");
    setTransferConfirmed(false);
  }, [transferSeasonId]);

  useEffect(() => {
    setTransferFromTeamId("");
    setTransferPlayerId("");
    setTransferToTeamId("");
    setTransferShirtNumber("");
    setTransferConfirmed(false);
  }, [transferCompetitionId]);

  useEffect(() => {
    setTransferPlayerId("");
    setTransferToTeamId("");
    setTransferShirtNumber("");
    setTransferConfirmed(false);
  }, [transferFromTeamId]);

  useEffect(() => {
    setTransferToTeamId("");
    setTransferConfirmed(false);
  }, [transferPlayerId]);

  useEffect(() => {
    setHistoryCompetitionId("");
  }, [historySeasonId]);

  const selectedDeparturePlayer = departurePlayers.find((row) => asString(row.id) === departureRosterId) ?? null;
  const selectedTransferPlayer = transferPlayers.find((row) => asString(row.player_id) === transferPlayerId) ?? null;

  const resetAddition = () => {
    setAdditionSeasonId("");
    setAdditionCompetitionId("");
    setAdditionTeamId("");
    setAdditionPlayerId("");
    setAdditionDate("");
    setAdditionNote("");
  };

  const resetDeparture = () => {
    setDepartureSeasonId("");
    setDepartureCompetitionId("");
    setDepartureTeamId("");
    setDepartureRosterId("");
    setDepartureDate("");
    setDepartureNote("");
    setDepartureConfirmed(false);
  };

  const resetTransfer = () => {
    setTransferSeasonId("");
    setTransferCompetitionId("");
    setTransferFromTeamId("");
    setTransferPlayerId("");
    setTransferToTeamId("");
    setTransferShirtNumber("");
    setTransferDate("");
    setTransferNote("");
    setTransferConfirmed(false);
  };

  const submitDeparture = async () => {
    if (!departureRosterId || !departureConfirmed) return;
    const ok = await depart({
      rosterId: departureRosterId,
      effectiveOn: departureDate || null,
      note: departureNote || null,
    });
    if (ok) resetDeparture();
  };

  const submitAddition = async () => {
    if (!additionSeasonId || !additionCompetitionId || !additionTeamId || !additionPlayerId) return;
    const ok = await add({
      playerId: additionPlayerId,
      seasonId: additionSeasonId,
      competitionId: additionCompetitionId,
      teamId: additionTeamId,
      effectiveOn: additionDate || null,
      note: additionNote || null,
    });
    if (ok) resetAddition();
  };

  const submitTransfer = async () => {
    if (!selectedTransferPlayer || !transferToTeamId || !transferConfirmed) return;
    const ok = await transfer({
      playerId: selectedTransferPlayer.player_id,
      seasonId: transferSeasonId,
      competitionId: transferCompetitionId,
      fromTeamId: transferFromTeamId,
      toTeamId: transferToTeamId,
      shirtNumber: transferShirtNumber ? Number(transferShirtNumber) : null,
      effectiveOn: transferDate || null,
      note: transferNote || null,
    });
    if (ok) resetTransfer();
  };

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <h2 className="text-3xl font-black text-zinc-950">Μεταγραφές &amp; Αποχωρήσεις</h2>
        <p className="max-w-3xl text-zinc-600">Διαχείριση προσθηκών, αποχωρήσεων και μεταγραφών με διατήρηση του ιστορικού του αθλητή.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <PlatformButton
          type="button"
          onClick={() => setMode("addition")}
          className={`rounded-full px-4 py-2 text-sm font-black transition ${mode === "addition" ? "bg-zinc-950 text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:border-orange-500"}`}
        >
          Προσθήκη
        </PlatformButton>
        <PlatformButton
          type="button"
          onClick={() => setMode("departure")}
          className={`rounded-full px-4 py-2 text-sm font-black transition ${mode === "departure" ? "bg-zinc-950 text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:border-orange-500"}`}
        >
          Αποχώρηση
        </PlatformButton>
        <PlatformButton
          type="button"
          onClick={() => setMode("transfer")}
          className={`rounded-full px-4 py-2 text-sm font-black transition ${mode === "transfer" ? "bg-zinc-950 text-white" : "border border-zinc-300 bg-white text-zinc-700 hover:border-orange-500"}`}
        >
          Μεταγραφή
        </PlatformButton>
      </div>

      {mode === "addition" ? (
        <Panel title="Προσθήκη" description="Προσθήκη υπάρχοντος αθλητή σε ομάδα της επιλεγμένης διοργάνωσης.">
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Σεζόν">
                <select value={additionSeasonId} onChange={(event) => setAdditionSeasonId(event.target.value)} className={inputClass}>
                  <option value="">Επιλογή</option>
                  {seasonOptions.map((season) => <option key={season.id} value={season.id}>{season.name}</option>)}
                </select>
              </Field>
              <Field label="Διοργάνωση">
                <select value={additionCompetitionId} onChange={(event) => setAdditionCompetitionId(event.target.value)} className={inputClass} disabled={!additionSeasonId}>
                  <option value="">Επιλογή</option>
                  {additionCompetitionOptions.map((competition) => <option key={competition.id} value={competition.id}>{competition.name}</option>)}
                </select>
              </Field>
              <Field label="Ομάδα">
                <select value={additionTeamId} onChange={(event) => setAdditionTeamId(event.target.value)} className={inputClass} disabled={!additionCompetitionId}>
                  <option value="">Επιλογή</option>
                  {additionTeamOptions.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </Field>
              <Field label="Αθλητής">
                <select value={additionPlayerId} onChange={(event) => setAdditionPlayerId(event.target.value)} className={inputClass} disabled={!additionTeamId}>
                  <option value="">Επιλογή</option>
                  {eligibleAdditionPlayers.map((player) => (
                    <option key={asString(player.player_id ?? player.id)} value={asString(player.player_id ?? player.id)}>
                      {asString(player.display_name) || "—"} {player.birth_date ? `· ${parseDateForDisplay(asString(player.birth_date))}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Ημερομηνία προσθήκης">
                <input type="date" value={additionDate} onChange={(event) => setAdditionDate(event.target.value)} className={inputClass} />
              </Field>
              <Field label="Σημείωση">
                <input value={additionNote} onChange={(event) => setAdditionNote(event.target.value)} className={inputClass} />
              </Field>
            </div>
            <div className="flex flex-wrap gap-3">
              <PlatformButton mutation type="button" onClick={() => void submitAddition()} disabled={busy || !additionPlayerId || !additionTeamId} className={buttonClass}>
                Προσθήκη
              </PlatformButton>
              <PlatformButton type="button" onClick={resetAddition} className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700 transition hover:border-orange-500">
                Ακύρωση
              </PlatformButton>
            </div>
            {additionTeamId && !eligibleAdditionPlayers.length ? <p className="text-sm text-zinc-500">Δεν υπάρχουν διαθέσιμοι αθλητές για προσθήκη.</p> : null}
          </div>
        </Panel>
      ) : mode === "departure" ? (
        <Panel title="Αποχώρηση" description="Ο αθλητής αποχωρεί από το τρέχον ρόστερ και η ιστορία του διατηρείται.">
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Σεζόν">
                <select
                  value={departureSeasonId}
                  onChange={(event) => setDepartureSeasonId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">Επιλογή</option>
                  {seasonOptions.map((season) => (
                    <option key={season.id} value={season.id}>{season.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Διοργάνωση">
                <select
                  value={departureCompetitionId}
                  onChange={(event) => setDepartureCompetitionId(event.target.value)}
                  className={inputClass}
                  disabled={!departureSeasonId}
                >
                  <option value="">Επιλογή</option>
                  {departureCompetitionOptions.map((competition) => (
                    <option key={competition.id} value={competition.id}>{competition.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Ομάδα">
                <select
                  value={departureTeamId}
                  onChange={(event) => setDepartureTeamId(event.target.value)}
                  className={inputClass}
                  disabled={!departureCompetitionId}
                >
                  <option value="">Επιλογή</option>
                  {departureTeamOptions.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Αθλητής">
                <select
                  value={departureRosterId}
                  onChange={(event) => setDepartureRosterId(event.target.value)}
                  className={inputClass}
                  disabled={!departureTeamId}
                >
                  <option value="">Επιλογή</option>
                  {departurePlayers.map((row) => (
                    <option key={String(row.id)} value={String(row.id)}>
                      {String(row.player_name ?? "—")} {row.birth_date ? `· ${parseDateForDisplay(String(row.birth_date))}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            {selectedDeparturePlayer && (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm font-black text-zinc-950">Επιλεγμένος αθλητής</p>
                <p className="mt-1 text-sm text-zinc-700">
                  {String(selectedDeparturePlayer.player_name ?? "—")}
                  {selectedDeparturePlayer.birth_date ? ` · ${parseDateForDisplay(String(selectedDeparturePlayer.birth_date))}` : ""}
                </p>
                <p className="mt-2 text-sm text-zinc-600">Αφαίρεση του αθλητή από το ρόστερ με διατήρηση της ιστορικής συμμετοχής.</p>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Ημερομηνία αποχώρησης">
                <input
                  type="date"
                  value={departureDate}
                  onChange={(event) => setDepartureDate(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <Field label="Σημείωση">
                <input
                  value={departureNote}
                  onChange={(event) => setDepartureNote(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <label className="flex items-end gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-700">
                <input
                  type="checkbox"
                  checked={departureConfirmed}
                  onChange={(event) => setDepartureConfirmed(event.target.checked)}
                  className="size-4 accent-orange-600"
                />
                Ο {String(selectedDeparturePlayer?.player_name ?? "αθλητής")} θα αποχωρήσει από την ομάδα και το ιστορικό θα διατηρηθεί.
              </label>
            </div>

            <div className="flex flex-wrap gap-3">
              <PlatformButton mutation
                type="button"
                onClick={() => void submitDeparture()}
                disabled={busy || !departureRosterId || !departureConfirmed}
                className={buttonClass}
              >
                Καταχώριση αποχώρησης
              </PlatformButton>
              <PlatformButton
                type="button"
                onClick={resetDeparture}
                className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700 transition hover:border-orange-500"
              >
                Ακύρωση
              </PlatformButton>
            </div>

            {departureTeamId && !departurePlayers.length && (
              <p className="text-sm text-zinc-500">Δεν υπάρχουν ενεργοί αθλητές στο επιλεγμένο ρόστερ.</p>
            )}
          </div>
        </Panel>
      ) : (
        <Panel title="Μεταγραφή" description="Ο ίδιος αθλητής μεταφέρεται σε νέα ομάδα μέσα στην ίδια διοργάνωση.">
          <div className="space-y-5">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Field label="Σεζόν">
                <select
                  value={transferSeasonId}
                  onChange={(event) => setTransferSeasonId(event.target.value)}
                  className={inputClass}
                >
                  <option value="">Επιλογή</option>
                  {seasonOptions.map((season) => (
                    <option key={season.id} value={season.id}>{season.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Διοργάνωση">
                <select
                  value={transferCompetitionId}
                  onChange={(event) => setTransferCompetitionId(event.target.value)}
                  className={inputClass}
                  disabled={!transferSeasonId}
                >
                  <option value="">Επιλογή</option>
                  {transferCompetitionOptions.map((competition) => (
                    <option key={competition.id} value={competition.id}>{competition.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Από Ομάδα">
                <select
                  value={transferFromTeamId}
                  onChange={(event) => setTransferFromTeamId(event.target.value)}
                  className={inputClass}
                  disabled={!transferCompetitionId}
                >
                  <option value="">Επιλογή</option>
                  {transferFromTeamOptions.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Αθλητής">
                <select
                  value={transferPlayerId}
                  onChange={(event) => setTransferPlayerId(event.target.value)}
                  className={inputClass}
                  disabled={!transferFromTeamId}
                >
                  <option value="">Επιλογή</option>
                  {transferPlayers.map((row) => (
                    <option key={String(row.player_id)} value={String(row.player_id)}>
                      {String(row.player_name ?? "—")} {row.birth_date ? `· ${parseDateForDisplay(String(row.birth_date))}` : ""}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <Field label="Προς Ομάδα">
                <select
                  value={transferToTeamId}
                  onChange={(event) => setTransferToTeamId(event.target.value)}
                  className={inputClass}
                  disabled={!transferPlayerId}
                >
                  <option value="">Επιλογή</option>
                  {transferToTeamOptions.map((team) => (
                    <option key={team.id} value={team.id}>{team.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="No. Φανέλας στη νέα ομάδα (προαιρετικό)">
                <input
                  value={transferShirtNumber}
                  onChange={(event) => setTransferShirtNumber(event.target.value)}
                  inputMode="numeric"
                  className={inputClass}
                />
              </Field>
              <Field label="Ημερομηνία μεταγραφής">
                <input
                  type="date"
                  value={transferDate}
                  onChange={(event) => setTransferDate(event.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>

            {selectedTransferPlayer && transferToTeamId && (
              <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm font-black text-zinc-950">Επιβεβαίωση μεταγραφής</p>
                <p className="mt-1 text-sm text-zinc-700">
                  {String(selectedTransferPlayer.player_name ?? "—")}
                  {selectedTransferPlayer.birth_date ? ` · ${parseDateForDisplay(String(selectedTransferPlayer.birth_date))}` : ""}
                  {" · "}{transferFromTeamOptions.find((team) => team.id === transferFromTeamId)?.name ?? "—"} → {transferToTeamOptions.find((team) => team.id === transferToTeamId)?.name ?? "—"}
                </p>
                <p className="mt-2 text-sm text-zinc-600">Ο ίδιος αθλητής θα μεταφερθεί στη νέα ομάδα και η προηγούμενη συμμετοχή του θα παραμείνει στο ιστορικό.</p>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <Field label="Σημείωση">
                <input
                  value={transferNote}
                  onChange={(event) => setTransferNote(event.target.value)}
                  className={inputClass}
                />
              </Field>
              <label className="flex items-end gap-3 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-bold text-zinc-700">
                <input
                  type="checkbox"
                  checked={transferConfirmed}
                  onChange={(event) => setTransferConfirmed(event.target.checked)}
                  className="size-4 accent-orange-600"
                />
                Επιβεβαιώνω ότι πρόκειται για την ίδια stable ταυτότητα αθλητή.
              </label>
            </div>

            <div className="flex flex-wrap gap-3">
              <PlatformButton mutation
                type="button"
                onClick={() => void submitTransfer()}
                disabled={busy || !transferPlayerId || !transferToTeamId || !transferConfirmed}
                className={buttonClass}
              >
                Μεταγραφή
              </PlatformButton>
              <PlatformButton
                type="button"
                onClick={resetTransfer}
                className="rounded-xl border border-zinc-300 bg-white px-4 py-2.5 font-black text-zinc-700 transition hover:border-orange-500"
              >
                Ακύρωση
              </PlatformButton>
            </div>

            {transferFromTeamId && !transferPlayers.length && (
              <p className="text-sm text-zinc-500">Δεν υπάρχουν διαθέσιμοι αθλητές για μεταγραφή.</p>
            )}
            {transferFromTeamId && !transferToTeamOptions.length && (
              <p className="text-sm text-zinc-500">Δεν υπάρχουν άλλες διαθέσιμες ομάδες στη συγκεκριμένη διοργάνωση.</p>
            )}
          </div>
        </Panel>
      )}

      <Panel title="Ιστορικό Μετακινήσεων" description="Προσθήκη, αποχώρηση και μεταγραφή διατηρούν το ιστορικό του αθλητή.">
        <div className="mb-4 grid gap-4 md:grid-cols-2">
          <Field label="Σεζόν">
            <select value={historySeasonId} onChange={(event) => setHistorySeasonId(event.target.value)} className={inputClass}>
              <option value="">Όλες</option>
              {seasonOptions.map((season) => (
                <option key={season.id} value={season.id}>{season.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Διοργάνωση">
            <select value={historyCompetitionId} onChange={(event) => setHistoryCompetitionId(event.target.value)} className={inputClass}>
              <option value="">Όλες</option>
              {historyCompetitionOptions.map((competition) => (
                <option key={competition.id} value={competition.id}>{competition.name}</option>
              ))}
            </select>
          </Field>
        </div>

        {movementRows.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-left text-sm">
              <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500">
                <tr>
                  <th className="px-3 py-3">Ημερομηνία</th>
                  <th className="px-3 py-3">Αθλητής</th>
                  <th className="px-3 py-3">Ενέργεια</th>
                  <th className="px-3 py-3">Από</th>
                  <th className="px-3 py-3">Προς</th>
                  <th className="px-3 py-3">Σεζόν</th>
                  <th className="px-3 py-3">Διοργάνωση</th>
                </tr>
              </thead>
              <tbody>
                {movementRows.map((row) => (
                  <tr key={row.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-3 py-3 text-zinc-700">{parseDateForDisplay(String(row.effective_on))}</td>
                    <td className="px-3 py-3 text-zinc-700">{String(row.player_name ?? "—")}</td>
                    <td className="px-3 py-3 text-zinc-700">{String(row.movement_type ?? "—")}</td>
                    <td className="px-3 py-3 text-zinc-700">{String(row.from_team_name ?? "—")}</td>
                    <td className="px-3 py-3 text-zinc-700">{String(row.to_team_name ?? "—")}</td>
                    <td className="px-3 py-3 text-zinc-700">{String(row.season_name ?? "—")}</td>
                    <td className="px-3 py-3 text-zinc-700">{String(row.competition_name ?? "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-500">Δεν υπάρχουν καταγεγραμμένες μετακινήσεις.</p>
        )}
      </Panel>
    </div>
  );
}
