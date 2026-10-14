# 0003. Event-driven runs with session resume

- Status: Accepted
- Date: 2026-10-13

## Context

A team of always-on agent sessions would burn usage limits idling and polling, and a blocked agent waiting for an answer holds a process and a context window for nothing. Claude subscriptions have 5-hour and 7-day usage windows shared by everything on the account.

## Decision

There are no long-lived sessions. Each message addressed to an agent queues a **run**. The runner executes `claude -p <prompt> --resume <session_id>` for that agent and thread, and the process exits when the turn ends. The Claude session id is stored per `(thread, agent)` and passed to `--resume` on the next run, so context continues. Tools such as `ask` and `verify` end the caller's turn; the answer comes as a new run. If a run is already queued for the same agent and thread, new messages join it.

This was validated in phase 1: an agent asked another, ended its turn, was woken by the reply, and its resumed run remembered the original task.

## Alternatives considered

- **Persistent agent processes that wait for messages.** Simpler mental model, but they hold context and processes while idle and are harder to schedule against usage limits.
- **Blocking tool calls (`ask` waits for the answer).** Easy for the agent, but ties up a session, breaks if the other agent runs elsewhere, and cannot survive a restart.
- **A new session on every run with the full thread replayed.** Stateless, but costs far more tokens per run than resuming.

## Consequences

- Idle agents cost nothing. Usage is driven by actual messages, which keeps a team viable on one subscription.
- Agents can live in different containers or VMs, and a run that finishes as failed puts its messages back in the queue for a retry. (A runner that dies mid-run, leaving the run marked `running`, is not recovered yet.)
- Each run pays the CLI's fixed prompt overhead ([ADR 0001](0001-claude-code-cli-as-engine.md)); resume mitigates it through prompt caching but does not remove it.
- Latency per hop includes process start-up and model time.
- Resume after switching Claude accounts is expected to work because sessions are local, but is not yet verified (matters for the planned multi-account feature).
