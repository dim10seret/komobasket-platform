import "server-only";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, lineTo, moveTo, popGraphicsState, pushGraphicsState, rgb, setLineWidth, setStrokingColor, stroke, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import { NOTO_SANS_GREEK_BOLD, NOTO_SANS_GREEK_REGULAR, NOTO_SANS_LATIN_BOLD, NOTO_SANS_LATIN_REGULAR } from "@/assets/fonts/noto-sans-subsets";
import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { gameSheetPeriodColor, gameSheetPeriodLabel, projectPlatformGameSheet, type GameSheetPeriod, type PlatformGameSheet, type PlatformGameSheetTeam, type RunningScoreMark } from "@/lib/platform-game-sheet";
import { readPlatformMatchReportFinalizedSourceWithDb } from "@/services/platform-match-report.service";
import type { D1DatabaseBinding } from "@/types/cloudflare";

export type PlatformGameSheetReadResult =
  | { kind: "sheet"; sheet: PlatformGameSheet }
  | { kind: "unavailable"; reason: string };

export async function readPlatformGameSheetWithDb(database: D1DatabaseBinding, gameId: string, organizationId: string): Promise<PlatformGameSheetReadResult> {
  const result = await readPlatformMatchReportFinalizedSourceWithDb(database, gameId, organizationId);
  if (result.kind === "unavailable") return { kind: "unavailable", reason: result.availability.unavailableReason ?? "MATCH_REPORT_UNAVAILABLE" };
  try { return { kind: "sheet", sheet: projectPlatformGameSheet(result.source) }; }
  catch (error) { return { kind: "unavailable", reason: error instanceof Error ? error.message : "GAME_SHEET_UNAVAILABLE" }; }
}

export async function readPlatformGameSheet(gameId: string, organizationId: string): Promise<PlatformGameSheetReadResult> {
  const environment = await getKomoBasketCloudflareEnv();
  if (!environment?.NEWS_DB) throw new Error("GAME_SHEET_UNAVAILABLE");
  return readPlatformGameSheetWithDb(environment.NEWS_DB, gameId, organizationId);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
function displayDate(value: string | null): string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return value ?? "";
  const [year, month, day] = value.split("-"); return `${day}/${month}/${year}`;
}
function cells(values: string[], count: number): string { return Array.from({ length: count }, (_, index) => `<span>${escapeHtml(values[index] ?? "")}</span>`).join(""); }

function teamPanel(team: PlatformGameSheetTeam): string {
  const rows = Array.from({ length: Math.max(12, team.players.length) }, (_, index) => {
    const player = team.players[index];
    if (!player) return `<tr><td>&nbsp;</td><td></td><td></td><td></td>${Array.from({ length: 5 }, () => "<td></td>").join("")}</tr>`;
    return `<tr><td>${escapeHtml(player.shirtNumber)}</td><td class="player-name">${escapeHtml(player.displayName)}</td><td>${player.captain ? "ΑΡΧ" : ""}</td><td>${player.starter ? "Χ" : ""}</td>${Array.from({ length: 5 }, (_, foul) => `<td>${escapeHtml(player.fouls[foul] ?? "")}</td>`).join("")}</tr>`;
  }).join("");
  return `<section class="team-panel"><div class="team-heading"><strong>${team.designation}: ${escapeHtml(team.name)}</strong></div><div class="team-meta"><span>Τάιμ-άουτ <b class="boxes">${cells(team.timeouts, 5)}</b></span><span>Ομαδικά φάουλ ${team.teamFouls.map((item) => `<b>${escapeHtml(item.label)}: ${item.count}</b>`).join(" ")}</span></div><table><thead><tr><th>Αρ.</th><th>Παίκτης</th><th>C</th><th>5άδα</th><th colspan="5">Προσωπικά φάουλ</th></tr></thead><tbody>${rows}</tbody></table><div class="staff-lines"><span>Προπονητής: <b>${escapeHtml(team.headCoach)}</b></span><span>Βοηθός Προπονητή: <b>${escapeHtml(team.assistantCoach)}</b></span></div></section>`;
}

