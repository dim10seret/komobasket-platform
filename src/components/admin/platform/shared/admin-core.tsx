"use client";

import type { ReactNode } from "react";
import type { FormEvent } from "react";

export type Row = Record<string, string | number | null>;
export type Snapshot = {
  mode: "preview" | "database";
  organizationContext: {
    organizationId: string;
    slug: string;
    name: string;
    logoUrl: string | null;
    role: "super_admin" | "admin" | "viewer";
  };
  seasons: Row[];
  competitions: Row[];
  teams: Row[];
  players: Row[];
  participations: Row[];
  rosters: Row[];
  movements: Row[];
  phases: Row[];
  phaseSchedules: Row[];
  seriesPlanningSlots: Row[];
  games: Row[];
  competitionVenues: Row[];
  counts: { seasons:number; competitions:number; teams:number; players:number };
};

export const inputClass = "rounded-xl border border-zinc-300 bg-white px-3 py-2.5 text-zinc-950 outline-none transition focus:border-orange-500 focus:ring-2 focus:ring-orange-100";
export const buttonClass = "rounded-xl bg-orange-600 px-4 py-2.5 font-black text-white transition hover:bg-orange-700 disabled:opacity-50";

export type AdminView = "home" | "news" | "platform";

export type TeamRosterViewRole = "head_coach" | "assistant_coach" | "trainer" | "physiotherapist" | "doctor" | "team_manager" | "team_official" | "other";
export const staffRoleLabels: Record<TeamRosterViewRole, string> = {
  head_coach: "Προπονητής",
  assistant_coach: "Βοηθός Προπονητή",
  trainer: "Γυμναστής",
  physiotherapist: "Φυσικοθεραπευτής",
  doctor: "Ιατρός",
  team_manager: "Team Manager",
  team_official: "Έφορος",
  other: "Άλλο",
};

export type TeamRosterAthlete = {
  roster_id: string;
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  photo_url: string | null;
  birth_date: string | null;
  shirt_number: number | null;
};

export type TeamRosterStaff = {
  membership_id: string;
  staff_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  photo_url: string | null;
  birth_date: string | null;
  role: TeamRosterViewRole | string;
  custom_role_label: string | null;
};

export type PreviousRosterInfo = {
  seasonId: string | null;
  seasonName: string | null;
  targetAthleteRosterExists: boolean;
  targetAthleteCount: number;
  targetStaffRosterExists: boolean;
  targetStaffCount: number;
  previousAthleteCount: number;
  previousStaffCount: number;
};

export type TeamRosterManagementView = {
  seasonId: string;
  seasonName: string;
  competitionId: string;
  competitionName: string;
  teamId: string;
  teamName: string;
  athletes: TeamRosterAthlete[];
  staff: TeamRosterStaff[];
  previousRoster: PreviousRosterInfo;
};

export type TeamRosterAthleteWithIndex = TeamRosterAthlete & { rowIndex: number };
export type TeamRosterStaffWithIndex = TeamRosterStaff & { rowIndex: number };

export type SearchAthleteResult = {
  player_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string;
  birth_date: string | null;
  last_team_name: string | null;
  last_season_name: string | null;
  career_history: {
    season_name: string;
    team_name: string;
    competition_name: string | null;
    season_year_key: number | null;
  }[];
};

export type SearchStaffResult = {
  staff_id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  birth_date: string | null;
  last_team_name: string | null;
  last_season_name: string | null;
};

export type RosterActionKind = "athlete" | "staff";

export type SortDirection = "asc" | "desc";
export type SortState = {
  key: "first_name" | "last_name" | "birth_date" | "shirt_number" | "staff_first_name" | "staff_last_name" | "staff_role";
  direction: SortDirection;
};

export type UpdateEntity = (resource:string,id:string,event:FormEvent<HTMLFormElement>,successMessage:string)=>Promise<boolean>;
export type DeleteEntity = (resource:string,id:string,successMessage:string)=>Promise<boolean>;
export type CreateEntity = (resource:string,input:Record<string, unknown>)=>Promise<boolean>;

export type CompetitionWorkspaceMode = "settings" | "phases" | "program";

