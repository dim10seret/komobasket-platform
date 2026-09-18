type PlayerRow = {
  id?: unknown;
  player_id?: unknown;
  display_name?: unknown;
  birth_date?: unknown;
};

type RosterRow = {
  player_id?: unknown;
  season_id?: unknown;
  competition_id?: unknown;
  status?: unknown;
};

const text = (value: unknown) => String(value ?? "").trim();

export function selectEligibleAdditionPlayers(
  players: PlayerRow[],
  rosters: RosterRow[],
  seasonId: string,
  competitionId: string,
) {
  if (!seasonId || !competitionId) return [];
  const activePlayerIds = new Set(rosters
    .filter((roster) => (
      text(roster.season_id) === seasonId
      && text(roster.competition_id) === competitionId
      && text(roster.status) === "active"
    ))
    .map((roster) => text(roster.player_id))
    .filter(Boolean));

  return players
    .filter((player) => {
      const playerId = text(player.player_id ?? player.id);
      return Boolean(playerId) && !activePlayerIds.has(playerId);
    })
    .sort((left, right) => text(left.display_name).localeCompare(text(right.display_name), "el-GR", {
      sensitivity: "base",
      numeric: true,
    }));
}