function runningScore(sheet: PlatformGameSheet): string {
  const bands = [0, 40, 80, 120].map((offset) => `<div class="score-band"><div class="score-band-head"><b>A</b><b>B</b></div>${sheet.runningScore.slice(offset, offset + 40).map((row) => {
    const mark = (value: typeof row.home) => value ? `<span class="score-mark${value.threePoint ? " three" : ""}">${escapeHtml(value.shirtNumber)}${value.threePoint ? "·3" : ""}</span>` : "";
    return `<div class="score-row"><span>${row.score}${mark(row.home)}</span><span>${row.score}${mark(row.away)}</span></div>`;
  }).join("")}</div>`).join("");
  return `<section class="running"><h2>ΔΙΑΚΥΜΑΝΣΗ ΣΚΟΡ</h2><div class="score-bands">${bands}</div><p class="legend">Σήμανση: αριθμός φανέλας · «·3» για εύστοχο τρίποντο.</p></section>`;
}

function periodSummary(sheet: PlatformGameSheet): string {
  return sheet.periodScores.map((score) => `<div><span>${escapeHtml(gameSheetPeriodLabel(score.period))}</span><b>${score.home} – ${score.away}</b></div>`).join("");
}

function extraBenchPage(sheet: PlatformGameSheet): string {
  if (sheet.home.extraBench.length === 0 && sheet.away.extraBench.length === 0) return "";
  const table = (team: PlatformGameSheetTeam) => `<section class="extra-team"><h2>${team.designation} — ${escapeHtml(team.name)}</h2><table><thead><tr><th>Ονοματεπώνυμο</th><th>Ρόλος</th></tr></thead><tbody>${team.extraBench.map((entry) => `<tr><td>${escapeHtml(entry.name)}</td><td>${escapeHtml(entry.role)}</td></tr>`).join("") || '<tr><td colspan="2">—</td></tr>'}</tbody></table></section>`;
  return `<article class="sheet-page extra-page"><header><p>KomoBasket Platform</p><h1>ΠΡΟΣΘΕΤΑ ΣΤΟΙΧΕΙΑ ΑΓΩΝΑ</h1><small>${escapeHtml(sheet.game.competition)} · ${escapeHtml(sheet.home.name)} – ${escapeHtml(sheet.away.name)}</small></header>${table(sheet.home)}${table(sheet.away)}</article>`;
}