export type StandingsRuleSettings = {
  pointsForWin: number;
  pointsForLoss: number;
  forfeitPoints: number;
  gamesPerPairing: number;
  tieBreakers: string[];
};

type TeamParticipationRow = {
  team_name: string | null;
  team_id: string | null;
};

export const seasonStatusLabels:Record<string, string> = {
  draft: "Under Construction",
  active: "Online",
  completed: "Complete",
};

export const competitionLifecycleLabels:Record<string, string> = {
  under_construction: "Under Construction",
  online: "Online",
  complete: "Published",
};

export const scheduleLifecycleLabels:Record<string, string> = {
  draft: "Πρόχειρο",
  published: "Δημοσιευμένο",
};

export const competitionTypeLabels:Record<string, string> = {
  league: "Πρωτάθλημα",
  cup: "Κύπελλο",
  tournament: "Τουρνουά",
  custom: "Custom",
};

export const getCompetitionTypeLabel = (type:string | null | undefined, customTypeLabel?: string | null) => {
  const trimmedCustom = String(customTypeLabel ?? "").trim();
  if (trimmedCustom) return trimmedCustom;
  const typeKey = String(type ?? "").trim();
  return competitionTypeLabels[typeKey] ?? (typeKey || "—");
};

export const phaseFormatLabels:Record<string, string> = {
  standings: "Βαθμολογική",
  series: "Σειρά αγώνων",
  custom: "Custom",
};

export const phaseFormatOptions = [
  { value: "standings", label: "Βαθμολογική" },
  { value: "series", label: "Σειρά αγώνων" },
] as const;

export const phaseFormatLabel = (value: string | number | null) => {
  const key = String(value ?? "");
  return phaseFormatLabels[key as keyof typeof phaseFormatLabels] ?? (key || "—");
};

export const standingsTieBreakerLabel: Record<string, string> = {
  head_to_head: "Μεταξύ τους αποτελέσματα",
  head_to_head_point_diff: "Διαφορά πόντων μεταξύ ισόβαθμων",
  overall_point_diff: "Συνολική διαφορά πόντων",
  points_for: "Πόντοι υπέρ",
  alphabetical: "Αλφαβητικά",
};

export const normalizeStandingsTieBreakers = (value: unknown) => {
  const preferred = Array.isArray(value) ? value : [];
  const allowed = ["head_to_head", "head_to_head_point_diff", "overall_point_diff", "points_for", "alphabetical"];
  const allowedSet = new Set(allowed);
  const normalized = preferred
    .map((item) => String(item ?? "").trim())
    .filter((valueItem) => valueItem && allowedSet.has(valueItem))
    .filter((valueItem, index, list) => list.indexOf(valueItem) === index);
  const withoutAlphabetical = normalized.filter((valueItem) => valueItem !== "alphabetical");
  return [...withoutAlphabetical, "alphabetical"];
};

export const parseStandingsRules = (raw: unknown): StandingsRuleSettings => {
  const parsed = typeof raw === "string" ? raw : "";
  const fallback: StandingsRuleSettings = {
    pointsForWin: 2,
    pointsForLoss: 1,
    forfeitPoints: 0,
    gamesPerPairing: 1,
    tieBreakers: ["head_to_head", "head_to_head_point_diff", "overall_point_diff", "points_for", "alphabetical"],
  };
  if (!parsed.trim()) return fallback;
  try {
    const parsedJson = JSON.parse(parsed) as Record<string, unknown>;
    const toInt = (value: unknown, minimum: number) => {
      const candidate = Number(value);
      if (!Number.isFinite(candidate) || !Number.isInteger(candidate)) return minimum;
      return Math.max(minimum, candidate);
    };
    return {
      pointsForWin: toInt(parsedJson.pointsForWin ?? parsedJson.winPoints, 0),
      pointsForLoss: toInt(parsedJson.pointsForLoss ?? parsedJson.lossPoints, 0),
      forfeitPoints: toInt(parsedJson.forfeitPoints, 0),
      gamesPerPairing: toInt(parsedJson.gamesPerPairing, 1),
      tieBreakers: Array.isArray(parsedJson.tieBreakers)
        ? parsedJson.tieBreakers.filter((item: unknown) =>
            ["head_to_head", "head_to_head_point_diff", "overall_point_diff", "points_for", "alphabetical"].includes(String(item)),
          ) as string[]
        : fallback.tieBreakers,
    };
  } catch {
    return fallback;
  }
};

