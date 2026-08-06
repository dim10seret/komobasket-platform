import type { MatchEvent } from "../types/event";
import type { MatchState } from "../types/match-state";

const escape = (value: string | number) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] ?? character);

function boxRows(state: MatchState, xml = false): string {
  const cells = (values: Array<string | number>) => xml
    ? `<Row>${values.map((value) => `<Cell><Data ss:Type="${typeof value === "number" ? "Number" : "String"}">${escape(value)}</Data></Cell>`).join("")}</Row>`
    : `<tr>${values.map((value) => `<td>${escape(value)}</td>`).join("")}</tr>`;
  return [state.home, state.away].flatMap((team) => team.players.map((player) => {
    const s = player.statistics;
    return cells([team.name, `#${player.number} ${player.firstName} ${player.lastName}`, s.points, `${s.twoPointMade}/${s.twoPointAttempts}`, `${s.threePointMade}/${s.threePointAttempts}`, `${s.freeThrowMade}/${s.freeThrowAttempts}`, s.offensiveRebounds + s.defensiveRebounds, s.assists, s.steals, s.blocks, s.turnovers, player.fouls]);
  })).join("");
}

export function printMatchReport(state: MatchState, events: readonly MatchEvent[]): void {
  const popup = window.open("", "_blank", "noopener,noreferrer");
  if (!popup) return;
  popup.document.write(`<!doctype html><html lang="el"><head><meta charset="utf-8"><title>Φύλλο αγώνα</title><style>body{font-family:Arial;padding:28px;color:#111}table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #bbb;text-align:center}td:first-child,td:nth-child(2){text-align:left}.score{font-size:30px;font-weight:bold}</style></head><body><h1>KomoControl - Φύλλο αγώνα</h1><p class="score">${escape(state.home.name)} ${state.home.score} - ${state.away.score} ${escape(state.away.name)}</p><p>Περίοδος ${state.quarter} · ${state.finished ? "Τελικό" : "Live"} · ${events.length} events</p><table><thead><tr><th>Ομάδα</th><th>Παίκτης</th><th>PTS</th><th>2PT</th><th>3PT</th><th>FT</th><th>REB</th><th>AST</th><th>STL</th><th>BLK</th><th>TO</th><th>PF</th></tr></thead><tbody>${boxRows(state)}</tbody></table></body></html>`);
  popup.document.close(); popup.focus(); popup.print();
}

export function downloadMatchExcel(state: MatchState): void {
  const headers = ["Ομάδα", "Παίκτης", "PTS", "2PT", "3PT", "FT", "REB", "AST", "STL", "BLK", "TO", "PF"];
  const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Box Score"><Table><Row><Cell><Data ss:Type="String">${escape(state.home.name)} ${state.home.score} - ${state.away.score} ${escape(state.away.name)}</Data></Cell></Row><Row>${headers.map((value) => `<Cell><Data ss:Type="String">${value}</Data></Cell>`).join("")}</Row>${boxRows(state, true)}</Table></Worksheet></Workbook>`;
  const url = URL.createObjectURL(new Blob([xml], { type: "application/vnd.ms-excel" }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = `komocontrol-${state.id}-box-score.xls`; anchor.click(); URL.revokeObjectURL(url);
}
