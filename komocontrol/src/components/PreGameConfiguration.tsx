import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

interface PreGameConfigurationProps {
    configuration: KomoControlPreGameConfiguration;
    busy: boolean;
    startPending?: boolean;
    error: string | null;
    startReadiness?: KomoControlStartReadinessIssue | null;
    configurationValidation?: KomoControlLiveConfigurationValidationIssue | null;
    savedRevision: number | null;
    readOnly?: boolean;
    footer: ReactNode;
    onBack: () => void;
    onDraftEdited: () => void;
    onSave: (input: KomoControlPreGameConfigurationSaveDraftInput) => Promise<boolean>;
    onStartMatch?: () => Promise<void>;
}

type DraftTeams = [KomoControlPreGameConfigurationTeamDraft, KomoControlPreGameConfigurationTeamDraft];
interface EditableDraft { teams: DraftTeams; presentation: { leftSide: KomoControlTeamSide }; officials: KomoControlOfficials; }

export const teamColorPresets = ["#1D4ED8", "#DC2626", "#EA580C", "#15803D", "#7E22CE", "#111827", "#F8FAFC", "#EAB308", "#0891B2", "#881337", "#DB2777", "#0F766E"] as const;
export const teamColorLabel = "Χρώμα ομάδας";
export const customColorLabel = "Custom";
type ExtraBenchRole = KomoControlPreGameConfigurationTeamDraft["extraBench"][number]["role"];
export interface RosterViewFilter { query: string; participantsOnly: boolean; }
type RosterFilters = Record<KomoControlTeamSide, RosterViewFilter>;
type TeamExpansion = Record<KomoControlTeamSide, boolean>;
type TeamAccentStyle = CSSProperties & { "--team-accent"?: string };

export const playerTableColumns = ["#", "ΠΑΙΚΤΗΣ", "ΚΑΤΑΣΤΑΣΗ", "ΑΡ.", "C", "STARTER"] as const;

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

function initialTeamExpansion(): TeamExpansion { return { HOME: false, AWAY: false }; }

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

export function compactRosterView<T extends { playerId: string; displayName: string; packageShirtNumber: number | null }>(
    players: readonly T[],
    draftPlayers: readonly { playerId: string; participating: boolean; gameShirtNumber: string | null }[],
    filter: RosterViewFilter,
    expanded: boolean,
): { players: T[]; hiddenSelected: number; collapsible: boolean } {
    const filtered = rosterView(players, draftPlayers, filter);
    const collapsible = players.length > 8 && players.length <= 20;
    if (!collapsible || expanded) return { ...filtered, collapsible };
    const visible = filtered.players.slice(0, 8);
    const visibleIds = new Set(visible.map((player) => player.playerId));
    const hiddenSelected = draftPlayers.filter((player) => player.participating && !visibleIds.has(player.playerId)).length;
    return { players: visible, hiddenSelected, collapsible };
}

export function teamAccentStyle(gameColor: string | null): TeamAccentStyle {
    return gameColor ? { "--team-accent": gameColor, borderColor: gameColor } : {};
}

export function configurationDisplayStatus(dirty: boolean): { phase: "ΠΡΟΣΧΕΔΙΟ"; savedLabel: string; saveConfirmation: string } {
    return { phase: "ΠΡΟΣΧΕΔΙΟ", savedLabel: dirty ? "Μη αποθηκευμένες αλλαγές" : "Αποθηκευμένο", saveConfirmation: "Το πρόχειρο αποθηκεύτηκε" };
}

export function authoritativeTeamIndex(side: KomoControlTeamSide): 0 | 1 { return side === "HOME" ? 0 : 1; }

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
        officials: { referees: { ...configuration.officials.referees }, table: { ...configuration.officials.table } },
    };
}

export function oppositeSide(side: KomoControlTeamSide): KomoControlTeamSide { return side === "HOME" ? "AWAY" : "HOME"; }