export function renderPlatformGameSheetHtml(sheet: PlatformGameSheet, nonce: string): string {
  const official = sheet.officials;
  return `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Φύλλο Αγώνα KomoBasket · ${escapeHtml(sheet.home.name)} - ${escapeHtml(sheet.away.name)}</title><style>
@page{size:A4 portrait;margin:4mm}*{box-sizing:border-box}body{margin:0;background:#e7e5e4;color:#111;font-family:"Arial Narrow","Noto Sans",Arial,sans-serif}.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:center;gap:10px;padding:12px;background:#18181b}.toolbar button{border:1px solid #fff;border-radius:8px;background:#fff;padding:10px 16px;font-weight:800;cursor:pointer}.toolbar .print{background:#ea580c;color:#fff;border-color:#fb923c}.sheet-page{width:202mm;min-height:289mm;margin:10mm auto;background:#fff;padding:4mm;box-shadow:0 8px 30px #0003;break-after:page}.sheet-page header{text-align:center;border:1.5px solid #000;padding:2mm}.sheet-page header p,.sheet-page header h1{margin:0}.sheet-page header p{font-size:9pt;font-weight:800}.sheet-page header h1{font-size:14pt;letter-spacing:.06em}.identity-grid{display:grid;grid-template-columns:1.5fr 1.5fr 1fr 1fr;gap:0;border:1px solid #000;border-top:0}.identity-grid div{min-height:9mm;padding:1mm;border-right:1px solid #000;font-size:7pt}.identity-grid div:nth-child(4n){border-right:0}.identity-grid b{display:block;font-size:8pt;margin-top:.8mm}.main-grid{display:grid;grid-template-columns:58% 42%;gap:2mm;margin-top:2mm}.team-panel{border:1px solid #000;margin-bottom:2mm}.team-heading{padding:1mm 1.5mm;border-bottom:1px solid #000;font-size:8pt}.team-meta{display:flex;justify-content:space-between;gap:1mm;padding:1mm;font-size:6.5pt}.team-meta b{margin-left:1mm}.boxes{display:inline-flex}.boxes span{display:inline-grid;place-items:center;width:5mm;height:4mm;border:1px solid #000;margin-left:.5mm}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #000;text-align:center;padding:.35mm;font-size:6.3pt;height:4.2mm}th:nth-child(1){width:7mm}th:nth-child(2){width:auto}.player-name{text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.staff-lines{display:grid;grid-template-columns:1fr 1fr;gap:2mm;padding:1.2mm;font-size:6.5pt;min-height:7mm}.running{border:1px solid #000;padding:1mm}.running h2{text-align:center;font-size:8pt;margin:0 0 1mm}.score-bands{display:grid;grid-template-columns:repeat(4,1fr);gap:.6mm}.score-band{border:1px solid #000}.score-band-head,.score-row{display:grid;grid-template-columns:1fr 1fr}.score-band-head b{font-size:6.5pt;text-align:center;border-bottom:1px solid #000}.score-band-head b:first-child,.score-row>span:first-child{border-right:1px solid #000}.score-row>span{position:relative;height:3.25mm;border-bottom:.25px solid #777;text-align:center;font-size:5.8pt;line-height:3.25mm}.score-row:last-child>span{border-bottom:0}.score-mark{position:absolute;inset:.2mm;background:#fff;font-size:5.5pt;font-weight:900;line-height:2.8mm;text-decoration:underline}.score-mark.three{border:1px solid #000;border-radius:50%;text-decoration:none}.legend{font-size:5.5pt;margin:1mm 0 0}.bottom{display:grid;grid-template-columns:1.4fr 1fr;gap:2mm;margin-top:2mm}.periods,.final,.officials,.signatures{border:1px solid #000;padding:1.2mm}.periods{display:grid;grid-template-columns:repeat(4,1fr);gap:1mm}.periods div{display:flex;justify-content:space-between;font-size:6.5pt}.final p,.officials p,.signatures p{margin:.5mm 0;font-size:7pt}.officials-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 3mm}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin-top:2mm}.signature-line{padding-top:7mm;border-bottom:1px solid #000;text-align:center;font-size:6pt}.extra-page header{margin-bottom:5mm}.extra-team{margin-top:5mm}.extra-team h2{font-size:11pt}.extra-team th,.extra-team td{height:8mm;font-size:9pt;text-align:left;padding:2mm}@media print{body{background:#fff}.toolbar{display:none}.sheet-page{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}.sheet-page:last-child{break-after:auto}}@media(max-width:800px){.sheet-page{margin:0;transform-origin:top left}.toolbar{flex-wrap:wrap}}
</style></head><body><nav class="toolbar" aria-label="Ενέργειες φύλλου αγώνα"><button id="back" type="button">Πίσω</button><button id="print" class="print" type="button">Εκτύπωση / Αποθήκευση PDF</button></nav><article class="sheet-page"><header><p>KomoBasket Platform</p><h1>ΦΥΛΛΟ ΑΓΩΝΑ KOMOBASKET</h1></header>${sheet.home.players.length > 12 || sheet.away.players.length > 12 ? '<aside class="extended-warning"><strong>ΕΚΤΕΤΑΜΕΝΟ ΦΥΛΛΟ ΑΓΩΝΑ</strong><p>Η σύνθεση περιλαμβάνει περισσότερους από 12 παίκτες.<br>Το παρόν αποτελεί φύλλο αγώνα KomoBasket και αποκλίνει<br>από την τυπική διάταξη FIBA/ΕΟΚ.</p></aside>' : ""}<section class="identity-grid"><div>Ομάδα Α<b>${escapeHtml(sheet.home.name)}</b></div><div>Ομάδα Β<b>${escapeHtml(sheet.away.name)}</b></div><div>Διοργάνωση<b>${escapeHtml(sheet.game.competition)}</b></div><div>Σεζόν<b>${escapeHtml(sheet.game.season)}</b></div><div>Αρ. Αγώνα<b>${escapeHtml(sheet.game.gameId)}</b></div><div>Ημερομηνία / Ώρα<b>${escapeHtml(displayDate(sheet.game.scheduledDate))} ${escapeHtml(sheet.game.scheduledTime)}</b></div><div>Γήπεδο<b>${escapeHtml(sheet.game.venue)}</b></div><div>Κομισάριος<b>${escapeHtml(official.table.commissioner)}</b></div><div>Διαιτητής Α<b>${escapeHtml(official.referees.a)}</b></div><div>Διαιτητής Β<b>${escapeHtml(official.referees.b)}</b></div><div>Διαιτητής Γ<b>${escapeHtml(official.referees.c)}</b></div><div>Φάση / Αγωνιστική<b>${escapeHtml([sheet.game.phase, sheet.game.round].filter(Boolean).join(" · "))}</b></div></section><div class="main-grid"><div>${teamPanel(sheet.home)}${teamPanel(sheet.away)}<section class="bottom"><div class="periods">${periodSummary(sheet)}</div><div class="final"><p><b>ΤΕΛΙΚΟ ΣΚΟΡ</b></p><p>Ομάδα Α: <b>${sheet.game.finalScore.home}</b> · Ομάδα Β: <b>${sheet.game.finalScore.away}</b></p><p>ΝΙΚΗΤΡΙΑ ΟΜΑΔΑ: <b>${escapeHtml(sheet.winner)}</b></p></div></section><section class="officials"><div class="officials-grid"><p>Χρονόμετρο: <b>${escapeHtml(official.table.timer)}</b></p><p>24'': <b>${escapeHtml(official.table.shotClock)}</b></p><p>Φύλλο Αγώνα: <b>${escapeHtml(official.table.scoresheet)}</b></p><p>Κομισάριος: <b>${escapeHtml(official.table.commissioner)}</b></p></div></section><section class="signatures"><div class="signature-line">Υπογραφή Διαιτητή</div><div class="signature-line">Υπογραφή Γραμματείας</div><p>Παρατηρήσεις:</p><p></p></section></div>${runningScore(sheet)}</div></article>${extraBenchPage(sheet)}<script nonce="${escapeHtml(nonce)}">document.getElementById("print").addEventListener("click",()=>window.print());document.getElementById("back").addEventListener("click",()=>history.back());</script></body></html>`;
}

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const NAVY = rgb(0.07, 0.16, 0.23);
const RED = rgb(0.75, 0.09, 0.14);
const BLUE = rgb(0.08, 0.26, 0.52);
const INK = rgb(0.08, 0.1, 0.13);
const LIGHT = rgb(0.87, 0.9, 0.92);
type SheetFonts = { regular: { latin: PDFFont; greek: PDFFont }; bold: { latin: PDFFont; greek: PDFFont } };
function fontFor(char: string, fonts: SheetFonts["regular"]): PDFFont { return /[\u0370-\u03ff\u1f00-\u1fff]/u.test(char) ? fonts.greek : fonts.latin; }
function textRuns(value: string, fonts: SheetFonts["regular"]): Array<{ font: PDFFont; text: string }> {
  const runs: Array<{ font: PDFFont; text: string }> = [];
  for (const char of value) {
    const font = fontFor(char, fonts);
    const last = runs.at(-1);
    if (last?.font === font) last.text += char; else runs.push({ font, text: char });
  }
  return runs;
}
function widthOf(value: string, fonts: SheetFonts["regular"], size: number): number { return textRuns(value, fonts).reduce((width, run) => width + run.font.widthOfTextAtSize(run.text, size), 0); }
function drawText(page: PDFPage, value: string, x: number, y: number, size: number, color: RGB, fonts: SheetFonts["regular"], maxWidth = Number.POSITIVE_INFINITY): void {
  let actual = size;
  while (actual > 6 && widthOf(value, fonts, actual) > maxWidth) actual -= 0.25;
  for (const run of textRuns(value, fonts)) { page.drawText(run.text, { x, y, size: actual, font: run.font, color }); x += run.font.widthOfTextAtSize(run.text, actual); }
}
function line(page: PDFPage, x1: number, y1: number, x2: number, y2: number, color = LIGHT, thickness = 0.65): void { page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, color, thickness }); }
function periodInk(period: GameSheetPeriod, regulationPeriods: number): RGB { return gameSheetPeriodColor(period, regulationPeriods) === "red" ? RED : BLUE; }
function decodeFont(value: string): Uint8Array { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }

