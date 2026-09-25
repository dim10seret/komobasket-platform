import "server-only";

import type { D1DatabaseBinding } from "@/types/cloudflare";

export type AdministrativeGameResultDecisionType = "correction" | "interruption";

export type SaveAdministrativeGameResultInput = {
  gameId: string;
  competitionId: string;
  decisionType: AdministrativeGameResultDecisionType;
  homeScore: unknown;
  awayScore: unknown;
  homeStandingsPointsOverride?: unknown;
  awayStandingsPointsOverride?: unknown;
  homeStandingsPointsOverrideProvided?: boolean;
  awayStandingsPointsOverrideProvided?: boolean;
  reason: unknown;
  expectedUpdatedAt?: unknown;
  scopeOrganizationId?: string;
};

type Row = Record<string, unknown>;

const entityId = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;

function nonNegativeInteger(value: unknown, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Το πεδίο «${label}» πρέπει να είναι ακέραιος μη αρνητικός αριθμός.`);
  }
  return parsed;
}

function optionalNonNegativeInteger(value: unknown, label: string) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  return nonNegativeInteger(value, label);
}

function nextAdministrativeResultUpdatedAt(existingUpdatedAt: unknown): string {
  const now = Date.now();
  const existing =
    typeof existingUpdatedAt === "string" ? Date.parse(existingUpdatedAt) : Number.NaN;

  return new Date(Number.isFinite(existing) ? Math.max(now, existing + 1) : now).toISOString();
}

export async function saveAdministrativeGameResultWithDb(
  db: D1DatabaseBinding,
  input: SaveAdministrativeGameResultInput,
  actorEmail: string,
) {
  const gameId = String(input.gameId ?? "").trim();
  const competitionId = String(input.competitionId ?? "").trim();
  const actor = String(actorEmail ?? "").trim();
  if (!gameId || !competitionId) throw new Error("Λείπει ο αγώνας ή η διοργάνωση.");
  if (!actor) throw new Error("Δεν αναγνωρίστηκε ο χειριστής της διοικητικής απόφασης.");

  const current = await db.prepare(`
    SELECT g.id, g.competition_id, g.phase_id, g.home_team_id, g.away_team_id,
      g.home_score, g.away_score, g.status, g.result_source,
      c.organization_id, p.format AS phase_format
    FROM league_games g
    JOIN league_competitions c ON c.id=g.competition_id
    LEFT JOIN league_phases p ON p.id=g.phase_id AND p.competition_id=g.competition_id
    WHERE g.id=? AND g.competition_id=?
  `).bind(gameId, competitionId).first<Row>();
  if (!current) throw new Error("Δεν βρέθηκε ο αγώνας στη συγκεκριμένη διοργάνωση.");
  if (current.phase_id && !current.phase_format) throw new Error("Ο αγώνας δεν αντιστοιχεί σε έγκυρη φάση της διοργάνωσης.");

  const organizationId = String(current.organization_id ?? "").trim();
  const scopeOrganizationId = String(input.scopeOrganizationId ?? "").trim();
  if (!organizationId || (scopeOrganizationId && scopeOrganizationId !== organizationId)) {
    throw new Error("Ο αγώνας δεν ανήκει στον επιλεγμένο οργανισμό.");
  }

  const existing = await db.prepare(`SELECT * FROM league_game_administrative_results
    WHERE game_id=? AND organization_id=?`).bind(gameId, organizationId).first<Row>();
  const decisionType = input.decisionType;
  if (!(["correction", "interruption"] as const).includes(decisionType)) {
    throw new Error("Ο τύπος διοικητικής απόφασης δεν είναι έγκυρος.");
  }
  if (decisionType === "correction" && String(current.status ?? "") !== "completed" && !existing) {
    throw new Error("Για μη ολοκληρωμένο αγώνα χρησιμοποιήστε οριστικό κλείσιμο λόγω διακοπής.");
  }
  if (decisionType === "interruption" && String(current.status ?? "") === "completed" && !existing) {
    throw new Error("Ο ολοκληρωμένος αγώνας διορθώνεται ως επίσημο αποτέλεσμα και όχι ως διακοπή.");
  }

  const homeScore = nonNegativeInteger(input.homeScore, "Επίσημο σκορ γηπεδούχου");
  const awayScore = nonNegativeInteger(input.awayScore, "Επίσημο σκορ φιλοξενούμενου");
  if (homeScore === awayScore) throw new Error("Το επίσημο αποτέλεσμα δεν μπορεί να είναι ισόπαλο.");

  const reason = String(input.reason ?? "").trim();
  if (!reason) throw new Error("Η αιτία ή οι παρατηρήσεις είναι υποχρεωτικές.");
  if (reason.length > 2000) throw new Error("Η αιτία ή οι παρατηρήσεις δεν μπορούν να υπερβαίνουν τους 2000 χαρακτήρες.");

  const homePoints = input.homeStandingsPointsOverrideProvided
    ? optionalNonNegativeInteger(input.homeStandingsPointsOverride, "Βαθμοί γηπεδούχου")
    : existing?.home_standings_points_override === undefined
      ? null
      : optionalNonNegativeInteger(existing.home_standings_points_override, "Βαθμοί γηπεδούχου");
  const awayPoints = input.awayStandingsPointsOverrideProvided
    ? optionalNonNegativeInteger(input.awayStandingsPointsOverride, "Βαθμοί φιλοξενούμενου")
    : existing?.away_standings_points_override === undefined
      ? null
      : optionalNonNegativeInteger(existing.away_standings_points_override, "Βαθμοί φιλοξενούμενου");
  if (String(current.phase_format ?? "") !== "standings" && (homePoints !== null || awayPoints !== null)) {
    throw new Error("Οι ειδικοί βαθμοί επιτρέπονται μόνο σε βαθμολογική φάση.");
  }

  const expectedUpdatedAt = String(input.expectedUpdatedAt ?? "").trim();
  if (existing && expectedUpdatedAt && expectedUpdatedAt !== String(existing.updated_at ?? "")) {
    throw new Error("Η διοικητική απόφαση άλλαξε ταυτόχρονα. Ανανεώστε τα δεδομένα και δοκιμάστε ξανά.");
  }

  const id = String(existing?.id ?? entityId("administrative_result"));
  const now = nextAdministrativeResultUpdatedAt(existing?.updated_at);
  const before = existing ? {
    decisionType: existing.decision_type,
    homeScore: existing.official_home_score,
    awayScore: existing.official_away_score,
    homeStandingsPointsOverride: existing.home_standings_points_override,
    awayStandingsPointsOverride: existing.away_standings_points_override,
    reason: existing.reason,
    updatedAt: existing.updated_at,
  } : null;
  const after = {
    decisionType,
    homeScore,
    awayScore,
    homeStandingsPointsOverride: homePoints,
    awayStandingsPointsOverride: awayPoints,
    reason,
    updatedAt: now,
  };

  const mutation = existing
    ? db.prepare(`UPDATE league_game_administrative_results SET
        decision_type=?, official_home_score=?, official_away_score=?,
        home_standings_points_override=?, away_standings_points_override=?,
        reason=?, updated_by_email=?, updated_at=?
      WHERE game_id=? AND organization_id=? AND updated_at=?`)
      .bind(decisionType, homeScore, awayScore, homePoints, awayPoints, reason, actor, now,
        gameId, organizationId, existing.updated_at)
    : db.prepare(`INSERT INTO league_game_administrative_results
        (id,organization_id,game_id,decision_type,official_home_score,official_away_score,
         home_standings_points_override,away_standings_points_override,reason,
         created_by_email,updated_by_email,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(id, organizationId, gameId, decisionType, homeScore, awayScore,
        homePoints, awayPoints, reason, actor, actor, now, now);

  const results = await db.batch([
    mutation,
    db.prepare(`INSERT INTO league_audit_log
      (id,actor_email,action,entity_type,entity_id,details_json,created_at)
      SELECT ?,?,?,?,?,?,? WHERE changes()=1`)
      .bind(entityId("audit"), actor, "administrative_official_result", "games", gameId,
        JSON.stringify({ before, after, recordedResult: {
          homeScore: current.home_score,
          awayScore: current.away_score,
          status: current.status,
          resultSource: current.result_source,
        } }), now),
  ]);
  const changes = Number((results[0] as { meta?: { changes?: number } })?.meta?.changes ?? 0);
  if (changes !== 1) throw new Error("Η διοικητική απόφαση άλλαξε ταυτόχρονα. Ανανεώστε τα δεδομένα και δοκιμάστε ξανά.");

  const saved = await db.prepare(`SELECT * FROM league_game_administrative_results
    WHERE game_id=? AND organization_id=?`).bind(gameId, organizationId).first<Row>();
  if (!saved) throw new Error("Η διοικητική απόφαση δεν αποθηκεύτηκε.");
  return saved;
}
