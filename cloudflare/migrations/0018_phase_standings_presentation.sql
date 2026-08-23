CREATE TABLE league_phase_standings_presentation (
  phase_id TEXT NOT NULL REFERENCES league_phases(id) ON DELETE CASCADE,
  category TEXT NOT NULL CHECK (category IN ('direct_qualification','play_out','eliminated')),
  position INTEGER NOT NULL CHECK (position >= 1),
  PRIMARY KEY (phase_id, category, position),
  UNIQUE (phase_id, position)
);

CREATE INDEX idx_phase_standings_presentation_phase
  ON league_phase_standings_presentation(phase_id, category, position);