export function gameSheetHalftimeSeparatorPoints(players: readonly PlatformGameSheetTeam["players"][number][], regulationPeriods: number, x: number, top: number): Array<{ x: number; y: number }> {
  if (!players.length || regulationPeriods < 2 || regulationPeriods % 2 !== 0) return [];
  const half = regulationPeriods / 2;
  const firstHalf = (period: GameSheetPeriod) => period.kind === "REGULATION" && period.index <= half;
  const position = (player: PlatformGameSheetTeam["players"][number]) => {
    const fouls = player.foulMarks?.filter((mark) => firstHalf(mark.period)).length ?? 0;
    if (fouls) return x + 210 + fouls * 11;
    return player.entry && firstHalf(player.entry.period) ? x + 207 : x + 188;
  };
  const points = [{ x: position(players[0]!), y: top - 12 }];
  players.forEach((player, index) => {
    const y = top - 27 - index * 15;
    points.push({ x: position(player), y });
    if (index + 1 < players.length) points.push({ x: position(players[index + 1]!), y });
  });
  return points;
}

export function gameSheetTimeoutSlots(marks: readonly { period: GameSheetPeriod }[], regulationPeriods: number): { firstHalf: Array<GameSheetPeriod | null>; secondHalf: Array<GameSheetPeriod | null>; overtime: GameSheetPeriod[] } {
  if (!Number.isInteger(regulationPeriods) || regulationPeriods < 1) throw new Error("GAME_SHEET_PERIOD_INVALID");
  const firstHalfEnd = Math.ceil(regulationPeriods / 2);
  const first = marks.filter((mark) => mark.period.kind === "REGULATION" && mark.period.index <= firstHalfEnd).map((mark) => mark.period);
  const second = marks.filter((mark) => mark.period.kind === "REGULATION" && mark.period.index > firstHalfEnd).map((mark) => mark.period);
  return {
    firstHalf: Array.from({ length: Math.max(2, first.length) }, (_, index) => first[index] ?? null),
    secondHalf: Array.from({ length: Math.max(3, second.length) }, (_, index) => second[index] ?? null),
    overtime: marks.filter((mark) => mark.period.kind === "OVERTIME").map((mark) => mark.period),
  };
}

