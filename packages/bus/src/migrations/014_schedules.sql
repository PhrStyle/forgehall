-- Schedules: the bus opens a thread for an agent when one is due (docs/concepts/schedules.md).

CREATE TABLE schedules (
  id                text PRIMARY KEY,
  workspace_id      text NOT NULL REFERENCES workspaces(id),
  agent_id          text NOT NULL,
  title             text NOT NULL,
  prompt            text NOT NULL,
  repo_id           text,
  rule              jsonb NOT NULL,              -- ScheduleRule from @forgehall/shared
  timezone          text NOT NULL,
  thread_mode       text NOT NULL DEFAULT 'new', -- new | same
  skip_if_open      boolean NOT NULL DEFAULT true,
  skip_usage_above  real,                        -- 0..1 of the 7-day window, null = never skip
  enabled           boolean NOT NULL DEFAULT true,
  next_run_at       timestamptz,                 -- null when disabled or a past one-off
  same_thread_id    text REFERENCES threads(id), -- thread_mode same: the recurring thread
  created_at        timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, agent_id) REFERENCES agents(workspace_id, id) ON DELETE CASCADE,
  FOREIGN KEY (workspace_id, repo_id) REFERENCES repos(workspace_id, id),
  CONSTRAINT schedules_thread_mode CHECK (thread_mode IN ('new', 'same'))
);
CREATE INDEX schedules_due ON schedules(next_run_at) WHERE enabled;

-- Every time a schedule came due (or was run by hand): the thread it opened, or why it was skipped.
CREATE TABLE schedule_runs (
  id            bigserial PRIMARY KEY,
  schedule_id   text NOT NULL REFERENCES schedules(id) ON DELETE CASCADE,
  due_at        timestamptz NOT NULL,
  manual        boolean NOT NULL DEFAULT false,
  thread_id     text REFERENCES threads(id),
  skipped       text,                            -- reason when skipped
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX schedule_runs_by_schedule ON schedule_runs(schedule_id, due_at DESC);
