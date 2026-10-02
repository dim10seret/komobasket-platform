import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { groupProgramSchedulesByPhaseTournament } from "./program-games-grouping";

const source = readFileSync(new URL("./ProgramGamesSection.tsx", import.meta.url), "utf8");
const competitionSource = readFileSync(new URL("./CompetitionSection.tsx", import.meta.url), "utf8");

type GroupPhase = { id: string; name: string; phase_order: number };
type GroupSchedule = { id: string; phase_id: string };

const group = (
  rootPhaseId: string,
  tournamentName: string,
  phases: GroupPhase[],
) => ({ rootPhaseId, tournamentName, phases, finalized: false });

describe("Program & Games canonical phase-series grouping", () => {
  it("uses the exact canonical groups already supplied to the Phases tab", () => {
    expect(competitionSource).toContain("phaseGroups={selectedCompetitionPhaseGroups}");
    expect(source).toContain("groupProgramSchedulesByPhaseTournament(phaseGroups, schedules)");
    expect(source).toContain("Θεσμός / Σειρά Φάσεων");
  });

  it("keeps two groups separate and preserves canonical phase order", () => {
    const phaseGroups = [
      group("league-root", "KomoBasket League", [
        { id: "league-root", name: "Αδιάφορος τίτλος Α", phase_order: 1 },
        { id: "league-final", name: "Αδιάφορος τίτλος Β", phase_order: 5 },
      ]),
      group("cup-root", "Komo Cup", [
        { id: "cup-root", name: "Αδιάφορος τίτλος Γ", phase_order: 6 },
        { id: "cup-final", name: "Αδιάφορος τίτλος Δ", phase_order: 9 },
      ]),
    ];
    const schedules: GroupSchedule[] = [
      { id: "cup-final-schedule", phase_id: "cup-final" },
      { id: "league-final-schedule", phase_id: "league-final" },
      { id: "cup-root-schedule", phase_id: "cup-root" },
      { id: "league-root-schedule", phase_id: "league-root" },
    ];

    const result = groupProgramSchedulesByPhaseTournament(phaseGroups, schedules);

    expect(result.map((entry) => entry.tournamentName)).toEqual(["KomoBasket League", "Komo Cup"]);
    expect(result[0].schedules.map((entry) => entry.id)).toEqual(["league-root-schedule", "league-final-schedule"]);
    expect(result[1].schedules.map((entry) => entry.id)).toEqual(["cup-root-schedule", "cup-final-schedule"]);
  });

  it("groups from canonical references rather than phase names", () => {
    const phaseGroups = [
      group("root-a", "Series A", [{ id: "phase-a", name: "ΚΥΠΕΛΛΟ", phase_order: 1 }]),
      group("root-b", "Series B", [{ id: "phase-b", name: "LEAGUE FINAL", phase_order: 2 }]),
    ];
    const result = groupProgramSchedulesByPhaseTournament(phaseGroups, [
      { id: "schedule-b", phase_id: "phase-b" },
      { id: "schedule-a", phase_id: "phase-a" },
    ]);

    expect(result[0].schedules.map((entry) => entry.id)).toEqual(["schedule-a"]);
    expect(result[1].schedules.map((entry) => entry.id)).toEqual(["schedule-b"]);
  });

  it("renders one canonical group and omits groups without programs", () => {
    const result = groupProgramSchedulesByPhaseTournament([
      group("single-root", "Single Series", [{ id: "single-phase", name: "Phase", phase_order: 1 }]),
      group("empty-root", "Empty Series", [{ id: "empty-phase", name: "Empty", phase_order: 2 }]),
    ], [{ id: "single-schedule", phase_id: "single-phase" }]);

    expect(result).toHaveLength(1);
    expect(result[0].rootPhaseId).toBe("single-root");
  });

  it("keeps Final and Small Final siblings in their configured canonical order", () => {
    const result = groupProgramSchedulesByPhaseTournament([
      group("semifinals", "Final Series", [
        { id: "semifinals", name: "Semifinals", phase_order: 7 },
        { id: "final", name: "Final", phase_order: 8 },
        { id: "small-final", name: "Small Final", phase_order: 9 },
      ]),
    ], [
      { id: "small-final-schedule", phase_id: "small-final" },
      { id: "final-schedule", phase_id: "final" },
      { id: "semifinals-schedule", phase_id: "semifinals" },
    ]);

    expect(result[0].schedules.map((entry) => entry.id)).toEqual([
      "semifinals-schedule",
      "final-schedule",
      "small-final-schedule",
    ]);
  });

  it("preserves existing phase-card actions inside each group", () => {
    expect(source).toContain("group.schedules.map((schedule) =>");
    expect(source).toContain('{isExpanded ? "Σύμπτυξη" : "Άνοιγμα"}');
    expect(source).toContain("Διαγραφή Προγράμματος");
    expect(source).toContain("openGenerateModal(String(schedule.id))");
  });
});