export function gameSheetRunningScoreVisual(mark: RunningScoreMark): { mark: "dot" | "diagonal"; circleShirt: boolean } {
  if (mark.symbol === "FREE_THROW" && mark.points === 1 && !mark.threePoint) return { mark: "dot", circleShirt: false };
  if (mark.symbol === "FIELD_GOAL" && (mark.points === 2 || mark.points === 3) && mark.threePoint === (mark.points === 3)) return { mark: "diagonal", circleShirt: mark.threePoint };
  throw new Error("GAME_SHEET_SCORING_MARK_INVALID");
}

export function gameSheetRegulationPeriods(regulationPeriods: number): GameSheetPeriod[] {
  if (!Number.isInteger(regulationPeriods) || regulationPeriods < 1) throw new Error("GAME_SHEET_PERIOD_INVALID");
  return Array.from({ length: regulationPeriods }, (_, index) => ({ kind: "REGULATION", index: index + 1 }));
}

function drawRoster(page: PDFPage, team: PlatformGameSheetTeam, x: number, players: PlatformGameSheetTeam["players"], fonts: SheetFonts, continuation: boolean, regulationPeriods: number): void {
  const top = continuation ? 730 : 652;
  const w = 267;
  drawText(page, `${team.designation}: ${team.name}${continuation ? " - ΣΥΝΕΧΕΙΑ" : ""}`, x, top + 11, 10, INK, fonts.bold, w);
  line(page, x, top + 5, x + w, top + 5, INK);
  drawText(page, "ΑΡ.   ΠΑΙΚΤΗΣ", x + 3, top - 7, 7, INK, fonts.bold);
  drawText(page, "CAP  ΕΙΣ.  ΦΑΟΥΛ", x + 170, top - 7, 6.5, INK, fonts.bold);
  const separator = gameSheetHalftimeSeparatorPoints(players, regulationPeriods, x, top);
  if (separator.length) page.pushOperators(pushGraphicsState(), setStrokingColor(BLUE), setLineWidth(0.85), moveTo(separator[0]!.x, separator[0]!.y), ...separator.slice(1).map((point) => lineTo(point.x, point.y)), stroke(), popGraphicsState());
  for (let index = 0; index < players.length; index++) {
    const player = players[index];
    const y = top - 23 - index * 15;
    line(page, x, y - 4, x + w, y - 4);
    drawText(page, player.shirtNumber, x + 3, y, 8, INK, fonts.bold, 22);
    drawText(page, player.displayName, x + 27, y, 7.2, INK, fonts.regular, 135);
    if (player.captain) drawText(page, "C", x + 169, y, 7.5, INK, fonts.bold);
    if (player.entry) {
      const px = x + 194;
      const color = player.entry.kind === "STARTER" ? BLUE : periodInk(player.entry.period, regulationPeriods);
      drawText(page, "X", px, y, 8, color, fonts.bold);
      if (player.entry.kind === "STARTER") page.drawEllipse({ x: px + 4.2, y: y + 3.3, xScale: 5.8, yScale: 6.2, borderColor: RED, borderWidth: 0.8 });
    }
    for (let foul = 0; foul < 5; foul++) {
      const mark = player.foulMarks?.[foul];
      const code = mark?.code ?? player.fouls[foul];
      if (code) {
        if (!mark) throw new Error("GAME_SHEET_FOUL_PERIOD_UNAVAILABLE");
        drawText(page, code, x + 211 + foul * 11, y, 7, periodInk(mark.period, regulationPeriods), fonts.bold, 10);
      }
    }
  }
  if (!continuation) {
    const bottom = top - 23 - Math.max(12, players.length) * 15;
    drawText(page, `Προπονητής: ${team.headCoach || "-"}`, x + 2, bottom + 2, 7, INK, fonts.regular, 177);
    drawText(page, "C/B:", x + 184, bottom + 2, 7, INK, fonts.bold);
    const marks = team.coachFouls ?? [];
    for (let index = 0; index < marks.length; index++) drawText(page, marks[index]!.code, x + 208 + index * 10, bottom + 2, 7, periodInk(marks[index]!.period, regulationPeriods), fonts.bold, 9);
    if (!marks.length) drawText(page, "-", x + 208, bottom + 2, 7, INK, fonts.bold);
  }
}

