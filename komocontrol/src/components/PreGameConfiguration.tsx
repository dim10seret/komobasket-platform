import { useEffect, useMemo, useState, type ReactNode } from "react";

interface PreGameConfigurationProps {
    configuration: KomoControlPreGameConfiguration;
    busy: boolean;
    error: string | null;
    savedRevision: number | null;
    footer: ReactNode;
    onBack: () => void;
    onDraftEdited: () => void;
    onSave: (input: KomoControlPreGameConfigurationSaveDraftInput) => Promise<void>;
}

type DraftTeams = [KomoControlPreGameConfigurationTeamDraft, KomoControlPreGameConfigurationTeamDraft];
interface EditableDraft { teams: DraftTeams; presentation: { leftSide: KomoControlTeamSide }; }

const colorPresets = ["#1D4ED8", "#EA580C", "#DC2626", "#15803D", "#7E22CE", "#111827", "#F8FAFC", "#EAB308"];
type ExtraBenchRole = KomoControlPreGameConfigurationTeamDraft["extraBench"][number]["role"];
export interface RosterViewFilter { query: string; participantsOnly: boolean; }
type RosterFilters = Record<KomoControlTeamSide, RosterViewFilter>;

const extraBenchRoles: ReadonlyArray<{ value: ExtraBenchRole; label: string }> = [
    { value: "coach", label: "Προπονητής" },
    { value: "assistant_coach", label: "Βοηθός προπονητή" },
    { value: "team_manager", label: "Έφορος / Υπεύθυνος ομάδας" },
    { value: "physiotherapist", label: "Φυσικοθεραπευτής" },
    { value: "doctor", label: "Ιατρός" },
    { value: "other", label: "Λοιπό Staff" },
];

function initialRosterFilters(): RosterFilters {
    return { HOME: { query: "", participantsOnly: false }, AWAY: { query: "", participantsOnly: false } };
}

export function rosterNeedsFilter(playerCount: number): boolean { return playerCount > 20; }

export function rosterView<T extends { playerId: string; displayName: string; packageShirtNumber: number | null }>(
    players: readonly T[],
    draftPlayers: readonly { playerId: string; participating: boolean; gameShirtNumber: string | null }[],
    filter: RosterViewFilter,
): { players: T[]; hiddenSelected: number } {
    const values = new Map(draftPlayers.map((player) => [player.playerId, player]));
    const query = filter.query.trim().toLocaleLowerCase("el");
    const filtering = query.length > 0 || filter.participantsOnly;
    const visible = players.length <= 20
        ? [...players]
        : filtering
            ? players.filter((player) => {
                const value = values.get(player.playerId);
                if (filter.participantsOnly && !value?.participating) return false;
                if (!query) return true;
                const fields = [player.displayName, value?.gameShirtNumber ?? "", player.packageShirtNumber === null ? "" : String(player.packageShirtNumber)];
                return fields.some((field) => field.toLocaleLowerCase("el").includes(query));
            })
            : players.slice(0, 20);
    const visibleIds = new Set(visible.map((player) => player.playerId));
    const hiddenSelected = draftPlayers.filter((player) => player.participating && !visibleIds.has(player.playerId)).length;
    return { players: visible, hiddenSelected };
}

export function displayedTeamSides(leftSide: KomoControlTeamSide): [KomoControlTeamSide, KomoControlTeamSide] {
    return [leftSide, oppositeSide(leftSide)];
}

function editableDraft(configuration: KomoControlPreGameConfiguration): EditableDraft {
    return {
        teams: configuration.teams.map((team) => ({
            side: team.side,
            players: team.players.map((player) => ({ playerId: player.playerId, participating: player.participating, gameShirtNumber: player.gameShirtNumber })),
            staff: team.staff.map((member) => ({ staffId: member.staffId, participating: member.participating })),
            extraBench: team.extraBench.map((entry) => ({ ...entry })),
            captainPlayerId: team.captainPlayerId,
            starterPlayerIds: [...team.starterPlayerIds],
            gameColor: team.gameColor,
        })) as DraftTeams,
        presentation: { leftSide: configuration.presentation.leftSide },
    };
}

export function oppositeSide(side: KomoControlTeamSide): KomoControlTeamSide { return side === "HOME" ? "AWAY" : "HOME"; }

export function withPlayerParticipation(team: KomoControlPreGameConfigurationTeamDraft, playerId: string, participating: boolean): KomoControlPreGameConfigurationTeamDraft {
    return {
        ...team,
        players: team.players.map((player) => player.playerId === playerId ? { ...player, participating } : player),
        captainPlayerId: !participating && team.captainPlayerId === playerId ? null : team.captainPlayerId,
        starterPlayerIds: participating ? team.starterPlayerIds : team.starterPlayerIds.filter((id) => id !== playerId),
    };
}

