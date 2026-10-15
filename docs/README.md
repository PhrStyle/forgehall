# Forgehall documentation

Organised by what you are trying to do. Everything marked "planned" in these pages is not implemented yet.

## Tutorial

- [Getting started](getting-started.md): from a fresh clone to the Docker stack and two isolated agents talking to each other and to you.

## How-to guides

- [Run agents in Docker](guides/run-agents-in-docker.md): start, stop and inspect isolated agents, and answer their permission requests.
- [Work on a repository](guides/work-on-a-repository.md): register a repo, let an agent fix it on a branch, review the diff, approve and merge.

## Concepts (explanation)

- [Overview](concepts/overview.md): the five pieces, why the Claude Code CLI is the engine, event-driven runs.
- [Isolation and permissions](concepts/isolation-and-permissions.md): isolated agents, the stack, the admin token, tool permissions and permission requests, defense in depth.
- [Workspaces](concepts/workspaces.md): isolation, templates, repositories and the staging remote, approval policies, Claude accounts.
- [Threads and messages](concepts/threads-and-messages.md): message types, the thread state machine, repository threads, approvals, the QA-to-merge flow.
- [Model routing and limits](concepts/model-routing-and-limits.md): which model runs what, queue priorities, real usage readings.
- [Learning and data](concepts/learning-and-data.md): agent memory in local git, approval of learnings, backups (planned).
- [Schedules](concepts/schedules.md): agents that run on a schedule (daily, weekly, monthly, yearly or once), with overlap and usage guards.
- [Roadmap](concepts/roadmap.md): phases F1 to F6 and where phases 1 and 2 stand.

## Reference

- [CLI (`fh`)](reference/cli.md): every command and option, including repositories.
- [MCP tools](reference/mcp-tools.md): the tools agents call on the bus.
- [Configuration](reference/configuration.md): environment variables, the stack's `.env`, and planned config files.
- [Runner API](reference/runner-api.md): the HTTP endpoints between runner and bus.
- [Console API](reference/console-api.md): the admin-token-protected endpoints of the console, approvals, permissions, settings, live events and the git endpoint.

## Decisions

- [Decision log](decisions.md): one-line decisions with context and trade-off.
- [ADR 0000: Record architecture decisions](adr/0000-record-architecture-decisions.md)
- [ADR 0001: Claude Code CLI as the engine](adr/0001-claude-code-cli-as-engine.md)
- [ADR 0002: Own message bus](adr/0002-own-message-bus.md)
- [ADR 0003: Event-driven runs with session resume](adr/0003-event-driven-runs-with-session-resume.md)
- [ADR 0004: Workspace isolation](adr/0004-workspace-isolation.md)
- [ADR 0005: Provider adapters and approval policies](adr/0005-provider-adapters-and-approval-policies.md)
- [ADR 0006: Local git for agent data](adr/0006-local-git-for-agent-data.md)
- [ADR 0007: The runner handles git, the bus hosts a staging remote](adr/0007-runner-handles-git-and-staging-remote.md)
- [ADR 0008: Isolated agents, the bus in the stack, and permission requests](adr/0008-isolated-agents-and-permission-requests.md)
- [ADR 0009: Host access per agent](adr/0009-host-access-per-agent.md)

## Project

- [Contributing](../CONTRIBUTING.md) · [Security](../SECURITY.md) · [Changelog](../CHANGELOG.md)
