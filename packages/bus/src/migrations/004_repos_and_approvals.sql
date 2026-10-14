-- Repositories agents work on, the branch of each thread, and approvals.

ALTER TABLE workspaces ADD COLUMN approval_policy text NOT NULL DEFAULT 'merge';  -- merge | pull_request | branch_only

CREATE TABLE repos (
  workspace_id  text NOT NULL REFERENCES workspaces(id),
  id            text NOT NULL,                 -- short name, e.g. checkout-app
  upstream_url  text NOT NULL,                 -- where approved work is published (local path or git URL)
  provider      text NOT NULL DEFAULT 'local', -- local | github | azure-devops
  base_branch   text NOT NULL DEFAULT 'main',
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

ALTER TABLE threads ADD COLUMN repo_id text;
ALTER TABLE threads ADD COLUMN branch text;
ALTER TABLE threads ADD FOREIGN KEY (workspace_id, repo_id) REFERENCES repos(workspace_id, id);

CREATE TABLE approvals (
  id            bigserial PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id),
  thread_id     text NOT NULL REFERENCES threads(id),
  policy        text NOT NULL,                  -- policy in force when requested
  requested_by  text NOT NULL,
  summary       text NOT NULL,
  head_sha      text NOT NULL,                  -- branch commit the user is asked to approve
  state         text NOT NULL DEFAULT 'pending', -- pending | approved | rejected | superseded
  comment       text,
  result        jsonb,                          -- e.g. {"merged": "<sha>"}
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz
);
CREATE INDEX approvals_pending ON approvals(workspace_id, state) WHERE state = 'pending';