function PlayerDraftRow({ player, value, captain, starter, starterLimitReached, side, onChange, onCaptain, onStarter }: {
    player: KomoControlPreGameConfigurationPlayer;
    value: KomoControlPreGameConfigurationPlayerDraft;
    captain: boolean;
    starter: boolean;
    starterLimitReached: boolean;
    side: KomoControlTeamSide;
    onChange: (value: KomoControlPreGameConfigurationPlayerDraft) => void;
    onCaptain: () => void;
    onStarter: (selected: boolean) => void;
}) {
    const packageNumber = player.packageShirtNumber === null ? null : String(player.packageShirtNumber);
    const overridden = value.gameShirtNumber !== packageNumber;
    return (
        <li className={value.participating ? "pregame-player is-selected" : "pregame-player"}>
            <label className="pregame-player-toggle">
                <input type="checkbox" checked={value.participating} onChange={(event) => onChange({ ...value, participating: event.target.checked })} />
                <span><strong>{player.displayName}</strong><small>{value.participating ? "Συμμετέχει" : "Εκτός"}</small></span>
            </label>
            <label className="pregame-number-field">
                <span>Αρ.</span>
                <input type="text" inputMode="numeric" maxLength={2} value={value.gameShirtNumber ?? ""} placeholder="—" aria-label={`Αριθμός αγώνα για ${player.displayName}`} onChange={(event) => onChange({ ...value, gameShirtNumber: event.target.value === "" ? null : event.target.value })} />
                <small>{overridden ? "Override" : packageNumber === null ? "Χωρίς αρχικό" : `Pkg ${packageNumber}`}</small>
            </label>
            <label className="pregame-role-toggle">
                <input type="radio" name={`captain-${side}`} checked={captain} disabled={!value.participating} onChange={onCaptain} />
                Αρχηγός
            </label>
            <label className="pregame-role-toggle">
                <input type="checkbox" checked={starter} disabled={!value.participating || (!starter && starterLimitReached)} onChange={(event) => onStarter(event.target.checked)} />
                Βασικός
            </label>
        </li>
    );
}

