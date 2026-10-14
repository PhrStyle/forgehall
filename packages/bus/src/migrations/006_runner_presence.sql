-- When each agent's runner last asked for work: shows whether anyone will pick up its runs.
ALTER TABLE agents ADD COLUMN runner_seen_at timestamptz;
