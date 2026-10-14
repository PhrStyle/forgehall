# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

Phase 1 (bus, runner, CLI) and phase 2 so far (repositories, approvals, isolation and permissions).

### Added

- **Publishing policies.** `pull_request`: approving pushes the thread branch and opens a pull request on GitHub or Azure DevOps with the reviewers you pick on the approval card; the thread waits in `external_review` until the bus sees it merged (closes) or closed (blocked). `branch_only`: approving pushes the branch. Policy per workspace in Settings → Publishing.
- **Commit identity per workspace** and an optional `Co-Authored-By: Claude` trailer, applied to published commits.
- **Host credentials** (Settings → Publishing): a write token per workspace and host, kept in `~/.forgehall/secrets/providers` (mode 0600), used only by the bus.
- `@forgehall/providers`: GitHub and Azure DevOps clients (pull requests, reviewer search, status), URL parsing and git auth headers.
- API: `GET`/`PATCH /api/workspaces/:ws/publishing`, `PUT`/`DELETE /api/workspaces/:ws/credentials/:provider`, `GET /api/threads/:id/reviewers`; `decide` accepts `reviewers` and `title`. Env `PR_POLL_SECONDS`.

### Fixed

- A thread with a repository no longer closes with unapproved changes: `complete` is refused while the branch has commits outside the base branch, and a completion made before the push becomes an approval request when the run ends.
- Model routing counts only failures since the last successful run, so a thread no longer stays on Opus after an earlier failure.
- Runner image: the agent work directory belongs to the `agent` user, so new work volumes are writable (checkouts failed with a root-owned volume).
- Git errors from the runner show git's reason instead of the command line.
- Claude account tokens pasted with line breaks (terminal wrapping) are accepted; malformed tokens get a clearer error.
- Postgres restarts with the stack after a reboot (`restart: unless-stopped`).

### Security

- The runner passes the agent's git credentials through the environment instead of the command line, and masks `Basic`/`Bearer` values in errors. Before, a failed checkout could put the agent token (base64) in logs and run errors. Restart agents with `fh agent run` to rotate their tokens.

### Changed

