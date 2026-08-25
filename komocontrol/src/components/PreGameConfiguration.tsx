import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

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

export function configurationDisplayStatus(revision: number, dirty: boolean): { revision: number; phase: "DRAFT"; savedLabel: string } {
    return { revision, phase: "DRAFT", savedLabel: dirty ? "Μη αποθηκευμένο" : "Αποθηκευμένο" };
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

function PlayerDraftRow({ player, value, rowNumber, captain, starter, starterLimitReached, side, onChange, onCaptain, onStarter }: {
    player: KomoControlPreGameConfigurationPlayer;
    value: KomoControlPreGameConfigurationPlayerDraft;
    rowNumber: number;
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
            <label className="pregame-player-select" aria-label={`Συμμετοχή ${player.displayName}`}>
                <input type="checkbox" checked={value.participating} onChange={(event) => onChange({ ...value, participating: event.target.checked })} />
                <span>{rowNumber}</span>
            </label>
            <strong className="pregame-player-name">{player.displayName}</strong>
            <span className={value.participating ? "pregame-player-status is-participating" : "pregame-player-status"}>{value.participating ? "Συμμετέχει" : "Εκτός"}</span>
            <label className="pregame-number-field">
                <input type="text" inputMode="numeric" maxLength={2} value={value.gameShirtNumber ?? ""} placeholder="—" aria-label={`Αριθμός αγώνα για ${player.displayName}`} onChange={(event) => onChange({ ...value, gameShirtNumber: event.target.value === "" ? null : event.target.value })} />
                <small>{overridden ? "Override" : packageNumber === null ? "Χωρίς αρχικό" : `Pkg ${packageNumber}`}</small>
            </label>
            <label className="pregame-role-toggle" aria-label={`Αρχηγός ${player.displayName}`}>
                <input type="radio" name={`captain-${side}`} checked={captain} disabled={!value.participating} onChange={onCaptain} />
            </label>
            <label className="pregame-role-toggle" aria-label={`Βασικός ${player.displayName}`}>
                <input type="checkbox" checked={starter} disabled={!value.participating || (!starter && starterLimitReached)} onChange={(event) => onStarter(event.target.checked)} />
            </label>
        </li>
    );
}

function TeamDraft({ team, draft, placement, minPlayers, maxPlayers, startingPlayers, filter, rosterExpanded, onFilterChange, onRosterExpandedChange, onChange }: {
    team: KomoControlPreGameConfigurationTeam;
    draft: KomoControlPreGameConfigurationTeamDraft;
    placement: "LEFT" | "RIGHT";
    minPlayers: number;
    maxPlayers: number;
    startingPlayers: number;
    filter: RosterViewFilter;
    rosterExpanded: boolean;
    onFilterChange: (filter: RosterViewFilter) => void;
    onRosterExpandedChange: (expanded: boolean) => void;
    onChange: (draft: KomoControlPreGameConfigurationTeamDraft) => void;
}) {
    const [extraBenchName, setExtraBenchName] = useState("");
    const [extraBenchRole, setExtraBenchRole] = useState<ExtraBenchRole>("coach");
    const [extraBenchFormOpen, setExtraBenchFormOpen] = useState(false);
    const players = new Map(draft.players.map((player) => [player.playerId, player]));
    const staff = new Map(draft.staff.map((member) => [member.staffId, member]));
    const selected = draft.players.filter((player) => player.participating).length;
    const starters = new Set(draft.starterPlayerIds);
    const view = compactRosterView(team.players, draft.players, filter, rosterExpanded);
    const extraBenchNameValid = extraBenchName.trim().length >= 2 && extraBenchName.trim().length <= 100 && !/[\u0000-\u001f\u007f]/.test(extraBenchName);
    const addExtraBench = () => {
        if (!extraBenchNameValid || draft.extraBench.length >= 10) return;
        onChange({ ...draft, extraBench: [...draft.extraBench, { entryId: crypto.randomUUID(), name: extraBenchName.trim(), role: extraBenchRole }] });
        setExtraBenchName("");
        setExtraBenchFormOpen(false);
    };
    return (
        <section className={`pregame-team pregame-team-${team.side.toLowerCase()}`} style={teamAccentStyle(draft.gameColor)} aria-labelledby={`pregame-${team.side.toLowerCase()}`}>
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
                    {teamColorPresets.map((color) => <button key={color} type="button" className={draft.gameColor === color ? "is-active" : ""} style={{ backgroundColor: color }} aria-label={`Επιλογή χρώματος ${color}`} onClick={() => onChange({ ...draft, gameColor: color })} />)}
                </div>
                <label className="pregame-custom-color">{customColorLabel}<input type="color" value={draft.gameColor ?? "#2563EB"} onChange={(event) => onChange({ ...draft, gameColor: event.target.value.toUpperCase() })} /></label>
                <button type="button" className="text-button" disabled={draft.gameColor === null} onClick={() => onChange({ ...draft, gameColor: null })}>Καθαρισμός</button>
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
                    return <PlayerDraftRow key={player.playerId} player={player} value={value} rowNumber={team.players.findIndex((candidate) => candidate.playerId === player.playerId) + 1} side={team.side} captain={draft.captainPlayerId === player.playerId} starter={starters.has(player.playerId)} starterLimitReached={starters.size >= startingPlayers}
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
                    return <label className="pregame-staff-row" key={member.staffId}><strong>{member.displayName}</strong><span>{member.roleLabel ?? member.role}</span><input type="checkbox" aria-label={`Συμμετοχή Staff ${member.displayName}`} checked={value.participating} onChange={(event) => onChange({ ...draft, staff: draft.staff.map((entry) => entry.staffId === member.staffId ? { ...entry, participating: event.target.checked } : entry) })} /></label>;
                })}</>}
            </div>
            <div className="pregame-extra-bench">
                <div className="pregame-extra-bench-heading"><div><h3>Πρόσθετος πάγκος</h3><small>Μόνο για αυτό το Run · {draft.extraBench.length}/10</small></div>{!extraBenchFormOpen ? <button type="button" className="text-button" disabled={draft.extraBench.length >= 10} onClick={() => setExtraBenchFormOpen(true)}>+ Προσθήκη</button> : null}</div>
                {extraBenchFormOpen ? <div className="pregame-extra-bench-form">
                    <label><span>Ονοματεπώνυμο</span><input type="text" maxLength={100} value={extraBenchName} onChange={(event) => setExtraBenchName(event.target.value)} /></label>
                    <label><span>Ιδιότητα</span><select value={extraBenchRole} onChange={(event) => setExtraBenchRole(event.target.value as ExtraBenchRole)}>{extraBenchRoles.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}</select></label>
                    <button type="button" className="secondary-button" disabled={!extraBenchNameValid || draft.extraBench.length >= 10} onClick={addExtraBench}>+ Προσθήκη</button>
                    <button type="button" className="text-button" onClick={() => { setExtraBenchFormOpen(false); setExtraBenchName(""); }}>Ακύρωση</button>
                </div> : null}
                {draft.extraBench.length === 0 ? <p className="pregame-extra-bench-empty">Δεν έχει προστεθεί Run-only Staff.</p> : <ul className="pregame-extra-bench-list">{draft.extraBench.map((entry) => <li key={entry.entryId}><span><strong>{entry.name}</strong><small>{extraBenchRoles.find((role) => role.value === entry.role)?.label}</small></span><button type="button" className="text-button" onClick={() => onChange({ ...draft, extraBench: draft.extraBench.filter((candidate) => candidate.entryId !== entry.entryId) })}>Αφαίρεση</button></li>)}</ul>}
            </div>
            <div className="pregame-team-rules"><span>Ελάχιστο: <strong>{minPlayers}</strong></span><span>Μέγιστο: <strong>{maxPlayers}</strong></span><span>Starter που απαιτούνται: <strong>{startingPlayers}</strong></span></div>
        </section>
    );
}

