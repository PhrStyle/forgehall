-- Claude accounts (the user's own subscriptions) and which one each workspace uses.
-- Tokens are not stored here: they live in files under $FORGEHALL_HOME/secrets/claude, mode 0600.

CREATE TABLE claude_accounts (
  id          text PRIMARY KEY,
  label       text NOT NULL,
  plan        text NOT NULL,             -- pro | max-5x | max-20x | team-standard | team-premium | enterprise
  token_hint  text NOT NULL,             -- last 4 characters, to recognise the token
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspaces ADD COLUMN claude_account_id text REFERENCES claude_accounts(id) ON DELETE SET NULL;
