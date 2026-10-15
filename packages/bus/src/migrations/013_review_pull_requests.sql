-- With the merge policy on GitHub or Azure DevOps, a thread gets a real pull request when its
-- agent asks for approval; approving merges it on the host.
ALTER TABLE threads ADD COLUMN pull_request jsonb;      -- {id, url, branch, status: open|merged|closed}
ALTER TABLE approvals ADD COLUMN published jsonb;       -- {head, commit}: the squashed commit pushed for this approval
