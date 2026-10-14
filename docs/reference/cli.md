# CLI reference: `fh`

`fh` operates Forgehall from the terminal. Most commands talk to Postgres directly (published by the stack on `127.0.0.1:5433`), so they need `DATABASE_URL` access and work even if the bus is down. `fh repo add` goes through the bus API with the admin token, because the bus owns the staging remotes.

```bash
alias fh="node packages/bus/dist/cli.js"
```

Status: **implemented**. The CLI is also exposed as the `fh` bin of `@forgehall/bus`. See [threads and messages](../concepts/threads-and-messages.md) for the thread states.

Run `fh help` (or `fh` with no arguments) for a short usage text. Errors print a message and exit with code 1.

## Commands

### `fh setup`

Prepares this machine for the Docker stack. It creates `~/.forgehall` (or `$FORGEHALL_HOME`) with `upstreams/` and the admin token (`admin-token`, mode `0600`, kept if it exists), detects whether Docker is rootless, and writes `infra/docker/.env` with `FORGEHALL_HOME_HOST`, `FORGEHALL_UID` and `FORGEHALL_GID`. Rootless Docker maps container root to your user, so it writes `0:0`; otherwise your own uid and gid. Safe to run again.

```bash
fh setup
# Data directory: /home/you/.forgehall
# Docker: rootless (stack runs as 0:0)
# Wrote /home/you/forgehall/infra/docker/.env
```

It then prints the next steps (compose up, build the runner image, create a Claude token). See [Getting started](../getting-started.md).

### `fh migrate`

Applies pending SQL migrations in order, each in its own transaction.

```bash
fh migrate
# applied: 001_init.sql      (or: nothing to apply)
```

### `fh workspace add <id> <name...>`

Creates a workspace, or renames it if the id exists. The name may contain spaces; if omitted it defaults to the id.

```bash
fh workspace add work "Work projects"
# workspace work ok
```

### `fh agent add <ws> <id> [options]`

Creates or updates (upserts) an agent in a workspace. Updating replaces name, role, model, `accepts_from` and prompt; permission additions (rules added with "Always allow") are kept.

| Option | Default | Meaning |
|---|---|---|
| `--name <name>` | the id | Display name |
| `--role <role>` | empty | Role, shown in the agent's first prompt |
| `--model <model>` | `sonnet` | Default model: `haiku`, `sonnet` or `opus` |
| `--prompt-file <path>` | none | File whose contents become the agent's identity prompt (appended to the system prompt) |
| `--accepts <a,b>` | empty (anyone) | Comma-separated agent ids allowed to send it `request` messages |

