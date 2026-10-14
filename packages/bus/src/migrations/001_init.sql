-- F1: workspaces, agents, threads, messages, runs and engine usage.

CREATE TABLE workspaces (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  config      jsonb NOT NULL DEFAULT '{}'
);

CREATE TABLE agents (
  workspace_id  text NOT NULL REFERENCES workspaces(id),
  id            text NOT NULL,
  name          text NOT NULL,
  role          text NOT NULL DEFAULT '',
  default_model text NOT NULL DEFAULT 'sonnet',
  accepts_from  text[] NOT NULL DEFAULT '{}',   -- empty = anyone in the workspace
  token_hash    text,                           -- sha256 of the runner/MCP token
  config        jsonb NOT NULL DEFAULT '{}',
  PRIMARY KEY (workspace_id, id)
);
CREATE UNIQUE INDEX agents_token_hash ON agents(token_hash) WHERE token_hash IS NOT NULL;

CREATE SEQUENCE thread_seq;

CREATE TABLE threads (
  id            text PRIMARY KEY DEFAULT 'THR-' || lpad(nextval('thread_seq')::text, 4, '0'),
  workspace_id  text NOT NULL REFERENCES workspaces(id),
  title         text NOT NULL,
  state         text NOT NULL DEFAULT 'open',
  severity      text,
  flags         jsonb NOT NULL DEFAULT '{}',   -- e.g. {"escalate": {"atlas": "motivo"}}
  created_by    text NOT NULL,
  assignee      text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX threads_ws_state ON threads(workspace_id, state);

CREATE TABLE runs (
  id                  bigserial PRIMARY KEY,
  workspace_id        text NOT NULL,
  agent_id            text NOT NULL,
  thread_id           text NOT NULL REFERENCES threads(id),
  model               text NOT NULL,
  effort              text NOT NULL,
  route_reason        text NOT NULL,
  priority            int  NOT NULL DEFAULT 5,   -- lower runs first
  state               text NOT NULL DEFAULT 'queued',  -- queued | running | done | failed
  session_id          text,
  queued_at           timestamptz NOT NULL DEFAULT now(),
  started_at          timestamptz,
  ended_at            timestamptz,
  input_tokens        bigint NOT NULL DEFAULT 0,
  output_tokens       bigint NOT NULL DEFAULT 0,
  cost_usd            numeric(12,6) NOT NULL DEFAULT 0,
  error               text,
  FOREIGN KEY (workspace_id, agent_id) REFERENCES agents(workspace_id, id)
);
CREATE INDEX runs_queue ON runs(workspace_id, agent_id, state, priority, queued_at);

CREATE TABLE messages (
  id            bigserial PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id),
  thread_id     text NOT NULL REFERENCES threads(id),
  type          text NOT NULL,
  from_actor    text NOT NULL,
  to_actor      text NOT NULL,
  body          text NOT NULL,
  outcome       text,
  reply_to      bigint REFERENCES messages(id),
  delivered_run bigint REFERENCES runs(id),     -- run whose prompt carried this message
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_thread ON messages(thread_id, id);
CREATE INDEX messages_pending ON messages(workspace_id, to_actor) WHERE delivered_run IS NULL;

CREATE TABLE sessions (
  thread_id     text NOT NULL REFERENCES threads(id),
  workspace_id  text NOT NULL,
  agent_id      text NOT NULL,
  session_id    text NOT NULL,
  PRIMARY KEY (thread_id, agent_id)
);

CREATE TABLE run_events (
  run_id   bigint NOT NULL REFERENCES runs(id),
  seq      int    NOT NULL,
  ts       timestamptz NOT NULL DEFAULT now(),
  kind     text   NOT NULL,
  payload  jsonb  NOT NULL,
  PRIMARY KEY (run_id, seq)
);

CREATE TABLE account_usage (
  workspace_id        text PRIMARY KEY,           -- F1: one account per workspace
  five_hour           real,
  five_hour_resets_at timestamptz,
  seven_day           real,
  seven_day_resets_at timestamptz,
  status              text,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
