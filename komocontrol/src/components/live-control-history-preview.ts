type PreviewSide = KomoControlTeamSide;

export interface HistoricalTrailEntry {
    step: string;
    label: string;
    value: string;
    playerId?: string;
    teamSide?: PreviewSide;
    sourceEventId?: string;
    editTargetId?: string;
    editable?: boolean;
}

export interface HistoricalScorerEventPreview {
    scorerEventGroupId: string;
    title: string;
    period: KomoControlScorerEventGroup["period"];
    clockSeconds: number;
    trail: HistoricalTrailEntry[];
}

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function side(value: unknown): PreviewSide | undefined {
    return value === "HOME" || value === "AWAY" ? value : undefined;
}

function opposite(value: PreviewSide): PreviewSide { return value === "HOME" ? "AWAY" : "HOME"; }

function player(gameplay: KomoControlSafeMatchGameplay, playerId: unknown, historicalState?: KomoControlScorerEventEditContext["historicalState"]): { label: string; side?: PreviewSide } {
    if (typeof playerId !== "string") return { label: "" };
    for (const historicalTeam of historicalState?.teams ?? []) {
        const found = historicalTeam.players.find((candidate) => candidate.playerId === playerId);
        if (found) return { label: found.shirtNumber === "" ? found.displayName : `#${found.shirtNumber}`, side: historicalTeam.side };
    }
    for (const team of gameplay.teams) {
        const found = team.players.find((candidate) => candidate.playerId === playerId);
        if (found) return { label: found.shirtNumber === "" ? found.displayName : `#${found.shirtNumber}`, side: team.side };
    }
    return { label: playerId };
}

function teamLabel(gameplay: KomoControlSafeMatchGameplay, teamSide: PreviewSide): string {
    return gameplay.teams.find((team) => team.side === teamSide)?.teamName ?? teamSide;
}

function staffLabel(gameplay: KomoControlSafeMatchGameplay, teamSide: PreviewSide | undefined, offender: Record<string, unknown>, technicalSource?: "COACH" | "BENCH"): string {
    if (technicalSource) return technicalSource;
    const role = offender.role === "HEAD_COACH" ? "COACH" : "BENCH";
    if (!teamSide || typeof offender.personId !== "string") return role;
    const person = gameplay.teams.find((team) => team.side === teamSide)?.bench.find((candidate) => candidate.personId === offender.personId);
    return person?.displayName.trim() ? `${role} · ${person.displayName.trim()}` : role;
}

function foulContextValue(intent: KomoControlGameplayIntent): string {
    const context = record(intent.context);
    const shooting = context?.kind === "SHOOTING";
    if (intent.foulType === "TECHNICAL_FOUL") return intent.category === "CATEGORY_1" ? "ΤΕΧΝ. ΠΟΙΝΗ GD" : "ΤΕΧΝ. ΠΟΙΝΗ";
    if (intent.foulType === "FLAGRANT_FOUL") return shooting ? "SHOOTING FL" : "FLAGRANT GD";
    if (intent.foulType === "DISRUPTIVE_FOUL") return shooting ? "SHOOTING DI" : "DISRUPTIVE";
    if (intent.foulType === "DISQUALIFYING_FOUL") return shooting ? "SHOOTING DI" : "DISQUALIFYING";
    if (shooting) return "SHOOTING FOUL";
    return context?.teamControlFoul === true ? "OFFENSIVE FOUL" : "FOUL";
}

function itemSide(item: KomoControlGameplayHistoryItem): PreviewSide | undefined {
    return side(item.intent?.team) ?? item.team;
}

function addPlayerEntry(trail: HistoricalTrailEntry[], gameplay: KomoControlSafeMatchGameplay, step: string, label: string, playerId: unknown, historicalState?: KomoControlScorerEventEditContext["historicalState"], sourceEventId?: string): void {
    const resolved = player(gameplay, playerId, historicalState);
    trail.push({ step, label, value: resolved.label, ...(typeof playerId === "string" ? { playerId } : {}), ...(resolved.side ? { teamSide: resolved.side } : {}), ...(sourceEventId ? { sourceEventId } : {}) });
}

