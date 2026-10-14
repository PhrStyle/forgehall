# Schedules

**[planned, phase 2]** Agents can run on a schedule: nightly checks, weekly reviews, a daily digest. Nothing here is built yet.

## How it works

Schedules live in the bus, not in the operating system's cron and not in Claude Code's session-scoped `/loop`. Every 30 seconds the bus looks for schedules that are due and, for each one, opens a thread with a `request` from `system` to the agent. From there it is a normal thread: queue, model routing, concurrency limits and approvals all apply.

```yaml
# workspaces/work/workspace.yaml
schedules:
  - id: nightly-regression
    agent: probe
    cron: "0 2 * * 1-5"           # weekdays at 02:00
    timezone: America/Sao_Paulo
    title: Nightly API regression
    prompt: Run the contract suite against staging. Open a request to forge for each new failure.
    thread: new                    # new: a fresh thread each time | same: one recurring thread
    skip_if_usage_above: 0.7       # skip when the account's 7-day usage is above 70%
  - id: weekly-improvement
    agent: mentor
    cron: "0 9 * * 1"
    prompt: Review last week's threads, failed runs and rejected learnings. Propose skill and memory improvements.
```

## Guard rails

- **No overlap.** If the previous occurrence is still open, the new one is skipped and the skip is recorded.
- **Usage aware.** An occurrence is skipped when the account's usage is above `skip_if_usage_above`.
- **Quiet when there is nothing to report.** The agent closes the thread with `complete(thread_id, summary)` and you are not notified. Findings become requests to other agents or questions to you, like any other thread.
- **`new` vs `same` threads.** `new` keeps each run's context small and cheap. `same` resumes one session, useful when the agent should remember previous occurrences, at the cost of a growing context.

## Examples

| Schedule | Agent | What it does |
|---|---|---|
| Nightly regression | QA | Runs the suite, opens a request to the developer for each new failure |
| Weekly dependency check | Dev | Lists outdated or vulnerable dependencies, proposes upgrades |
| Weekly improvement review | Mentor | Reviews recent threads, failures and rejected learnings; proposes skill and memory changes for approval |
| Daily digest | Any | Summarises what the team did and what waits on you |
