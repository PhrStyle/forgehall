-- Retries wait before running again instead of looping.
ALTER TABLE runs ADD COLUMN not_before timestamptz;
