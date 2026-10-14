-- Runs report liveness; the bus fails runs whose runner went silent.
ALTER TABLE runs ADD COLUMN heartbeat_at timestamptz;
CREATE INDEX runs_running ON runs(state, heartbeat_at) WHERE state = 'running';
