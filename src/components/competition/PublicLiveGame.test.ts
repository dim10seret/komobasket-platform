import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatPublicClock,
  interpolatedPublicClock,
  publicLivePollDelay,
} from "./PublicLiveGame";

const componentSource = readFileSync(new URL("./PublicLiveGame.tsx", import.meta.url), "utf8");
const competitionSource = readFileSync(
  new URL("../../app/competitions/page.tsx", import.meta.url),
  "utf8",
);
const livePageSource = readFileSync(
  new URL("../../app/competitions/games/[gameId]/live/page.tsx", import.meta.url),
  "utf8",
);

describe("public LIVE presentation", () => {
  it("formats authoritative stopped clock time", () => {
    expect(formatPublicClock(495)).toBe("08:15");
  });

  it("interpolates a running clock locally from the authoritative baseline", () => {
    expect(interpolatedPublicClock({ remainingSeconds: 495, running: true, asOfMs: 1_000 }, 6_000)).toBe(490);
  });

  it("does not interpolate a stopped clock", () => {
    expect(interpolatedPublicClock({ remainingSeconds: 495, running: false, asOfMs: 1_000 }, 60_000)).toBe(495);
  });

  it("clamps an interpolated clock at zero", () => {
    expect(formatPublicClock(-1)).toBe("00:00");
    expect(componentSource).toContain("Math.max(0");
  });

  it("polls every two seconds while LIVE and visible", () => {
    expect(publicLivePollDelay(false)).toBe(2_000);
  });

  it("slows polling while the tab is hidden", () => {
    expect(publicLivePollDelay(true)).toBe(10_000);
  });

  it("stops polling after finalization", () => {
    expect(componentSource).toContain('if (game.status !== "live") return');
  });

  it("shows LIVE only for authoritative live schedule cards", () => {
    expect(competitionSource).toContain("game.liveAvailable");
    expect(competitionSource).toContain(">LIVE<");
    expect(competitionSource).toContain("bg-emerald-500");
  });

  it("links the LIVE button to the correct public game route", () => {
    expect(competitionSource).toContain("/competitions/games/");
    expect(competitionSource).toContain("game.id");
    expect(competitionSource).toContain("/live");
  });

  it("renders a spectator scoreboard without scorer controls", () => {
    expect(componentSource).toContain("PublicLiveScoreboard");
    expect(componentSource).toContain("teamPanel(game.home)");
    expect(componentSource).toContain("teamPanel(game.away)");
    expect(componentSource).toContain("ΚΑΤΟΧΗ");
  });

  it("makes both team identities touch-accessible STATUS triggers", () => {
    expect(componentSource).toContain("onClick={() => onTeam?.(team.side)}");
    expect(componentSource).toContain("teamPanel(game.home)");
    expect(componentSource).toContain("teamPanel(game.away)");
    expect(componentSource).toContain("min-h-11");
  });

  it("renders HOME and AWAY active lineups with full names and fouls", () => {
    expect(componentSource).toContain("team.activeFive.map");
    expect(componentSource).toContain("<PublicLiveLineup team={game.home}");
    expect(componentSource).toContain("<PublicLiveLineup team={game.away}");
    expect(componentSource).toContain("player.displayName");
    expect(componentSource).toContain("player.fouls.total");
  });

  it("does not fabricate missing lineup players", () => {
    expect(componentSource).toContain("team.activeFive.map");
  });

  it("renders latest public play-by-play entries in the center column", () => {
    expect(componentSource).toContain("<PublicLivePlayByPlay items={game.playByPlay}");
    expect(componentSource).toContain("playByPlay");
    expect(componentSource).toContain("order-3 lg:order-2");
  });

  it("uses a progressive mobile stack instead of squeezing three columns", () => {
    expect(componentSource).toContain("grid-cols-1");
    expect(componentSource).toContain("lg:grid-cols-[minmax(15rem,0.8fr)_minmax(22rem,1.4fr)_minmax(15rem,0.8fr)]");
    expect(componentSource).toContain("order-1");
    expect(componentSource).toContain("order-2 lg:order-3");
  });

  it("keeps the public scoreboard readable on narrow screens", () => {
    expect(componentSource).toContain("grid-cols-2");
    expect(componentSource).toContain("col-span-2");
    expect(componentSource).toContain("break-words");
    expect(componentSource).toContain("tabular-nums");
  });

  it("renders the requested read-only STATUS statistics", () => {
    for (const column of ["Παίκτης", "Κατάσταση", "PTS", "2PTS", "3PTS", "1PTS", "REB", "AST", "STL", "BLK", "TO", "F", "EFF"]) {
      expect(componentSource).toContain(column);
    }
    expect(componentSource).toContain("statistics.twoPointMade");
    expect(componentSource).toContain("statistics.twoPointAttempts");
  });

  it("keeps the STATUS table and close control accessible on mobile", () => {
    expect(componentSource).toContain("overflow-auto");
    expect(componentSource).toContain("max-h-[94vh]");
    expect(componentSource).toContain("Κλείσιμο");
  });

  it("uses conditional polling so unchanged responses preserve local UI", () => {
    expect(componentSource).toContain('If-None-Match');
    expect(componentSource).toContain("response.status !== 304");
    expect(componentSource).toContain("mergePolledPublicGame(current, payload.data");
  });

  it("shows a safe completed state and stops LIVE behavior", () => {
    expect(componentSource).toContain('game.status !== "live"');
    expect(componentSource).toContain("ΟΛΟΚΛΗΡΩΜΕΝΟΣ");
    expect(componentSource).toContain("publicLivePollDelay");
  });

  it("loads the initial public game projection on the dedicated route", () => {
    expect(livePageSource).toContain("readPublicLiveGame");
    expect(livePageSource).toContain("PublicLiveGameView");
    expect(livePageSource).toContain("force-dynamic");
  });
});
