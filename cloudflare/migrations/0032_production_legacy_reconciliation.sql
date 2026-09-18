-- Reconcile the known central KomoBasket production dataset imported before
-- scheduling and phase lifecycle metadata became canonical.

UPDATE league_games
SET
  scheduled_date = substr(scheduled_at, 1, 10),
  scheduled_time = substr(scheduled_at, 12, 5)
WHERE competition_id IN (
    'competition_2024-25_league',
    'competition_2024-25_cup',
    'competition_2025-26_league',
    'competition_2025-26_cup'
  )
  AND scheduled_at IS NOT NULL
  AND scheduled_date IS NULL
  AND scheduled_time IS NULL;

UPDATE league_phases
SET
  lifecycle_status = 'finalized',
  finalized_at = CASE id
    WHEN 'phase_competition-2024-25-league_κανονικη-περιοδος'
      THEN '2025-02-16T19:15:00'
    WHEN 'phase_competition-2025-26-league_κανονικη-περιοδος'
      THEN '2026-03-15T19:15:00'
    ELSE NULL
  END
WHERE id IN (
  'phase_competition-2024-25-cup_φαση-των-16',
  'phase_competition-2024-25-cup_προημιτελικα',
  'phase_competition-2024-25-cup_ημιτελικα',
  'phase_competition-2024-25-cup_τελικος',
  'phase_competition-2024-25-league_κανονικη-περιοδος',
  'phase_competition-2024-25-league_final-four-ημιτελικος',
  'phase_competition-2024-25-league_final-four-τελικος',
  'phase_competition-2025-26-cup_φαση-των-16',
  'phase_competition-2025-26-cup_φαση-των-8',
  'phase_competition-2025-26-cup_final4-κυπελλου',
  'phase_competition-2025-26-cup_τελικος',
  'phase_competition-2025-26-league_play-out-5-12',
  'phase_competition-2025-26-league_κανονικη-περιοδος',
  'phase_competition-2025-26-league_φαση-των-8',
  'phase_competition-2025-26-league_final-four-ημιτελικος',
  'phase_competition-2025-26-league_final-four-μικρος-τελικος',
  'phase_competition-2025-26-league_final-four-τελικος'
);

UPDATE league_phases
SET
  lifecycle_status = 'active',
  finalized_at = NULL
WHERE id IN (
  'phase_competition-2024-25-league_play-out-5-12',
  'phase_competition-2024-25-league_φαση-των-8'
);
