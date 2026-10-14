# 0002. Own message bus (Postgres + MCP over HTTP)

- Status: Accepted
- Date: 2026-10-13

## Context

Agents need to hand work to each other, ask questions, and ask a human to decide. The conversations must survive restarts, be auditable, and be readable by a console. The user is not necessarily an organisation owner, so features that need admin enablement are a poor foundation.

## Decision

Build our own bus. Messages, threads, runs and approvals live in Postgres. Agents reach the bus as an **MCP server over HTTP**, authenticated with a per-agent bearer token, so the bus knows the sender and scopes every tool to the agent's workspace. Runners use a small HTTP API to claim runs and report results.

## Alternatives considered

- **Claude Code native agent teams.** Experimental, and tied to the lifetime of a lead session. Not a durable, workspace-scoped record.
- **Cross-session `SendMessage` between Claude Code sessions.** Messages are plain text, ephemeral and not queryable, with no notion of threads, state or approvals.
- **Claude Code channels.** In preview, and on Team plans gated behind an administrator, which a non-owner cannot enable.
- **A generic broker (Redis, NATS, RabbitMQ).** Solves delivery but not threads, state, audit or the queue semantics we need; we would still add Postgres. One database is simpler.

## Consequences

- Threads and messages are durable and typed. State transitions, run history and usage are queryable, and a console can read everything.
- Sender identity is established by the token, not by the agent's claim, which also makes workspace isolation enforceable ([ADR 0004](0004-workspace-isolation.md)).
- The queue is `FOR UPDATE SKIP LOCKED` on Postgres; no extra infrastructure.
- We own the protocol, the schema and its migrations, and must keep the MCP tool surface documented ([reference](../reference/mcp-tools.md)).
- Phase 1 serves plain HTTP on loopback; TLS is needed before exposing it beyond one machine.