export const roundRobinStructureFromTeams = (teamCount: number, gamesPerPairing: number) => {
  if (teamCount <= 0) {
    return { rounds: 0, gamesPerRound: 0, byesPerRound: 0, totalGames: 0 };
  }
  const baseRounds = teamCount % 2 === 0 ? teamCount - 1 : teamCount;
  const rounds = baseRounds * Math.max(1, Math.floor(gamesPerPairing || 1));
  const byesPerRound = teamCount % 2 === 0 ? 0 : 1;
  const uniquePairings = (teamCount * (teamCount - 1)) / 2;
  const gamesPerPairingSafe = Math.max(1, Math.floor(gamesPerPairing || 1));
  return {
    rounds,
    gamesPerRound: Math.floor(teamCount / 2),
    byesPerRound,
    totalGames: Math.round(uniquePairings * gamesPerPairingSafe),
  };
};

export const getCompetitionTeamsForStandings = (data: Snapshot, competitionId: string) => {
  const seen = new Set<string>();
  const teams: TeamParticipationRow[] = [];
  for (const participation of data.participations) {
    if (String(participation.competition_id ?? "") !== competitionId) continue;
    const teamId = String(participation.team_id ?? "").trim();
    if (!teamId || seen.has(teamId)) continue;
    seen.add(teamId);
    teams.push({
      team_id: teamId,
      team_name: String(participation.team_name ?? participation.display_name ?? "—"),
    });
  }
  return teams.sort((a, b) => String(a.team_name ?? "").localeCompare(String(b.team_name ?? ""), "el-GR"));
};

export const participationStatusLabels:Record<string, string> = {
  active: "Ενεργή",
  inactive: "Ανενεργή",
  withdrawn: "Αποχώρησε",
};
export const COMPLETED_COMPETITION_STATUSES = new Set(["complete", "completed", "finished"]);
export const isCompletedCompetition = (status:string) => COMPLETED_COMPETITION_STATUSES.has(String(status).toLowerCase().trim());

export function Field({ label, children }: { label:string; children:ReactNode }) {
  return <label className="grid gap-1.5 text-sm font-bold text-zinc-700"><span>{label}</span>{children}</label>;
}

export function Panel({ title, description, children }: { title:string; description?:string; children:ReactNode }) {
  return <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
    <h2 className="text-xl font-black text-zinc-950">{title}</h2>
    {description && <p className="mt-1 text-sm text-zinc-600">{description}</p>}
    <div className="mt-5">{children}</div>
  </section>;
}

export function SimpleTable({ rows, columns, empty="Δεν υπάρχουν ακόμη εγγραφές." }: { rows:Row[]; columns:[string,string][]; empty?:string }) {
  if (!rows.length) return <p className="rounded-xl bg-zinc-50 p-4 text-sm text-zinc-500">{empty}</p>;
  return <div className="overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm">
    <thead className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500"><tr>{columns.map(([key,label]) => <th key={key} className="px-3 py-3">{label}</th>)}</tr></thead>
    <tbody>{rows.map((row,index) => <tr key={String(row.id ?? index)} className="border-b border-zinc-100 last:border-0">{columns.map(([key]) => <td key={key} className="px-3 py-3 text-zinc-700">{String(row[key] ?? "—")}</td>)}</tr>)}</tbody>
  </table></div>;
}

export function parseDateForDisplay(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function compareNullable(a:string|number|null|undefined,b:string|number|null|undefined,direction:SortDirection) {
  const left = a ?? "";
  const right = b ?? "";
  if (left === right) return 0;
  const value = String(left).localeCompare(String(right), "el-GR", { sensitivity: "base", numeric: true });
  return direction === "asc" ? value : -value;
}

export function clearBlobPreviewUrl(previewUrl: string) {
  if (previewUrl && previewUrl.startsWith("blob:")) {
    URL.revokeObjectURL(previewUrl);
  }
}
