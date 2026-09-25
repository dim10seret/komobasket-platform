export type AdministrativeGameResultProjectionRow = {
  home_score: number | string | null;
  away_score: number | string | null;
  status: string | null;
  result_source: string | null;
  administrative_result_id?: string | null;
  administrative_home_score?: number | string | null;
  administrative_away_score?: number | string | null;
};

export function projectAdministrativeGameResult<T extends AdministrativeGameResultProjectionRow>(row: T) {
  const recorded = {
    recorded_home_score: row.home_score,
    recorded_away_score: row.away_score,
    recorded_status: row.status,
    recorded_result_source: row.result_source,
  };
  if (!String(row.administrative_result_id ?? "").trim()) return { ...row, ...recorded };
  return {
    ...row,
    ...recorded,
    home_score: row.administrative_home_score ?? null,
    away_score: row.administrative_away_score ?? null,
    status: "completed",
    result_source: "administrative",
  };
}
