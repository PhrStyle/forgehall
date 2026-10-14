# Model routing and limits

Forgehall chooses the model and effort for every run, records the reason, and limits how many runs execute at once. It also reads real usage numbers from the Claude Code CLI.

Legend: **[now]** implemented in phase 1, **[planned]** not built yet.

## Routing rules (v1) [now]

Rules are deterministic and applied when a run is queued, in this order (first match wins). The code is `packages/bus/src/router.ts`.

| Order | Situation | Model | Effort |
|---|---|---|---|
| 1 | The agent called `escalate` on this thread | `opus` | high |
| 2 | Two or more failed runs of this agent on this thread | `opus` | high |
| 3 | Triggering message is `answer`, `notify` or `ask` | `haiku` | low |
| 4 | Thread severity is `high` and the agent's default is `haiku` | `sonnet` | medium |
| 5 | Anything else (`request`, `verify`, `decision`, `approval`) | the agent's default model | medium |

Every run stores the reason (visible in `fh runs <workspace>`), for example `high severity with a Haiku default agent`. An escalation applies to the next run of that agent on that thread only.

Only `haiku`, `sonnet` and `opus` are allowed. Fable is excluded because it is not included in Team Standard seats. A failed run puts its messages back in the queue, so it is retried; after two failures the router moves the thread to Opus.

**[planned]** Post-thread reflection on Sonnet, weekly memory consolidation on Haiku, a `--fallback-model` that always points to a cheaper model, and tuning the rules from stored run data (model, success, tokens).

## Queue and concurrency [now]

- One run per agent at a time.
- At most `MAX_RUNNING` runs in progress per workspace (default 2). This is a stand-in for the planned per-account semaphore.
- Within an agent, the queue is ordered by priority, then age. Lower number runs first, so replies unblock other agents before new work starts:

| Priority | Trigger type |
|---|---|
| 1 | `answer`, `decision` |
| 3 | `verify` |
| 4 | `ask` |
| 5 | `request` |
| 6 | `notify`, `approval` |

- If a run is already queued for the same agent and thread, new messages join it instead of creating another run. All undelivered messages for that agent and thread go into one prompt.
- Claims are serialised per workspace with a Postgres advisory lock, and the queue uses `FOR UPDATE SKIP LOCKED`.

## Real usage [now]

Each Claude Code CLI run emits a `rate_limit_event` with the account's utilisation in the **5-hour** and **7-day** windows and their reset times. The runner keeps the last one it saw and sends it with the run's `finish` call. The bus stores the latest reading per workspace; read it with `fh usage <workspace>`. These are the CLI's own numbers, not an estimate. (Validated against Claude Code 2.1.296.) Because phase 1 has one account per workspace, usage is stored per workspace.

## Pauses and limits [planned]

- Pause the account's queue until `resetsAt` when the CLI reports it hit a limit.
- Preventive pause when the 7-day window passes 85% or the 5-hour window passes 95%, with a manual release.
- A per-account concurrency semaphore (default 2) instead of per workspace.
- A `share` setting dividing the weekly limit between workspaces that share an account.
- Pay-per-use accounts limited by a dollar budget, measured from each run's `total_cost_usd` (already stored as `cost_usd`).

Until these exist, nothing stops runs when you approach a limit. Watch `fh usage` yourself.
