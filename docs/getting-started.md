# Getting started

By the end of this tutorial you will have the Forgehall stack running in Docker and two isolated agents. You will ask one agent (vigil, QA) a question, watch it ask the other (atlas, dev), and read the result as a thread.

This tutorial drives Forgehall with the `fh` CLI and, at the end, shows the same thread in the web console. To have agents change code in a repository, continue with [Work on a repository](guides/work-on-a-repository.md). To understand why agents run in containers, read [Isolation and permissions](concepts/isolation-and-permissions.md).

## Prerequisites

- Node 22 and pnpm
- Docker. Rootless Docker works; `fh setup` detects it.
- The Claude Code CLI installed and logged in with your own subscription (`claude` must work in your shell). You use it once to create a token for the containers.

Runs call the real Claude Code CLI, so **they consume your account's usage limits**. This tutorial uses Haiku and short tasks to keep that small.

## 1. Clone, install, build

```bash
git clone <repository-url> forgehall && cd forgehall
pnpm install && pnpm build
alias fh="node packages/bus/dist/cli.js"   # for the first fh setup only; it installs the fh command
```

## 2. Prepare this machine

```bash
fh setup
```

Output:

```
Data directory: /home/you/.forgehall
Docker: rootless (stack runs as 0:0)
Wrote /home/you/forgehall/infra/docker/.env

Next:
  docker compose -f infra/docker/compose.yaml -p forgehall up -d --build
  docker build -f infra/docker/Dockerfile --target runner -t forgehall/runner:dev .
  claude setup-token   # once; save it to ~/.config/forgehall/claude-token (chmod 600)
  fh supervise --install
```

`fh setup` creates `~/.forgehall` with the admin token (mode `0600`) and an `upstreams/` folder, and writes `infra/docker/.env` with the data directory and the user the bus runs as. With rootful Docker it prints your uid and gid instead of `0:0`.

## 3. Start the stack

```bash
docker compose -f infra/docker/compose.yaml -p forgehall up -d --build
curl -s http://127.0.0.1:4545/health
```

```
{"ok":true,"home":"/data"}
```

This runs Postgres and the bus. The bus applies its migrations at startup, mounts `~/.forgehall` at `/data`, listens on `127.0.0.1:4545` only, and joins the `forgehall-agents` network where agents reach it as `http://bus:4545`. Postgres is published on `127.0.0.1:5433` for `fh`.

## 4. Build the runner image and create a Claude token

Build the image once. Every agent runs in a container from it:

```bash
docker build -f infra/docker/Dockerfile --target runner -t forgehall/runner:dev .
```

Containers cannot use your interactive login, so create a long-lived token for your own subscription, once:

```bash
claude setup-token
```

Keep it at hand: in step 6 you add it in the console under **Settings → Claude accounts** (stored in `~/.forgehall/secrets`, readable only by you, never shown again) and pick that account for the workspace. Alternatively set `CLAUDE_CODE_OAUTH_TOKEN` in the shell where you run `fh agent run`.

## 5. Create a workspace and two agents

```bash
echo "You are Vigil, the QA agent. Be brief." > vigil.md
echo "You are Atlas, the developer agent. Known fact: the checkout bug also happens without a coupon, in 2 out of 5 runs. Be brief." > atlas.md

fh workspace add dev "Dev"
fh agent add dev vigil --name Vigil --role QA --model haiku --prompt-file vigil.md
fh agent add dev atlas --name Atlas --role Dev --model haiku --prompt-file atlas.md
```

A workspace is an isolated team. Each agent has a role, a default model and an identity prompt (`--prompt-file`). Atlas's prompt plants a fact so you can see it travel from one agent to another.

## 6. Add your Claude account and start the agents

