# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow [Semantic Versioning](https://semver.org/) once it reaches 1.0.

## [Unreleased]

Phase 1 (bus, runner, CLI).

### Added

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
