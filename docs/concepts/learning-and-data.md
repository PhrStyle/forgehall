# Learning and data

**Everything on this page is planned**, except that `FORGEHALL_HOME` already holds the git [staging remotes](workspaces.md#repositories-and-the-staging-remote) (`staging/<ws>/<repo>.git`). Phase 1 stores threads, messages, runs and usage in Postgres and nothing else. Agents have no persistent memory or skills managed by Forgehall yet, and there is no backup tooling.

## Code and data stay apart

The project is open source, so code and personal data never mix.

| | Where | Versioned as |
|---|---|---|
| Code (bus, runner, console, templates) | the public repository | git, as usual |
| Data (workspaces, agents, memory, skills, knowledge, database) | `FORGEHALL_HOME` (default `~/.forgehall`) | local git with no remote, one repository per workspace |

```text
~/.forgehall/
  config.yaml            accounts, backup, preferences (no secrets)
  secrets/               encrypted tokens, or the system keyring
  workspaces/
    personal/  (.git)    workspace.yaml, agents/, skills/, knowledge/
    work/      (.git)
  postgres/              database volume
  backups/
```

## Why git, locally

The learning flow needs four things git already does:

| Need | With local git | Without it |
|---|---|---|
| See exactly what an agent wants to learn | `git diff` | write a text diff |
| Keep a proposal separate until approved | a `learn/<agent>/<thread>` branch | a drafts table and merge logic |
| Undo one bad learning, or roll an agent back to a version | `git revert`, `git tag forge-v3` | restore a whole backup, losing the rest |
| Know when and why something was learned | `git log` with the thread id in the commit | custom audit |

The cost is a few MB, no network and no hosted service. Git is a history engine here, not hosting. See [ADR 0006](../adr/0006-local-git-for-agent-data.md).

## Learning flow

1. During runs, Claude Code's automatic memory writes into the agent's `memory/` directory on its `agent/<id>` branch.
2. When a thread completes, a reflection run is scheduled for each participant: what is worth keeping, and should a repeated procedure become a skill? The agent edits `memory/` and `skills/`.
3. The runner commits to `learn/<id>/<thread>` and the bus creates a `learning` approval with the diff.
4. Approve and the bus merges into `main`. Reject and your comment becomes feedback memory for the agent, and the branch is dropped.
5. Weekly consolidation, through the same approval flow, merges duplicates and removes stale memories.
6. `git tag <id>-vN` marks agent versions. Reverting to a tag also needs approval.

Skills use the standard `SKILL.md` format. A skill is promoted only within its workspace, never into another.

## Backup

A daily job produces, per workspace:

- `git bundle create --all`, a single file with full history (restore with `git clone file.bundle`),
- a `pg_dump` of that workspace's threads, messages and runs,
- everything packed as `tar.zst` and **encrypted with age** (your key),
- retention of 7 daily, 4 weekly and 6 monthly copies.

| Destination | Default | Note |
|---|---|---|
| Local folder under `FORGEHALL_HOME` | on | Protects against mistakes, not against losing the disk |
| Another folder, external disk or synced folder | optional | Just set a path |
| restic (S3, B2, SFTP, rclone) | optional | Deduplicated off-site backup |
| Private git remote | off | Never the default |

Each workspace can have its own destination and key, for example none external for `work`.
