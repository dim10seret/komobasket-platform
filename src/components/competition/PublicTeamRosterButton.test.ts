import { readFileSync } from "node:fs";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PublicTeamRosterButton, { PublicTeamRosterTable } from "./PublicTeamRosterButton";
import PublicTeamStatisticsPanel from "./PublicTeamStatistics";

const players = [{ id: "p-1", displayName: "ΔΗΜΗΤΡΙΟΣ ΓΑΚΗΣ", shirtNumber: 8 }, { id: "p-2", displayName: "ΠΑΙΚΤΗΣ ΧΩΡΙΣ ΑΡΙΘΜΟ", shirtNumber: null }];
const page = readFileSync(new URL("./PublicCompetitionsView.tsx", import.meta.url), "utf8");
const button = readFileSync(new URL("./PublicTeamRosterButton.tsx", import.meta.url), "utf8");

describe("independent public roster button", () => {
  it("shows only the three requested read-only columns", () => {
    const html = renderToStaticMarkup(createElement(PublicTeamRosterTable, { players }));
    expect((html.match(/<th /g) ?? [])).toHaveLength(3);
    for (const value of ["A/A", "Ονοματεπώνυμο", "Νο. Φανέλας", "ΔΗΜΗΤΡΙΟΣ ΓΑΚΗΣ", ">8<", ">—<"]) expect(html).toContain(value);
    for (const value of ["PTS", "REB", "AST", "gamesPlayed", "statistics", "input", "select"]) expect(html).not.toContain(value);
  });
  it("renders zero as a jersey rather than the null placeholder", () => {
    expect(renderToStaticMarkup(createElement(PublicTeamRosterTable, { players: [{ ...players[0], shirtNumber: 0 }] }))).toContain(">0<");
  });
  it("renders the roster button and players alongside the existing zero-game statistics state", () => {
    const html = renderToStaticMarkup(createElement(Fragment, null,
      createElement(PublicTeamRosterButton, { teamName: "TEAM", players }),
      createElement(PublicTeamStatisticsPanel, { gameMode: "FULL", statistics: { team: { id: "team", name: "TEAM" }, games: [], total: { teamGamesPlayed: 0, players: [] } } }),
    ));
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain(">Ρόστερ</button>");
    expect(html).toContain("ΔΗΜΗΤΡΙΟΣ ΓΑΚΗΣ");
    expect(html).toContain("Δεν υπάρχουν διαθέσιμα στατιστικά αγώνων.");
    expect(html).not.toContain("disabled");
  });
  it("uses a closed native modal with an opaque surface, backdrop and native focus/Escape handling", () => {
    const html = renderToStaticMarkup(createElement(PublicTeamRosterButton, { teamName: "TEAM", players }));
    expect(html).toContain("<dialog");
    expect(html).not.toMatch(/<dialog[^>]*\bopen(?:=|\s|>)/);
    expect(html).toContain("aria-labelledby=");
    expect(html).toContain("backdrop:bg-black/50");
    expect(html).toContain("bg-white");
    expect(button).toContain("dialog.current?.showModal()");
    expect(button).toContain("dialog.current?.close()");
  });
  it("distinguishes empty roster from a failed roster read without touching the statistics panel", () => {
    expect(renderToStaticMarkup(createElement(PublicTeamRosterButton, { teamName: "TEAM", players: [] }))).toContain("Δεν υπάρχουν ενεργοί παίκτες");
    expect(renderToStaticMarkup(createElement(PublicTeamRosterButton, { teamName: "TEAM", players: null }))).toContain("Το ρόστερ δεν είναι διαθέσιμο");
    expect(page).toContain("try { roster = await getPublicTeamRoster(rosterScope); } catch {}");
  });
  it("wires the header's selected scope without feeding its roster into statistics or program", () => {
    expect(page).toContain("seasonId: context.selectedSeason.id, competitionId: context.selectedCompetition.id, teamId: context.teamView.team.id");
    expect(page).toContain("<PublicTeamRosterButton teamName={view.team.name} players={roster?.players ?? null} />");
    expect(page).toContain("const logoUrl = roster ? roster.logoUrl : view.team.logoUrl;");
    expect(page).toContain("<PublicTeamStatisticsPanel statistics={view.statistics} gameMode={view.gameMode} />");
    expect(page).toContain("<TeamGameGroup games={view.games} teamHref={teamHref} gameBasePath={gameBasePath} />");
    expect(button).not.toContain("fetch(");
    expect(button).not.toContain("view.statistics");
  });
});
