ALTER TABLE league_games ADD COLUMN result_source TEXT
  CHECK (result_source IS NULL OR result_source IN ('manual','match_report','award'));