describe("future-phase provisional scheduling", () => {
  it("uses planning actions instead of materializing unresolved teams", () => {
    expect(source).toContain('"planRoundRobinProgram"');
    expect(source).toContain('"createSeriesPlanningSchedule"');
    expect(source).toContain('"saveRoundRobinPlanningSlot"');
    expect(source).toContain("buildRoundRobinPlanningGames");
  });

  it("keeps provisional rows separate from real game actions", () => {
    expect(source).toContain('status: "provisional"');
    expect(source).toContain("Προσωρινό");
    expect(source).toContain("Δεν δημιουργείται πραγματικός αγώνας.");
    expect(source).toContain("openRoundRobinPlanningDialog");
  });

  it("retains canonical Series progression and carry-over", () => {
    expect(source).toContain("calculateSeriesProgression");
    expect(source).toContain("resolveSeriesCarryOver");
    expect(source).toContain("saveSeriesPlanningSlot");
  });
});

describe("transferred Series result presentation", () => {
  const tableStart = source.indexOf("{(activeSeriesRound.rows ?? []).map((entry) => {");
  const tableEnd = source.indexOf("</tbody>", tableStart);
  const seriesTable = source.slice(tableStart, tableEnd);

  it("keeps the transferred score and renders a non-interactive status with an explanation", () => {
    expect(seriesTable).toContain('const isTransferred = round.rowState === "transferred"');
    expect(seriesTable).toContain('round.homeScore !== null && round.awayScore !== null');
    expect(seriesTable).toContain("Από μεταφορά");
    expect(seriesTable).toContain("Δεν απαιτείται προγραμματισμός: αποτέλεσμα από προηγούμενη φάση");
  });

  it("keeps conditional rows schedulable without transferred messaging", () => {
    const schedulingCell = seriesTable.slice(seriesTable.indexOf("{displayVenue}"));
    const transferredBranchStart = schedulingCell.indexOf("{isTransferred ? (");
    const ifNeededBranchStart = schedulingCell.indexOf(") : isIfNeeded ? (", transferredBranchStart);
    const transferredBranch = schedulingCell.slice(transferredBranchStart, ifNeededBranchStart);
    const ifNeededBranch = schedulingCell.slice(ifNeededBranchStart);

    expect(seriesTable).toContain('const isIfNeeded = round.rowState === "if_needed" && !isPendingCarryOver');
    expect(seriesTable).toMatch(/isIfNeeded\s*\?\s*"Εάν χρειαστεί"/);
    expect(transferredBranch).not.toContain("openPlanningDialog");
    expect(ifNeededBranch).toContain("openPlanningDialog");
    expect(ifNeededBranch).toContain('round.planningSlot ? "Επεξεργασία" : "Προγραμματισμός"');
    expect(ifNeededBranch).not.toContain("Δεν απαιτείται προγραμματισμός");
  });

  it("derives pending carry-over only from the configured meeting number and removes scheduling", () => {
    expect(source).toContain("getConfiguredSeriesCarryOverMeetingNumbers(phase)");
    expect(source).toContain('entry.displayState === "pending_carry_over"');
    expect(seriesTable).toContain("Αναμονή μεταφοράς αποτελέσματος");
    expect(seriesTable).toContain("Το αποτέλεσμα της συνάντησης θα μεταφερθεί από την προηγούμενη φάση όταν αυτή οριστικοποιηθεί.");
    const pendingBranchStart = seriesTable.indexOf(") : isPendingCarryOver ? (");
    const ordinaryBranchStart = seriesTable.indexOf(") : isIfNeeded ? (", pendingBranchStart);
    const pendingBranch = seriesTable.slice(pendingBranchStart, ordinaryBranchStart);
    expect(pendingBranch).not.toContain("openPlanningDialog");
    expect(pendingBranch).not.toContain("Προγραμματισμός");
    expect(seriesTable.slice(ordinaryBranchStart)).toContain("openPlanningDialog");
  });

  it("uses a neutral heading for mixed transferred and conditional rows", () => {
    const helperStart = source.indexOf("const getGroupedSeriesRoundLabel");
    const helperEnd = source.indexOf("const parseStandingParticipantKey", helperStart);
    const helper = source.slice(helperStart, helperEnd);

    expect(helper).toContain("new Set(displayStates)");
    expect(helper).toContain("states.length === 1 ? states[0] : undefined");
    expect(source).toContain("nextRows.map((entry) => entry.displayState)");
    expect(source).toContain('if (displayState === "pending_carry_over") return `${base} — αναμονή μεταφοράς`;');
  });

  it("does not infer transfer state from previous-phase position labels", () => {
    const predicateStart = seriesTable.indexOf("const isTransferred");
    const predicateEnd = seriesTable.indexOf(";", predicateStart);
    const formatterStart = source.indexOf("const describeStandingParticipant");
    const formatterEnd = source.indexOf("const buildRoundRobinPlanningGames", formatterStart);
    const formatter = source.slice(formatterStart, formatterEnd);
    const fixtures = [
      { participantKey: "standing:phase-source:position:8", position: 8, rowState: "if_needed" },
      { participantKey: "standing:phase-source:position:9", position: 9, rowState: "if_needed" },
    ];

    expect(seriesTable.slice(predicateStart, predicateEnd + 1)).toBe(
      'const isTransferred = round.rowState === "transferred";',
    );
    expect(formatter).toContain('`${parsed.position}η θέση · ${String(sourcePhase?.name ?? "προηγούμενη φάση")}`');
    expect(formatter).not.toContain("Από μεταφορά");
    for (const fixture of fixtures) {
      const parsed = /^standing:(.+):position:(\d+)$/.exec(fixture.participantKey);
      expect(Number(parsed?.[2])).toBe(fixture.position);
      expect(`${Number(parsed?.[2])}η θέση · προηγούμενη φάση`).toBe(`${fixture.position}η θέση · προηγούμενη φάση`);
      expect(fixture.rowState).toBe("if_needed");
    }
    const schedulingCell = seriesTable.slice(seriesTable.indexOf("{displayVenue}"));
    const ifNeededBranch = schedulingCell.slice(schedulingCell.indexOf(") : isIfNeeded ? ("));
    expect(ifNeededBranch).toContain("openPlanningDialog");
    expect(ifNeededBranch).not.toContain("Από μεταφορά");
  });
});

