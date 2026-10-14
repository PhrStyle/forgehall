# 0004. Workspace isolation

- Status: Accepted
- Date: 2026-10-13

## Context

One person may use Forgehall for a personal context and for an employer's, with different repositories, rules, accounts and confidentiality. Information from one context must not reach the other, whether through an agent's memory, a shared credential or a message.

## Decision

A **workspace** is a hard isolation boundary. These are per workspace and never shared:

- agents and their identities, memory and skills,
- threads, messages, runs and usage on the bus (every row carries `workspace_id`; an agent token sees only its own workspace),
- credentials (provider tokens, Claude account) and secrets,
- execution environments (containers, later VMs),
- the local git repository holding agent data ([ADR 0006](0006-local-git-for-agent-data.md)).

Role **templates** (dev, QA, research, ...) are global but contain no memory or context. Creating an agent copies a template into the workspace, after which the copy evolves independently. Skills are promoted only within a workspace; moving one across is a manual copy into the template without memory.

## Alternatives considered

- **Shared agents across workspaces.** Fewer agents to maintain, but memory and context leak between contexts, which is the thing we must avoid.
- **One installation per context.** Strong isolation, but two databases, two buses and duplicated setup for what is a single person's tool.
- **Tags or ACLs inside one global pool.** Flexible, but one query bug becomes a data leak; a hard `workspace_id` boundary on every row and token is easier to reason about.

## Consequences

- Phase 1 implements the bus half: tokens and MCP tools are workspace-scoped, and cross-workspace messaging is impossible by construction. Environment, credential and git isolation are planned.
- Some duplication: a similar QA agent exists in each workspace and learns separately.
- A shared Claude account across workspaces needs an explicit split of its usage window (planned `limits.share`).
