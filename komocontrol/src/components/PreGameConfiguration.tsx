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

function editableTeams(configuration: KomoControlPreGameConfiguration): DraftTeams {
    return configuration.teams.map((team) => ({
        side: team.side,
        players: team.players.map((player) => ({
            playerId: player.playerId,
            participating: player.participating,
            gameShirtNumber: player.gameShirtNumber,
        })),
    })) as DraftTeams;
}

function PlayerDraftRow({
    player,
    onParticipationChange,
    onNumberChange,
}: {
    player: KomoControlPreGameConfigurationPlayer;
    onParticipationChange: (participating: boolean) => void;
    onNumberChange: (number: string | null) => void;
}) {
    const packageNumber = player.packageShirtNumber === null ? null : String(player.packageShirtNumber);
    const overridden = player.gameShirtNumber !== packageNumber;
    return (
        <li className={player.participating ? "pregame-player is-selected" : "pregame-player"}>
            <label className="pregame-player-toggle">
                <input type="checkbox" checked={player.participating} onChange={(event) => onParticipationChange(event.target.checked)} />
                <span>
                    <strong>{player.displayName}</strong>
                    <small>{player.participating ? "Συμμετέχει" : "Δεν συμμετέχει"}</small>
                </span>
            </label>
            <label className="pregame-number-field">
                <span>Αριθμός αγώνα</span>
                <input
                    type="text"
                    inputMode="numeric"
                    maxLength={2}
                    value={player.gameShirtNumber ?? ""}
                    placeholder="—"
                    aria-label={`Αριθμός αγώνα για ${player.displayName}`}
                    onChange={(event) => onNumberChange(event.target.value === "" ? null : event.target.value)}
                />
                <small>{overridden ? "Override Run" : packageNumber === null ? "Χωρίς αρχικό αριθμό" : `Αρχικό Package: ${packageNumber}`}</small>
            </label>
        </li>
    );
}

function TeamDraft({
    team,
    draft,
    onChange,
}: {
    team: KomoControlPreGameConfigurationTeam;
    draft: KomoControlPreGameConfigurationTeamDraft;
    onChange: (draft: KomoControlPreGameConfigurationTeamDraft) => void;
}) {
    const values = new Map(draft.players.map((player) => [player.playerId, player]));
    const selected = draft.players.filter((player) => player.participating).length;
    return (
        <section className="pregame-team" aria-labelledby={`pregame-${team.side.toLowerCase()}`}>
            <header>
                <div>
                    <span className="side-kicker">{team.side}</span>
                    <h2 id={`pregame-${team.side.toLowerCase()}`}>{team.teamName}</h2>
                </div>
                <strong>{selected} / {team.players.length}</strong>
            </header>
            <ul className="pregame-player-list">
                {team.players.map((player) => {
                    const value = values.get(player.playerId);
                    if (!value) return null;
                    return (
                        <PlayerDraftRow
                            key={player.playerId}
                            player={{ ...player, participating: value.participating, gameShirtNumber: value.gameShirtNumber }}
                            onParticipationChange={(participating) => onChange({ ...draft, players: draft.players.map((entry) => entry.playerId === player.playerId ? { ...entry, participating } : entry) })}
                            onNumberChange={(gameShirtNumber) => onChange({ ...draft, players: draft.players.map((entry) => entry.playerId === player.playerId ? { ...entry, gameShirtNumber } : entry) })}
                        />
                    );
                })}
            </ul>
        </section>
    );
}

export function savedDraftConfirmationVisible(currentRevision: number, savedRevision: number | null, dirty: boolean): boolean {
    return !dirty && savedRevision === currentRevision;
}

export function PreGameConfiguration({ configuration, busy, error, savedRevision, footer, onBack, onDraftEdited, onSave }: PreGameConfigurationProps) {
    const [teams, setTeams] = useState<DraftTeams>(() => editableTeams(configuration));
    useEffect(() => setTeams(editableTeams(configuration)), [configuration.runId, configuration.revision]);
    const baseline = useMemo(() => JSON.stringify(editableTeams(configuration)), [configuration]);
    const dirty = JSON.stringify(teams) !== baseline;
    const showSavedConfirmation = savedDraftConfirmationVisible(configuration.revision, savedRevision, dirty);

    const updateTeam = (index: 0 | 1, team: KomoControlPreGameConfigurationTeamDraft) => {
        onDraftEdited();
        setTeams((current) => index === 0 ? [team, current[1]] : [current[0], team]);
    };

    return (
        <main className="home-shell pregame-shell">
            <section className="home-card pregame-card">
                <header className="pregame-header">
                    <div>
                        <span className="eyebrow">DURABLE LOCAL DRAFT</span>
                        <h1>Συμμετοχές και αριθμοί αγώνα</h1>
                        <p>Package v{configuration.packageVersion} · Run {configuration.runId.slice(-8)} · Revision {configuration.revision}</p>
                    </div>
                    <div className="pregame-state">
                        <span className="status-dot" />
                        {dirty ? "Μη αποθηκευμένες αλλαγές" : "Το draft είναι αποθηκευμένο"}
                    </div>
                </header>

                <div className="pregame-guidance">
                    Όλοι οι παίκτες ξεκινούν εκτός συμμετοχής. Οι αριθμοί ισχύουν μόνο για αυτό το Run και δεν αλλάζουν το Game Package.
                </div>

                <div className="pregame-teams">
                    <TeamDraft team={configuration.teams[0]} draft={teams[0]} onChange={(team) => updateTeam(0, team)} />
                    <TeamDraft team={configuration.teams[1]} draft={teams[1]} onChange={(team) => updateTeam(1, team)} />
                </div>

                {error ? <p className="form-message error" role="alert">{error}</p> : null}
                <div className="pregame-actions">
                    <button type="button" className="secondary-button" onClick={onBack} disabled={busy}>Πίσω στην προετοιμασία</button>
                    <div className="pregame-save-cluster">
                        {showSavedConfirmation ? <p className="pregame-save-confirmation" role="status" aria-live="polite">Το πρόχειρο αποθηκεύτηκε · Revision {savedRevision}</p> : null}
                        <button type="button" className="primary-button" disabled={busy || !dirty} onClick={() => void onSave({ gameId: configuration.gameId, expectedRevision: configuration.revision, teams })}>
                            {busy ? "Αποθήκευση…" : "Αποθήκευση Draft"}
                        </button>
                    </div>
                </div>
                {footer}
            </section>
        </main>
    );
}