function TeamDraft({ team, draft, placement, startingPlayers, filter, onFilterChange, onChange }: {
    team: KomoControlPreGameConfigurationTeam;
    draft: KomoControlPreGameConfigurationTeamDraft;
    placement: "LEFT" | "RIGHT";
    startingPlayers: number;
    filter: RosterViewFilter;
    onFilterChange: (filter: RosterViewFilter) => void;
    onChange: (draft: KomoControlPreGameConfigurationTeamDraft) => void;
}) {
    const [extraBenchName, setExtraBenchName] = useState("");
    const [extraBenchRole, setExtraBenchRole] = useState<ExtraBenchRole>("coach");
    const players = new Map(draft.players.map((player) => [player.playerId, player]));
    const staff = new Map(draft.staff.map((member) => [member.staffId, member]));
    const selected = draft.players.filter((player) => player.participating).length;
    const starters = new Set(draft.starterPlayerIds);
    const view = rosterView(team.players, draft.players, filter);
    const extraBenchNameValid = extraBenchName.trim().length >= 2 && extraBenchName.trim().length <= 100 && !/[\u0000-\u001f\u007f]/.test(extraBenchName);
    const addExtraBench = () => {
        if (!extraBenchNameValid || draft.extraBench.length >= 10) return;
        onChange({ ...draft, extraBench: [...draft.extraBench, { entryId: crypto.randomUUID(), name: extraBenchName.trim(), role: extraBenchRole }] });
        setExtraBenchName("");
    };
    return (
        <section className={`pregame-team pregame-team-${team.side.toLowerCase()}`} style={draft.gameColor ? { borderColor: draft.gameColor, borderTopColor: draft.gameColor } : undefined} aria-labelledby={`pregame-${team.side.toLowerCase()}`}>
            <header>
                <div className="pregame-team-identity">
                    <span className="pregame-color-swatch" style={draft.gameColor ? { backgroundColor: draft.gameColor } : undefined} aria-hidden="true" />
                    <div><div className="pregame-team-badges"><span className="pregame-authority-badge">{team.side}</span><span className="pregame-placement-badge">{placement}</span></div><h2 id={`pregame-${team.side.toLowerCase()}`}>{team.teamName}</h2></div>
                </div>
                <div className="pregame-team-counts"><strong>{selected}/{team.players.length}</strong><small>Βασικοί {draft.starterPlayerIds.length}/{startingPlayers}</small></div>
            </header>
            <div className="pregame-color-control">
                <span>Χρώμα αγώνα</span>
                <div className="pregame-color-presets">
                    {colorPresets.map((color) => <button key={color} type="button" className={draft.gameColor === color ? "is-active" : ""} style={{ backgroundColor: color }} aria-label={`Επιλογή χρώματος ${color}`} onClick={() => onChange({ ...draft, gameColor: color })} />)}
                </div>
                <label className="pregame-custom-color">Custom<input type="color" value={draft.gameColor ?? "#2563EB"} onChange={(event) => onChange({ ...draft, gameColor: event.target.value.toUpperCase() })} /></label>
                <button type="button" className="text-button" disabled={draft.gameColor === null} onClick={() => onChange({ ...draft, gameColor: null })}>Καθαρισμός</button>
            </div>
            {rosterNeedsFilter(team.players.length) ? <div className="pregame-roster-filter">
                <input type="search" value={filter.query} placeholder="Αναζήτηση παίκτη..." aria-label={`Αναζήτηση παίκτη ${team.side}`} onChange={(event) => onFilterChange({ ...filter, query: event.target.value })} />
                <label><input type="checkbox" checked={filter.participantsOnly} onChange={(event) => onFilterChange({ ...filter, participantsOnly: event.target.checked })} />Μόνο συμμετέχοντες</label>
                {view.hiddenSelected > 0 ? <small>{view.hiddenSelected} επιλεγμένοι παίκτες δεν εμφανίζονται στο τρέχον φίλτρο.</small> : null}
            </div> : null}
            <ul className="pregame-player-list">
                {view.players.map((player) => {
                    const value = players.get(player.playerId);
                    if (!value) return null;
                    return <PlayerDraftRow key={player.playerId} player={player} value={value} side={team.side} captain={draft.captainPlayerId === player.playerId} starter={starters.has(player.playerId)} starterLimitReached={starters.size >= startingPlayers}
                        onChange={(next) => onChange(next.participating === value.participating ? { ...draft, players: draft.players.map((entry) => entry.playerId === next.playerId ? next : entry) } : withPlayerParticipation({ ...draft, players: draft.players.map((entry) => entry.playerId === next.playerId ? next : entry) }, next.playerId, next.participating))}
                        onCaptain={() => onChange({ ...draft, captainPlayerId: player.playerId })}
                        onStarter={(selectedStarter) => onChange({ ...draft, starterPlayerIds: selectedStarter ? [...draft.starterPlayerIds, player.playerId] : draft.starterPlayerIds.filter((id) => id !== player.playerId) })} />;
                })}
            </ul>
            <div className="pregame-staff">
                <h3>Package Staff</h3>
                {team.staff.length === 0 ? <p>Δεν υπάρχει Staff στο Package.</p> : team.staff.map((member) => {
                    const value = staff.get(member.staffId);
                    if (!value) return null;
                    return <label key={member.staffId}><input type="checkbox" checked={value.participating} onChange={(event) => onChange({ ...draft, staff: draft.staff.map((entry) => entry.staffId === member.staffId ? { ...entry, participating: event.target.checked } : entry) })} /><span><strong>{member.displayName}</strong><small>{member.roleLabel ?? member.role}</small></span></label>;
                })}
            </div>
            <div className="pregame-extra-bench">
                <div className="pregame-extra-bench-heading"><h3>Πάγκος</h3><small>Μόνο για αυτό το Run · {draft.extraBench.length}/10</small></div>
                <div className="pregame-extra-bench-form">
                    <label><span>Ονοματεπώνυμο</span><input type="text" maxLength={100} value={extraBenchName} onChange={(event) => setExtraBenchName(event.target.value)} /></label>
                    <label><span>Ιδιότητα</span><select value={extraBenchRole} onChange={(event) => setExtraBenchRole(event.target.value as ExtraBenchRole)}>{extraBenchRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
                    <button type="button" className="secondary-button" disabled={!extraBenchNameValid || draft.extraBench.length >= 10} onClick={addExtraBench}>+ Προσθήκη</button>
                </div>
                {draft.extraBench.length === 0 ? <p className="pregame-extra-bench-empty">Δεν έχει προστεθεί Run-only Staff.</p> : <ul className="pregame-extra-bench-list">{draft.extraBench.map((entry) => <li key={entry.entryId}><span><strong>{entry.name}</strong><small>{extraBenchRoles.find((role) => role.value === entry.role)?.label}</small></span><button type="button" className="text-button" onClick={() => onChange({ ...draft, extraBench: draft.extraBench.filter((candidate) => candidate.entryId !== entry.entryId) })}>Αφαίρεση</button></li>)}</ul>}
            </div>
        </section>
    );
}

export function savedDraftConfirmationVisible(currentRevision: number, savedRevision: number | null, dirty: boolean): boolean { return !dirty && savedRevision === currentRevision; }

export function PreGameConfiguration({ configuration, busy, error, savedRevision, footer, onBack, onDraftEdited, onSave }: PreGameConfigurationProps) {
    const [draft, setDraft] = useState<EditableDraft>(() => editableDraft(configuration));
    const [rosterFilters, setRosterFilters] = useState<RosterFilters>(() => initialRosterFilters());
    useEffect(() => { setDraft(editableDraft(configuration)); setRosterFilters(initialRosterFilters()); }, [configuration.runId, configuration.revision]);
    const baseline = useMemo(() => JSON.stringify(editableDraft(configuration)), [configuration]);
    const dirty = JSON.stringify(draft) !== baseline;
    const showSavedConfirmation = savedDraftConfirmationVisible(configuration.revision, savedRevision, dirty);
    const rightSide = oppositeSide(draft.presentation.leftSide);
    const displayedSides = displayedTeamSides(draft.presentation.leftSide);
    const sameColor = draft.teams[0].gameColor !== null && draft.teams[0].gameColor === draft.teams[1].gameColor;

    const updateDraft = (next: EditableDraft) => { onDraftEdited(); setDraft(next); };
    const updateTeam = (side: KomoControlTeamSide, team: KomoControlPreGameConfigurationTeamDraft) => updateDraft({ ...draft, teams: side === "HOME" ? [team, draft.teams[1]] : [draft.teams[0], team] });

    return (
        <main className="home-shell pregame-shell">
            <section className="home-card pregame-card">
                <header className="pregame-header"><div><span className="eyebrow">DURABLE LOCAL DRAFT</span><h1>Πλήρες φύλλο προετοιμασίας</h1><p>Package v{configuration.packageVersion} · Run {configuration.runId.slice(-8)} · Revision {configuration.revision}</p></div><div className="pregame-state"><span className="status-dot" />{dirty ? "Μη αποθηκευμένες αλλαγές" : "Το draft είναι αποθηκευμένο"}</div></header>
                <div className="pregame-guidance">Οι συμμετοχές, οι αριθμοί, το Staff, οι αρχηγοί, οι βασικοί, τα χρώματα και η φυσική τοποθέτηση ισχύουν μόνο για αυτό το Run.</div>
                <div className="pregame-placement"><div><strong>LEFT</strong><span>{draft.presentation.leftSide}</span></div><button type="button" className="secondary-button" onClick={() => updateDraft({ ...draft, presentation: { leftSide: rightSide } })}>Αλλαγή πλευρών</button><div><strong>RIGHT</strong><span>{rightSide}</span></div></div>
                {sameColor ? <p className="pregame-color-warning">HOME και AWAY έχουν το ίδιο χρώμα. Επιτρέπεται, αλλά η οπτική διάκριση θα είναι μικρότερη.</p> : null}
                <div className="pregame-teams">
                    {displayedSides.map((side, index) => {
                        const teamIndex = side === "HOME" ? 0 : 1;
                        return <TeamDraft key={side} team={configuration.teams[teamIndex]} draft={draft.teams[teamIndex]} placement={index === 0 ? "LEFT" : "RIGHT"} startingPlayers={configuration.settings.startingPlayers} filter={rosterFilters[side]} onFilterChange={(filter) => setRosterFilters((current) => ({ ...current, [side]: filter }))} onChange={(team) => updateTeam(side, team)} />;
                    })}
                </div>
                {error ? <p className="form-message error" role="alert">{error}</p> : null}
                <div className="pregame-actions"><button type="button" className="secondary-button" onClick={onBack} disabled={busy}>Πίσω στην προετοιμασία</button><div className="pregame-save-cluster">{showSavedConfirmation ? <p className="pregame-save-confirmation" role="status" aria-live="polite">Το πρόχειρο αποθηκεύτηκε · Revision {savedRevision}</p> : null}<button type="button" className="primary-button" disabled={busy || !dirty} onClick={() => void onSave({ gameId: configuration.gameId, expectedRevision: configuration.revision, teams: draft.teams, presentation: draft.presentation })}>{busy ? "Αποθήκευση…" : "Αποθήκευση Draft"}</button></div></div>
                {footer}
            </section>
        </main>
    );
}
