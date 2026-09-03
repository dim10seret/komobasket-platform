import "server-only";

import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, PDFPage, PDFFont, rgb } from "pdf-lib";
import {
  NOTO_SANS_GREEK_BOLD,
  NOTO_SANS_GREEK_REGULAR,
  NOTO_SANS_LATIN_BOLD,
  NOTO_SANS_LATIN_REGULAR,
} from "../assets/fonts/noto-sans-subsets";
import { matchReportShootingPercentage } from "../lib/platform-match-report-statistics";
import type {
  PlatformMatchReport,
  PlatformMatchReportPlayer,
  PlatformMatchReportStatisticsLine,
} from "../lib/platform-match-report";

type PdfTextFonts = { latin: PDFFont; greek: PDFFont };
type StatisticsPdfPlayerRow = PlatformMatchReportPlayer & {
  twoPointPercentage: string;
  threePointPercentage: string;
  freeThrowPercentage: string;
};

export type StatisticsPdfDocumentModel = {
  title: string;
  competition: string;
  season: string;
  phase: string | null;
  round: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  venue: string | null;
  score: string;
  winner: string | null;
  periods: Array<{ label: string; score: string }>;
  teams: Array<{
    side: "HOME" | "AWAY";
    name: string;
    players: StatisticsPdfPlayerRow[];
    totals: PlatformMatchReportStatisticsLine;
  }>;
  columns: readonly string[];
};

export const STATISTICS_PDF_COLUMNS = [
  "#", "ΠΑΙΚΤΗΣ", "Β", "ΚΑΤΑΣΤΑΣΗ", "PTS", "2PT", "3PT", "FT", "OREB", "DREB", "REB", "AST", "STL", "BLK", "TO", "F", "EFF",
] as const;
export const STATISTICS_PDF_CREATOR = "Created by: D. Seretidis";

export type StatisticsPdfPagePlan = {
  side: "HOME" | "AWAY";
  teamName: string;
  continuation: boolean;
  players: StatisticsPdfPlayerRow[];
  includeTotals: boolean;
};

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const MARGIN = 28;
const TABLE_ROW_HEIGHT = 18;
const TABLE_HEADER_HEIGHT = 20;
const TABLE_WIDTHS = [23, 142, 20, 68, 27, 36, 36, 36, 29, 29, 29, 27, 27, 27, 27, 22, 28] as const;
const NAVY = rgb(0.055, 0.11, 0.18);
const BLUE = rgb(0.06, 0.35, 0.58);
const PALE = rgb(0.94, 0.96, 0.98);
const ORANGE = rgb(0.92, 0.34, 0.08);
const WHITE = rgb(1, 1, 1);
const MUTED = rgb(0.35, 0.41, 0.48);
const FIRST_TEAM_PAGE_FINAL_PLAYER_CAPACITY = 17;
const FIRST_TEAM_PAGE_PLAYER_CAPACITY = 18;
const CONTINUATION_PAGE_FINAL_PLAYER_CAPACITY = 24;

function periodLabel(period: PlatformMatchReport["game"]["periodScores"][number]["period"]): string {
  return period.kind === "REGULATION" ? `Q${period.index}` : `OT${period.index}`;
}

function playerRow(player: PlatformMatchReportPlayer): StatisticsPdfPlayerRow {
  return {
    ...player,
    twoPointPercentage: matchReportShootingPercentage(player.statistics.twoPointMade, player.statistics.twoPointAttempts),
    threePointPercentage: matchReportShootingPercentage(player.statistics.threePointMade, player.statistics.threePointAttempts),
    freeThrowPercentage: matchReportShootingPercentage(player.statistics.freeThrowMade, player.statistics.freeThrowAttempts),
  };
}

export function buildStatisticsPdfDocumentModel(report: PlatformMatchReport): StatisticsPdfDocumentModel {
  if (!report.availability.available) throw new Error("MATCH_REPORT_UNAVAILABLE");
  const home = report.game.homeTeam;
  const away = report.game.awayTeam;
  const winner = report.game.winner === "HOME" ? home.name : report.game.winner === "AWAY" ? away.name : null;
  return {
    title: "ΣΤΑΤΙΣΤΙΚΑ ΑΓΩΝΑ",
    competition: report.game.competition,
    season: report.game.season,
    phase: report.game.phase,
    round: report.game.round,
    scheduledDate: report.game.scheduledDate,
    scheduledTime: report.game.scheduledTime,
    venue: report.game.venue,
    score: `${home.name} ${report.game.finalScore.home} - ${report.game.finalScore.away} ${away.name}`,
    winner,
    periods: report.game.periodScores.map((period) => ({ label: periodLabel(period.period), score: `${period.home}-${period.away}` })),
    teams: [
      { side: "HOME", name: home.name, players: report.statistics.home.players.map(playerRow), totals: report.statistics.home.totals },
      { side: "AWAY", name: away.name, players: report.statistics.away.players.map(playerRow), totals: report.statistics.away.totals },
    ],
    columns: STATISTICS_PDF_COLUMNS,
  };
}

