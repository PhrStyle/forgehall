-- Publishing approved work: commit identity per workspace, the bus's write credential per host,
-- and the pull requests the bus opened.

ALTER TABLE workspaces ADD COLUMN git_author_name  text;
ALTER TABLE workspaces ADD COLUMN git_author_email text;
ALTER TABLE workspaces ADD COLUMN ai_trailer       boolean NOT NULL DEFAULT true;

-- Write tokens are not stored here: they live in files under $FORGEHALL_HOME/secrets/providers, mode 0600.
CREATE TABLE provider_credentials (
  workspace_id  text NOT NULL REFERENCES workspaces(id),
  provider      text NOT NULL,              -- github | azure-devops
  token_hint    text NOT NULL,              -- last 4 characters
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider)
);

-- Pull requests waiting on the host's reviewers; the bus polls them until merged or closed.
CREATE INDEX approvals_open_prs ON approvals(id) WHERE state = 'approved' AND result ? 'pr' AND result->'pr'->>'status' = 'open';
