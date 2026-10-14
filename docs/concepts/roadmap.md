# Roadmap

Forgehall is built in phases. Each phase ends with something you can run.

| Phase | Delivers | Done when |
|---|---|---|
| **F1** Bus | Bus with MCP and Postgres; runner for one agent; CLI to send messages | A message wakes the agent, it answers through MCP and a second run resumes the session |
| **F2** Conversation | Vigil and atlas; thread states; workspaces; `local` provider; `merge` and `pull_request` policies; `work_touching` | Both flows run end to end on a local test repository |
| **F3** Console and providers | React console on the bus with live updates; `azure-devops` and `github` adapters | You approve in the console and the pull request appears on the provider |
| **F4** Learning | Reflection, `learn/*` branches, review tab, consolidation | A proposed memory is approved and used in the next run |
| **F5** VMs | Incus, network allowlist, snapshots | The F2 tests pass with agents in VMs |
| **F6** Extras | Schedules, notifications, more agents (research, writing, data) | n/a |

Isolation technology: Docker (one container per agent, via compose) for F1 to F4, then Incus VMs (separate kernel, native snapshots, per-instance network ACL) in F5. The same base image serves both: Node 22, a pinned `claude`, git and the runner.

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

Remaining:

- Runner Docker image (base image with Node 22, a pinned `claude`, git and the runner), so agents no longer run directly on the host

Not part of phase 1 (comes later): approvals as records, providers, console, learning, backups, multi-account support, preventive limit pauses.
