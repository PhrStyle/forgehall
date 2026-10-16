# Learning and data

Status: **learning and memory are implemented** (memory and skills, reflection, shared knowledge, history with undo, optional approval, console). **Planned:** version tags and rollback, weekly consolidation, daily encrypted backup, and agents defined as files. Each planned item is marked below.

Agents change their own memory and skills through bus tools. Each change is a commit in the workspace's local git repository, which you can see, undo or gate. Decisions and their trade-offs: [ADR 0010](../adr/0010-automatic-learning-with-history.md), which refines [ADR 0006](../adr/0006-local-git-for-agent-data.md).

## Code and data stay apart

The project is open source, so code and personal data never mix.

| | Where | Versioned as |
|---|---|---|
| Code (bus, runner, console, templates) | the public repository | git, as usual |
| Data (workspaces, agent memory and skills, shared knowledge) | `FORGEHALL_HOME` (default `~/.forgehall`) | local git with no remote, one repository per workspace (implemented) |

```text
~/.forgehall/
  workspaces/
    dev/  (.git)           implemented: created on first use
      knowledge.md         shared knowledge, written by you
      agents/
        atlas/
          memory/<name>.md
          skills/<name>/SKILL.md
  staging/                 git staging remotes (implemented)
  secrets/                 tokens (implemented)
  config.yaml              planned: accounts, backup, preferences
  postgres/                planned: database volume
  backups/                 planned
```

The bus creates a workspace's repository on first use and is the only writer. Agents never write to the repository directly.

## What an agent can learn

| File | Who writes it | Limits |
|---|---|---|
| `knowledge.md` (one per workspace) | You, in the console (Settings → Workspace → Knowledge) | 32 KB |
| `agents/<id>/memory/<name>.md` | The agent, through `remember` and `forget` | 16 KB per file, 60 files per agent |
| `agents/<id>/skills/<name>/SKILL.md` | The agent, through `save_skill` and `remove_skill` | 16 KB per file, 10 files per skill |

Names are lowercase letters, digits and `-`, up to 64 characters. Knowledge is shared by every agent of the workspace. Memory and skills belong to one agent. Agents never write shared knowledge: shared conventions are your decision.

## Learning flow

1. **During a thread**, the agent calls `remember`, `forget`, `save_skill` or `remove_skill` with a reason and the thread id. The bus checks the name, size and count.
2. **By default the change applies at once.** The bus commits it to the workspace repository with the agent as author, the reason and `Thread: THR-…` in the message. It is in the agent's memory from its next run.
3. **Optional gate.** With "Ask before saving to memory" on in the agent's Settings (off by default), the change becomes a proposal instead. You approve or reject it in the Inbox (Learning proposals). Nothing is written until you approve.
4. **Reflection after a thread closes.** When a thread reaches `done` through `complete`, each agent that sent messages in it gets a reflection notice and a run on its default model, if:
   - you sent it a decision or an answer,
   - a review it asked for failed,
   - it asked you a question, or
   - it had three or more finished runs.

   Each agent reflects once per thread. In the console, **Learn from this thread** starts it on demand.
5. **Delivery.** Before every run the runner writes the knowledge and the agent's memory to `~/.claude/CLAUDE.md`, and each skill to `~/.claude/skills/<name>/`, inside the agent's container. Claude Code loads them in every session. Host runs skip this step, so the user's own `~/.claude` is never overwritten.
6. **History and undo.** The console's agent page shows **History**: who changed what, why, the thread, the files, and the diff. **Undo** adds a revert commit. Nothing is deleted from the history.

The default trades prevention for visibility: a bad memory is visible and reversible after the fact. Use the approval gate for agents that read untrusted content, such as repositories or issues, because text they read could try to plant instructions in their memory.

## Why git, locally

| Need | With local git | Without it |
|---|---|---|
| See exactly what changed | `git diff` (the console's diff view) | a custom diff |
| Undo one learning | a revert commit | restoring a whole backup |
| Know when and why | `git log` with the reason and thread id | custom audit |
| Attribute a change | the agent as commit author | a custom field |

The cost is a few MB, no network and no hosted service. Git is a history engine here, not hosting.

## Planned

- **Version tags and rollback.** `git tag <id>-vN` marks an agent's version; reverting to a tag is planned, and would need approval.
- **Weekly consolidation.** A reflection pass that merges duplicate memories and removes stale ones, through the same approval gate.
- **Agents defined as files.** `agent.yaml` and role templates in the workspace repository.
- **Daily backup,** described below.

## Backup (planned)

A planned daily job produces, per workspace:

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
