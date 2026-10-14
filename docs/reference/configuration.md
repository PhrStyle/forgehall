# Configuration

## Environment variables (implemented, phase 1)

There are no config files yet. Everything is read from the environment.

### Bus (`packages/bus/dist/index.js`) and CLI

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgres://forgehall:forgehall_dev@127.0.0.1:5433/forgehall` | Postgres connection. Also used by `fh`. The default matches `infra/docker/compose.yaml`; the password is for local development only |
| `PORT` | `4545` | HTTP port |
| `HOST` | `127.0.0.1` | Bind address. Loopback by default because tokens travel over plain HTTP with no TLS |
| `LOG_LEVEL` | `info` | Fastify logger level |
| `MAX_RUNNING` | `2` | Maximum runs in progress per workspace |
| `CLAIM_WAIT_MS` | `25000` | How long a runner's claim request waits for work before returning 204 |

The bus applies pending migrations at startup.

### Runner (`packages/runner/dist/index.js`)

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_TOKEN` | none, required | The agent's bearer token (`fh agent token <ws> <id>`). One runner serves one agent |
| `BUS_URL` | `http://127.0.0.1:4545` | Where the bus listens |
| `WORK_ROOT` | `./.work` (under the current directory) | Root of the agent's work area; each thread gets `WORK_ROOT/<thread-id>/` as the engine's working directory |
| `CLAUDE_BIN` | `claude` | Claude Code executable |
| `CLAUDE_CODE_OAUTH_TOKEN` | unset | Passed to the CLI to select the account. If unset, the CLI uses its own login. Create one with `claude setup-token` |

The runner's whole environment is inherited by the `claude` process.

## Planned configuration

None of the following is read by any code today. It shows the intended shape.

### `FORGEHALL_HOME` (planned)

Data directory, default `~/.forgehall`. See [Learning and data](../concepts/learning-and-data.md).

### `config.yaml` (planned)

```yaml
# ~/.forgehall/config.yaml
accounts:
  - id: team-work
    plan: team-standard        # pro | max-5x | max-20x | team-standard | team-premium (subscriptions only)
  - id: max-personal
    plan: max-5x
backup:
  destination: ~/.forgehall/backups
  retention: { daily: 7, weekly: 4, monthly: 6 }
```

### `workspace.yaml` (planned)

```yaml
# workspaces/work/workspace.yaml
name: Work
provider:
  kind: azure-devops           # github | azure-devops | gitlab | local
  org: contoso
  project: Commerce
  credentials: secret://ws-work/azure-pat
repos:
  - name: orders-api
    url: https://dev.azure.com/contoso/Commerce/_git/orders-api
    base_branch: main
approval:
  policy: pull_request         # merge | pull_request | branch_only
  pr:
    reviewers: choose          # choose at approval time | fixed list | provider policy
    remember_last: true
    draft: false
    title_template: "{thread.title} ({thread.id})"
claude:
  accounts: [team-work]        # order is priority
  switching: single            # single | manual | failover (off by default, see workspaces)
limits:
  share: 0.7                   # share of the weekly limit reserved for this workspace
```

### `agent.yaml` (planned)

```yaml
# workspaces/work/agents/forge/agent.yaml
default_model: sonnet
accepts_from: [probe, you]
allowed_tools: [Read, Glob, Grep, Edit, Write]
```