Open the console (`pnpm --filter @forgehall/console dev`, then <http://localhost:5173>), go to **Settings → Claude accounts**, add an account (label, plan, the token from step 4) and select it for the `dev` workspace under **Account per workspace**. Then install the supervisor once. It starts each agent in its own container:

```bash
fh supervise --install
fh agent ps
```

```
dev/vigil  Up 5 seconds  fh-dev-vigil
dev/atlas  Up 4 seconds  fh-dev-atlas
```

Each agent is one container (`fh-<workspace>-<agent>`) on the `forgehall-agents` network, with its own work volume and a restart policy. The supervisor keeps them running and restarts them after a reboot; see [Run agents in Docker](guides/run-agents-in-docker.md). `fh agent run dev vigil` starts one agent by hand instead, and issues a fresh agent token each time. The runner long-polls the bus for work and works under `/home/agent/work/<thread-id>/` in its container.

## 7. Send a task

```bash
fh send dev vigil "Ask atlas (ask tool) whether the checkout bug happens without a coupon, then answer me with what atlas said." --title "Checkout total bug"
```

`fh send` opens a thread, posts a `request` from you to vigil and queues a run. Output:

```
THR-0001 opened for vigil
```

Wait a minute or two, then read the thread:

```bash
fh thread THR-0001
```

Output from a real run, recorded before agents moved into containers (timestamps and wording will differ):

```
THR-0001 "Checkout total bug" · in_progress · assignee vigil

#1 03:53:02 request you → vigil
   Ask atlas (ask tool) whether the checkout bug happens without a coupon, then answer me with what atlas said.
#2 03:53:06 ask vigil → atlas
   Does the checkout total bug also happen without a coupon applied?
#3 03:53:10 answer atlas → vigil
   Yes. The checkout total bug also happens without a coupon, in 2 out of 5 runs.
#4 03:53:13 answer vigil → you
   Atlas says yes: the checkout total bug also happens without a coupon, in 2 out of 5 runs.
```

If the thread has only message #1 yet, the agents are still working. Check `docker logs -f fh-dev-vigil`.

## What happened

1. `fh send` created the thread and message #1. The bus **queued a run** for vigil.
2. Vigil's runner (in its container) claimed the run and started `claude -p ...` with the bus attached as an MCP server named `bus`. Vigil called the `ask` tool, which posted message #2 and queued a run for atlas. Asking **ends vigil's turn**; nobody blocks waiting.
3. Atlas's runner claimed its run, called `answer` (message #3) and queued a run for vigil.
4. Vigil's second run **resumed the same Claude session** (`--resume <session_id>`), so it remembered the original task. It called `answer` addressed to `you` (message #4). Messages to you do not create runs; they wait in the thread.

The thread state is `in_progress`. Phase 1 has no step that closes a thread; `verify`, approval and completion arrive with later phases.

## Inspect the runs

```bash
fh runs dev
```

```
run 3 vigil THR-0001 done haiku/low · handling answer: short task
run 2 atlas THR-0001 done haiku/low · handling ask: short task
run 1 vigil THR-0001 done haiku/medium · request received: agent default model
```

This is **model routing**, visible per run: the first run uses the agent's default model, while short reply-type work (`ask`, `answer`, `notify`) goes to Haiku at low effort. Each run stores the reason. See [Model routing and limits](concepts/model-routing-and-limits.md) for the rules. Runs that fail show `· error: ...` at the end.

## Check usage

```bash
fh usage dev
```

Example output:

```
{
  workspace_id: 'dev',
  five_hour: 0.04,
  five_hour_resets_at: 2026-10-13T17:00:00.000Z,
  seven_day: 0.01,
  seven_day_resets_at: 2026-10-18T09:00:00.000Z,
  status: 'allowed',
  updated_at: 2026-10-13T14:02:35.512Z
}
```

These are the numbers the Claude Code CLI itself reports for your account's 5-hour and 7-day windows, forwarded by the runner after each run. Until a run has finished you will see `no reading yet`.

## Talk back to the thread

You can reply as yourself:

```bash
fh reply THR-0001 "Thanks. Please check the same with two items in the cart." --to vigil --type request
```

This queues another vigil run on the same thread, resuming its session.

## Watch it in the console

With the stack running, start the web console in another terminal:

```bash
pnpm --filter @forgehall/console dev
```

Open <http://localhost:5173>. You will see your agents and their status, the thread `THR-0001` with its messages and runs in order, and each agent's live activity (tool calls, messages sent over the bus, cost and duration). You can also send a new task and answer in the thread from there. Memory, Skills, Environment and Versions on an agent page are previews with sample data.

The console's dev server reads the admin token from `~/.forgehall/admin-token` and adds it to every `/api` request it proxies. The browser never sees it. If the console shows `401` errors, run `fh setup` and restart it.

### Answering permission requests

When an agent wants to do something no rule covers, for example `npm install` or `curl`, the run pauses and a card appears under **Waiting on you**, in the thread and on the agent page. Choose **Allow once**, **Always allow** (adds a rule such as `Bash(npm install *)` to that agent) or **Deny**, optionally with a reason. If you do not answer within 15 minutes the request counts as denied. Details: [Isolation and permissions](concepts/isolation-and-permissions.md).

## If a task stays queued

A run only starts when the agent's runner is connected. The console marks an agent without one **Runner offline**, and shows a banner if the supervisor is not running (start it with `fh supervise --install`). Otherwise start the agent from its page with **Start**, or by hand:

```bash
fh agent run dev vigil
docker logs -f fh-dev-vigil
```

Typical causes: the supervisor is not running, the agent is stopped, the container exited (see the logs), or the runner image or Claude token is missing (`fh agent run` explains which). A runner that logs a refusal about running directly on this machine is a host runner; start agents with the supervisor or `fh agent run` instead.

## Stop everything

`fh agent stop` also tells the supervisor to leave the agent stopped.

```bash
fh agent stop dev vigil
fh agent stop dev atlas
docker compose -f infra/docker/compose.yaml -p forgehall down
```

Add `-v` to the last command to also delete the database volume. Agent work volumes (`fh-dev-vigil-work`) stay until you remove them with `docker volume rm`.

## Next

- [Overview](concepts/overview.md) for how the pieces fit together
- [CLI reference](reference/cli.md)
- [Isolation and permissions](concepts/isolation-and-permissions.md) for what agents may do
- [Run agents in Docker](guides/run-agents-in-docker.md) for day-to-day operation
- [SECURITY.md](../SECURITY.md) before you widen what agents may do
