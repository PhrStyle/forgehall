# 0006. Local git for agent data

- Status: Accepted (design; not implemented in phase 1)
- Date: 2026-10-13

## Context

Agents are meant to learn: memory and skills change over time and those changes must be reviewable, reversible and attributable. The project is open source, so personal and company data must stay out of the code repository. Users may not want any hosted service for their agents' memory.

## Decision

Keep **code and data apart**. Data (workspaces, agent definitions, memory, skills, knowledge) lives under `FORGEHALL_HOME` (default `~/.forgehall`), as **one local git repository per workspace with no remote**. Git is a history engine here, not hosting.

- A proposed learning is a commit on a `learn/<agent>/<thread>` branch; the bus creates an approval showing the diff, and merges it only when you approve.
- Rollback uses `git revert` or tags (`forge-v3`). The commit message carries the thread id.
- A **daily backup** per workspace packs `git bundle` plus a `pg_dump` into an age-encrypted archive with retention (7 daily, 4 weekly, 6 monthly), to a local folder by default and optionally elsewhere. Pushing to a remote is possible but never the default.

## Alternatives considered

- **A hosted repository for memory.** Easy backup and sharing, but sends possibly confidential content off the machine and needs an account. Remains an opt-in destination.
- **Versioning inside the database only.** One system to back up, but we would build diffs, proposals-before-approval, revert and an audit trail ourselves, all of which git provides.
- **Snapshots only (disk or backup).** Cheap, but you cannot see what changed, accept part of it, or undo one learning without losing everything after it.

## Consequences

- Review, revert and history come from git at almost no cost (a few MB, no network).
- Each workspace has its own repository, backup destination and key, which supports [workspace isolation](0004-workspace-isolation.md).
- Users must back up; a local-only repository does not survive disk loss, hence the default daily backup. Backups hold sensitive content, hence encryption.
- Nothing in this ADR is built yet; phase 1 stores only bus data in Postgres.
