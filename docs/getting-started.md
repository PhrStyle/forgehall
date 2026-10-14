# Getting started

By the end of this tutorial you will have a local bus and two agents running. You will ask one agent (vigil, QA) a question, watch it ask the other (atlas, dev), and read the result as a thread.

Everything here is **phase 1**. There is no console yet; you drive Forgehall with the `fh` CLI.

## Prerequisites

- Node 22 and pnpm
- Docker (the bus needs Postgres; a compose file is provided)
- The Claude Code CLI installed and logged in with your own subscription (`claude` must work in your shell)

Runs call the real Claude Code CLI, so **they consume your account's usage limits**. This tutorial uses Haiku and short tasks to keep that small.

## 1. Clone, install, build

```bash
git clone <repository-url> forgehall && cd forgehall
pnpm install && pnpm build
```

## 2. Start Postgres and create the schema

```bash
docker compose -f infra/docker/compose.yaml -p forgehall up -d
alias fh="node packages/bus/dist/cli.js"
fh migrate
```

Postgres listens on `127.0.0.1:5433`. `fh migrate` prints the migrations it applied.

## 3. Create a workspace and two agents

```bash
echo "You are Vigil, the QA agent. Be brief." > vigil.md
echo "You are Atlas, the developer agent. Known fact: the checkout bug also happens without a coupon, in 2 out of 5 runs. Be brief." > atlas.md

fh workspace add dev "Dev"
fh agent add dev vigil --name Vigil --role QA --model haiku --prompt-file vigil.md
fh agent add dev atlas --name Atlas --role Dev --model haiku --prompt-file atlas.md
```

A workspace is an isolated team. Each agent has a role, a default model and an identity prompt (`--prompt-file`). Atlas's prompt plants a fact so you can see it travel from one agent to another.

## 4. Start the bus and one runner per agent

```bash
node packages/bus/dist/index.js &                                   # bus on 127.0.0.1:4545
AGENT_TOKEN=$(fh agent token dev vigil) node packages/runner/dist/index.js &
AGENT_TOKEN=$(fh agent token dev atlas) node packages/runner/dist/index.js &
```

`fh agent token` prints a fresh token and invalidates the previous one. Each runner long-polls the bus for work for its own agent. Runners run on your host in this phase and work under `./.work/<thread-id>/`.

## 5. Send a task

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

Output from a real run (timestamps and wording will differ):

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

If the thread has only message #1 yet, the agents are still working. Check the runner and bus logs in the terminal.

## What happened

1. `fh send` created the thread and message #1. The bus **queued a run** for vigil.
2. Vigil's runner claimed the run and started `claude -p ...` with the bus attached as an MCP server named `bus`. Vigil called the `ask` tool, which posted message #2 and queued a run for atlas. Asking **ends vigil's turn**; nobody blocks waiting.
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

## Stop everything

```bash
kill %1 %2 %3                       # bus and both runners, in the shell where you started them
docker compose -f infra/docker/compose.yaml -p forgehall down
```

Add `-v` to the last command to also delete the database volume.

## Next

- [Overview](concepts/overview.md) for how the pieces fit together
- [CLI reference](reference/cli.md)
- [SECURITY.md](../SECURITY.md) before you give agents more tools than file access