function unresolvedTeam(step: NonNullable<KomoControlScorerEventTerminal["unresolvedStep"]>, foulSide: PreviewSide | undefined, shotSide: PreviewSide | undefined, turnoverSide: PreviewSide | undefined): PreviewSide | undefined {
    if (step === "ASSIST") return shotSide;
    if (step === "STEALER") return turnoverSide ? opposite(turnoverSide) : undefined;
    if (step === "FOULER") return foulSide;
    if (step === "DRAWN_BY" || step === "CHOOSE_SHOOTER" || step === "FT1" || step === "FT2" || step === "FT3") return foulSide ? opposite(foulSide) : shotSide;
    return undefined;
}

export function reconstructScorerEventGroup(group: KomoControlScorerEventGroup, gameplay: KomoControlSafeMatchGameplay, historicalState?: KomoControlScorerEventEditContext["historicalState"]): HistoricalScorerEventPreview | null {
    if (!group.safeForReconstruction) return null;
    const items = [...group.items].sort((left, right) => left.sequence - right.sequence);
    const visible = items.filter((item) => item.type !== "PENALTY_ADMINISTRATION_ENDED");
    const intents = visible.filter((item): item is KomoControlGameplayHistoryItem & { intent: KomoControlGameplayIntent } => item.intent !== null);
    const terminal = group.scorerEventTerminal;
    const foulItem = intents.find((item) => item.intent.kind === "foul");
    const shotItem = intents.find((item) => item.intent.kind === "shot");
    const turnoverItem = intents.find((item) => item.intent.kind === "turnover");
    const freeThrows = intents.filter((item) => item.intent.kind === "free-throw").sort((left, right) => Number(left.intent.attemptIndex) - Number(right.intent.attemptIndex));
    const reboundItems = intents.filter((item) => item.intent.kind === "rebound");
    const blockItem = intents.find((item) => item.intent.kind === "block");
    const stealItem = intents.find((item) => item.intent.kind === "steal");
    const trail: HistoricalTrailEntry[] = [];
    let title = "ΣΥΜΒΑΝ";

    const substitutions = intents.filter((item) => item.intent.kind === "substitution");
    if (substitutions.length) {
        title = "SUBS";
        for (const item of substitutions) {
            const teamSide = itemSide(item);
            const outgoing = player(gameplay, item.intent.playerOutId).label;
            const incoming = player(gameplay, item.intent.playerInId).label;
            trail.push({ step: `substitution-${item.sequence}`, label: teamSide ? `${teamSide} SUB` : "SUB", value: `${outgoing} → ${incoming}`, ...(teamSide ? { teamSide } : {}) });
        }
        return { scorerEventGroupId: group.scorerEventGroupId, title, period: group.period, clockSeconds: group.clockSeconds, trail };
    }

    if (turnoverItem) {
        title = "TURN OVER";
        addPlayerEntry(trail, gameplay, "turnover", "TURNOVER BY", turnoverItem.intent.playerId, historicalState, turnoverItem.eventId);
        if (stealItem) addPlayerEntry(trail, gameplay, "steal", "STEALER", stealItem.intent.playerId, historicalState, stealItem.eventId);
        else if (terminal?.decisions?.steal === "NONE") trail.push({ step: "steal", label: "STEALER", value: "ΧΩΡΙΣ STEAL" });
        else if (terminal?.reason === "ENTER_EARLY" && terminal.unresolvedStep === "STEALER") trail.push({ step: "steal", label: "STEALER", value: "", teamSide: itemSide(turnoverItem) ? opposite(itemSide(turnoverItem)!) : undefined });
    } else {
        const foulSide = foulItem ? itemSide(foulItem) : undefined;
        const shotSide = shotItem ? itemSide(shotItem) : undefined;
        if (foulItem) {
            title = foulContextValue(foulItem.intent);
            if (foulItem.intent.foulType !== "TECHNICAL_FOUL") trail.push({ step: "context", label: "FOUL", value: title });
        } else if (shotItem) title = "SHOOT";

        if (shotItem) {
            trail.push({ step: "shot-type", label: "SHOT TYPE", value: `${shotItem.intent.points}PT` });
            if (!foulItem) addPlayerEntry(trail, gameplay, "shooter", "SHOOTER", shotItem.intent.playerId, historicalState, shotItem.eventId);
        }

        if (foulItem) {
            const offender = record(foulItem.intent.offender);
            const offenderLabel = foulItem.intent.foulType === "TECHNICAL_FOUL" ? "FOUL" : "FOULER";
            if (offender?.kind === "PLAYER") addPlayerEntry(trail, gameplay, "offender", offenderLabel, offender.playerId, historicalState, foulItem.eventId);
            else if (offender?.kind === "BENCH") trail.push({ step: "offender", label: offenderLabel, value: staffLabel(gameplay, foulSide, offender, foulItem.scorerEventContext?.technicalStaffSource), ...(foulSide ? { teamSide: foulSide } : {}) });
            if (typeof foulItem.intent.fouledPlayerId === "string") addPlayerEntry(trail, gameplay, "victim", "DRAWN BY", foulItem.intent.fouledPlayerId, historicalState, foulItem.eventId);
        }

        if (shotItem) {
            trail.push({ step: "result", label: "RESULT", value: shotItem.intent.made === true ? "MADE" : "MISS", sourceEventId: shotItem.eventId });
            if (typeof shotItem.intent.assistPlayerId === "string") addPlayerEntry(trail, gameplay, "assist", "ASSIST", shotItem.intent.assistPlayerId, historicalState, shotItem.eventId);
            else if (terminal?.decisions?.assist === "NONE") trail.push({ step: "assist", label: "ASSIST", value: "NO ASSIST" });
        }

        if (blockItem) addPlayerEntry(trail, gameplay, "blocker", "BLOCKER", blockItem.intent.playerId, historicalState, blockItem.eventId);

        const manualShooter = foulItem?.intent.foulType === "TECHNICAL_FOUL" || (foulItem?.intent.foulType === "DISQUALIFYING_FOUL" && record(foulItem.intent.offender)?.kind === "BENCH");
        let shownFtShooter: string | undefined;
        for (const item of freeThrows) {
            if (typeof item.intent.playerId === "string" && (historicalState || item.intent.playerId !== shownFtShooter)) {
                addPlayerEntry(trail, gameplay, `ft-shooter-${item.sequence}`, manualShooter ? "CHOOSE SHOOTER" : "FREE THROW", item.intent.playerId, historicalState, item.eventId);
                shownFtShooter = item.intent.playerId;
            }
            const attempt = Number(item.intent.attemptIndex);
            trail.push({ step: `ft-${attempt}`, label: `FT${attempt}`, value: item.intent.made === true ? "MADE" : "MISS", sourceEventId: item.eventId, ...(typeof item.intent.playerId === "string" ? { playerId: item.intent.playerId } : {}), ...(itemSide(item) ? { teamSide: itemSide(item) } : {}) });
        }

        for (const item of reboundItems) {
            if (item.intent.teamRebound === true) {
                const reboundSide = itemSide(item);
                trail.push({ step: "rebound", label: "REBOUNDER", value: reboundSide ? `TEAM · ${teamLabel(gameplay, reboundSide)}` : "TEAM", ...(reboundSide ? { teamSide: reboundSide } : {}) });
            } else addPlayerEntry(trail, gameplay, "rebound", "REBOUNDER", item.intent.playerId, historicalState, item.eventId);
        }

        if (terminal?.reason === "ENTER_EARLY" && terminal.unresolvedStep) {
            const unresolved = terminal.unresolvedStep;
            if (unresolved === "ASSIST" && !trail.some((entry) => entry.step === "assist")) trail.push({ step: "assist", label: "ASSIST", value: "", ...(shotSide ? { teamSide: shotSide } : {}) });
            else if (unresolved === "REBOUNDER" && !trail.some((entry) => entry.step === "rebound")) trail.push({ step: "rebound", label: "REBOUNDER", value: "" });
            else if (unresolved === "CHOOSE_SHOOTER") {
                const selectedShooter = terminal.resumeContext?.penaltyShooterPlayerId;
                if (selectedShooter) addPlayerEntry(trail, gameplay, "ft-shooter-resume", "CHOOSE SHOOTER", selectedShooter, historicalState);
                else trail.push({ step: "ft-shooter-resume", label: "CHOOSE SHOOTER", value: "", ...(foulSide ? { teamSide: opposite(foulSide) } : {}) });
            } else if (unresolved === "FT1" || unresolved === "FT2" || unresolved === "FT3") {
                const selectedShooter = terminal.resumeContext?.penaltyShooterPlayerId;
                if (selectedShooter && selectedShooter !== shownFtShooter) addPlayerEntry(trail, gameplay, "ft-shooter-resume", manualShooter ? "CHOOSE SHOOTER" : "FREE THROW", selectedShooter, historicalState);
                trail.push({ step: `ft-${unresolved.slice(2)}`, label: unresolved, value: "", ...(selectedShooter ? { playerId: selectedShooter } : {}), ...(unresolvedTeam(unresolved, foulSide, shotSide, undefined) ? { teamSide: unresolvedTeam(unresolved, foulSide, shotSide, undefined) } : {}) });
            } else if (unresolved === "FOULER" || unresolved === "DRAWN_BY") {
                trail.push({ step: unresolved.toLowerCase(), label: unresolved === "FOULER" ? "FOULER" : "DRAWN BY", value: "", ...(unresolvedTeam(unresolved, foulSide, shotSide, undefined) ? { teamSide: unresolvedTeam(unresolved, foulSide, shotSide, undefined) } : {}) });
            }
        }
    }

    if (!trail.length) {
        const item = visible[0];
        if (!item) return null;
        const eventSide = itemSide(item);
        const values: Record<string, string> = {
            TIMEOUT: "TIMEOUT", JUMP_BALL: "JUMP BALL", ALTERNATING_POSSESSION: "ΕΝΑΛΛΑΣΣΟΜΕΝΗ ΚΑΤΟΧΗ",
            CLOCK_START: "ΡΟΛΟΪ START", CLOCK_STOP: "ΡΟΛΟΪ STOP", CLOCK_SET: "ΔΙΟΡΘΩΣΗ ΡΟΛΟΓΙΟΥ",
            PERIOD_START: "ΕΝΑΡΞΗ ΠΕΡΙΟΔΟΥ", PERIOD_END: "ΛΗΞΗ ΠΕΡΙΟΔΟΥ", MATCH_START: "ΕΝΑΡΞΗ ΑΓΩΝΑ", MATCH_END: "ΛΗΞΗ ΑΓΩΝΑ",
        };
        title = values[item.type] ?? item.type.replaceAll("_", " ");
        const factualPlayer = player(gameplay, item.playerId, historicalState);
        trail.push({ step: "fact", label: title, value: factualPlayer.label || (eventSide ? `${eventSide} · ${teamLabel(gameplay, eventSide)}` : "ΚΑΤΑΧΩΡΙΣΜΕΝΟ"), ...(factualPlayer.side ? { teamSide: factualPlayer.side } : eventSide ? { teamSide: eventSide } : {}) });
    }

    return { scorerEventGroupId: group.scorerEventGroupId, title, period: group.period, clockSeconds: group.clockSeconds, trail };
}

