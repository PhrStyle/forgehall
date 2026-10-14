# CLI reference: `fh`

`fh` operates Forgehall from the terminal. It talks to Postgres directly (not through the bus HTTP API), so it needs `DATABASE_URL` access, but the bus does not have to be running.

```bash
alias fh="node packages/bus/dist/cli.js"
```

Status: **implemented**. The CLI is also exposed as the `fh` bin of `@forgehall/bus`. See [threads and messages](../concepts/threads-and-messages.md) for the thread states.

Run `fh help` (or `fh` with no arguments) for a short usage text. Errors print a message and exit with code 1.

## Commands

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

Creates or updates (upserts) an agent in a workspace. Updating replaces name, role, model, `accepts_from`, prompt and tool list.

| Option | Default | Meaning |
|---|---|---|
| `--name <name>` | the id | Display name |
| `--role <role>` | empty | Role, shown in the agent's first prompt |
| `--model <model>` | `sonnet` | Default model: `haiku`, `sonnet` or `opus` |
| `--prompt-file <path>` | none | File whose contents become the agent's identity prompt (appended to the system prompt) |
| `--accepts <a,b>` | empty (anyone) | Comma-separated agent ids allowed to send it `request` messages |

The allowed tools are reset to the defaults (`Read`, `Glob`, `Grep`, `Edit`, `Write`); there is no CLI option to change them yet.

```bash
fh agent add personal vigil --name Vigil --role QA --model haiku --prompt-file ./vigil.md --accepts atlas
# agent personal/vigil ok
```

### `fh agent token <ws> <id>`

Issues a new bearer token for the agent and prints it once. Any previous token stops working. Only a SHA-256 hash is stored. Use it as the runner's `AGENT_TOKEN`.

```bash
AGENT_TOKEN=$(fh agent token personal vigil) node packages/runner/dist/index.js
```

### `fh repo add <ws> <id> <upstream> [--base <branch>]`

Registers a repository in a workspace (provider `local`) and creates its staging remote at `$FORGEHALL_HOME/staging/<ws>/<id>.git`. Running it again for the same id updates the upstream and base branch and refreshes the staging remote.

| Argument | Default | Meaning |
|---|---|---|
| `<id>` | required | Short name, for example `checkout-app` |
| `<upstream>` | required | Any git URL or path that `git push` can write to; approved work is published here |
| `--base <branch>` | `main` | Branch that approved work is merged into |

The staging remote is a bare repository seeded from the upstream's base branch, with a hook that accepts only `refs/heads/fh/*` pushes and no deletions. `fh` needs `git` and the same `FORGEHALL_HOME` as the bus. The workspace must exist.

```bash
fh repo add dev checkout-app /tmp/fh-demo/checkout-app.git --base main
# repo dev/checkout-app ok · upstream /tmp/fh-demo/checkout-app.git · base main · staging ready
```

### `fh repos <ws>`

Lists a workspace's repositories: id, provider, base branch, upstream.

```bash
fh repos dev
# checkout-app  local  main  /tmp/fh-demo/checkout-app.git
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

`DATABASE_URL` selects the database and `FORGEHALL_HOME` the data directory (staging remotes); see [configuration](configuration.md).

Approvals are decided in the console or with `POST /api/approvals/:id/decide` ([console API](console-api.md)); there is no `fh` command for it yet.
