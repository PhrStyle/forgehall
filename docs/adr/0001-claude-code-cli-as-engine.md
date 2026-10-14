# 0001. Claude Code CLI as the agent engine

- Status: Accepted
- Date: 2026-10-13

## Context

Each Forgehall agent needs an agent loop: a model plus tools (read, edit, run commands), permissions, skills and memory. Forgehall is meant to run on the user's own Claude subscription, not an API key, and to stay small enough for one maintainer.

## Decision

The engine of every agent is the **official, unmodified Claude Code CLI** in headless mode (`claude -p ... --output-format stream-json`), started by the runner for each run. The runner talks to it through a small `Engine` interface (`run(EngineRun) -> EngineResult`) so the bus and console do not depend on Claude specifics. `ClaudeCodeEngine` is the only implementation.

## Alternatives considered

- **Claude Agent SDK.** Programmatic and flexible, but Anthropic's documentation tells developers building on it to use API-key authentication, while subscription logins are described for the unmodified Claude Code binary. It would also mean owning more of the agent loop.
- **Other open agent harnesses (for example Hermes or OpenClaw style projects), or our own loop.** They can route to any model, but they require maintaining an agent loop, tool permissions, context management and memory, which is the largest and fastest-moving part of the problem. They also do not use the official binary that the subscription terms favour.
- **Proxying subscription tokens to a custom client.** Rejected outright: it intermediates credentials, which Forgehall's rules forbid.

## Consequences

- No agent loop to maintain; improvements to Claude Code (tools, skills, memory, permission modes) come for free.
- The reading of the subscription terms is: official binary, the user's own seat, own use, no token brokering. It is an interpretation. Forgehall documents that and should be reviewed against the terms before commercial use.
- Every run pays a prompt overhead of roughly 100k cached tokens (system prompt, tools, MCP definitions). Mostly cache reads, but it counts toward usage, which is why runs are event driven ([ADR 0003](0003-event-driven-runs-with-session-resume.md)) and Haiku is the default.
- Forgehall depends on CLI flags and the stream-json format. The CLI version should be pinned in the runner image and upgraded deliberately.
- Other engines can be added later behind `Engine` without touching the bus.
