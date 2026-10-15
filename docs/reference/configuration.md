# Configuration

## Environment variables (implemented)

There are no config files yet. Everything is read from the environment.

### Bus (`packages/bus/dist/index.js`, runs in the stack) and `fh`

In the stack the bus is the `bus` service of `infra/docker/compose.yaml`; the image sets `HOST=0.0.0.0`, `PORT=4545` and `FORGEHALL_HOME=/data`. Compose publishes the port on `127.0.0.1` only.

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgres://forgehall:forgehall_dev@127.0.0.1:5433/forgehall` | Postgres connection. Also used by `fh` from the host. In the stack, compose points the bus at `postgres:5432`. The password is for local development only |
| `PORT` | `4545` | HTTP port |
| `HOST` | `127.0.0.1` (`0.0.0.0` in the bus image) | Bind address. Plain HTTP with no TLS: in the stack the port is published on the host's loopback only, and agents reach it on the `forgehall-agents` network |
| `LOG_LEVEL` | `info` | Fastify logger level |
| `MAX_RUNNING` | `2` | Maximum runs in progress per workspace |
| `CLAIM_WAIT_MS` | `25000` | How long a runner's claim request waits for work before returning 204 |
| `PERMISSION_TIMEOUT_MS` | `900000` (15 minutes) | How long a permission request waits for you before it counts as denied |
| `RUN_STALE_SECONDS` | `300` | A running run with no heartbeat for this long is failed and its messages re-queued |
| `PR_POLL_SECONDS` | `120` | How often the bus checks the pull requests it opened (`pull_request` policy) for merge or close |
| `FORGEHALL_HOME` | `~/.forgehall` on the host, `/data` in the stack | Data directory: staging remotes (`staging/<workspace>/<repo>.git`), local upstreams (`upstreams/`), provider tokens (`secrets/providers/`), agents' host tokens (`secrets/agents/`) and the `admin-token` file. In the stack the host's `~/.forgehall` is mounted at `/data` |
| `FORGEHALL_ADMIN_TOKEN` | unset | Use this admin token instead of reading or creating `$FORGEHALL_HOME/admin-token`. Read by the bus, `fh` and the console's dev server |
| `FORGEHALL_BUS_URL` | `http://127.0.0.1:4545` | Where **`fh`** (`fh repo add`) and the console's dev server reach the bus |
| `FORGEHALL_RUNNER_IMAGE` | `forgehall/runner:dev` | Image `fh agent run` starts |
| `FORGEHALL_CLAUDE_TOKEN_FILE` | `~/.config/forgehall/claude-token` | File with the Claude token (`claude setup-token`) that `fh agent run` passes to containers. `CLAUDE_CODE_OAUTH_TOKEN` in the environment takes precedence |
| `FORGEHALL_AGENT_NETWORK` | `forgehall-agents` | Docker network of the stack that agents join |
| `FORGEHALL_AGENT_BUS_URL` | `http://bus:4545` | Bus URL given to agent containers |

The bus applies pending migrations at startup. The admin token is created on first start (or by `fh setup`) as `fha_...`, mode `0600`.

