import { createHash, randomBytes } from "node:crypto";
import { HUMAN, type MessageType, type Model, type Outcome, type RunClaim, type RunEvent, type RunFinish, type ThreadState } from "@forgehall/shared";
import type postgres from "postgres";
import type { Sql } from "./db.js";

type Tx = Sql | postgres.TransactionSql;
import { buildPrompt } from "./prompt.js";
import { route } from "./router.js";

export interface AgentRow {
  workspace_id: string;
  id: string;
  name: string;
  role: string;
  default_model: Model;
  accepts_from: string[];
  config: { prompt?: string; allowedTools?: string[] };
}

export interface ThreadRow {
  id: string;
  workspace_id: string;
  title: string;
  state: ThreadState;
  severity: string | null;
  flags: { escalate?: Record<string, string> };
  created_by: string;
  assignee: string | null;
  updated_at: Date;
}

export interface MessageRow {
  id: string; // bigint comes back as string
  thread_id: string;
  type: MessageType;
  from_actor: string;
  to_actor: string;
  body: string;
  outcome: Outcome | null;
  reply_to: string | null;
  created_at: Date;
}

export class BusError extends Error {}

const DEFAULT_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write"];

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export class Store {
  constructor(readonly sql: Sql) {}

  // ---------- workspaces & agents ----------

  async upsertWorkspace(id: string, name: string): Promise<void> {
    await this.sql`INSERT INTO workspaces (id, name) VALUES (${id}, ${name})
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`;
  }

  async upsertAgent(a: { workspaceId: string; id: string; name: string; role: string; defaultModel: Model; acceptsFrom?: string[]; prompt?: string; allowedTools?: string[] }): Promise<void> {
    const config = { prompt: a.prompt ?? "", allowedTools: a.allowedTools ?? DEFAULT_TOOLS };
    await this.sql`INSERT INTO agents (workspace_id, id, name, role, default_model, accepts_from, config)
      VALUES (${a.workspaceId}, ${a.id}, ${a.name}, ${a.role}, ${a.defaultModel}, ${a.acceptsFrom ?? []}, ${this.sql.json(config)})
      ON CONFLICT (workspace_id, id) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role,
        default_model = EXCLUDED.default_model, accepts_from = EXCLUDED.accepts_from, config = EXCLUDED.config`;
  }

  /** Issues a new token for an agent (invalidating the previous one) and returns it once. */
  async issueAgentToken(workspaceId: string, agentId: string): Promise<string> {
    const token = `at_${randomBytes(24).toString("base64url")}`;
    const rows = await this.sql`UPDATE agents SET token_hash = ${hashToken(token)}
      WHERE workspace_id = ${workspaceId} AND id = ${agentId} RETURNING id`;
    if (rows.length === 0) throw new BusError(`agent ${workspaceId}/${agentId} does not exist`);
    return token;
  }

  async agentByToken(token: string): Promise<AgentRow | null> {
    const [row] = await this.sql<AgentRow[]>`SELECT * FROM agents WHERE token_hash = ${hashToken(token)}`;
    return row ?? null;
  }

  async agent(workspaceId: string, agentId: string): Promise<AgentRow | null> {
    const [row] = await this.sql<AgentRow[]>`SELECT * FROM agents WHERE workspace_id = ${workspaceId} AND id = ${agentId}`;
    return row ?? null;
  }

  async agents(workspaceId: string): Promise<AgentRow[]> {
    return this.sql<AgentRow[]>`SELECT * FROM agents WHERE workspace_id = ${workspaceId} ORDER BY id`;
  }

  // ---------- threads & messages ----------

  async createThread(t: { workspaceId: string; title: string; createdBy: string; assignee: string; severity?: string | null }): Promise<ThreadRow> {
    const [row] = await this.sql<ThreadRow[]>`INSERT INTO threads (workspace_id, title, created_by, assignee, severity)
      VALUES (${t.workspaceId}, ${t.title}, ${t.createdBy}, ${t.assignee}, ${t.severity ?? null}) RETURNING *`;
    return row!;
  }

  async thread(id: string): Promise<ThreadRow | null> {
    const [row] = await this.sql<ThreadRow[]>`SELECT * FROM threads WHERE id = ${id}`;
    return row ?? null;
  }

  async threads(workspaceId: string, state?: string): Promise<ThreadRow[]> {
    return state
      ? this.sql<ThreadRow[]>`SELECT * FROM threads WHERE workspace_id = ${workspaceId} AND state = ${state} ORDER BY updated_at DESC`
      : this.sql<ThreadRow[]>`SELECT * FROM threads WHERE workspace_id = ${workspaceId} ORDER BY updated_at DESC`;
  }

  async messages(threadId: string): Promise<MessageRow[]> {
    return this.sql<MessageRow[]>`SELECT * FROM messages WHERE thread_id = ${threadId} ORDER BY id`;
  }

  async message(id: string): Promise<MessageRow | null> {
    const [row] = await this.sql<MessageRow[]>`SELECT * FROM messages WHERE id = ${id}`;
    return row ?? null;
  }

  /**
   * Posts a message, moves the thread state and, when the recipient is an agent,
   * queues a run for it. Everything happens in one transaction.
   */
  async postMessage(m: { workspaceId: string; threadId: string; type: MessageType; from: string; to: string; body: string; outcome?: Outcome | null; replyTo?: string | null }): Promise<MessageRow> {
    return this.sql.begin(async (tx) => {
      const [thread] = await tx<ThreadRow[]>`SELECT * FROM threads WHERE id = ${m.threadId} FOR UPDATE`;
      if (!thread || thread.workspace_id !== m.workspaceId) throw new BusError(`thread ${m.threadId} does not exist in this workspace`);
      if (m.to !== HUMAN) {
        const [target] = await tx<AgentRow[]>`SELECT * FROM agents WHERE workspace_id = ${m.workspaceId} AND id = ${m.to}`;
        if (!target) throw new BusError(`agent ${m.to} does not exist in this workspace`);
        if (m.type === "request" && target.accepts_from.length > 0 && m.from !== HUMAN && !target.accepts_from.includes(m.from)) {
          throw new BusError(`${m.to} does not accept requests from ${m.from}`);
        }
      }
      const [msg] = await tx<MessageRow[]>`INSERT INTO messages (workspace_id, thread_id, type, from_actor, to_actor, body, outcome, reply_to)
        VALUES (${m.workspaceId}, ${m.threadId}, ${m.type}, ${m.from}, ${m.to}, ${m.body}, ${m.outcome ?? null}, ${m.replyTo ?? null}) RETURNING *`;
      const next = nextState(thread.state, m.type, m.outcome ?? null);
      await tx`UPDATE threads SET state = ${next}, updated_at = now() WHERE id = ${m.threadId}`;
      if (m.to !== HUMAN) await this.enqueue(tx, thread, m.to, m.type);
      return msg!;
    });
  }

  async setEscalation(threadId: string, agentId: string, reason: string): Promise<void> {
    await this.sql`UPDATE threads SET flags = jsonb_set(flags, '{escalate}', coalesce(flags->'escalate', '{}'::jsonb) || ${this.sql.json({ [agentId]: reason })})
      WHERE id = ${threadId}`;
  }

  // ---------- runs ----------

  /** Queues a run unless one is already waiting for the same agent and thread. */
  private async enqueue(tx: Tx, thread: ThreadRow, agentId: string, trigger: MessageType): Promise<void> {
    const [waiting] = await tx`SELECT id FROM runs WHERE thread_id = ${thread.id} AND agent_id = ${agentId} AND state = 'queued'`;
    if (waiting) return;
    const [agent] = await tx<AgentRow[]>`SELECT * FROM agents WHERE workspace_id = ${thread.workspace_id} AND id = ${agentId}`;
    const failures = (await tx<{ failures: number }[]>`SELECT count(*)::int AS failures FROM runs
      WHERE thread_id = ${thread.id} AND agent_id = ${agentId} AND state = 'failed'`)[0]!.failures;
    const r = route({
      trigger,
      agentDefault: agent!.default_model,
      severity: thread.severity,
      failures,
      escalation: thread.flags.escalate?.[agentId] ?? null,
    });
    await tx`INSERT INTO runs (workspace_id, agent_id, thread_id, model, effort, route_reason, priority)
      VALUES (${thread.workspace_id}, ${agentId}, ${thread.id}, ${r.model}, ${r.effort}, ${r.reason}, ${r.priority})`;
  }

  /**
   * Hands the next queued run of this agent to its runner, with the prompt built from every
   * message not yet delivered to the agent in that thread. Returns null when there is nothing to do.
   */
  async claimRun(agent: AgentRow, maxRunningPerWorkspace: number): Promise<RunClaim | null> {
    return this.sql.begin(async (tx) => {
      // Serialize claims per workspace so the concurrency cap holds.
      await tx`SELECT pg_advisory_xact_lock(hashtext(${agent.workspace_id}))`;
      const [busy] = await tx`SELECT 1 FROM runs WHERE workspace_id = ${agent.workspace_id} AND agent_id = ${agent.id} AND state = 'running'`;
      if (busy) return null;
      const running = (await tx<{ running: number }[]>`SELECT count(*)::int AS running FROM runs
        WHERE workspace_id = ${agent.workspace_id} AND state = 'running'`)[0]!.running;
      if (running >= maxRunningPerWorkspace) return null;
      const [run] = await tx<{ id: string; thread_id: string; model: Model; effort: "low" | "medium" | "high"; route_reason: string }[]>`
        SELECT id, thread_id, model, effort, route_reason FROM runs
        WHERE workspace_id = ${agent.workspace_id} AND agent_id = ${agent.id} AND state = 'queued'
        ORDER BY priority, queued_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!run) return null;
      await tx`UPDATE runs SET state = 'running', started_at = now() WHERE id = ${run.id}`;
      const pending = await tx<MessageRow[]>`UPDATE messages SET delivered_run = ${run.id}
        WHERE thread_id = ${run.thread_id} AND to_actor = ${agent.id} AND delivered_run IS NULL RETURNING *`;
      pending.sort((a, b) => Number(a.id) - Number(b.id));
      const [thread] = await tx<ThreadRow[]>`SELECT * FROM threads WHERE id = ${run.thread_id}`;
      const [session] = await tx<{ session_id: string }[]>`SELECT session_id FROM sessions WHERE thread_id = ${run.thread_id} AND agent_id = ${agent.id}`;
      if (thread!.state === "open") await tx`UPDATE threads SET state = 'in_progress', updated_at = now() WHERE id = ${run.thread_id}`;
      // A new run starts from the escalation it was routed with; clear the flag for the next one.
      await tx`UPDATE threads SET flags = flags #- ${["escalate", agent.id]} WHERE id = ${run.thread_id}`;
      return {
        runId: Number(run.id),
        workspaceId: agent.workspace_id,
        agentId: agent.id,
        threadId: run.thread_id,
        model: run.model,
        effort: run.effort,
        routeReason: run.route_reason,
        sessionId: session?.session_id ?? null,
        prompt: buildPrompt({ agent, thread: thread!, messages: pending, resumed: Boolean(session) }),
        agentPrompt: agent.config.prompt ?? "",
        allowedTools: agent.config.allowedTools ?? DEFAULT_TOOLS,
      };
    });
  }

  async appendEvents(agent: AgentRow, runId: number, events: RunEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.sql.begin(async (tx) => {
      const [run] = await tx`SELECT 1 FROM runs WHERE id = ${runId} AND workspace_id = ${agent.workspace_id} AND agent_id = ${agent.id}`;
      if (!run) throw new BusError(`run ${runId} does not belong to this agent`);
      const next = (await tx<{ next: number }[]>`SELECT coalesce(max(seq), 0) + 1 AS next FROM run_events WHERE run_id = ${runId}`)[0]!.next;
      const rows = events.map((e, i) => ({ run_id: runId, seq: next + i, kind: e.kind, payload: tx.json(e.payload as never) }));
      await tx`INSERT INTO run_events ${tx(rows, "run_id", "seq", "kind", "payload")}`;
    });
  }

  async finishRun(agent: AgentRow, runId: number, f: RunFinish): Promise<void> {
    await this.sql.begin(async (tx) => {
      const [run] = await tx<{ thread_id: string; state: string }[]>`SELECT thread_id, state FROM runs
        WHERE id = ${runId} AND workspace_id = ${agent.workspace_id} AND agent_id = ${agent.id} FOR UPDATE`;
      if (!run) throw new BusError(`run ${runId} does not belong to this agent`);
      if (run.state !== "running") throw new BusError(`run ${runId} is not running`);
      await tx`UPDATE runs SET state = ${f.ok ? "done" : "failed"}, ended_at = now(), session_id = ${f.sessionId},
        input_tokens = ${f.inputTokens}, output_tokens = ${f.outputTokens}, cost_usd = ${f.costUsd}, error = ${f.error}
        WHERE id = ${runId}`;
      if (f.sessionId) {
        await tx`INSERT INTO sessions (thread_id, workspace_id, agent_id, session_id)
          VALUES (${run.thread_id}, ${agent.workspace_id}, ${agent.id}, ${f.sessionId})
          ON CONFLICT (thread_id, agent_id) DO UPDATE SET session_id = EXCLUDED.session_id`;
      }
      if (f.rateLimit) {
        const w = f.rateLimit.unifiedWindows;
        const ts = (s?: number) => (s ? new Date(s * 1000) : null);
        await tx`INSERT INTO account_usage (workspace_id, five_hour, five_hour_resets_at, seven_day, seven_day_resets_at, status, updated_at)
          VALUES (${agent.workspace_id}, ${w?.five_hour?.utilization ?? null}, ${ts(w?.five_hour?.resetsAt)},
                  ${w?.seven_day?.utilization ?? null}, ${ts(w?.seven_day?.resetsAt)}, ${f.rateLimit.status}, now())
          ON CONFLICT (workspace_id) DO UPDATE SET five_hour = EXCLUDED.five_hour, five_hour_resets_at = EXCLUDED.five_hour_resets_at,
            seven_day = EXCLUDED.seven_day, seven_day_resets_at = EXCLUDED.seven_day_resets_at, status = EXCLUDED.status, updated_at = now()`;
      }
      // Messages that arrived while the run was going still need an answer; on failure, the
      // trigger messages go back to the queue so a retry sees them again.
      if (!f.ok) await tx`UPDATE messages SET delivered_run = NULL WHERE delivered_run = ${runId}`;
      const [pending] = await tx<{ type: MessageType }[]>`SELECT type FROM messages
        WHERE thread_id = ${run.thread_id} AND to_actor = ${agent.id} AND delivered_run IS NULL ORDER BY id LIMIT 1`;
      if (pending) {
        const [thread] = await tx<ThreadRow[]>`SELECT * FROM threads WHERE id = ${run.thread_id}`;
        await this.enqueue(tx, thread!, agent.id, pending.type);
      }
    });
  }

  async runs(workspaceId: string, limit = 20) {
    return this.sql`SELECT id, agent_id, thread_id, model, effort, route_reason, state, queued_at, started_at, ended_at,
        input_tokens, output_tokens, cost_usd, error
      FROM runs WHERE workspace_id = ${workspaceId} ORDER BY id DESC LIMIT ${limit}`;
  }

  async usage(workspaceId: string) {
    const [row] = await this.sql`SELECT * FROM account_usage WHERE workspace_id = ${workspaceId}`;
    return row ?? null;
  }
}

/** Thread state machine, driven by message type (docs/ARCHITECTURE.md, "Thread states"). */
export function nextState(current: ThreadState, type: MessageType, outcome: Outcome | null): ThreadState {
  if (current === "done" || current === "cancelled") return current;
  switch (type) {
    case "verify":
      return "verifying";
    case "answer":
      return outcome === "failed" ? "in_progress" : current;
    case "approval":
      return "awaiting_approval";
    case "decision":
      return "in_progress";
    case "request":
      return current === "awaiting_approval" ? "in_progress" : current;
    default:
      return current;
  }
}