function OfficialTextInput({ label, value, readOnly, onChange }: { label: string; value: string | null; readOnly: boolean; onChange: (value: string | null) => void }) { return <label>{label}<input type="text" maxLength={120} disabled={readOnly} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} placeholder="Ονοματεπώνυμο"/></label>; }
function OfficialsDialog({ value, readOnly, busy, onClose, onSave }: { value: KomoControlOfficials; readOnly: boolean; busy: boolean; onClose: () => void; onSave: (value: KomoControlOfficials) => Promise<void> }) {
    const [draft, setDraft] = useState<KomoControlOfficials>(() => ({ referees: { ...value.referees }, table: { ...value.table } }));
    const referee = (key: keyof KomoControlOfficials["referees"], label: string) => <OfficialTextInput key={key} label={label} value={draft.referees[key]} readOnly={readOnly} onChange={(name) => setDraft((current) => ({ ...current, referees: { ...current.referees, [key]: name } }))}/>;
    const table = (key: keyof KomoControlOfficials["table"], label: string) => <OfficialTextInput key={key} label={label} value={draft.table[key]} readOnly={readOnly} onChange={(name) => setDraft((current) => ({ ...current, table: { ...current.table, [key]: name } }))}/>;
    return <div className="pregame-officials-backdrop"><section className="pregame-officials-dialog" role="dialog" aria-modal="true" aria-labelledby="pregame-officials-title"><header><h2 id="pregame-officials-title">Διαιτητές &amp; Γραμματεία</h2><button type="button" className="secondary-button" disabled={busy} onClick={onClose} aria-label="Κλείσιμο">Κλείσιμο</button></header><div className="pregame-officials-grid"><fieldset disabled={busy}><legend>Διαιτητές</legend>{referee("a", "Διαιτητής Α")}{referee("b", "Διαιτητής Β")}{referee("c", "Διαιτητής Γ")}</fieldset><fieldset disabled={busy}><legend>Γραμματεία</legend>{table("timer", "Χρονόμετρο")}{table("shotClock", "24''")}{table("scoresheet", "Φύλλο Αγώνα")}{table("commissioner", "Κομισάριος")}</fieldset></div>{!readOnly ? <footer><button type="button" className="primary-button" disabled={busy} onClick={() => void onSave(draft)}>{busy ? "Αποθήκευση…" : "Αποθήκευση"}</button></footer> : null}</section></div>;
}

export function withPlayerParticipation(team: KomoControlPreGameConfigurationTeamDraft, playerId: string, participating: boolean): KomoControlPreGameConfigurationTeamDraft {
    return {
        ...team,
        players: team.players.map((player) => player.playerId === playerId ? { ...player, participating } : player),
        captainPlayerId: !participating && team.captainPlayerId === playerId ? null : team.captainPlayerId,
        starterPlayerIds: participating ? team.starterPlayerIds : team.starterPlayerIds.filter((id) => id !== playerId),
    };
}

export function livePlayerControlPolicy(live: boolean, wasParticipating: boolean, participating: boolean): { participationLocked: boolean; shirtNumberLocked: boolean; captainStarterLocked: boolean } {
    return {
        participationLocked: live && wasParticipating,
        shirtNumberLocked: live && !participating,
        captainStarterLocked: live,
    };
}

