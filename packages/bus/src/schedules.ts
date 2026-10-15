import { randomBytes } from "node:crypto";
import { describeRule, HUMAN, isFrequent, ruleToCron, ScheduleRule, SYSTEM } from "@forgehall/shared";
import { isTimezone, nextRun, runsBetween } from "./schedule-time.js";
import { BusError, CHANGES_CHANNEL, type Store, type ThreadRow } from "./store.js";

/**
 * Schedules live in the bus (docs/concepts/schedules.md). When one is due the bus opens a thread
 * with a request from `system` to the agent (or posts to the schedule's recurring thread), so
 * queueing, routing, limits and approvals apply as for any other work.
 */

export type RunStatus = "upcoming" | "running" | "needs_you" | "done" | "failed" | "skipped";

export interface ScheduleRow {
  id: string;
  workspace_id: string;
  agent_id: string;
  title: string;
  prompt: string;
  repo_id: string | null;
  rule: ScheduleRule;
  timezone: string;
  thread_mode: "new" | "same";
  skip_if_open: boolean;
  skip_usage_above: number | null;
  enabled: boolean;
  next_run_at: Date | null;
  same_thread_id: string | null;
  created_at: Date;
}

export interface ScheduleInput {
  agent: string;
  title: string;
  prompt: string;
  repo?: string | null;
  rule: unknown;
  timezone: string;
  thread_mode: "new" | "same";
  skip_if_open: boolean;
  skip_usage_above: number | null;
  enabled?: boolean;
}

/** How a run that opened a thread is doing, from the thread's state (alias t) and what waits on the user. */
const STATUS_SQL = `CASE
  WHEN r.skipped IS NOT NULL THEN 'skipped'
  WHEN t.id IS NULL THEN 'failed'
  WHEN t.state = 'done' THEN 'done'
  WHEN t.state IN ('blocked', 'cancelled') THEN 'failed'
  WHEN t.state = 'awaiting_approval'
    OR EXISTS (SELECT 1 FROM messages q WHERE q.thread_id = t.id AND q.type = 'ask' AND q.to_actor = '${HUMAN}'
      AND NOT EXISTS (SELECT 1 FROM messages a WHERE a.thread_id = t.id AND a.from_actor = '${HUMAN}' AND a.id > q.id))
    THEN 'needs_you'
  ELSE 'running' END`;

export class Schedules {
  constructor(private readonly store: Store) {}

  private get sql() {
    return this.store.sql;
  }

  private async changed(workspaceId: string): Promise<void> {
    await this.sql`SELECT pg_notify(${CHANGES_CHANNEL}, ${JSON.stringify({ kind: "schedule", workspace: workspaceId })})`;
  }

  private async validate(workspaceId: string, i: ScheduleInput): Promise<ScheduleRule> {
    const parsed = ScheduleRule.safeParse(i.rule);
    if (!parsed.success) throw new BusError(`invalid repeat rule: ${parsed.error.issues.map((x) => x.message).join("; ")}`);
    if (!i.title.trim() || !i.prompt.trim()) throw new BusError("title and what to do are required");
    if (!isTimezone(i.timezone)) throw new BusError(`unknown timezone ${i.timezone}`);
    if (!(await this.store.agent(workspaceId, i.agent))) throw new BusError(`agent ${i.agent} does not exist in ${workspaceId}`);
    if (i.repo && !(await this.store.repo(workspaceId, i.repo))) throw new BusError(`repo ${i.repo} does not exist in ${workspaceId}`);
    if (i.skip_usage_above !== null && !(i.skip_usage_above > 0 && i.skip_usage_above <= 1)) throw new BusError("skip_usage_above must be between 0 and 1");
    return parsed.data;
  }

  async create(workspaceId: string, i: ScheduleInput): Promise<ReturnType<Schedules["view"]>> {
    const rule = await this.validate(workspaceId, i);
    const enabled = i.enabled ?? true;
    const next = enabled ? nextRun(rule, i.timezone, new Date()) : null;
    const id = `sch_${randomBytes(5).toString("hex")}`;
    await this.sql`INSERT INTO schedules (id, workspace_id, agent_id, title, prompt, repo_id, rule, timezone, thread_mode, skip_if_open, skip_usage_above, enabled, next_run_at)
      VALUES (${id}, ${workspaceId}, ${i.agent}, ${i.title.trim()}, ${i.prompt.trim()}, ${i.repo ?? null}, ${this.sql.json(rule as never)}, ${i.timezone},
        ${i.thread_mode}, ${i.skip_if_open}, ${i.skip_usage_above}, ${enabled}, ${next})`;
    await this.changed(workspaceId);
    return (await this.get(id))!;
  }

