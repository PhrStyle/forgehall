# Roadmap

Forgehall is built in phases. Each phase ends with something you can run.

| Phase | Delivers | Done when |
|---|---|---|
| **F1** Bus | Bus with MCP and Postgres; runner for one agent; CLI to send messages | A message wakes the agent, it answers through MCP and a second run resumes the session |
| **F2** Conversation | Vigil and atlas; thread states and `complete`; workspaces; `local` provider and staging remote; `merge` approval policy; `work_touching`; [schedules](schedules.md) | Both flows run end to end on a local test repository |
| **F3** Console and providers | React console on the bus with live updates; `azure-devops` and `github` adapters | You approve in the console and the pull request appears on the provider |
| **F4** Learning | Reflection, `learn/*` branches, review tab, consolidation | A proposed memory is approved and used in the next run |
| **F5** VMs | Incus, network allowlist, snapshots | The F2 tests pass with agents in VMs |
| **F6** Extras | Notifications when something waits on you (browser, then a chat app such as Telegram), more agents (research, writing, data) | n/a |

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
- Merge policy with real pull requests on GitHub and Azure DevOps (with a workspace host token): approval requests open the pull request, approving merges it on the host, and the thread follows a merge or close made there. Validated end to end on Azure DevOps from the console: a request for changes updated the same pull request with a second iteration, and approving completed it on the host
- Console: branch card, diff viewer, approval card, repository selection in New task
- Isolated agents by default: runners report a mode and the bus refuses `host` runners unless you allow them; `fh agent run`, `stop` and `ps` manage one container per agent; the bus runs in the Docker stack
- Admin token on the whole console API (`/api`); `fh setup` prepares `~/.forgehall` and the stack settings
- Tool permissions: default rules for isolated runners, and permission requests answered in the console (allow once, always allow, deny), expiring after 15 minutes. Validated with a real run: a denied `rm` was respected
- Verified end to end: an agent fixed a bug in a sample repository and the approved merge reached the upstream; a push to `main` with an agent token is rejected
- Publishing: policies `merge`, `pull_request` and `branch_only`; one squashed commit per approval with the workspace commit identity and an optional AI trailer; GitHub and Azure DevOps clients (pull requests, reviewer search, status polling) with the bus's write credential per workspace; console Settings → Publishing and a reviewer picker on the approval card
- Verified end to end in isolated containers with a subscription account: an agent added tests, asked for package installs (approved in the console), another agent verified them, and the approved change reached the upstream
- Workspaces and agents created and edited in the console; host access (GitHub, Azure DevOps tokens) per agent
- Supervisor on the host (`fh supervise`): starts, stops, restarts and replaces agent containers to match the desired state set in the console or with `fh agent run` and `fh agent stop`; restarts crashed containers with backoff; `fh supervise --install` runs it as a systemd user service
- `fh setup` installs the `fh` command (`~/.local/bin/fh`), so the commands the console shows work as written
- Questions to the user stand out: a "Waiting on you" badge on threads and agents; a pinned card with the short question first and the `ask` `options` as buttons; a jump button to the message that asked; the thread's questions listed, open and answered. Notifications outside the console stay planned under F6
- Routing: an answer that continues the work (a verification result, or your reply to an agent) runs on the agent's default model; other answers still route to Haiku
- [Schedules](schedules.md): agents run on a repeat rule (daily, weekdays, chosen days, every N hours, monthly or yearly, once) from the console or API; day, week, month and year views; overlap and usage guards; run now

Remaining:

- Incus VMs (`fh agent run --isolation vm`) and network allowlists, phase 5. Docker containers share the host kernel
- A full `pull_request` run against Azure DevOps (GitHub validated end to end); reviewer comments back to the agent; pull requests opened when verification starts instead of when approval is requested (F3)
- `work_touching` and the other work-awareness tools
- Revisit plan usage in the console: today it is the reading from each workspace's last agent run, so it drifts from what Claude shows for the subscription (it misses usage outside Forgehall and goes stale between runs) and can differ between workspaces on the same subscription. There is no official way to read current usage without a model request. To review: show the reading as a dated snapshot ("read 7 min ago, at the last agent run") and what it does not include, without workspaces needing to know which account another workspace uses
- Console form feedback: submitting New task (and other forms) with a required field empty does nothing visible today. Mark required fields, show an inline message on the empty field ("Add a short summary"), focus it, and keep the button's state clear, so a refused submit never looks like a broken button
- Before the public release: one-step install. `fh setup` checks the requirements (Node 22, pnpm, Docker, the Claude Code CLI) and says how to install what is missing, starts the stack, builds the runner image and installs the supervisor by default (`--no-supervisor` to skip); supervisor services for macOS (`launchd`) as well as Linux (systemd), and Windows through WSL2
- With the first stable release: git tags for the milestones (bus, console, repositories and approvals, isolation, providers, supervisor, real pull requests) and a `scripts/demo.sh <tag>` that runs any of them with its own database, data directory, ports and sample data, to show how the project evolved
