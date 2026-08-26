PRAGMA foreign_keys = ON;

DROP TRIGGER IF EXISTS local_game_run_configurations_pre_engine_update;

CREATE TRIGGER IF NOT EXISTS local_game_run_configurations_active_update
BEFORE UPDATE ON local_game_run_configurations
FOR EACH ROW
WHEN NOT EXISTS (
    SELECT 1
    FROM local_game_runs
    WHERE run_id = NEW.run_id
      AND status = 'active'
      AND (
          (started_at_utc IS NULL AND last_accepted_sequence = 0)
          OR (started_at_utc IS NOT NULL AND last_accepted_sequence >= 1)
      )
)
BEGIN
    SELECT RAISE(ABORT, 'configuration requires a consistent active Run');
END;