export function savedDraftConfirmationVisible(currentRevision: number, savedRevision: number | null, dirty: boolean): boolean { return !dirty && savedRevision === currentRevision; }

export function PreGameConfiguration({ configuration, busy, error, savedRevision, footer, onBack, onDraftEdited, onSave }: PreGameConfigurationProps) {
    const [draft, setDraft] = useState<EditableDraft>(() => editableDraft(configuration));
    const [rosterFilters, setRosterFilters] = useState<RosterFilters>(() => initialRosterFilters());
    const [rosterExpanded, setRosterExpanded] = useState<TeamExpansion>(() => initialTeamExpansion());
    useEffect(() => { setDraft(editableDraft(configuration)); setRosterFilters(initialRosterFilters()); setRosterExpanded(initialTeamExpansion()); }, [configuration.runId, configuration.revision]);
    const baseline = useMemo(() => JSON.stringify(editableDraft(configuration)), [configuration]);
    const dirty = JSON.stringify(draft) !== baseline;
    const showSavedConfirmation = savedDraftConfirmationVisible(configuration.revision, savedRevision, dirty);
    const rightSide = oppositeSide(draft.presentation.leftSide);
    const displayedSides = displayedTeamSides(draft.presentation.leftSide);
    const sameColor = draft.teams[0].gameColor !== null && draft.teams[0].gameColor === draft.teams[1].gameColor;
    const displayStatus = configurationDisplayStatus(configuration.revision, dirty);

    const updateDraft = (next: EditableDraft) => { onDraftEdited(); setDraft(next); };
    const updateTeam = (side: KomoControlTeamSide, team: KomoControlPreGameConfigurationTeamDraft) => updateDraft({ ...draft, teams: side === "HOME" ? [team, draft.teams[1]] : [draft.teams[0], team] });

    return (
        <main className="home-shell pregame-shell">
            <section className="home-card pregame-card">
                <header className="pregame-topbar">
                    <div className="pregame-title-block"><button type="button" className="pregame-back-button" onClick={onBack} disabled={busy}>← <span>Προετοιμασία αγώνα</span></button><h1>Συμμετοχές και αριθμοί</h1><p>Package v{configuration.packageVersion} · Run {configuration.runId.slice(-8)}</p></div>
                    <div className="pregame-placement"><div><strong>LEFT</strong><span>{draft.presentation.leftSide}</span></div><button type="button" className="secondary-button" onClick={() => updateDraft({ ...draft, presentation: { leftSide: rightSide } })}>⇄ Αλλαγή πλευρών</button><div><strong>RIGHT</strong><span>{rightSide}</span></div></div>
                    <div className="pregame-status-board"><div><span>Αναθεώρηση</span><strong>{displayStatus.revision}</strong></div><div><strong>{displayStatus.phase}</strong><span className={dirty ? "is-dirty" : "is-saved"}>{displayStatus.savedLabel}</span></div></div>
                </header>
                {sameColor ? <p className="pregame-color-warning">HOME και AWAY έχουν το ίδιο χρώμα. Επιτρέπεται, αλλά η οπτική διάκριση θα είναι μικρότερη.</p> : null}
                <div className="pregame-teams">
                    {displayedSides.map((side, index) => {
                        const teamIndex = authoritativeTeamIndex(side);
                        return <TeamDraft key={side} team={configuration.teams[teamIndex]} draft={draft.teams[teamIndex]} placement={index === 0 ? "LEFT" : "RIGHT"} minPlayers={configuration.settings.minPlayers} maxPlayers={configuration.settings.maxPlayers} startingPlayers={configuration.settings.startingPlayers} filter={rosterFilters[side]} rosterExpanded={rosterExpanded[side]} onFilterChange={(filter) => setRosterFilters((current) => ({ ...current, [side]: filter }))} onRosterExpandedChange={(expanded) => setRosterExpanded((current) => ({ ...current, [side]: expanded }))} onChange={(team) => updateTeam(side, team)} />;
                    })}
                </div>
                {error ? <p className="form-message error" role="alert">{error}</p> : null}
                <div className="pregame-actions"><p className="pregame-action-guidance">Συμπληρώστε συμμετοχές, αριθμούς, αρχηγούς, βασικούς, Staff, χρώματα και θέση παρουσίασης. Οι αλλαγές ισχύουν μόνο για αυτό το Run.</p><div className="pregame-save-cluster">{showSavedConfirmation ? <p className="pregame-save-confirmation" role="status" aria-live="polite">Το πρόχειρο αποθηκεύτηκε · Revision {savedRevision}</p> : null}<button type="button" className="primary-button" disabled={busy || !dirty} onClick={() => void onSave({ gameId: configuration.gameId, expectedRevision: configuration.revision, teams: draft.teams, presentation: draft.presentation })}>{busy ? "Αποθήκευση…" : "Αποθήκευση Draft"}</button></div></div>
                {footer}
            </section>
        </main>
    );
}
