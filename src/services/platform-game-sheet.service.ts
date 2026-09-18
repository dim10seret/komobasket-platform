import "server-only";

import { getKomoBasketCloudflareEnv } from "@/lib/cloudflare";
import { gameSheetPeriodLabel, projectPlatformGameSheet, type PlatformGameSheet, type PlatformGameSheetTeam } from "@/lib/platform-game-sheet";
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
  const rows = Array.from({ length: 12 }, (_, index) => {
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
  return `<!doctype html><html lang="el"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Επίσημο Φύλλο Αγώνα · ${escapeHtml(sheet.home.name)} - ${escapeHtml(sheet.away.name)}</title><style>
@page{size:A4 portrait;margin:4mm}*{box-sizing:border-box}body{margin:0;background:#e7e5e4;color:#111;font-family:"Arial Narrow","Noto Sans",Arial,sans-serif}.toolbar{position:sticky;top:0;z-index:5;display:flex;justify-content:center;gap:10px;padding:12px;background:#18181b}.toolbar button{border:1px solid #fff;border-radius:8px;background:#fff;padding:10px 16px;font-weight:800;cursor:pointer}.toolbar .print{background:#ea580c;color:#fff;border-color:#fb923c}.sheet-page{width:202mm;min-height:289mm;margin:10mm auto;background:#fff;padding:4mm;box-shadow:0 8px 30px #0003;break-after:page}.sheet-page header{text-align:center;border:1.5px solid #000;padding:2mm}.sheet-page header p,.sheet-page header h1{margin:0}.sheet-page header p{font-size:9pt;font-weight:800}.sheet-page header h1{font-size:14pt;letter-spacing:.06em}.identity-grid{display:grid;grid-template-columns:1.5fr 1.5fr 1fr 1fr;gap:0;border:1px solid #000;border-top:0}.identity-grid div{min-height:9mm;padding:1mm;border-right:1px solid #000;font-size:7pt}.identity-grid div:nth-child(4n){border-right:0}.identity-grid b{display:block;font-size:8pt;margin-top:.8mm}.main-grid{display:grid;grid-template-columns:58% 42%;gap:2mm;margin-top:2mm}.team-panel{border:1px solid #000;margin-bottom:2mm}.team-heading{padding:1mm 1.5mm;border-bottom:1px solid #000;font-size:8pt}.team-meta{display:flex;justify-content:space-between;gap:1mm;padding:1mm;font-size:6.5pt}.team-meta b{margin-left:1mm}.boxes{display:inline-flex}.boxes span{display:inline-grid;place-items:center;width:5mm;height:4mm;border:1px solid #000;margin-left:.5mm}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #000;text-align:center;padding:.35mm;font-size:6.3pt;height:4.2mm}th:nth-child(1){width:7mm}th:nth-child(2){width:auto}.player-name{text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.staff-lines{display:grid;grid-template-columns:1fr 1fr;gap:2mm;padding:1.2mm;font-size:6.5pt;min-height:7mm}.running{border:1px solid #000;padding:1mm}.running h2{text-align:center;font-size:8pt;margin:0 0 1mm}.score-bands{display:grid;grid-template-columns:repeat(4,1fr);gap:.6mm}.score-band{border:1px solid #000}.score-band-head,.score-row{display:grid;grid-template-columns:1fr 1fr}.score-band-head b{font-size:6.5pt;text-align:center;border-bottom:1px solid #000}.score-band-head b:first-child,.score-row>span:first-child{border-right:1px solid #000}.score-row>span{position:relative;height:3.25mm;border-bottom:.25px solid #777;text-align:center;font-size:5.8pt;line-height:3.25mm}.score-row:last-child>span{border-bottom:0}.score-mark{position:absolute;inset:.2mm;background:#fff;font-size:5.5pt;font-weight:900;line-height:2.8mm;text-decoration:underline}.score-mark.three{border:1px solid #000;border-radius:50%;text-decoration:none}.legend{font-size:5.5pt;margin:1mm 0 0}.bottom{display:grid;grid-template-columns:1.4fr 1fr;gap:2mm;margin-top:2mm}.periods,.final,.officials,.signatures{border:1px solid #000;padding:1.2mm}.periods{display:grid;grid-template-columns:repeat(4,1fr);gap:1mm}.periods div{display:flex;justify-content:space-between;font-size:6.5pt}.final p,.officials p,.signatures p{margin:.5mm 0;font-size:7pt}.officials-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 3mm}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:4mm;margin-top:2mm}.signature-line{padding-top:7mm;border-bottom:1px solid #000;text-align:center;font-size:6pt}.extra-page header{margin-bottom:5mm}.extra-team{margin-top:5mm}.extra-team h2{font-size:11pt}.extra-team th,.extra-team td{height:8mm;font-size:9pt;text-align:left;padding:2mm}@media print{body{background:#fff}.toolbar{display:none}.sheet-page{width:auto;min-height:0;margin:0;padding:0;box-shadow:none}.sheet-page:last-child{break-after:auto}}@media(max-width:800px){.sheet-page{margin:0;transform-origin:top left}.toolbar{flex-wrap:wrap}}
</style></head><body><nav class="toolbar" aria-label="Ενέργειες φύλλου αγώνα"><button id="back" type="button">Πίσω</button><button id="print" class="print" type="button">Εκτύπωση / Αποθήκευση PDF</button></nav><article class="sheet-page"><header><p>KomoBasket Platform</p><h1>ΕΠΙΣΗΜΟ ΦΥΛΛΟ ΑΓΩΝΑ</h1></header><section class="identity-grid"><div>Ομάδα Α<b>${escapeHtml(sheet.home.name)}</b></div><div>Ομάδα Β<b>${escapeHtml(sheet.away.name)}</b></div><div>Διοργάνωση<b>${escapeHtml(sheet.game.competition)}</b></div><div>Σεζόν<b>${escapeHtml(sheet.game.season)}</b></div><div>Αρ. Αγώνα<b>${escapeHtml(sheet.game.gameId)}</b></div><div>Ημερομηνία / Ώρα<b>${escapeHtml(displayDate(sheet.game.scheduledDate))} ${escapeHtml(sheet.game.scheduledTime)}</b></div><div>Γήπεδο<b>${escapeHtml(sheet.game.venue)}</b></div><div>Κομισάριος<b>${escapeHtml(official.table.commissioner)}</b></div><div>Διαιτητής Α<b>${escapeHtml(official.referees.a)}</b></div><div>Διαιτητής Β<b>${escapeHtml(official.referees.b)}</b></div><div>Διαιτητής Γ<b>${escapeHtml(official.referees.c)}</b></div><div>Φάση / Αγωνιστική<b>${escapeHtml([sheet.game.phase, sheet.game.round].filter(Boolean).join(" · "))}</b></div></section><div class="main-grid"><div>${teamPanel(sheet.home)}${teamPanel(sheet.away)}<section class="bottom"><div class="periods">${periodSummary(sheet)}</div><div class="final"><p><b>ΤΕΛΙΚΟ ΣΚΟΡ</b></p><p>Ομάδα Α: <b>${sheet.game.finalScore.home}</b> · Ομάδα Β: <b>${sheet.game.finalScore.away}</b></p><p>ΝΙΚΗΤΡΙΑ ΟΜΑΔΑ: <b>${escapeHtml(sheet.winner)}</b></p></div></section><section class="officials"><div class="officials-grid"><p>Χρονόμετρο: <b>${escapeHtml(official.table.timer)}</b></p><p>24'': <b>${escapeHtml(official.table.shotClock)}</b></p><p>Φύλλο Αγώνα: <b>${escapeHtml(official.table.scoresheet)}</b></p><p>Κομισάριος: <b>${escapeHtml(official.table.commissioner)}</b></p></div></section><section class="signatures"><div class="signature-line">Υπογραφή Διαιτητή</div><div class="signature-line">Υπογραφή Γραμματείας</div><p>Παρατηρήσεις:</p><p></p></section></div>${runningScore(sheet)}</div></article>${extraBenchPage(sheet)}<script nonce="${escapeHtml(nonce)}">document.getElementById("print").addEventListener("click",()=>window.print());document.getElementById("back").addEventListener("click",()=>history.back());</script></body></html>`;
}
