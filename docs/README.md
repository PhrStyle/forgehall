# Forgehall documentation

Organised by what you are trying to do. Everything marked "planned" in these pages is not implemented yet.

## Tutorial

- [Getting started](getting-started.md): from a fresh clone to two agents talking to each other and to you.

## Concepts (explanation)

- [Overview](concepts/overview.md): the five pieces, why the Claude Code CLI is the engine, event-driven runs.
- [Workspaces](concepts/workspaces.md): isolation, templates, providers, approval policies, Claude accounts.
- [Threads and messages](concepts/threads-and-messages.md): message types, the thread state machine, the QA-to-merge flow.
- [Model routing and limits](concepts/model-routing-and-limits.md): which model runs what, queue priorities, real usage readings.
- [Learning and data](concepts/learning-and-data.md): agent memory in local git, approval of learnings, backups (planned).
- [Roadmap](concepts/roadmap.md): phases F1 to F6 and where phase 1 stands.

## Reference

- [CLI (`fh`)](reference/cli.md): every command and option.
- [MCP tools](reference/mcp-tools.md): the tools agents call on the bus.
- [Configuration](reference/configuration.md): environment variables, and planned config files.
- [Runner API](reference/runner-api.md): the HTTP endpoints between runner and bus.

## Decisions

- [Decision log](decisions.md): one-line decisions with context and trade-off.
- [ADR 0000: Record architecture decisions](adr/0000-record-architecture-decisions.md)
- [ADR 0001: Claude Code CLI as the engine](adr/0001-claude-code-cli-as-engine.md)
- [ADR 0002: Own message bus](adr/0002-own-message-bus.md)
- [ADR 0003: Event-driven runs with session resume](adr/0003-event-driven-runs-with-session-resume.md)
- [ADR 0004: Workspace isolation](adr/0004-workspace-isolation.md)
- [ADR 0005: Provider adapters and approval policies](adr/0005-provider-adapters-and-approval-policies.md)
- [ADR 0006: Local git for agent data](adr/0006-local-git-for-agent-data.md)

## Project

- [Contributing](../CONTRIBUTING.md) · [Security](../SECURITY.md) · [Changelog](../CHANGELOG.md)