describe("Program & Games Match Report UI", () => {
  it("renders unavailable reports as grey and disabled", () => { expect(source).toContain("if (!availability?.available)"); expect(source).toContain("disabled: true"); expect(source).toContain("bg-zinc-100 text-zinc-500"); });
  it("renders finalized reports without incidents as green and enabled", () => { expect(source).toContain("disabled: false"); expect(source).toContain("bg-emerald-600 text-white"); });
  it("renders incident reports as red with visible warning meaning", () => { expect(source).toContain("if (availability.hasIncidentReport)"); expect(source).toContain("bg-red-600 text-white"); expect(source).toContain('label: "⚠ MATCH REPORT"'); expect(source).toContain("Υπάρχει Αναφορά Συμβάντων"); });
  it("opens the protected report detail instead of the manual-result editor", () => { expect(source).toContain("openMatchReport(String(realGame.id), matchReportAvailability)"); expect(source).toContain("/api/admin/match-reports/"); expect(source).not.toContain("if (isRealGame && realGame) openResultForm(realGame)"); });
  it("keeps independent manual-result editing", () => { expect(source).toContain("if (realGame) openResultForm(realGame)"); expect(source).toContain('value={administrativeResultMode ? "administrative-result" : "manual-result"}'); });
  it("reuses the result dialog for administrative correction and permanent interruption", () => { expect(source).toContain('"administrative-result" : "manual-result"'); expect(source).toContain("Επεξεργασία επίσημου αποτελέσματος"); expect(source).toContain("Οριστικό κλείσιμο λόγω διακοπής"); expect(source).toContain("Κλείσιμο και αποθήκευση αποτελέσματος"); });
  it("collects optional per-team standings points and a required reason", () => { expect(source).toContain('name="homeStandingsPointsOverride"'); expect(source).toContain('name="awayStandingsPointsOverride"'); expect(source).toContain('label="Αιτία / Παρατηρήσεις"'); expect(source).toContain("Το 0 αποθηκεύεται ως ρητή απονομή"); });
  it("confirms interruption without fabricating KomoControl finalization", () => { expect(source).toContain("Το ιστορικό KomoControl δεν θα οριστικοποιηθεί τεχνητά"); expect(source).toContain("δεν αλλάζει το χρονόμετρο, τα γεγονότα, τη finalization ή τα στατιστικά KomoControl"); });
  it("marks a Match Report whose official public result has an administrative difference", () => { expect(source).toContain("selectedMatchReportGame?.administrative_result_id"); expect(source).toContain("Υπάρχει διοικητική διαφοροποίηση του επίσημου αποτελέσματος."); });
  it("shows identity and enables both finalized report exports", () => { expect(source).toContain("matchReportDetail.game.homeTeam.name"); expect(source).toContain("matchReportDetail.game.finalScore.home"); expect(source).toContain('"ΣΤΑΤΙΣΤΙΚΑ PDF"'); expect(source).toContain("ΦΥΛΛΟ ΑΓΩΝΑ"); });
  it("opens the protected printable Game Sheet route", () => { expect(source).toContain("openGameSheet"); expect(source).toContain("/game-sheet`"); expect(source).toContain('"_blank", "noopener,noreferrer"'); });
  it("downloads through the protected Statistics route", () => { expect(source).toContain("downloadStatisticsPdf"); expect(source).toContain("/statistics`"); expect(source).toContain('blob.type !== "application/pdf"'); expect(source).toContain("URL.createObjectURL(blob)"); });
  it("prevents duplicate requests and exposes progress", () => { expect(source).toContain("statisticsPdfLoading"); expect(source).toContain('"ΔΗΜΙΟΥΡΓΙΑ PDF…"'); expect(source).toContain("disabled={statisticsPdfLoading}"); });
  it("keeps the modal open and shows a download error", () => { expect(source).toContain("statisticsPdfError"); expect(source).toContain('role="alert"'); expect(source).toContain("Το PDF στατιστικών δεν δημιουργήθηκε"); });
  it("shows incident action only from authoritative detail", () => { expect(source).toContain("matchReportDetail.availability.hasIncidentReport && matchReportDetail.incidentReport"); expect(source).toContain("⚠ ΑΝΑΦΟΡΑ ΣΥΜΒΑΝΤΩΝ"); });
  it("renders escaped multiline incident text", () => { expect(source).toContain("{matchReportDetail.incidentReport}"); expect(source).toContain("whitespace-pre-wrap"); expect(source).toContain("break-words"); expect(source).not.toContain("dangerouslySetInnerHTML"); });
  it("keeps dialogs responsive", () => { expect(source).toContain("max-h-[92vh]"); expect(source).toContain("overflow-y-auto"); expect(source).toContain("min-h-11"); });
});