function PlayerDraftRow({ player, value, rowNumber, captain, starter, starterLimitReached, side, readOnly, live, startInvalid, onChange, onCaptain, onStarter }: {
    player: KomoControlPreGameConfigurationPlayer;
    value: KomoControlPreGameConfigurationPlayerDraft;
    rowNumber: number;
    captain: boolean;
    starter: boolean;
    starterLimitReached: boolean;
    side: KomoControlTeamSide;
    readOnly: boolean;
    live: boolean;
    startInvalid: boolean;
    onChange: (value: KomoControlPreGameConfigurationPlayerDraft) => void;
    onCaptain: () => void;
    onStarter: (selected: boolean) => void;
}) {
    const packageNumber = player.packageShirtNumber === null ? null : String(player.packageShirtNumber);
    const overridden = value.gameShirtNumber !== packageNumber;
    const controls = livePlayerControlPolicy(live, player.participating, value.participating);
    return (
        <li className={`pregame-player${value.participating ? " is-selected" : ""}${startInvalid ? " has-start-readiness-error" : ""}`}>
            <label className="pregame-player-select" aria-label={`Συμμετοχή ${player.displayName}`}>
                <input type="checkbox" checked={value.participating} disabled={readOnly || controls.participationLocked} onChange={(event) => onChange({ ...value, participating: event.target.checked })} />
                <span>{rowNumber}</span>
            </label>
            <strong className="pregame-player-name">{player.displayName}</strong>
            <span className={value.participating ? "pregame-player-status is-participating" : "pregame-player-status"}>{value.participating ? "Συμμετέχει" : "Εκτός"}</span>
            <label className="pregame-number-field">
                <input type="text" inputMode="numeric" maxLength={2} value={value.gameShirtNumber ?? ""} disabled={readOnly || controls.shirtNumberLocked} placeholder="—" aria-invalid={startInvalid || undefined} aria-label={`Αριθμός αγώνα για ${player.displayName}`} onChange={(event) => onChange({ ...value, gameShirtNumber: event.target.value === "" ? null : event.target.value })} />
                <small>{overridden ? "Override" : packageNumber === null ? "Χωρίς αρχικό" : `Pkg ${packageNumber}`}</small>
            </label>
            <label className="pregame-role-toggle" aria-label={`Αρχηγός ${player.displayName}`}>
                <input type="radio" name={`captain-${side}`} checked={captain} disabled={readOnly || controls.captainStarterLocked || !value.participating} onChange={onCaptain} />
            </label>
            <label className="pregame-role-toggle" aria-label={`Βασικός ${player.displayName}`}>
                <input type="checkbox" checked={starter} disabled={readOnly || controls.captainStarterLocked || !value.participating || (!starter && starterLimitReached)} onChange={(event) => onStarter(event.target.checked)} />
            </label>
        </li>
    );
}