  async update(id: string, patch: Partial<ScheduleInput>): Promise<ReturnType<Schedules["view"]>> {
    const cur = await this.row(id);
    const merged: ScheduleInput = {
      agent: patch.agent ?? cur.agent_id, title: patch.title ?? cur.title, prompt: patch.prompt ?? cur.prompt,
      repo: patch.repo !== undefined ? patch.repo : cur.repo_id, rule: patch.rule ?? cur.rule, timezone: patch.timezone ?? cur.timezone,
      thread_mode: patch.thread_mode ?? cur.thread_mode, skip_if_open: patch.skip_if_open ?? cur.skip_if_open,
      skip_usage_above: patch.skip_usage_above !== undefined ? patch.skip_usage_above : cur.skip_usage_above,
      enabled: patch.enabled ?? cur.enabled,
    };
    const rule = await this.validate(cur.workspace_id, merged);
    const next = merged.enabled ? nextRun(rule, merged.timezone, new Date()) : null;
    // A new agent or thread mode starts a new recurring thread.
    const keepThread = merged.agent === cur.agent_id && merged.thread_mode === "same" && (merged.repo ?? null) === cur.repo_id;
    await this.sql`UPDATE schedules SET agent_id = ${merged.agent}, title = ${merged.title.trim()}, prompt = ${merged.prompt.trim()}, repo_id = ${merged.repo ?? null},
        rule = ${this.sql.json(rule as never)}, timezone = ${merged.timezone}, thread_mode = ${merged.thread_mode}, skip_if_open = ${merged.skip_if_open},
        skip_usage_above = ${merged.skip_usage_above}, enabled = ${merged.enabled!}, next_run_at = ${next},
        same_thread_id = ${keepThread ? cur.same_thread_id : null}
      WHERE id = ${id}`;
    await this.changed(cur.workspace_id);
    return (await this.get(id))!;
  }

  async remove(id: string): Promise<void> {
    const cur = await this.row(id);
    await this.sql`DELETE FROM schedules WHERE id = ${id}`;
    await this.changed(cur.workspace_id);
  }

  private async row(id: string): Promise<ScheduleRow> {
    const [s] = await this.sql<ScheduleRow[]>`SELECT * FROM schedules WHERE id = ${id}`;
    if (!s) throw new BusError(`schedule ${id} not found`);
    return s;
  }

  private view(s: ScheduleRow, last: { at: Date; status: RunStatus; reason: string | null; thread_id: string | null } | null) {
    return {
      id: s.id, workspace_id: s.workspace_id, agent_id: s.agent_id, title: s.title, prompt: s.prompt, repo_id: s.repo_id,
      rule: s.rule, timezone: s.timezone, thread_mode: s.thread_mode, skip_if_open: s.skip_if_open, skip_usage_above: s.skip_usage_above,
      enabled: s.enabled, cron: ruleToCron(s.rule), description: describeRule(s.rule), next_run_at: s.next_run_at, last_run: last, created_at: s.created_at,
    };
  }

  async get(id: string) {
    return (await this.list(undefined, id))[0] ?? null;
  }

  async list(workspaceId?: string, id?: string) {
    const rows = await this.sql<(ScheduleRow & { last_at: Date | null; last_status: RunStatus | null; last_reason: string | null; last_thread: string | null })[]>`
      SELECT s.*, l.due_at AS last_at, l.status AS last_status, l.skipped AS last_reason, l.thread_id AS last_thread
      FROM schedules s
      LEFT JOIN LATERAL (
        SELECT r.due_at, r.skipped, r.thread_id, ${this.sql.unsafe(STATUS_SQL)} AS status
        FROM schedule_runs r LEFT JOIN threads t ON t.id = r.thread_id
        WHERE r.schedule_id = s.id ORDER BY r.due_at DESC, r.id DESC LIMIT 1
      ) l ON true
      WHERE ${workspaceId ? this.sql`s.workspace_id = ${workspaceId}` : this.sql`s.id = ${id!}`}
      ORDER BY s.created_at`;
    return rows.map((r) => this.view(r, r.last_at ? { at: r.last_at, status: r.last_status!, reason: r.last_reason, thread_id: r.last_thread } : null));
  }

  /** Past runs in the range (from the record) and future ones (computed); frequent schedules are listed apart. */
  async calendar(workspaceId: string, from: Date, to: Date) {
    if (!(to > from)) throw new BusError("to must be after from");
    if (to.getTime() - from.getTime() > 400 * 86_400_000) throw new BusError("the range can span at most 400 days");
    const schedules = await this.sql<ScheduleRow[]>`SELECT * FROM schedules WHERE workspace_id = ${workspaceId}`;
    const frequent = schedules.filter((s) => isFrequent(s.rule)).map((s) => s.id);
    const past = await this.sql<{ schedule_id: string; at: Date; status: RunStatus; reason: string | null; thread_id: string | null }[]>`
      SELECT r.schedule_id, r.due_at AS at, ${this.sql.unsafe(STATUS_SQL)} AS status, r.skipped AS reason, r.thread_id
      FROM schedule_runs r JOIN schedules s ON s.id = r.schedule_id LEFT JOIN threads t ON t.id = r.thread_id
      WHERE s.workspace_id = ${workspaceId} AND r.due_at >= ${from} AND r.due_at < ${to}
        AND NOT (s.rule->>'kind' = 'every' AND (s.rule->>'hours')::int <= 2)
      ORDER BY r.due_at`;
    const now = new Date();
    const upcoming = schedules
      .filter((s) => s.enabled && !isFrequent(s.rule))
      .flatMap((s) => runsBetween(s.rule, s.timezone, from > now ? from : now, to, 1000)
        .map((at) => ({ schedule_id: s.id, at, status: "upcoming" as RunStatus, reason: null, thread_id: null })));
    return { occurrences: [...past, ...upcoming], frequent };
  }