describe("Program & Games matchday MVP UI", () => {
  it("places the MVP action beside the selected matchday and disables it until every report is authoritative", () => { expect(source).toContain("MVP ΑΓΩΝΙΣΤΙΚΗΣ"); expect(source).toContain("mvpMatchdayEligible"); expect(source).toContain("data.matchReports?.[String(game.id)]?.available === true"); expect(source).toContain("disabled={!mvpMatchdayEligible || matchdayMvpLoading}"); });
  it("loads and saves through the canonical shared Platform endpoint", () => { expect(source).toContain("/api/admin/matchday-mvp"); expect(source).toContain('method: "PATCH"'); expect(source).toContain("gameId"); expect(source).toContain("playerId"); });
  it("renders the ranked five plus the eligible outside-shortlist path", () => { expect(source).toContain("matchdayMvpState.candidates.map"); expect(source).toContain("ΑΛΛΟΣ ΠΑΙΚΤΗΣ"); expect(source).toContain("matchdayMvpState.otherPerformances.map"); });
  it("renders the unchanged candidate order as one compact comparison table", () => { expect(source).toContain('className="w-full min-w-[72rem] table-auto text-left text-sm"'); expect(source).toContain("matchdayMvpState.candidates.map((candidate) =>"); expect(source).not.toContain("md:grid-cols-2 xl:grid-cols-5"); });
  it("renders every approved comparison column from the canonical candidate model", () => { for (const heading of ["Ονοματεπώνυμο", "Ομάδα", "PTS", "3PTS", "REB", "AST", "STL", "EFF", "Αποτέλεσμα αγώνα"]) expect(source).toContain(heading); expect(source).toContain("candidate.statistics.points"); expect(source).toContain("candidate.statistics.threePointMade"); expect(source).toContain("candidate.statistics.rebounds"); expect(source).toContain("candidate.statistics.assists"); expect(source).toContain("candidate.statistics.steals"); expect(source).toContain("candidate.statistics.efficiency"); expect(source).toContain("candidate.opponentName"); expect(source).toContain("candidate.finalScore.team"); expect(source).toContain("candidate.finalScore.opponent"); });
  it("keeps selection on the left and reuses the existing save handler", () => { expect(source.indexOf(">Επιλογή</th>")).toBeLessThan(source.indexOf(">#</th>")); expect(source).toContain("selectMatchdayMvp(candidate.gameId, candidate.playerId)"); expect(source).toContain('selected ? "ΕΠΙΛΕΓΜΕΝΟΣ"'); });
  it("keeps names readable and horizontal overflow scoped to the table", () => { expect(source).toContain("max-w-full overflow-x-auto overscroll-x-contain"); expect(source).toContain("min-w-44 whitespace-nowrap px-3 py-3 font-black"); expect(source).toContain("min-w-44 whitespace-nowrap px-3 py-3 font-bold"); });
  it("does not calculate or trust client-side statistics", () => { expect(source).not.toContain("rankMatchdayMvpPerformances"); expect(source).not.toContain("league_player_game_stats"); });
});