function TeamDraft({ team, draft, placement, minPlayers, maxPlayers, startingPlayers, filter, rosterExpanded, readOnly, live, readinessIssue, onFilterChange, onRosterExpandedChange, onChange }: {
    team: KomoControlPreGameConfigurationTeam;
    draft: KomoControlPreGameConfigurationTeamDraft;
    placement: "LEFT" | "RIGHT";
    minPlayers: number;
    maxPlayers: number;
    startingPlayers: number;
    filter: RosterViewFilter;
    rosterExpanded: boolean;
    readOnly: boolean;
    live: boolean;
    readinessIssue: KomoControlStartReadinessIssue | KomoControlLiveConfigurationValidationIssue | null;
    onFilterChange: (filter: RosterViewFilter) => void;
    onRosterExpandedChange: (expanded: boolean) => void;
    onChange: (draft: KomoControlPreGameConfigurationTeamDraft) => void;
}) {
    const [extraBenchName, setExtraBenchName] = useState("");
    const [extraBenchRole, setExtraBenchRole] = useState<ExtraBenchRole>("coach");
    const [extraBenchFormOpen, setExtraBenchFormOpen] = useState(false);
    const [editingExtraBenchId, setEditingExtraBenchId] = useState<string | null>(null);
    const players = new Map(draft.players.map((player) => [player.playerId, player]));
    const staff = new Map(draft.staff.map((member) => [member.staffId, member]));
    const selected = draft.players.filter((player) => player.participating).length;
    const starters = new Set(draft.starterPlayerIds);
    const view = compactRosterView(team.players, draft.players, filter, rosterExpanded);
    const extraBenchNameValid = extraBenchName.trim().length >= 2 && extraBenchName.trim().length <= 100 && !/[\u0000-\u001f\u007f]/.test(extraBenchName);
    const invalidPlayerIds = startReadinessPlayerIds(readinessIssue, team.side);
    const closeExtraBenchForm = () => {
        setExtraBenchName("");
        setExtraBenchRole("coach");
        setEditingExtraBenchId(null);
        setExtraBenchFormOpen(false);
    };
    const openExtraBenchEdit = (entry: KomoControlPreGameConfigurationTeamDraft["extraBench"][number]) => {
        setExtraBenchName(entry.name);
        setExtraBenchRole(entry.role);
        setEditingExtraBenchId(entry.entryId);
        setExtraBenchFormOpen(true);
    };
    const saveExtraBench = () => {
        if (!extraBenchNameValid || (!editingExtraBenchId && draft.extraBench.length >= 10)) return;
        const entry = { entryId: editingExtraBenchId ?? crypto.randomUUID(), name: extraBenchName.trim(), role: extraBenchRole };
        onChange({ ...draft, extraBench: editingExtraBenchId ? draft.extraBench.map((candidate) => candidate.entryId === editingExtraBenchId ? entry : candidate) : [...draft.extraBench, entry] });
        closeExtraBenchForm();
    };
    return (
        <section className={`pregame-team pregame-team-${team.side.toLowerCase()}${readinessIssue?.teamSide === team.side ? " has-start-readiness-error" : ""}`} style={teamAccentStyle(draft.gameColor)} aria-labelledby={`pregame-${team.side.toLowerCase()}`}>
            <header>
                <div className="pregame-team-identity">
                    <span className="pregame-color-swatch" style={draft.gameColor ? { backgroundColor: draft.gameColor } : undefined} aria-hidden="true" />
                    <div><div className="pregame-team-badges"><span className="pregame-authority-badge">{team.side}</span><span className="pregame-placement-badge">{placement}</span></div><h2 id={`pregame-${team.side.toLowerCase()}`}>{team.teamName}</h2></div>
                </div>
                <div className="pregame-team-counts"><strong>{selected}/{team.players.length}</strong><small>Βασικοί {draft.starterPlayerIds.length}/{startingPlayers}</small></div>
            </header>
            <div className="pregame-color-control">
                <span>{teamColorLabel}</span>
                <div className="pregame-color-presets">
                    {teamColorPresets.map((color) => <button key={color} type="button" disabled={readOnly} className={draft.gameColor === color ? "is-active" : ""} style={{ backgroundColor: color }} aria-label={`Επιλογή χρώματος ${color}`} onClick={() => onChange({ ...draft, gameColor: color })} />)}
                </div>
                <label className="pregame-custom-color">{customColorLabel}<input type="color" disabled={readOnly} value={draft.gameColor ?? "#2563EB"} onChange={(event) => onChange({ ...draft, gameColor: event.target.value.toUpperCase() })} /></label>
                <button type="button" className="text-button" disabled={readOnly || live || draft.gameColor === null} onClick={() => onChange({ ...draft, gameColor: null })}>Καθαρισμός</button>
            </div>
            {rosterNeedsFilter(team.players.length) ? <div className="pregame-roster-filter">
                <input type="search" value={filter.query} placeholder="Αναζήτηση παίκτη..." aria-label={`Αναζήτηση παίκτη ${team.side}`} onChange={(event) => onFilterChange({ ...filter, query: event.target.value })} />
                <label><input type="checkbox" checked={filter.participantsOnly} onChange={(event) => onFilterChange({ ...filter, participantsOnly: event.target.checked })} />Μόνο συμμετέχοντες</label>
            </div> : null}
            <div className="pregame-player-table-header">{playerTableColumns.map((column) => <span key={column}>{column}</span>)}</div>
            <ul className="pregame-player-list">
                {view.players.map((player) => {
                    const value = players.get(player.playerId);
                    if (!value) return null;
                    return <PlayerDraftRow key={player.playerId} player={player} value={value} rowNumber={team.players.findIndex((candidate) => candidate.playerId === player.playerId) + 1} side={team.side} readOnly={readOnly} live={live} startInvalid={invalidPlayerIds.has(player.playerId)} captain={draft.captainPlayerId === player.playerId} starter={starters.has(player.playerId)} starterLimitReached={starters.size >= startingPlayers}
                        onChange={(next) => onChange(next.participating === value.participating ? { ...draft, players: draft.players.map((entry) => entry.playerId === next.playerId ? next : entry) } : withPlayerParticipation({ ...draft, players: draft.players.map((entry) => entry.playerId === next.playerId ? next : entry) }, next.playerId, next.participating))}
                        onCaptain={() => onChange({ ...draft, captainPlayerId: player.playerId })}
                        onStarter={(selectedStarter) => onChange({ ...draft, starterPlayerIds: selectedStarter ? [...draft.starterPlayerIds, player.playerId] : draft.starterPlayerIds.filter((id) => id !== player.playerId) })} />;
                })}
            </ul>
            {view.hiddenSelected > 0 ? <p className="pregame-hidden-selected">{view.hiddenSelected} επιλεγμένοι παίκτες δεν εμφανίζονται στην τρέχουσα προβολή.</p> : null}
            {view.collapsible ? <div className="pregame-roster-toggle"><button type="button" className="text-button" onClick={() => onRosterExpandedChange(!rosterExpanded)}>{rosterExpanded ? "Απόκρυψη" : `Προβολή όλων (${team.players.length})`}</button></div> : null}
            <div className="pregame-staff">
                <h3>Προπονητικό επιτελείο</h3>
                {team.staff.length === 0 ? <p>Δεν υπάρχει Staff στο Package.</p> : <><div className="pregame-staff-header"><span>ΟΝΟΜΑ</span><span>ΡΟΛΟΣ</span><span>ΣΥΜΜΕΤΕΧΕΙ</span></div>{team.staff.map((member) => {
                    const value = staff.get(member.staffId);
                    if (!value) return null;
                    return <label className="pregame-staff-row" key={member.staffId}><strong>{member.displayName}</strong><span>{member.roleLabel ?? member.role}</span><input type="checkbox" disabled={readOnly || live} aria-label={`Συμμετοχή Staff ${member.displayName}`} checked={value.participating} onChange={(event) => onChange({ ...draft, staff: draft.staff.map((entry) => entry.staffId === member.staffId ? { ...entry, participating: event.target.checked } : entry) })} /></label>;
                })}</>}
            </div>
            <div className="pregame-extra-bench">
                <div className="pregame-extra-bench-heading"><div><h3>Πρόσθετος πάγκος</h3><small>Μόνο για αυτό το Run · {draft.extraBench.length}/10</small></div>{!extraBenchFormOpen ? <button type="button" className="text-button" disabled={readOnly || draft.extraBench.length >= 10} onClick={() => { setEditingExtraBenchId(null); setExtraBenchName(""); setExtraBenchRole("coach"); setExtraBenchFormOpen(true); }}>+ Προσθήκη</button> : null}</div>
                {extraBenchFormOpen ? <div className="pregame-extra-bench-form">
                    <label><span>Ονοματεπώνυμο</span><input type="text" maxLength={100} value={extraBenchName} onChange={(event) => setExtraBenchName(event.target.value)} /></label>
                    <label><span>Ιδιότητα</span><select value={extraBenchRole} onChange={(event) => setExtraBenchRole(event.target.value as ExtraBenchRole)}>{extraBenchRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
                    <button type="button" className="secondary-button" disabled={!extraBenchNameValid || (!editingExtraBenchId && draft.extraBench.length >= 10)} onClick={saveExtraBench}>{editingExtraBenchId ? "Αποθήκευση αλλαγών" : "+ Προσθήκη"}</button>
                    <button type="button" className="text-button" onClick={closeExtraBenchForm}>Ακύρωση</button>
                </div> : null}
                {draft.extraBench.length === 0 ? <p className="pregame-extra-bench-empty">Δεν έχει προστεθεί Run-only Staff.</p> : <ul className="pregame-extra-bench-list">{draft.extraBench.map((entry) => <li key={entry.entryId}><span><strong>{entry.name}</strong><small>{extraBenchRoles.find((role) => role.value === entry.role)?.label}</small></span><div className="pregame-extra-bench-list-actions"><button type="button" className="text-button" disabled={readOnly} onClick={() => openExtraBenchEdit(entry)}>Επεξεργασία</button><button type="button" className="text-button" disabled={readOnly} onClick={() => { if (editingExtraBenchId === entry.entryId) closeExtraBenchForm(); onChange({ ...draft, extraBench: draft.extraBench.filter((candidate) => candidate.entryId !== entry.entryId) }); }}>Αφαίρεση</button></div></li>)}</ul>}
            </div>
            <div className="pregame-team-rules"><span>Ελάχιστο: <strong>{minPlayers}</strong></span><span>Μέγιστο: <strong>{maxPlayers}</strong></span><span>Starter που απαιτούνται: <strong>{startingPlayers}</strong></span></div>
        </section>
    );
}

export function savedDraftConfirmationVisible(currentRevision: number, savedRevision: number | null, dirty: boolean): boolean { return !dirty && savedRevision === currentRevision; }
export function startReadinessPlayerIds(issue: KomoControlStartReadinessIssue | KomoControlLiveConfigurationValidationIssue | null | undefined, side: KomoControlTeamSide): Set<string> { return new Set(issue?.teamSide === side ? issue.affectedPlayers.map((player) => player.playerId) : []); }
export function startMatchButtonPresentation(readOnly: boolean, busy: boolean, dirty: boolean, startPending: boolean): { disabled: boolean; label: string } { return { disabled: readOnly || busy || dirty, label: startPending ? "Έναρξη…" : "Έναρξη αγώνα" }; }

export function PreGameConfiguration({ configuration, busy, startPending = false, error, startReadiness = null, configurationValidation = null, savedRevision, readOnly = false, footer, onBack, onDraftEdited, onSave, onStartMatch }: PreGameConfigurationProps) {
    const [draft, setDraft] = useState<EditableDraft>(() => editableDraft(configuration));
    const [officialsOpen, setOfficialsOpen] = useState(false);
    const [rosterFilters, setRosterFilters] = useState<RosterFilters>(() => initialRosterFilters());
    const [rosterExpanded, setRosterExpanded] = useState<TeamExpansion>(() => initialTeamExpansion());
    useEffect(() => { setDraft(editableDraft(configuration)); setRosterFilters(initialRosterFilters()); setRosterExpanded(initialTeamExpansion()); }, [configuration.runId, configuration.revision]);
    const baseline = useMemo(() => JSON.stringify(editableDraft(configuration)), [configuration]);
    const dirty = JSON.stringify(draft) !== baseline;
    const showSavedConfirmation = savedDraftConfirmationVisible(configuration.revision, savedRevision, dirty);
    const rightSide = oppositeSide(draft.presentation.leftSide);
    const displayedSides = displayedTeamSides(draft.presentation.leftSide);
    const sameColor = draft.teams[0].gameColor !== null && draft.teams[0].gameColor === draft.teams[1].gameColor;
    const displayStatus = configurationDisplayStatus(dirty);
    const live = configuration.lifecycle === "live";
    const validationIssue = configurationValidation ?? startReadiness;
    const startButton = startMatchButtonPresentation(readOnly, busy, dirty, startPending);

    const updateDraft = (next: EditableDraft) => { if (readOnly) return; onDraftEdited(); setDraft(next); };
    const updateTeam = (side: KomoControlTeamSide, team: KomoControlPreGameConfigurationTeamDraft) => updateDraft({ ...draft, teams: side === "HOME" ? [team, draft.teams[1]] : [draft.teams[0], team] });

    return (
        <main className="home-shell pregame-shell">
            <section className="home-card pregame-card">
                <header className="pregame-topbar">
                    <div className="pregame-title-block"><button type="button" className="pregame-back-button" onClick={onBack} disabled={busy}>← <span>Προετοιμασία αγώνα</span></button><h1>Συμμετοχές και αριθμοί</h1><p>Package v{configuration.packageVersion} · Run {configuration.runId.slice(-8)}</p></div>
                    <div className="pregame-placement"><div><strong>LEFT</strong><span>{draft.presentation.leftSide}</span></div><button type="button" className="secondary-button" disabled={readOnly} onClick={() => updateDraft({ ...draft, presentation: { leftSide: rightSide } })}>⇄ Αλλαγή πλευρών</button><div><strong>RIGHT</strong><span>{rightSide}</span></div></div>
                    <div className="pregame-status-board"><div><strong>{displayStatus.phase}</strong><span className={dirty ? "is-dirty" : "is-saved"}>{displayStatus.savedLabel}</span></div></div>
                </header>
                {live ? <aside className="pregame-live-correction-note" role="status"><strong>Διόρθωση ενεργού αγώνα</strong><span>Ο αγώνας είναι σε εξέλιξη. Μπορείτε να προσθέσετε παίκτη, να διαχειριστείτε τον Run-only πρόσθετο πάγκο ή να διορθώσετε αριθμό φανέλας, χρώμα ομάδας και πλευρές. Η αγωνιστική ιστορία παραμένει ενεργή.</span></aside> : null}
                {sameColor ? <p className="pregame-color-warning">HOME και AWAY έχουν το ίδιο χρώμα. Επιτρέπεται, αλλά η οπτική διάκριση θα είναι μικρότερη.</p> : null}
                <div className="pregame-teams">
                    {displayedSides.map((side, index) => {
                        const teamIndex = authoritativeTeamIndex(side);
                        return <TeamDraft key={side} team={configuration.teams[teamIndex]} draft={draft.teams[teamIndex]} placement={index === 0 ? "LEFT" : "RIGHT"} minPlayers={configuration.settings.minPlayers} maxPlayers={configuration.settings.maxPlayers} startingPlayers={configuration.settings.startingPlayers} filter={rosterFilters[side]} rosterExpanded={rosterExpanded[side]} readOnly={readOnly} live={live} readinessIssue={validationIssue?.teamSide === side ? validationIssue : null} onFilterChange={(filter) => setRosterFilters((current) => ({ ...current, [side]: filter }))} onRosterExpandedChange={(expanded) => setRosterExpanded((current) => ({ ...current, [side]: expanded }))} onChange={(team) => updateTeam(side, team)} />;
                    })}
                </div>
                {error ? <p className="form-message error" role="alert">{error}</p> : null}
                <div className="pregame-actions"><aside className="pregame-action-guidance" aria-label="Οδηγίες πριν την έναρξη"><span className="pregame-guidance-icon" aria-hidden="true">i</span><span>{readOnly ? "Η διαμόρφωση είναι διαθέσιμη μόνο για ανάγνωση." : live ? "Οι επιτρεπτές διορθώσεις αποθηκεύονται πρώτα τοπικά. Συμμετέχοντες που ξεκίνησαν, αρχηγός, βασικοί και πάγκος παραμένουν κλειδωμένοι." : "Συμπληρώστε συμμετοχές, αριθμούς, αρχηγούς, βασικούς, Staff, χρώματα και θέση παρουσίασης. Οι αλλαγές ισχύουν μόνο για αυτό το Run."}</span></aside><div className="pregame-save-cluster">{showSavedConfirmation ? <p className="pregame-save-confirmation" role="status" aria-live="polite">{displayStatus.saveConfirmation}</p> : null}<button type="button" className="secondary-button" disabled={busy} onClick={() => setOfficialsOpen(true)}>Διαιτητές &amp; Γραμματεία</button><button type="button" className="primary-button" disabled={readOnly || busy || !dirty} onClick={() => void onSave({ gameId: configuration.gameId, expectedRevision: configuration.revision, teams: draft.teams, presentation: draft.presentation, officials: draft.officials })}>{busy ? "Αποθήκευση…" : "Αποθήκευση Draft"}</button>{onStartMatch ? <button type="button" className="start-match-button" disabled={startButton.disabled} aria-busy={startPending} onClick={() => void onStartMatch()}>{startButton.label}</button> : null}</div></div>
                {officialsOpen ? <OfficialsDialog value={draft.officials} readOnly={Boolean(readOnly)} busy={busy} onClose={() => setOfficialsOpen(false)} onSave={async (officials) => { const next = { ...draft, officials }; updateDraft(next); const saved = await onSave({ gameId: configuration.gameId, expectedRevision: configuration.revision, teams: next.teams, presentation: next.presentation, officials: next.officials }); if (saved) setOfficialsOpen(false); }}/> : null}
                {footer}
            </section>
        </main>
    );
}
