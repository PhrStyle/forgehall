-- Learning: agents keep memory and skills in the workspace data repository (git). By default a
-- change is committed at once; an agent set to "ask before saving" files a proposal instead.
CREATE TABLE learning_proposals (
  id            bigserial PRIMARY KEY,
  workspace_id  text NOT NULL REFERENCES workspaces(id),
  agent_id      text NOT NULL,
  thread_id     text REFERENCES threads(id),
  action        text NOT NULL,                -- remember | forget | save_skill | remove_skill
  name          text NOT NULL,
  content       text,                         -- memory text or SKILL.md
  reason        text NOT NULL,
  state         text NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  comment       text,
  commit        text,                         -- the data commit once approved
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_at    timestamptz,
  FOREIGN KEY (workspace_id, agent_id) REFERENCES agents(workspace_id, id) ON DELETE CASCADE
);
CREATE INDEX learning_pending ON learning_proposals(workspace_id) WHERE state = 'pending';
