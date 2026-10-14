# Forgehall

A self-hosted team of persistent Claude Code agents that talk to each other, learn, and wait for your approval.

![Forgehall console: a thread where the QA agent asks the developer agent a question and reports back, with each run, model and cost](docs/assets/console-thread.png)

Forgehall runs a fixed team of agents (QA, development, research and so on) that you define per workspace, such as `personal` and `work`. Agents exchange messages through their own bus, so work is organised as threads with a history instead of loose chat. Each message wakes the right agent with the official Claude Code CLI, using a model chosen for that task. Anything that matters, such as merging code or saving something to an agent's memory, waits for a human decision. It runs on your machine, with your own Claude subscription.

## Status

Early development. Phase 1 is complete: the bus (Postgres, MCP, runner API, live change stream), the runner (on the host or in Docker), the `fh` CLI and a first web console with live updates. Provider adapters, approval policies, schedules and learning come next. See the [roadmap](docs/concepts/roadmap.md).

## How it works

- A **workspace** is an isolated context (agents, threads, tokens). Nothing crosses from one workspace to another.
- An **agent** is a fixed identity with a role, a default model and a bearer token.
- Work happens in **threads**. A thread holds typed messages (`request`, `ask`, `answer`, `verify`, `approval`, `notify`, `decision`) and moves through a state machine.
- The **bus** stores everything in Postgres and exposes MCP tools (`ask`, `answer`, `request`, ...) to agents over HTTP.
- Every message to an agent queues a **run**. A **runner** claims it, starts `claude -p` (resuming that agent's session for the thread) and streams events back.
- A deterministic **router** picks the model and effort per run and records why. Nobody waits blocked: asking ends the turn, and the answer arrives as a new run.

## Features

| Working now (phase 1) | Planned |
|---|---|
| Postgres-backed bus with threads, messages, runs, run events | Approval policies in the console (`merge`, `pull_request`) |
| Web console: team, threads, live run activity, usage, new tasks | Schedules (cron agents) with usage guards |
| Retries with backoff, blocked threads, stale-run recovery | Agent memory, skills and reflection |
| MCP tools for agents: `request`, `ask`, `answer`, `verify`, `request_approval`, `notify`, `escalate`, `thread_read`, `threads_list` | `inbox`, `attach`, `prs_list`, `work_touching` |
| Per-agent tokens and workspace-scoped tools | `accepts_from` enforced beyond `request` |
| Thread state machine driven by message type | Approval records, `merge` / `pull_request` / `branch_only` policies |
| Deterministic model routing with recorded reason | Repository providers (local, GitHub, Azure DevOps) |
| Priority queue, per-workspace concurrency cap | Per-account concurrency, preventive pause near limits |
| Session resume per agent and thread | Multiple Claude accounts per workspace |
| Real usage read from `rate_limit_event` | Learning branches, reflection, consolidation |
| `fh` CLI for workspaces, agents, threads, runs, usage | Local git for agent data, daily encrypted backup |
| Runner executing the Claude Code CLI, on the host or in Docker | Incus VMs, network allowlists |

## Quickstart

Requires Node 22, pnpm, Docker and a logged-in Claude Code CLI. Runs consume your Claude account's usage limits.

```bash
pnpm install && pnpm build
docker compose -f infra/docker/compose.yaml -p forgehall up -d
alias fh="node packages/bus/dist/cli.js"
fh migrate
fh workspace add dev "Dev"
fh agent add dev vigil --name Vigil --role QA --model haiku
fh agent add dev atlas --name Atlas --role Dev --model haiku
node packages/bus/dist/index.js &                                   # bus on 127.0.0.1:4545
AGENT_TOKEN=$(fh agent token dev vigil) node packages/runner/dist/index.js &
AGENT_TOKEN=$(fh agent token dev atlas) node packages/runner/dist/index.js &
fh send dev vigil "Ask atlas (ask tool) whether the checkout bug happens without a coupon, then answer me."
fh thread THR-0001
pnpm --filter @forgehall/console dev                                 # web console on http://localhost:5173
```

Open <http://localhost:5173> to watch the team, threads and live runs in the console.

The step-by-step version, with expected output, is in [Getting started](docs/getting-started.md).

## Security warning

Agents execute model-driven actions and edit files. Treat them like any automation that acts on your behalf, and run them isolated. In phase 1 the runner runs directly on your host, as your user. To limit the damage, the default allowed tools are file tools only (`Read`, `Glob`, `Grep`, `Edit`, `Write`) plus the bus tools, and `Bash` is not allowed by default. File tools can still read and write anything your user can reach, so do not point agents at directories with secrets. Read [SECURITY.md](SECURITY.md) before giving agents more tools.

## Terms of use and your data

Forgehall is an independent open-source project. It is not affiliated with or endorsed by Anthropic. The notes below reflect Anthropic's terms as reviewed on 2026-10-14; terms change, and it is up to each user to check that their use still complies. The project will be updated when changes affect how it works.

- **Your own login, the official CLI.** Every agent runs the unmodified Claude Code CLI, signed in with *your own* Claude account (interactive login or `claude setup-token`). Forgehall never asks for, stores or transmits Claude credentials. Do not share, pool or resell accounts or tokens.
- **Follow your plan's terms.** Pro and Max are governed by Anthropic's Consumer Terms, Team and Enterprise by the Commercial Terms, and all by the [Usage Policy](https://www.anthropic.com/legal/aup). Anthropic states that subscription limits assume ordinary, individual usage; keep the number of agents and schedules proportionate. You are responsible for what your agents do.
- **Work accounts.** Using an employer's Team seat or code is subject to your employer's policies. Check them before pointing agents at company repositories.
- **Where your data goes.** Prompts and code that agents read are sent to Anthropic by Claude Code. Under commercial plans (Team, Enterprise) Anthropic does not train on them; on consumer plans (Pro, Max) that depends on your privacy setting. Claude Code also keeps session transcripts in plain text under `~/.claude/projects/` (30 days by default), and the bus stores threads and run events in your local Postgres. See Anthropic's [data usage](https://code.claude.com/docs/en/data-usage) page.

## Documentation

- [Documentation index](docs/README.md)
- [Getting started](docs/getting-started.md) (tutorial)
- [Architecture overview](docs/concepts/overview.md)
- [CLI reference](docs/reference/cli.md) and [MCP tools](docs/reference/mcp-tools.md)
- [Architecture decision records](docs/adr/0000-record-architecture-decisions.md) and [decision log](docs/decisions.md)
- [Contributing](CONTRIBUTING.md), [Security](SECURITY.md), [Changelog](CHANGELOG.md)

## Requirements

- Node 22 and pnpm
- Docker (for the local Postgres)
- Claude Code CLI installed and logged in, with a subscription (Pro, Max or Team). Use only your own account. No API key is needed: with only a subscription login, runs consume your plan limits. See [Billing](docs/concepts/workspaces.md#billing).

## License

Apache License 2.0. See [LICENSE](LICENSE).