  preview(rule: unknown, timezone: string) {
    const parsed = ScheduleRule.safeParse(rule);
    if (!parsed.success) throw new BusError(`invalid repeat rule: ${parsed.error.issues.map((x) => x.message).join("; ")}`);
    if (!isTimezone(timezone)) throw new BusError(`unknown timezone ${timezone}`);
    const next: Date[] = [];
    let after = new Date();
    for (let i = 0; i < 5; i++) {
      const d = nextRun(parsed.data, timezone, after);
      if (!d) break;
      next.push(d);
      after = d;
    }
    return { cron: ruleToCron(parsed.data), description: describeRule(parsed.data), next };
  }

  /** Runs a schedule now, by hand: guards do not apply. */
  async runNow(id: string): Promise<{ thread_id: string }> {
    const s = await this.row(id);
    const threadId = await this.fire(s);
    await this.sql`INSERT INTO schedule_runs (schedule_id, due_at, manual, thread_id) VALUES (${id}, now(), true, ${threadId})`;
    await this.changed(s.workspace_id);
    return { thread_id: threadId };
  }

  /** Called every 30 s: fires or skips every due schedule. Missed runs (bus down) fire once, not once per miss. */
  async tick(now = new Date()): Promise<number> {
    const due = await this.sql<ScheduleRow[]>`SELECT * FROM schedules WHERE enabled AND next_run_at <= ${now} ORDER BY next_run_at`;
    let count = 0;
    for (const s of due) {
      const next = nextRun(s.rule, s.timezone, now);
      // Claim it: only the tick that moves next_run_at fires it.
      const claimed = await this.sql`UPDATE schedules SET next_run_at = ${next}, enabled = ${next !== null}
        WHERE id = ${s.id} AND next_run_at = ${s.next_run_at} RETURNING id`;
      if (claimed.length === 0) continue;
      count++;
      try {
        const skip = await this.skipReason(s);
        if (skip) {
          await this.sql`INSERT INTO schedule_runs (schedule_id, due_at, skipped) VALUES (${s.id}, ${s.next_run_at}, ${skip})`;
        } else {
          const threadId = await this.fire(s);
          await this.sql`INSERT INTO schedule_runs (schedule_id, due_at, thread_id) VALUES (${s.id}, ${s.next_run_at}, ${threadId})`;
        }
      } catch (e) {
        await this.sql`INSERT INTO schedule_runs (schedule_id, due_at, skipped) VALUES (${s.id}, ${s.next_run_at}, ${`could not start: ${(e as Error).message}`})`;
      }
      await this.changed(s.workspace_id);
    }
    return count;
  }

  private async skipReason(s: ScheduleRow): Promise<string | null> {
    if (s.skip_if_open) {
      const [open] = await this.sql<{ id: string }[]>`
        SELECT t.id FROM threads t WHERE t.state NOT IN ('done', 'cancelled') AND t.id IN (
          SELECT thread_id FROM schedule_runs WHERE schedule_id = ${s.id} AND thread_id IS NOT NULL ORDER BY due_at DESC LIMIT 1)`;
      if (open) return `the previous run is still open (${open.id})`;
    }
    if (s.skip_usage_above !== null) {
      const usage = await this.store.usage(s.workspace_id);
      const weekly = usage?.seven_day as number | null | undefined;
      if (typeof weekly === "number" && weekly > s.skip_usage_above) {
        return `weekly usage at ${Math.round(weekly * 100)}% (skips above ${Math.round(s.skip_usage_above * 100)}%)`;
      }
    }
    return null;
  }

  /** Opens the run's thread (or posts to the recurring one) with a request from system to the agent. */
  private async fire(s: ScheduleRow): Promise<string> {
    const body = `${s.prompt}\n\n(Scheduled: ${describeRule(s.rule)}. If there is nothing to report, close the thread with complete.)`;
    let thread: ThreadRow | null = null;
    if (s.thread_mode === "same" && s.same_thread_id) {
      thread = await this.store.thread(s.same_thread_id);
      if (thread?.state === "cancelled") thread = null;
      else if (thread && thread.state === "done") await this.sql`UPDATE threads SET state = 'in_progress', updated_at = now() WHERE id = ${thread.id}`;
    }
    if (!thread) {
      thread = await this.store.createThread({ workspaceId: s.workspace_id, title: s.title, createdBy: SYSTEM, assignee: s.agent_id, repoId: s.repo_id });
      if (s.thread_mode === "same") await this.sql`UPDATE schedules SET same_thread_id = ${thread.id} WHERE id = ${s.id}`;
    }
    await this.store.postMessage({ workspaceId: s.workspace_id, threadId: thread.id, type: "request", from: SYSTEM, to: s.agent_id, body });
    return thread.id;
  }
}
