-- The supervisor (`fh supervise`, on the host) starts and stops agent containers to match what
-- the user wants. The bus only stores that wish; it never touches Docker.

ALTER TABLE agents ADD COLUMN desired_state text NOT NULL DEFAULT 'running';   -- running | stopped
ALTER TABLE agents ADD COLUMN restart_requested_at timestamptz;              -- console "Restart"
ALTER TABLE agents ADD COLUMN container_state text;                          -- as last seen by the supervisor
ALTER TABLE agents ADD COLUMN container_detail text;                         -- e.g. why it could not start
ALTER TABLE agents ADD COLUMN container_seen_at timestamptz;

ALTER TABLE agents ADD CONSTRAINT agents_desired_state CHECK (desired_state IN ('running', 'stopped'));

-- When the supervisor last reported, so the console can tell whether one is running.
INSERT INTO settings (key, value) VALUES ('supervisor_seen_at', 'null') ON CONFLICT (key) DO NOTHING;
