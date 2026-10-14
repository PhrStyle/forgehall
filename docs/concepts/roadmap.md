# Roadmap

Forgehall is built in phases. Each phase ends with something you can run.

| Phase | Delivers | Done when |
|---|---|---|
| **F1** Bus | Bus with MCP and Postgres; runner for one agent; CLI to send messages | A message wakes the agent, it answers through MCP and a second run resumes the session |
| **F2** Conversation | Vigil and atlas; thread states and `complete`; workspaces; `local` provider and staging remote; `merge` approval policy; `work_touching`; [schedules](schedules.md) | Both flows run end to end on a local test repository |
| **F3** Console and providers | React console on the bus with live updates; `azure-devops` and `github` adapters | You approve in the console and the pull request appears on the provider |
| **F4** Learning | Reflection, `learn/*` branches, review tab, consolidation | A proposed memory is approved and used in the next run |
| **F5** VMs | Incus, network allowlist, snapshots | The F2 tests pass with agents in VMs |
| **F6** Extras | Notifications, more agents (research, writing, data) | n/a |

Isolation technology: Docker (one container per agent, started with `fh agent run`; the bus runs in the compose stack) for F1 to F4, then Incus VMs (separate kernel, native snapshots, per-instance network ACL) in F5. The same base image serves both: Node 22, a pinned `claude`, git and the runner.

## Phase 1 status

Done:

- Bus: Postgres schema and migrations, threads, messages, runs, run events, sessions, usage per workspace
- MCP over HTTP with per-agent tokens: `request`, `ask`, `answer`, `verify`, `request_approval`, `notify`, `escalate`, `thread_read`, `threads_list`
- Thread state machine driven by message type
- Deterministic model routing with stored reasons; priority queue; per-workspace concurrency cap
- Runner with the Claude Code engine, session resume per agent and thread, event streaming
- Real usage from `rate_limit_event`
- `fh` CLI for workspaces, agents, tokens, threads, runs and usage
- Unit tests for routing, state machine and prompt building
- Docker images for the bus and the runner (Node 22, a pinned `claude`, git), bus service in compose
- Run heartbeats; runs whose runner goes silent are failed and their messages re-queued
- Retries with backoff (30 s, 60 s), at most 3 consecutive failures, then the thread is `blocked` and the user is told why; login errors block immediately
- Console API (read models, human actions) and a live change stream (SSE)

In progress:

- Web console (React) on top of the console API

Not part of phase 1 (comes later): learning, backups, multi-account support, preventive limit pauses.

## Phase 2 status

Done:

- `complete`, close and reopen: assignees close finished threads, and you can mark a thread done, cancel it or reopen it with instructions
- Repositories: `fh repo add`, the `local` provider, a staging remote per repository served over git smart HTTP with a hook that accepts only `fh/*` branches
- Branch per thread (`fh/<THREAD-ID>`); the runner checks out, commits and pushes, agents never run git; one run per thread at a time
- Approvals as records pinned to a commit; the `merge` policy: approving merges into the base branch without a working tree, refuses conflicts and a moved branch, publishes upstream and closes the thread
- Console: branch card, diff viewer, approval card, repository selection in New task
- Isolated agents by default: runners report a mode and the bus refuses `host` runners unless you allow them; `fh agent run`, `stop` and `ps` manage one container per agent; the bus runs in the Docker stack
- Admin token on the whole console API (`/api`); `fh setup` prepares `~/.forgehall` and the stack settings
- Tool permissions: default rules for isolated runners, and permission requests answered in the console (allow once, always allow, deny), expiring after 15 minutes. Validated with a real run: a denied `rm` was respected
- Verified end to end: an agent fixed a bug in a sample repository and the approved merge reached the upstream; a push to `main` with an agent token is rejected

Remaining:

- Incus VMs (`fh agent run --isolation vm`) and network allowlists, phase 5. Docker containers share the host kernel
- `pull_request` and `branch_only` policies with real providers (GitHub, Azure DevOps), which belong to F3
- [Schedules](schedules.md)
- `work_touching` and the other work-awareness tools