function drawTeamFoulsAndTimeouts(page: PDFPage, team: PlatformGameSheetTeam, x: number, fonts: SheetFonts, regulationPeriods: number): void {
  drawText(page, "ΦΑΟΥΛ ΠΕΡΙΟΔΟΥ", x + 2, 439, 7, INK, fonts.bold);
  const periods = gameSheetRegulationPeriods(regulationPeriods);
  const periodWidth = 264 / periods.length;
  const foulCellStep = Math.min(11, Math.max(5.5, (periodWidth - 17) / 4));
  const foulCellWidth = Math.max(4.5, foulCellStep - 2);
  for (const period of periods) {
    const q = period.index;
    const px = x + (q - 1) * periodWidth;
    const count = team.teamFouls.filter((foul) => foul.period.kind === "REGULATION" && foul.period.index === q || q === regulationPeriods && foul.period.kind === "OVERTIME").reduce((sum, foul) => sum + foul.count, 0);
    const color = periodInk(period, regulationPeriods);
    drawText(page, `Q${q}`, px, 427, 6.5, color, fonts.bold);
    for (let cell = 0; cell < 4; cell++) {
      const cellX = px + 16 + cell * foulCellStep;
      page.drawRectangle({ x: cellX, y: 414, width: foulCellWidth, height: 10, borderColor: LIGHT, borderWidth: 0.5 });
      if (cell < count) drawText(page, "X", cellX + Math.max(1, (foulCellWidth - 4) / 2), 416, 7, color, fonts.bold);
    }
    if (count > 4) drawText(page, `+${count - 4}`, px + 17, 407, 6, color, fonts.bold);
  }
  const slots = gameSheetTimeoutSlots(team.timeoutMarks ?? [], regulationPeriods);
  const boxes = (values: Array<GameSheetPeriod | null>, start: number, y: number) => values.forEach((period, index) => {
    const bx = start + index * 12;
    page.drawRectangle({ x: bx, y, width: 9, height: 9, borderColor: LIGHT, borderWidth: 0.5 });
    if (period) drawText(page, "X", bx + 2, y + 2, 7, periodInk(period, regulationPeriods), fonts.bold);
  });
  drawText(page, "ΤΑΪΜ-ΑΟΥΤ Α ΗΜ.", x + 2, 397, 6.4, INK, fonts.bold);
  boxes(slots.firstHalf, x + 86, 393);
  drawText(page, "Β ΗΜ.", x + 125, 397, 6.4, INK, fonts.bold);
  boxes(slots.secondHalf, x + 158, 393);
  if (slots.overtime.length) {
    drawText(page, "ΠΑΡΑΤΑΣΗ", x + 2, 382, 6.4, INK, fonts.bold);
    boxes(slots.overtime, x + 64, 378);
  }
}

