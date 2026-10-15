# Schedules

**[implemented, phase 2]** Agents run on a schedule: nightly checks, weekly reviews, a daily digest. Schedules are created and edited in the console (left rail, Schedules). They are stored in the bus, not in a workspace file.

Not built yet: notifications when a scheduled run needs you or finishes (planned with notifications, F6). Until then, check the Schedules view or the thread.

## How it works

Schedules live in the bus, not in the operating system's cron and not in Claude Code's session-scoped `/loop`. Every `SCHEDULE_TICK_SECONDS` (default 30) the bus fires the schedules that are due. For each one it opens a thread, titled with the schedule's title and created by `system`, assigned to the agent (with the repository, if set). The thread starts with a `request` from `system` containing the prompt and a suffix:

> (Scheduled: Weekdays at 02:00. If there is nothing to report, close the thread with complete.)

With thread mode `same`, the run posts to the recurring thread instead of opening a new one. From there it is a normal thread: queue, model routing, concurrency limits and approvals all apply. Requests from `system` pass the agent's `accepts_from` list like any other request.

A missed run (the bus was down) fires once when the bus is back, not once per missed occurrence.

### Fields

| Field | Meaning |
|---|---|
| Agent | The agent that receives the thread |
| Title | Thread title |
| What to do | The prompt sent with the request |
| Repository | Optional. The thread gets a branch `fh/<THREAD-ID>` in it |
| Repeat | A repeat rule (below) |
| Timezone | IANA name, such as `America/Sao_Paulo`. The console defaults to the browser's |
| Thread | `new`: a new thread each run (small, cheap context). `same`: one recurring thread, reopened when done (the agent remembers earlier runs, at the cost of a growing context) |
| Skip if the previous run is open | Default on. See [Guard rails](#guard-rails) |
| Skip above usage | `0` to `1`, a share of the account's 7-day window. Default 0.7 in the console |
| Enabled | Off schedules do not fire |

### Repeat rules

The rule is stored as a `ScheduleRule`. The bus converts it to cron and evaluates it in the schedule's timezone with cron-parser.

| Rule | Example | Cron |
|---|---|---|
| `daily` at a time | Every day at 09:00 | `0 9 * * *` |
| `weekdays` at a time | Weekdays at 02:00 | `0 2 * * 1-5` |
| `days` (chosen weekdays, 0 = Monday) at a time | Mondays and Thursdays at 09:00 | `0 9 * * 1,4` |
| `every` N hours (1 to 12) at a minute | Every 2 hours at :15 | `15 */2 * * *` |
| `monthly` on day 1 to 31 or `last`, optionally only in chosen months | Last day of Jan, Apr, Jul and Oct at 08:00 (quarterly) | `0 8 L 1,4,7,10 *` |
| `once` at a local date and time | 2026-11-03 09:00 | none; the schedule turns itself off after it runs |

Yearly is a `monthly` rule with one month. Schedules that run every hour or two are drawn as bands in the calendar, not one block per run.

### Run status

The console shows each run as one of:

- **upcoming**: not yet due.
- **running**: the thread has a run in progress.
- **needs_you**: waiting for an approval or an answer from you.
- **done**: the thread is done.
- **failed**: the thread is blocked or cancelled.
- **skipped**: a guard applied. The reason is recorded, for example "the previous run is still open (THR-0042)" or "weekly usage at 76% (skips above 70%)".

## Guard rails

- **No overlap.** With `skip_if_open` (default on), if the previous run's thread is still open, the new run is skipped and the skip is recorded.
- **Usage aware.** A run is skipped when the account's 7-day usage is above `skip_usage_above`.
- **Quiet when there is nothing to report.** The prompt suffix asks the agent to close the thread with `complete` when there is nothing to report. Findings become requests to other agents or questions to you, like any other thread.
- **Run now** opens a run immediately. The guards are not applied.
- **`new` vs `same` threads.** `new` keeps each run's context small and cheap. `same` resumes one session, useful when the agent should remember previous runs, at the cost of a growing context.

## Examples

Fictional agents `atlas` and `vigil`; the repository is `checkout-app`.

| Schedule | Agent | Repeat rule | What it does |
|---|---|---|---|
| Nightly regression | vigil | Weekdays at 02:00 | Runs the suite on `checkout-app`, opens a request to atlas for each new failure |
| Weekly dependency check | atlas | Mondays at 09:00 (`days`: Monday) | Lists outdated or vulnerable dependencies, proposes upgrades |
| Daily digest | vigil | Every day at 18:00 (`daily`), thread `same` | Summarises what the team did and what waits on you |
| Quarterly review | atlas | Last day of Jan, Apr, Jul and Oct at 08:00 (`monthly`) | Reviews the quarter's threads and failed runs |