There is no CLI option for tools or permissions. Runs get the [permission defaults](../concepts/isolation-and-permissions.md#tool-permissions) for their mode, plus the agent's own additions, which the console's "Always allow" writes.

```bash
fh agent add personal vigil --name Vigil --role QA --model haiku --prompt-file ./vigil.md --accepts atlas
# agent personal/vigil ok
```

### `fh agent token <ws> <id>`

Issues a new bearer token for the agent and prints it once. Any previous token stops working, including the one a running container holds. Only a SHA-256 hash is stored. Mostly useful for the opt-in host runner or for experiments; `fh agent run` issues its own.

```bash
fh agent token dev atlas
# at_...
```

### `fh agent run <ws> <id> [--isolation docker]`

Starts the agent's runner **isolated**, as the container `fh-<ws>-<id>`. It issues a fresh agent token, removes an existing container of the same name and starts a new one with the `forgehall-agents` network, a work volume (`fh-<ws>-<id>-work`), `--restart unless-stopped`, and the agent token, the Claude token and `BUS_URL=http://bus:4545` as environment variables. `FORGEHALL_BILLING` is passed through if set in your shell.

Requirements, each with a message telling you what to do when missing: the agent exists, the runner image exists (`forgehall/runner:dev`, or `FORGEHALL_RUNNER_IMAGE`), the stack's network exists, and a Claude token is available (`CLAUDE_CODE_OAUTH_TOKEN`, or the file at `FORGEHALL_CLAUDE_TOKEN_FILE`, default `~/.config/forgehall/claude-token`).

| Option | Default | Meaning |
|---|---|---|
| `--isolation docker` | `docker` | Container isolation. `vm` (Incus) is **planned** for phase 5 and is refused today |

```bash
fh agent run dev atlas
# dev/atlas running isolated (docker, 5a7e1c0e91b2). Logs: docker logs -f fh-dev-atlas
```

### `fh agent stop <ws> <id>`

Removes the agent's container. The work volume stays.

```bash
fh agent stop dev atlas
# dev/atlas stopped          (or: dev/atlas was not running)
```

### `fh agent ps`

Lists isolated agents (containers labelled `forgehall.agent`), running or not: `<ws>/<agent>`, status and container name. Prints `no isolated agents` if there are none.

```bash
fh agent ps
# dev/atlas  Up 2 minutes  fh-dev-atlas
```

### `fh repo add <ws> <id> <upstream> [--base <branch>]`

Registers a repository in a workspace and creates its staging remote at `$FORGEHALL_HOME/staging/<ws>/<id>.git`. The provider is detected from the upstream URL. `fh` sends the request to the bus (`POST /api/workspaces/:ws/repos`, authenticated with the admin token), so the bus must be running; it is reached at `FORGEHALL_BUS_URL` (default `http://127.0.0.1:4545`). Running it again for the same id updates the upstream and base branch and refreshes the staging remote.

| Argument | Default | Meaning |
|---|---|---|
| `<id>` | required | Short name, for example `checkout-app` |
| `<upstream>` | required | A git URL, or a local path under `~/.forgehall` (for example `~/.forgehall/upstreams/checkout-app.git`). Approved work is published here |
| `--base <branch>` | `main` | Branch that approved work is merged into |

The provider is detected from the upstream URL:

| Upstream | Provider |
|---|---|
| `github.com` | `github` |
| `dev.azure.com` or `*.visualstudio.com` | `azure-devops` |
| anything else, including local paths | `local` |

Credentials embedded in the URL (`user@`) are stripped before the URL is stored. For a private `github` or `azure-devops` host, add its token in the console's Settings ([Publishing](console-api.md#publishing)) before running `fh repo add`: the bus clones the base branch then.

The staging remote is a bare repository seeded from the upstream's base branch, with a hook that accepts only `refs/heads/fh/*` pushes and no deletions. The workspace must exist.

The bus runs in a container and sees `~/.forgehall` as `/data`. `fh` asks the bus for its home (`GET /health`, field `home`) and translates a host path under `~/.forgehall` into the bus's path; a local path outside `~/.forgehall` is refused with a message, because the bus cannot see it. The upstream is stored, and printed, as the bus's path.

```bash
fh repo add dev checkout-app ~/.forgehall/upstreams/checkout-app.git --base main
# repo dev/checkout-app ok · upstream /data/upstreams/checkout-app.git · base main · staging ready
```

### `fh repos <ws>`

Lists a workspace's repositories: id, provider, base branch, upstream.

```bash
fh repos dev
# checkout-app  local  main  /data/upstreams/checkout-app.git
```

### `fh send <ws> <agent> <text...> [--title <title>] [--severity <s>] [--repo <id>]`

Opens a thread assigned to `<agent>` and posts a `request` from you. This queues a run for the agent.

| Option | Default | Meaning |
|---|---|---|
| `--title <title>` | first 60 characters of the text | Thread title |
| `--severity <s>` | none | Free text; the router treats `high` as high severity |
| `--repo <id>` | none | Bind the thread to a registered repository; it gets the branch `fh/<THREAD-ID>`. See [Work on a repository](../guides/work-on-a-repository.md) |

```bash
fh send work atlas "Checkout total is off by one cent with two coupons." --title "Coupon rounding" --severity high
# THR-0001 opened for atlas
fh send dev atlas "Fix rounding in total.js" --repo checkout-app
# THR-0002 opened for atlas
```

### `fh reply <thread> <text...> [--to <agent>] [--type <t>] [--re <message_id>]`

Posts a message as you into an existing thread.

| Option | Default | Meaning |
|---|---|---|
| `--to <agent>` | the thread's assignee | Recipient. Required if the thread has no assignee |
| `--type <t>` | `answer` | `answer`, `decision` or `request` |
| `--re <message_id>` | none | Message this replies to |

Posting to an agent queues a run for it, and `decision` or `request` can move the thread state (see the state table).

```bash
fh reply THR-0001 "Please also check with three items." --to atlas --type request
# message 5 sent to atlas
```

### `fh threads <ws> [--state <state>]`

Lists a workspace's threads, most recently updated first, optionally filtered by state.

```bash
fh threads work --state in_progress
# THR-0001  in_progress             atlas  Coupon rounding
```

### `fh thread <id>`

Shows one thread with its full message history.

```bash
fh thread THR-0001
# THR-0001 "Coupon rounding" · in_progress · assignee atlas
#
# #1 14:02:11 request you → atlas
#    Checkout total is off by one cent with two coupons.
```

### `fh runs <ws>`

Lists the 20 most recent runs of a workspace, newest first: run id, agent, thread, state (`queued`, `running`, `done`, `failed`), model/effort, the routing reason and any error.

```bash
fh runs work
# run 1 atlas THR-0001 done sonnet/medium · request received: agent default model
```

### `fh usage <ws>`

Prints the latest usage reading for the workspace's account (5-hour and 7-day utilisation, reset times, status), or `no reading yet` if no run has reported one.

```bash
fh usage work
```

## Environment

`DATABASE_URL` selects the database, `FORGEHALL_HOME` the data directory (default `~/.forgehall`, holding the admin token), `FORGEHALL_BUS_URL` where `fh repo add` reaches the bus, and `FORGEHALL_ADMIN_TOKEN` overrides the admin token file; see [configuration](configuration.md). `fh agent run` also reads `FORGEHALL_RUNNER_IMAGE`, `FORGEHALL_CLAUDE_TOKEN_FILE`, `CLAUDE_CODE_OAUTH_TOKEN`, `FORGEHALL_AGENT_NETWORK`, `FORGEHALL_AGENT_BUS_URL` and `FORGEHALL_BILLING`.

Approvals and permission requests are decided in the console or with the console API ([console API](console-api.md)); there is no `fh` command for them yet.
