-- Machine-wide settings and tool permission requests answered by the user.

CREATE TABLE settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- Agents run isolated (Docker) by default; runners on the host are refused unless allowed.
INSERT INTO settings (key, value) VALUES ('allow_host_runners', 'false');

ALTER TABLE runs ADD COLUMN runner_mode text;  -- container | host

CREATE TABLE permission_requests (
  id            bigserial PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id),
  agent_id      text NOT NULL,
  run_id        bigint REFERENCES runs(id),
  thread_id     text REFERENCES threads(id),
  tool_name     text NOT NULL,
  input         jsonb NOT NULL,
  rule          text NOT NULL,                 -- the rule "Always allow" would add, e.g. Bash(npm install *)
  state         text NOT NULL DEFAULT 'pending', -- pending | allowed | denied | expired
  remember      boolean NOT NULL DEFAULT false,
  reason        text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);
CREATE INDEX permission_requests_pending ON permission_requests(workspace_id, state) WHERE state = 'pending';
