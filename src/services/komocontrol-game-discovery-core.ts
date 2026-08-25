export type PublishedGamePackageRow = {
  id: string;
  game_id: string;
  organization_id: string;
  package_version: number;
  status: string;
  snapshot_json: string;
  published_at: string;
};

export type KomoControlAvailableGame = {
  gameId: string;
  packageId: string;
  packageVersion: number;
  homeTeam: { id: string; name: string };
  awayTeam: { id: string; name: string };
  competition: { id: string; name: string };
  seasonName: string;
  phaseName: string | null;
  roundLabel: string | null;
  scheduledDate: string;
  scheduledTime: string;
  scheduledAt: string | null;
  venue: string | null;
  publishedAt: string;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error("Malformed published GamePackage snapshot.");
  return value.trim();
}

function optionalText(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  return requiredText(value);
}

function team(value: unknown, expectedSide: "HOME" | "AWAY") {
  const item = record(value);
  if (!item || item.side !== expectedSide) throw new Error("Malformed published GamePackage Team snapshot.");
  return { id: requiredText(item.id), name: requiredText(item.name) };
}

function projectPackage(row: PublishedGamePackageRow, organizationId: string): KomoControlAvailableGame {
  if (row.status !== "published" || row.organization_id !== organizationId || !Number.isInteger(row.package_version) || row.package_version < 1) throw new Error("Invalid published GamePackage row.");
  let snapshot: unknown;
  try { snapshot = JSON.parse(row.snapshot_json); } catch { throw new Error("Malformed published GamePackage snapshot."); }
  const root = record(snapshot); const game = record(root?.game); const teams = Array.isArray(root?.teams) ? root.teams : [];
  if (!game || requiredText(game.id) !== row.game_id || requiredText(game.organizationId) !== organizationId) throw new Error("Published GamePackage authority mismatch.");
  const home = teams.filter((item) => record(item)?.side === "HOME"); const away = teams.filter((item) => record(item)?.side === "AWAY");
  if (home.length !== 1 || away.length !== 1) throw new Error("Malformed published GamePackage participants.");
  const scheduledDate = requiredText(game.scheduledDate); const scheduledTime = requiredText(game.scheduledTime);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(scheduledDate) || !/^\d{2}:\d{2}(?::\d{2})?$/.test(scheduledTime)) throw new Error("Malformed published GamePackage schedule.");
  return {
    gameId: row.game_id, packageId: requiredText(row.id), packageVersion: row.package_version,
    homeTeam: team(home[0], "HOME"), awayTeam: team(away[0], "AWAY"),
    competition: { id: requiredText(game.competitionId), name: requiredText(game.competitionName) },
    seasonName: requiredText(game.seasonName), phaseName: optionalText(game.phaseName), roundLabel: optionalText(game.roundLabel),
    scheduledDate, scheduledTime, scheduledAt: optionalText(game.scheduledAt), venue: optionalText(game.venue), publishedAt: requiredText(row.published_at),
  };
}

export function projectAvailableGames(rows: PublishedGamePackageRow[], organizationId: string): KomoControlAvailableGame[] {
  const games = rows.filter((row) => row.organization_id === organizationId && row.status === "published").map((row) => projectPackage(row, organizationId));
  const ids = new Set<string>();
  for (const game of games) { if (ids.has(game.gameId)) throw new Error("Multiple current published GamePackages found."); ids.add(game.gameId); }
  return games.sort((left, right) => left.scheduledDate.localeCompare(right.scheduledDate) || left.scheduledTime.localeCompare(right.scheduledTime) || left.gameId.localeCompare(right.gameId));
}
