-- Root phases optionally carry the presentation name of their Tournament tree.
-- Descendants resolve this metadata dynamically through previous_phase_id.
ALTER TABLE league_phases ADD COLUMN tournament_name TEXT;