function drawRunningScore(page: PDFPage, sheet: PlatformGameSheet, fonts: SheetFonts): void {
  drawText(page, "ΔΙΑΚΥΜΑΝΣΗ ΣΚΟΡ - Α / Β", 22, 366, 9, INK, fonts.bold);
  const bandWidth = (PAGE_WIDTH - 44) / 4;
  for (let band = 0; band < 4; band++) {
    const x = 22 + band * bandWidth;
    drawText(page, `A       ${band * 40 + 1}-${band * 40 + 40}       B`, x + 3, 354, 7, INK, fonts.bold);
    for (let offset = 0; offset < 40; offset++) {
      const row = sheet.runningScore[band * 40 + offset];
      if (!row) continue;
      const y = 341 - offset * 7.2;
      page.drawRectangle({ x, y: y - 1, width: bandWidth, height: 7.2, borderColor: LIGHT, borderWidth: 0.35 });
      line(page, x + bandWidth / 2, y - 1, x + bandWidth / 2, y + 6.2);
      for (const [side, mark, left] of [["HOME", row.home, true], ["AWAY", row.away, false]] as const) {
        const cx = x + (left ? 1 : bandWidth / 2 + 1);
        const score = String(row.score);
        const scoreX = cx + 2;
        drawText(page, score, scoreX, y + 0.2, 6.1, INK, fonts.regular);
        if (!mark) continue;
        if (!mark.period) throw new Error("GAME_SHEET_SCORE_PERIOD_UNAVAILABLE");
        const color = periodInk(mark.period, sheet.regulationPeriods);
        const visual = gameSheetRunningScoreVisual(mark);
        const numberWidth = widthOf(score, fonts.regular, 6.1);
        if (visual.mark === "dot") page.drawEllipse({ x: scoreX + numberWidth / 2, y: y + 5.8, xScale: 1, yScale: 1, color });
        else line(page, scoreX - 0.5, y + 0.3, scoreX + numberWidth + 0.5, y + 5.3, color, 1.1);
        const shirtX = cx + 28;
        drawText(page, mark.shirtNumber, shirtX, y + 0.2, 6.1, color, fonts.bold, 30);
        if (visual.circleShirt) page.drawEllipse({ x: shirtX + widthOf(mark.shirtNumber, fonts.bold, 6.1) / 2, y: y + 3.1, xScale: widthOf(mark.shirtNumber, fonts.bold, 6.1) / 2 + 2, yScale: 3.1, borderColor: color, borderWidth: 0.65 });
        for (const closure of sheet.periodClosures ?? []) {
          if (closure[side === "HOME" ? "home" : "away"] !== row.score) continue;
          line(page, cx, y - 1, cx + bandWidth / 2 - 2, y - 1, periodInk(closure.period, sheet.regulationPeriods), 0.8);
        }
        if (row.score === sheet.game.finalScore[side === "HOME" ? "home" : "away"]) {
          line(page, cx, y - 2.3, cx + bandWidth / 2 - 2, y - 2.3, color, 0.8);
        }
      }
    }
  }
}

