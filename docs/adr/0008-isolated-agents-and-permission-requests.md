# 0008. Isolated agents, the bus in the stack, and permission requests

- Status: Accepted (implemented for Docker; VM isolation is planned for phase 5)
- Date: 2026-10-14

## Context

Until now the runner ran directly on the host, as the user, with file tools only. Giving agents more useful tools (`npm test`, `pytest`, package installs) made that unacceptable: a model that reads untrusted text could run commands as you. Agents need to run somewhere that limits the damage, and the user must stay in control of what goes beyond a safe default.

Moving agents into containers raised three problems. With rootless Docker or Docker Desktop, a container cannot reach a service listening on the host. Agents and the bus then share a network, so anything the bus exposes to the user must not be usable by an agent. And Claude Code needs a way to ask the user about a tool use when nobody is at its terminal.

## Decision

- **Isolated by default.** Runners report a mode (`container`, `vm`, `host`) when they claim work. The bus refuses `host` runners with `403` unless the setting `allow_host_runners` is on. Host runs get no standing permissions and every tool use is asked.
- **The bus runs in the Docker stack**, with Postgres, on the `forgehall-agents` network where agents reach it as `http://bus:4545`. It publishes only `127.0.0.1:4545` on the host and mounts `~/.forgehall` at `/data`. `fh setup` writes the compose settings for this machine (rootless or not).
- **The console API needs an admin token.** Everything under `/api` requires `Authorization: Bearer <~/.forgehall/admin-token>`. Agents use their own tokens on `/mcp`, `/runner` and `/git` only. The console dev and preview server injects the admin token when proxying, so it never reaches the browser.
- **Permission prompts go through MCP.** The runner starts Claude Code with `--permission-mode default` and `--permission-prompt-tool mcp__bus__permission`. Claude Code applies allow and deny rules itself; for anything else it calls the bus's `permission` tool, which stores a request, waits for your answer in the console (allow once, always allow, deny with a reason) and returns it. Unanswered requests expire after 15 minutes and count as denied.
- **Rules in Claude Code's syntax**, with defaults for isolated runners (allow file tools and test, build and inspect commands; ask installs, network and recursive `rm`; deny `sudo` and reading secrets) plus per-agent additions that "Always allow" writes.
- **`fh agent run`** starts the isolated runner as a container with a restart policy. The Claude token is passed to it as an environment variable.

## Alternatives considered

- **The bus on the host with a gateway listener** (bind to the Docker bridge gateway so containers reach it). It fails on rootless Docker and Docker Desktop, where the host is not reachable that way, and it needs a listener on a non-loopback interface.
- **Filtering by network interface** (answer `/api` only on loopback, agents on another interface). It depends on how Docker routes traffic on each platform and breaks silently when that changes; a token check does not depend on routing.
- **`dontAsk` mode with a fixed allowlist.** Simple, but an agent that needs one more command fails instead of asking, and the list would have to be guessed up front. Asking keeps the user in control and lets "Always allow" build the list from real use.
- **Letting agents run on the host freely.** Easiest, and what phase 1 did. It gives a manipulated agent your user's full reach. Kept only as an opt-in, with every action asked.

## Consequences

- Setup has more steps: `fh setup`, the compose stack, the runner image and a Claude token. They are documented in [Getting started](../getting-started.md).
- The runner mode is self-reported. This prevents accidental host runs, not a determined local user; the boundary against agents is the admin token and the permission rules.
- The admin token is a new secret to protect (file mode `0600`). Anyone who can read it can act as you.
- Secrets passed to containers as environment variables (agent token, Claude token) are visible to `docker inspect` on this machine.
- A run can wait for you for up to 15 minutes. The runner sets `MCP_TOOL_TIMEOUT` so the call lasts that long.
- Containers share the host kernel; VMs with network allowlists remain planned for phase 5.
- `fh` still reaches Postgres on `127.0.0.1:5433`; commands that need the bus's files (`fh repo add`) go through the bus API.
