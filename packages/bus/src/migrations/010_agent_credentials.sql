-- Host access per agent (GitHub, Azure DevOps): some agents may read or write on a host, others not.
-- Tokens are not stored here: they live in files under $FORGEHALL_HOME/secrets/agents, mode 0600.
CREATE TABLE agent_credentials (
  workspace_id  text NOT NULL,
  agent_id      text NOT NULL,
  provider      text NOT NULL,              -- github | azure-devops
  token_hint    text NOT NULL,              -- last 4 characters
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, agent_id, provider),
  FOREIGN KEY (workspace_id, agent_id) REFERENCES agents(workspace_id, id) ON DELETE CASCADE
);