function targetKinds(entry: HistoricalTrailEntry): KomoControlHistoricalEditTargetKind[] {
    if (entry.step === "shooter") return ["SHOOTER"];
    if (entry.step === "offender") return ["FOULER", "TECHNICAL_PLAYER"];
    if (entry.step === "victim") return ["DRAWN_BY"];
    if (entry.step === "assist") return ["ASSIST"];
    if (entry.step === "blocker") return ["BLOCKER"];
    if (entry.step.startsWith("ft-shooter-")) return ["FREE_THROW_SHOOTER"];
    if (entry.step === "result") return ["SHOT_RESULT"];
    if (entry.step.startsWith("ft-") && entry.sourceEventId) return ["FREE_THROW_RESULT"];
    if (entry.step === "turnover") return ["TURNOVER_BY"];
    if (entry.step === "steal") return ["STEALER"];
    if (entry.step === "rebound") return ["REBOUNDER"];
    return [];
}

export function reconstructHistoricalScorerEventEdit(context: KomoControlScorerEventEditContext, gameplay: KomoControlSafeMatchGameplay): HistoricalScorerEventPreview | null {
    const contextualGroup = context.editCapabilities.safeForEdit && !context.group.safeForReconstruction ? { ...context.group, safeForReconstruction: true } : context.group;
    const preview = reconstructScorerEventGroup(contextualGroup, gameplay, context.historicalState);
    if (!preview) return null;
    return {
        ...preview,
        trail: preview.trail.map((entry) => {
            const kinds = targetKinds(entry);
            const target = context.editCapabilities.targets.find((candidate) => {
                const decisionTarget = candidate.kind === "SHOT_RESULT" || candidate.kind === "FREE_THROW_RESULT";
                return kinds.includes(candidate.kind)
                    && (!entry.sourceEventId || candidate.eventId === entry.sourceEventId)
                    && (decisionTarget || !entry.playerId || candidate.currentPlayerId === entry.playerId);
            });
            return target ? { ...entry, editTargetId: target.targetId, editable: target.editable } : entry;
        }),
    };
}