describe("Program & Games responsive schedule table", () => {
  it("keeps both schedule variants readable through table-level horizontal scrolling", () => {
    expect(source.match(/overflow-x-auto overscroll-x-contain[^>]*>\s*<table className="w-full min-w-\[68rem\] table-auto/g)).toHaveLength(2);
    expect(source.match(/min-w-\[68rem\] table-auto/g)).toHaveLength(2);
    expect(source).not.toContain("lg:overflow-x-visible");
    expect(source).not.toContain('table className="w-full min-w-0 table-fixed');
  });

  it("gives team columns a stable minimum width without aggressive word breaking", () => {
    expect(source.match(/min-w-\[11rem\] whitespace-nowrap px-3 py-3/g)).toHaveLength(4);
    expect(source.match(/block whitespace-normal break-normal text-(?:right|left) leading-snug/g)).toHaveLength(4);
    expect(source).not.toMatch(/break-words text-(?:right|left) leading-snug/);
  });
});

describe("administrative result re-edit UI contract", () => {
  it("refreshes the current version before closing the reusable editor", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("./ProgramGamesSection.tsx", import.meta.url), "utf8");
    const refreshIndex = source.indexOf("await onRefreshCompetitionData?.();");
    const closeIndex = source.indexOf("closeResultForm();", refreshIndex);

    expect(source).toContain('name="expectedAdministrativeUpdatedAt"');
    expect(source).toContain('selectedResultGame.administrative_updated_at ?? ""');
    expect(refreshIndex).toBeGreaterThan(-1);
    expect(closeIndex).toBeGreaterThan(refreshIndex);
    expect(source).toContain("Επεξεργασία επίσημου αποτελέσματος");
  });
});

describe("selected-game administrative result controls", () => {
  it("renders a dedicated result section only for one selected game", () => {
    expect(source).toContain('data-testid="selected-game-result-controls"');
    expect(source).toContain("selectedGameIds.length === 1 ? (() => {");
    expect(source).toContain("ΑΠΟΤΕΛΕΣΜΑ ΑΓΩΝΑ");
  });

  it("opens the existing result modal in correction or interruption mode", () => {
    expect(source).toContain('openResultForm(selectedPanelGame, "administrative-correction")');
    expect(source).toContain('openResultForm(selectedPanelGame, "administrative-interruption")');
  });

  it("removes administrative interruption actions from both game-row variants", () => {
    expect(source).not.toContain('openResultForm(realGame, "administrative-interruption")');
    expect(source).not.toContain('openResultForm(game, "administrative-interruption")');
  });

  it("keeps an interrupted administrative result visible and editable", () => {
    expect(source).toContain('administrative_decision_type === "interruption"');
    expect(source).toContain("Διακοπή – διοικητικό αποτέλεσμα");
    expect(source).toContain("Διοικητικό κλείσιμο λόγω διακοπής");
    expect(source).toContain("Επεξεργασία επίσημου αποτελέσματος");
  });

  it("preserves bulk scheduling, video, and current-version contracts", () => {
    expect(source).toContain("saveScheduleSelection(scheduleKey, competitionId, selectedGameIds, editor)");
    expect(source).toContain('name="videoUrl"');
    expect(source).toContain('Field label="Ημερομηνία"');
    expect(source).toContain('Field label="Ώρα"');
    expect(source).toContain('Field label="Γήπεδο"');
    expect(source).toContain('name="expectedAdministrativeUpdatedAt"');
    expect(source).toContain('selectedResultGame.administrative_updated_at ?? ""');
  });
});