export function planStatisticsPdfPages(model: StatisticsPdfDocumentModel): StatisticsPdfPagePlan[] {
  return model.teams.flatMap((team) => {
    const pages: StatisticsPdfPagePlan[] = [];
    let offset = 0;
    if (team.players.length <= FIRST_TEAM_PAGE_FINAL_PLAYER_CAPACITY) {
      return [{ side: team.side, teamName: team.name, continuation: false, players: team.players, includeTotals: true }];
    }
    pages.push({
      side: team.side,
      teamName: team.name,
      continuation: false,
      players: team.players.slice(0, FIRST_TEAM_PAGE_PLAYER_CAPACITY),
      includeTotals: false,
    });
    offset = FIRST_TEAM_PAGE_PLAYER_CAPACITY;
    while (offset < team.players.length) {
      const remaining = team.players.length - offset;
      const count = Math.min(remaining, CONTINUATION_PAGE_FINAL_PLAYER_CAPACITY);
      pages.push({
        side: team.side,
        teamName: team.name,
        continuation: true,
        players: team.players.slice(offset, offset + count),
        includeTotals: remaining <= CONTINUATION_PAGE_FINAL_PLAYER_CAPACITY,
      });
      offset += count;
    }
    return pages;
  });
}

export function statisticsPdfFilename(report: PlatformMatchReport): string {
  const clean = (value: string) => value.normalize("NFC").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "team";
  return `komobasket-statistics-${clean(report.game.homeTeam.name)}-vs-${clean(report.game.awayTeam.name)}.pdf`;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function statusLabel(player: StatisticsPdfPlayerRow): string {
  if (player.finalStatus === "ELIGIBLE") return "ΕΝΕΡΓΟΣ";
  if (player.finalStatusReason === "FIVE_FOULS") return "5 ΦΑΟΥΛ";
  if (player.finalStatus === "DISQUALIFIED") return "ΑΠΟΒΟΛΗ";
  return "ΕΚΤΟΣ";
}

function isGreek(character: string): boolean {
  const point = character.codePointAt(0) ?? 0;
  return (point >= 0x0370 && point <= 0x03ff) || (point >= 0x1f00 && point <= 0x1fff);
}

function supportedCharacter(character: string, primary: PDFFont, alternate: PDFFont): { text: string; font: PDFFont } {
  const codePoint = character.codePointAt(0) ?? 0;
  const primarySet = new Set(primary.getCharacterSet());
  if (primarySet.has(codePoint)) return { text: character, font: primary };
  if (new Set(alternate.getCharacterSet()).has(codePoint)) return { text: character, font: alternate };
  return { text: "?", font: alternate };
}

function textRuns(text: string, fonts: PdfTextFonts) {
  const runs: Array<{ text: string; font: PDFFont }> = [];
  for (const character of text) {
    const primary = isGreek(character) ? fonts.greek : fonts.latin;
    const alternate = primary === fonts.greek ? fonts.latin : fonts.greek;
    const resolved = supportedCharacter(character, primary, alternate);
    const last = runs.at(-1);
    if (last?.font === resolved.font) last.text += resolved.text;
    else runs.push(resolved);
  }
  return runs;
}

function textWidth(text: string, fonts: PdfTextFonts, size: number): number {
  return textRuns(text, fonts).reduce((width, run) => width + run.font.widthOfTextAtSize(run.text, size), 0);
}

function fitText(text: string, fonts: PdfTextFonts, size: number, maxWidth: number): string {
  if (textWidth(text, fonts, size) <= maxWidth) return text;
  const suffix = "...";
  let fitted = "";
  for (const character of text) {
    if (textWidth(fitted + character + suffix, fonts, size) > maxWidth) break;
    fitted += character;
  }
  return fitted + suffix;
}

function drawMixedText(page: PDFPage, text: string, fonts: PdfTextFonts, x: number, y: number, size: number, color = NAVY) {
  let cursor = x;
  for (const run of textRuns(text, fonts)) {
    page.drawText(run.text, { x: cursor, y, size, font: run.font, color });
    cursor += run.font.widthOfTextAtSize(run.text, size);
  }
}

function centeredX(text: string, fonts: PdfTextFonts, size: number, x: number, width: number) {
  return x + Math.max(0, (width - textWidth(text, fonts, size)) / 2);
}

function lineValues(line: PlatformMatchReportStatisticsLine): string[] {
  return [
    String(line.points), `${line.twoPointMade}/${line.twoPointAttempts}`, `${line.threePointMade}/${line.threePointAttempts}`,
    `${line.freeThrowMade}/${line.freeThrowAttempts}`, String(line.offensiveRebounds), String(line.defensiveRebounds),
    String(line.rebounds), String(line.assists), String(line.steals), String(line.blocks), String(line.turnovers),
    String(line.fouls), String(line.efficiency),
  ];
}

export async function generateStatisticsPdf(report: PlatformMatchReport): Promise<Uint8Array> {
  const model = buildStatisticsPdfDocumentModel(report);
  const document = await PDFDocument.create();
  document.registerFontkit(fontkit);
  document.setTitle(`${model.title} - ${model.score}`);
  document.setAuthor("KomoBasket");
  document.setSubject("Authoritative finalized basketball box score");
  document.setCreator("KomoBasket Platform");
  document.setProducer("KomoBasket Platform");
  const fixedDate = new Date("2000-01-01T00:00:00.000Z");
  document.setCreationDate(fixedDate);
  document.setModificationDate(fixedDate);
  const [latinRegular, latinBold, greekRegular, greekBold] = await Promise.all([
    document.embedFont(decodeBase64(NOTO_SANS_LATIN_REGULAR), { subset: true }),
    document.embedFont(decodeBase64(NOTO_SANS_LATIN_BOLD), { subset: true }),
    document.embedFont(decodeBase64(NOTO_SANS_GREEK_REGULAR), { subset: true }),
    document.embedFont(decodeBase64(NOTO_SANS_GREEK_BOLD), { subset: true }),
  ]);
  const regular = { latin: latinRegular, greek: greekRegular };
  const bold = { latin: latinBold, greek: greekBold };
  let page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = 0;

  const drawContinuationHeader = (teamName: string) => {
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 34, width: PAGE_WIDTH, height: 34, color: NAVY });
    drawMixedText(page, `KOMOBASKET · ${teamName} · ΣΥΝΕΧΕΙΑ`, bold, MARGIN, PAGE_HEIGHT - 23, 11, WHITE);
    y = PAGE_HEIGHT - 52;
  };
  const drawGameHeader = () => {
    page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 96, width: PAGE_WIDTH, height: 96, color: NAVY });
    drawMixedText(page, "KOMOBASKET", bold, MARGIN, PAGE_HEIGHT - 28, 10, rgb(0.25, 0.76, 0.95));
    drawMixedText(page, model.title, bold, MARGIN, PAGE_HEIGHT - 52, 19, WHITE);
    const scoreSize = 17;
    drawMixedText(page, model.score, bold, centeredX(model.score, bold, scoreSize, MARGIN, PAGE_WIDTH - (2 * MARGIN)), PAGE_HEIGHT - 80, scoreSize, WHITE);
    y = PAGE_HEIGHT - 116;
    const metadata = [model.competition, model.season, model.phase, model.round, model.scheduledDate, model.scheduledTime, model.venue]
      .filter((value): value is string => Boolean(value?.trim())).join(" · ");
    drawMixedText(page, fitText(metadata, regular, 8.5, PAGE_WIDTH - (2 * MARGIN)), regular, MARGIN, y, 8.5, MUTED);
    y -= 18;
    if (model.winner) drawMixedText(page, `ΝΙΚΗΤΗΣ: ${model.winner}`, bold, MARGIN, y, 9, ORANGE);
    let periodX = PAGE_WIDTH - MARGIN;
    for (const period of [...model.periods].reverse()) {
      const text = `${period.label} ${period.score}`;
      const width = textWidth(text, bold, 8) + 14;
      periodX -= width;
      page.drawRectangle({ x: periodX, y: y - 4, width, height: 17, color: PALE, borderColor: rgb(0.78, 0.83, 0.88), borderWidth: 0.5 });
      drawMixedText(page, text, bold, periodX + 7, y, 8, BLUE);
      periodX -= 5;
    }
    y -= 28;
  };

  const drawTableHeader = () => {
    page.drawRectangle({ x: MARGIN, y: y - TABLE_HEADER_HEIGHT + 5, width: TABLE_WIDTHS.reduce((sum, width) => sum + width, 0), height: TABLE_HEADER_HEIGHT, color: NAVY });
    let x = MARGIN;
    STATISTICS_PDF_COLUMNS.forEach((label, index) => {
      const width = TABLE_WIDTHS[index];
      const size = index === 1 || index === 3 ? 6.5 : 6.2;
      drawMixedText(page, label, bold, index === 1 || index === 3 ? x + 3 : centeredX(label, bold, size, x, width), y - 9, size, WHITE);
      x += width;
    });
    y -= TABLE_HEADER_HEIGHT;
  };

  const drawDataRow = (values: string[], name: string, starter: string, status: string, shaded: boolean, boldRow = false) => {
    if (shaded) page.drawRectangle({ x: MARGIN, y: y - TABLE_ROW_HEIGHT + 4, width: TABLE_WIDTHS.reduce((sum, width) => sum + width, 0), height: TABLE_ROW_HEIGHT, color: PALE });
    const cells = [values[0], name, starter, status, ...values.slice(1)];
    let x = MARGIN;
    const fonts = boldRow ? bold : regular;
    cells.forEach((value, index) => {
      const width = TABLE_WIDTHS[index];
      const size = index === 1 ? 6.8 : index === 3 ? 6.1 : 6.5;
      const fitted = fitText(value, fonts, size, width - 5);
      drawMixedText(page, fitted, fonts, index === 1 || index === 3 ? x + 3 : centeredX(fitted, fonts, size, x, width), y - 9, size, boldRow ? NAVY : rgb(0.12, 0.16, 0.21));
      x += width;
    });
    page.drawLine({ start: { x: MARGIN, y: y - TABLE_ROW_HEIGHT + 4 }, end: { x: MARGIN + TABLE_WIDTHS.reduce((sum, width) => sum + width, 0), y: y - TABLE_ROW_HEIGHT + 4 }, thickness: 0.35, color: rgb(0.84, 0.87, 0.9) });
    y -= TABLE_ROW_HEIGHT;
  };

  const pagePlan = planStatisticsPdfPages(model);
  pagePlan.forEach((plannedPage, pageIndex) => {
    if (pageIndex > 0) page = document.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    const team = model.teams.find((candidate) => candidate.side === plannedPage.side);
    if (!team) throw new Error("STATISTICS_PDF_TEAM_MISSING");
    if (plannedPage.continuation) drawContinuationHeader(team.name);
    else drawGameHeader();
    page.drawRectangle({ x: MARGIN, y: y - 18, width: PAGE_WIDTH - (2 * MARGIN), height: 23, color: team.side === "HOME" ? BLUE : ORANGE });
    drawMixedText(page, `${team.side} · ${team.name}${plannedPage.continuation ? " · ΣΥΝΕΧΕΙΑ" : ""}`, bold, MARGIN + 8, y - 11, 11, WHITE);
    y -= 28;
    drawTableHeader();
    plannedPage.players.forEach((player, index) => {
      const values = [player.shirtNumber, ...lineValues(player.statistics)];
      drawDataRow(values, player.displayName, player.starter ? "ΝΑΙ" : "", statusLabel(player), index % 2 === 1);
    });
    if (plannedPage.includeTotals) {
      drawDataRow(["", ...lineValues(team.totals)], "ΣΥΝΟΛΑ ΟΜΑΔΑΣ", "", "", true, true);
    }
  });

  const pages = document.getPages();
  pages.forEach((pdfPage, index) => {
    const footer = `KomoBasket · ${index + 1}/${pages.length}`;
    drawMixedText(pdfPage, footer, regular, MARGIN, 12, 7, MUTED);
    drawMixedText(pdfPage, STATISTICS_PDF_CREATOR, regular, PAGE_WIDTH - MARGIN - textWidth(STATISTICS_PDF_CREATOR, regular, 7), 12, 7, MUTED);
  });
  return document.save({ useObjectStreams: false, addDefaultPage: false });
}