`FORGEHALL_HOME` on the host and `/data` in the bus container are the same directory. `fh` asks the bus for its home (`GET /health`) to translate paths; see [`fh repo add`](cli.md#fh-repo-add-ws-id-upstream---base-branch).

The machine-wide setting `allow_host_runners` (default off) is changed in the console's Settings or with `PATCH /api/settings` ([console API](console-api.md#settings)).

### Publishing (per workspace)

Set in the console under Settings, "Publishing", or with `PATCH /api/workspaces/:ws/publishing` ([console API](console-api.md#publishing)). There is no `fh` option for these yet.

| Setting | Default | Meaning |
|---|---|---|
| Approval policy | `merge` | What approving does: `merge` pushes to the base branch, `branch_only` pushes the thread branch `fh/<THREAD-ID>`, `pull_request` pushes the branch and opens a pull request. See [Deciding an approval](console-api.md#deciding-an-approval) |
| Commit identity | `Forgehall <forgehall@localhost>` | Author and committer name and e-mail of published commits. Used when empty |
| AI trailer | on | Adds `Co-Authored-By: Claude <noreply@anthropic.com>` to published commits |
| Host credentials | none | One token per host (`github`, `azure-devops`). Used by the bus to push, open pull requests and search reviewers |

Required token scopes:

| Host | Token | Scopes |
|---|---|---|
| GitHub | fine-grained token | Contents: read and write; Pull requests: read and write |
| Azure DevOps | personal access token | Code: Read & Write; Identity: Read |

This write token is used only by the bus. Agents never get it.

Tokens are stored in `~/.forgehall/secrets/providers/<workspace>/<provider>.token` (mode `0600`), never in the database and never printed. Do not commit that directory or copy its contents into docs or tickets.

Agents' host access tokens are separate from the workspace write token. Each is stored in `$FORGEHALL_HOME/secrets/agents/<ws>/<agent>/<provider>.token` (mode `0600`), is given to that agent's runs as environment variables, and is never returned by the API. See [Host access per agent](../concepts/workspaces.md#host-access-per-agent).

### `infra/docker/.env` (written by `fh setup`)

Read by `compose.yaml`. Do not commit it; it is machine-specific.

| Variable | Meaning |
|---|---|
| `FORGEHALL_HOME_HOST` | Absolute path of `~/.forgehall` on the host, mounted at `/data` in the bus. Compose refuses to start without it |
| `FORGEHALL_UID`, `FORGEHALL_GID` | User the bus container runs as. `0:0` with rootless Docker (it maps to your user), otherwise your uid and gid. Defaults to `1000:1000` |

### Runner (in the runner image; `packages/runner/dist/index.js`)

`fh agent run` sets these for you. They matter if you run the image yourself or use the opt-in host mode.

| Variable | Default | Meaning |
|---|---|---|
| `AGENT_TOKEN` | none, required | The agent's bearer token. One runner serves one agent |
| `BUS_URL` | `http://127.0.0.1:4545` (`http://bus:4545` in the image) | Where the bus listens |
| `FORGEHALL_RUNNER_MODE` | `host` (`container` in the image) | Where the runner says it executes: `container`, `vm` or `host`. Reported on every claim. The bus refuses `host` unless "Allow agents directly on this machine" is on. Self-reported: do not set it to `container` outside a container |
| `WORK_ROOT` | `./.work` (`/home/agent/work` in the image) | Root of the agent's work area; each thread gets `WORK_ROOT/<thread-id>/` as the engine's working directory |
| `CLAUDE_BIN` | `claude` | Claude Code executable |
| `CLAUDE_CODE_OAUTH_TOKEN` | unset | Passed to the CLI to select the account. `fh agent run` sets it from your token file. On the host, if unset, the CLI uses its own login |
| `FORGEHALL_BILLING` | `auto` | `auto`: subscription only when the runner has a subscription token or no API key (removes API-key variables, stops a run on a non-subscription credential or paid extra usage); the API only when given an API key and no subscription token. `any` or `subscription-only` force one mode. See [Billing](../concepts/workspaces.md#billing) |

The runner exits with an explanation when the bus answers `403` to its claim. Its environment is inherited by the `claude` process, which also gets `MCP_TOOL_TIMEOUT` of 20 minutes so a call waiting for your permission answer can last.

### Console dev and preview server (`packages/console`)

| Variable | Default | Meaning |
|---|---|---|
| `FORGEHALL_BUS_URL` | `http://127.0.0.1:4545` | Bus to proxy `/api` to |
| `FORGEHALL_ADMIN_TOKEN` | contents of `$FORGEHALL_HOME/admin-token` | Added by the server as the `Authorization` header of proxied requests. Never in the browser bundle |

## Planned configuration

None of the following is read by any code today. It shows the intended shape.

### More under `FORGEHALL_HOME` (planned)

Today `FORGEHALL_HOME` holds `staging/`, `upstreams/` and `admin-token`. The planned per-workspace data repositories live here too. See [Learning and data](../concepts/learning-and-data.md).

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
  switching: single            # single | manual (your own accounts only)
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