export async function generatePlatformGameSheetPdf(sheet: PlatformGameSheet): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  document.setTitle("ΦΥΛΛΟ ΑΓΩΝΑ KOMOBASKET");
  document.setAuthor("KomoBasket");
  document.setCreator("KomoBasket Platform");
  const [latin, latinBold, greek, greekBold] = await Promise.all([
    document.embedFont(decodeFont(NOTO_SANS_LATIN_REGULAR), { subset: true }),
    document.embedFont(decodeFont(NOTO_SANS_LATIN_BOLD), { subset: true }),
    document.embedFont(decodeFont(NOTO_SANS_GREEK_REGULAR), { subset: true }),
    document.embedFont(decodeFont(NOTO_SANS_GREEK_BOLD), { subset: true }),
  ]);
  const fonts: SheetFonts = { regular: { latin, greek }, bold: { latin: latinBold, greek: greekBold } };
  const extended = sheet.home.players.length > 12 || sheet.away.players.length > 12;
  const continuationCount = Math.ceil(Math.max(0, sheet.home.players.length - 12, sheet.away.players.length - 12) / 12);
  const benchPage = sheet.home.extraBench.length + sheet.away.extraBench.length > 0;
  const totalPages = 1 + continuationCount + Number(benchPage);
  const main = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawText(main, "ΦΥΛΛΟ ΑΓΩΝΑ KOMOBASKET", 22, 812, 15, NAVY, fonts.bold);
  if (extended) {
    drawText(main, "ΕΚΤΕΤΑΜΕΝΟ ΦΥΛΛΟ ΑΓΩΝΑ", 22, 791, 10, RED, fonts.bold);
    drawText(main, "Η σύνθεση περιλαμβάνει περισσότερους από 12 παίκτες.", 22, 778, 8, INK, fonts.regular);
    drawText(main, "Το παρόν αποτελεί φύλλο αγώνα KomoBasket και αποκλίνει", 22, 767, 8, INK, fonts.regular);
    drawText(main, "από την τυπική διάταξη FIBA/ΕΟΚ.", 22, 756, 8, INK, fonts.regular);
  }
  const metaY = extended ? 739 : 786;
  drawText(main, `${sheet.game.competition} / ${sheet.game.season} / ${sheet.game.phase ?? "-"} / ${sheet.game.round ?? "-"}`, 22, metaY, 8, INK, fonts.regular, 550);
  drawText(main, `${sheet.game.gameId}   ${displayDate(sheet.game.scheduledDate)} ${sheet.game.scheduledTime ?? ""}   ${sheet.game.venue ?? ""}`, 22, metaY - 14, 8, INK, fonts.regular, 550);
  drawText(main, `${sheet.home.name}  ${sheet.game.finalScore.home} - ${sheet.game.finalScore.away}  ${sheet.away.name}`, 22, metaY - 30, 10, NAVY, fonts.bold, 550);
  drawText(main, `Νικήτρια: ${sheet.winner}   ${sheet.periodScores.map((score) => `${gameSheetPeriodLabel(score.period)} ${score.home}-${score.away}`).join("   ")}`, 22, metaY - 44, 7.2, INK, fonts.regular, 550);
  drawRoster(main, sheet.home, 22, sheet.home.players.slice(0, 12), fonts, false, sheet.regulationPeriods);
  drawRoster(main, sheet.away, 306, sheet.away.players.slice(0, 12), fonts, false, sheet.regulationPeriods);
  drawTeamFoulsAndTimeouts(main, sheet.home, 22, fonts, sheet.regulationPeriods);
  drawTeamFoulsAndTimeouts(main, sheet.away, 306, fonts, sheet.regulationPeriods);
  drawRunningScore(main, sheet, fonts);
  drawText(main, `Διαιτητές: ${[sheet.officials.referees.a, sheet.officials.referees.b, sheet.officials.referees.c].filter(Boolean).join(" / ") || "-"}`, 22, 41, 7, INK, fonts.regular, 550);
  drawText(main, `Γραμματεία: ${[sheet.officials.table.scoresheet, sheet.officials.table.timer, sheet.officials.table.shotClock, sheet.officials.table.commissioner].filter(Boolean).join(" / ") || "-"}`, 22, 30, 7, INK, fonts.regular, 550);
  drawText(main, `1 / ${totalPages}`, 540, 16, 7, INK, fonts.bold);
  for (let index = 0; index < continuationCount; index++) {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawText(page, `KOMOBASKET - ${sheet.game.gameId} - ΣΥΝΕΧΕΙΑ ΣΥΝΘΕΣΕΩΝ`, 22, 812, 13, NAVY, fonts.bold, 550);
    drawText(page, `${sheet.home.name} / ${sheet.away.name}   ${sheet.game.finalScore.home}-${sheet.game.finalScore.away}`, 22, 788, 9, INK, fonts.regular);
    drawRoster(page, sheet.home, 22, sheet.home.players.slice(12 + index * 12, 24 + index * 12), fonts, true, sheet.regulationPeriods);
    drawRoster(page, sheet.away, 306, sheet.away.players.slice(12 + index * 12, 24 + index * 12), fonts, true, sheet.regulationPeriods);
    drawText(page, `${index + 2} / ${totalPages}`, 540, 16, 7, INK, fonts.bold);
  }
  if (benchPage) {
    const page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    drawText(page, `KOMOBASKET - ${sheet.game.gameId} - ΠΡΟΣΘΕΤΑ ΣΤΟΙΧΕΙΑ`, 22, 812, 12, NAVY, fonts.bold);
    let y = 778;
    for (const team of [sheet.home, sheet.away]) {
      drawText(page, `${team.designation}: ${team.name}`, 22, y, 10, INK, fonts.bold); y -= 18;
      drawText(page, `Προπονητής: ${team.headCoach || "-"}   Βοηθός: ${team.assistantCoach || "-"}`, 22, y, 8, INK, fonts.regular); y -= 20;
      for (const entry of team.extraBench) { drawText(page, `${entry.name} - ${entry.role}`, 28, y, 8, INK, fonts.regular); y -= 15; }
      y -= 24;
    }
    drawText(page, `${totalPages} / ${totalPages}`, 540, 16, 7, INK, fonts.bold);
  }
  return document.save();
}