- Approving now publishes **one squashed commit** per approval, authored by the workspace identity, for every policy (it was a merge commit by "Forgehall" that kept the agents' commits). The agents' per-run commits stay in the staging remote.
- `fh repo add` detects the host from the URL (`github`, `azure-devops`, else `local`) and strips credentials embedded in it.
- **Agents run isolated by default.** Runners report a mode (`container`, `vm`, `host`) in `POST /runner/claim`; the bus answers `403` to `host` runners and the runner exits with an explanation, unless the setting `allow_host_runners` is on (console Settings, "Allow agents directly on this machine"). Host runs get no standing permissions and every tool use is asked. The mode is self-reported.
- **The bus runs in the Docker stack** (`infra/docker/compose.yaml`), published on `127.0.0.1:4545` only and reachable by agents as `http://bus:4545` on the `forgehall-agents` network; it mounts `~/.forgehall` at `/data`. `FORGEHALL_HOME` is `/data` there.
- **The console API requires an admin token** (`Authorization: Bearer <~/.forgehall/admin-token>`) on everything under `/api`; without it, `401`. The console dev and preview server adds it when proxying. Breaking for scripts that called `/api` without it.
- `fh repo add` goes through the bus API; local upstreams must live under `~/.forgehall`. `GET /health` returns `home`.
- Runs use `--permission-mode default` and the default tool rules for the runner mode instead of file tools only. The default allowed tools now include test, build and inspect commands; see [Isolation and permissions](docs/concepts/isolation-and-permissions.md).
- `docs/guides/run-agents-in-docker.md` and the Quickstart now start from the stack and `fh agent run`; the manual host runner is documented only as an opt-in.

### Added

- `fh setup`: creates `~/.forgehall` (admin token, `upstreams/`), detects rootless Docker and writes `infra/docker/.env`.
- `fh agent run <ws> <id> [--isolation docker]`, `fh agent stop` and `fh agent ps`: one container per agent (`fh-<ws>-<id>`) from the `forgehall/runner:dev` image, with a work volume and `--restart unless-stopped`. `--isolation vm` is planned and refused.
- Tool permissions: default rules for isolated runners (allow, ask, deny) in Claude Code syntax, per-agent additions, and **permission requests**. Claude Code calls the internal `permission` MCP tool (`--permission-prompt-tool`); the console shows a card (Allow once, Always allow, Deny with a reason) in Waiting on you, the thread and the agent page. Unanswered requests expire after 15 minutes (`PERMISSION_TIMEOUT_MS`) and count as denied.
- Console API: `GET /api/settings`, `PATCH /api/settings`, `GET /api/workspaces/:ws/permissions`, `POST /api/permissions/:id/decide`, `POST /api/workspaces/:ws/repos`; SSE `permission` events.
- Environment variables: `FORGEHALL_RUNNER_MODE`, `FORGEHALL_CLAUDE_TOKEN_FILE`, `FORGEHALL_RUNNER_IMAGE`, `FORGEHALL_AGENT_NETWORK`, `FORGEHALL_AGENT_BUS_URL`, `FORGEHALL_BUS_URL`, `FORGEHALL_ADMIN_TOKEN`, `PERMISSION_TIMEOUT_MS`; `infra/docker/.env` with `FORGEHALL_HOME_HOST`, `FORGEHALL_UID`, `FORGEHALL_GID`.
- Docs: [Isolation and permissions](docs/concepts/isolation-and-permissions.md), [ADR 0008](docs/adr/0008-isolated-agents-and-permission-requests.md), decision log entries, and updated reference pages and SECURITY.md.

- Runner presence: the bus records when each agent's runner polls; the console shows **Runner offline** and a banner with the start command when work is queued for an agent without a runner.
- Repositories: `fh repo add <ws> <id> <upstream> [--base main]` and `fh repos <ws>`; provider `local`. Each repo gets a staging remote (bare repository under `$FORGEHALL_HOME/staging/<ws>/<id>.git`) with a `pre-receive` hook that accepts only `refs/heads/fh/*` and no deletions. `FORGEHALL_HOME` is now read by the bus and `fh`.
- Git smart HTTP on the bus at `/git/<ws>/<repo>.git`, authenticated with the agent token (401 without, 403 for another workspace).
- Threads bound to a repository (`fh send --repo`, `repo` in `POST /api/threads` and in the `request` MCP tool, a Repository field in the console), each with a branch `fh/<THREAD-ID>`.
- Runner git handling: agents never run git; the runner checks out the thread branch before a run, commits (`<agent> (forgehall)`) and pushes after a successful run, and reports a `git.push` event. One run per thread at a time.
- Approval records and the `merge` policy: `request_approval` pins the branch head commit (or pins it when the run ends, or withdraws if nothing was pushed). Approving merges into the base branch without a working tree and publishes upstream, then closes the thread; it is refused if the branch moved or conflicts. Rejecting requires a comment and returns `Changes requested: ...` to the assignee. `approval_policy` workspace setting (only `merge` implemented).
- Console API: `GET /api/workspaces/:ws/repos`, `GET /api/threads/:id/diff`, `GET /api/threads/:id/approvals`, `POST /api/approvals/:id/decide`. Console: branch card, diff viewer and approval card.
- Docs: [ADR 0007](docs/adr/0007-runner-handles-git-and-staging-remote.md), the how-to [Work on a repository](docs/guides/work-on-a-repository.md), the [console API reference](docs/reference/console-api.md) and decision log entries.

- `complete` MCP tool for the assignee to close a thread; console actions to mark a thread done, cancel it or reopen it with instructions (`POST /api/threads/:id/close`, `/reopen`).
- Web console (`packages/console`, Vite + React): team overview, threads list and detail with run markers, agent activity feed from run events, usage meters, new task and message composer, basic approve / request changes, Ctrl+K palette, live updates over SSE. Memory, Skills, Environment and Versions tabs are previews with sample data.
- Message bus on Postgres: workspaces, agents, threads, messages, runs, run events, sessions and per-workspace usage, with SQL migrations applied at startup.
- MCP server over HTTP for agents with per-agent bearer tokens and workspace-scoped tools: `request`, `ask`, `answer`, `verify`, `request_approval`, `notify`, `escalate`, `thread_read`, `threads_list`.
- Thread state machine driven by message type.
- `accepts_from` check on `request` messages, and prompt framing that marks other agents' messages as data.
- Deterministic model routing (Haiku, Sonnet, Opus) with the reason stored on every run.
- Priority queue with one run per agent and a per-workspace concurrency cap (`MAX_RUNNING`).
- Runner with a Claude Code engine (`claude -p`, stream-json), session resume per agent and thread, batched event streaming, and a default tool allowlist of file tools without `Bash`.
- Real account usage (5-hour and 7-day windows) read from the CLI's `rate_limit_event`.
- `fh` CLI: `migrate`, `workspace add`, `agent add`, `agent token`, `send`, `reply`, `threads`, `thread`, `runs`, `usage`.
- Docker Compose file for a local Postgres.
- Unit tests for routing, the state machine and prompt building.
- English documentation: tutorial, concepts, reference, ADRs and a decision log.
