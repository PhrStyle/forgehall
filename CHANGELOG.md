# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

Phase 1 (bus, runner, CLI) and phase 2 so far (repositories and approvals).

### Added

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
