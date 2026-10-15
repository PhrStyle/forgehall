import { createHash, randomBytes } from "node:crypto";
import { HUMAN, SYSTEM, type RunnerMode, type MessageType, type Model, type Outcome, type RunClaim, type RunEvent, type RunFinish, type ThreadState } from "@forgehall/shared";
import type postgres from "postgres";
import type { Sql } from "./db.js";

type Tx = Sql | postgres.TransactionSql;
import { createProvider, detectProvider, gitAuthHeader, parseRepoUrl, ProviderError, stripCredentials, type ProviderKind, type Reviewer } from "@forgehall/providers";
import { branchDiff, ensureStaging, MergeConflictError, publishBranch, publishToBase, revParse, squashApproved, stagingPath, syncBase, threadBranch, type UpstreamAuth } from "./git.js";
import { readAccountToken, readAgentHostToken, readProviderToken, removeAccountToken, removeAgentHostToken, removeProviderToken, writeAccountToken, writeAgentHostToken, writeProviderToken } from "./accounts.js";
import { rulesFor, suggestRule, type PermissionRules } from "./permissions.js";
import { buildPrompt } from "./prompt.js";
import { route } from "./router.js";

export interface AgentRow {
  workspace_id: string;
  id: string;
  name: string;
  role: string;
  default_model: Model;
  accepts_from: string[];
  config: { prompt?: string; allowedTools?: string[]; permissions?: Partial<PermissionRules> };
}

export interface ThreadRow {
  id: string;
  workspace_id: string;
  title: string;
  state: ThreadState;
  severity: string | null;
  flags: { escalate?: Record<string, string> };
  repo_id: string | null;
  branch: string | null;
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

export interface RepoRow {
  workspace_id: string;
  id: string;
  upstream_url: string;
  provider: string;
  base_branch: string;
}

export type ApprovalPolicy = "merge" | "pull_request" | "branch_only";
export const APPROVAL_POLICIES: readonly ApprovalPolicy[] = ["merge", "pull_request", "branch_only"];
export const HOST_PROVIDERS = ["github", "azure-devops"] as const;
export type HostProvider = (typeof HOST_PROVIDERS)[number];

/** What publishing an approval produced. */
export interface ApprovalResult {
  /** Policy merge: the commit now at the head of the base branch. */
  merged?: string;
  /** Policies pull_request and branch_only: the published branch and commit. */
  branch?: string;
  commit?: string;
  pr?: { id: string; url: string; status: "open" | "merged" | "closed" };
  warnings?: string[];
}

export interface Publishing {
  approval_policy: ApprovalPolicy;
  git_author_name: string | null;
  git_author_email: string | null;
  ai_trailer: boolean;
  credentials: { provider: HostProvider; token_hint: string; created_at: Date }[];
}

/** Masks credentials in text that may reach logs or the console. */
const redactAuth = (text: string) => text.replace(/\b(Basic|Bearer) [A-Za-z0-9+/=._~-]+/g, "$1 ***");

export const AI_TRAILER = "Co-Authored-By: Claude <noreply@anthropic.com>";
const DEFAULT_AUTHOR = { name: "Forgehall", email: "forgehall@localhost" };

export interface ApprovalRow {
  id: string;
  workspace_id: string;
  thread_id: string;
  policy: string;
  requested_by: string;
  summary: string;
  head_sha: string | null;
  state: "pending" | "approved" | "rejected" | "superseded";
  comment: string | null;
  result: ApprovalResult | null;
  created_at: Date;
  decided_at: Date | null;
}

export interface PermissionRow {
  id: string;
  workspace_id: string;
  agent_id: string;
  run_id: string | null;
  thread_id: string | null;
  tool_name: string;
  input: Record<string, unknown>;
  rule: string;
  state: "pending" | "allowed" | "denied" | "expired";
  remember: boolean;
  reason: string | null;
  created_at: Date;
  decided_at: Date | null;
}

export interface AccountRow {
  id: string;
  label: string;
  plan: string;
  token_hint: string;
  created_at: Date;
  workspaces: string[];
}

export class BusError extends Error {}

const DEFAULT_TOOLS = ["Read", "Glob", "Grep", "Edit", "Write"];
const ID_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** An agent as the console edits it. Host tokens are never returned, only their last 4 characters. */
export interface AgentSettings {
  id: string;
  name: string;
  role: string;
  default_model: Model;
  accepts_from: string[];
  prompt: string;
  permissions: Partial<PermissionRules>;
  credentials: { provider: HostProvider; token_hint: string; created_at: Date }[];
}

/** Consecutive failed runs of one agent on one thread before the thread is blocked. */
export const MAX_ATTEMPTS = 3;
const RETRY_BASE_SECONDS = 30;
/** Failures a retry cannot fix (missing login, revoked credentials). */
const FATAL_ERROR = /subscription-only|not logged in|\/login|invalid api key|authentication|unauthorized|oauth token/i;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Change notifications for live views (console SSE). Payloads stay small: ids only. */
export type Change =
  | { kind: "thread"; workspace: string; thread: string }
  | { kind: "message"; workspace: string; thread: string; message: string }
  | { kind: "run"; workspace: string; thread: string; run: number; state: string }
  | { kind: "run_event"; workspace: string; run: number }
  | { kind: "agent"; workspace: string; agent: string }
  | { kind: "permission"; workspace: string; permission: string; thread: string | null };

export const CHANGES_CHANNEL = "forgehall_changes";

async function notify(tx: Tx, change: Change): Promise<void> {
  await tx`SELECT pg_notify(${CHANGES_CHANNEL}, ${JSON.stringify(change)})`;
}

/** Work queued for a thread that just closed will never be needed. */
async function cancelQueuedRuns(tx: Tx, threadId: string): Promise<void> {
  await tx`UPDATE runs SET state = 'cancelled', ended_at = now() WHERE thread_id = ${threadId} AND state = 'queued'`;
}

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
        default_model = EXCLUDED.default_model, accepts_from = EXCLUDED.accepts_from,
        -- merge: keep what the user granted over time (e.g. "Always allow" permission rules)
        config = agents.config || EXCLUDED.config`;
  }

  // ---------- workspaces and agents from the console ----------

  /** Creates a workspace; refuses an id that exists (the CLI's upsert renames instead). */
  async createWorkspace(id: string, name: string): Promise<{ id: string; name: string }> {
    if (!ID_RE.test(id)) throw new BusError("workspace id: lowercase letters, digits and -, starting with a letter or digit (max 40)");
    if (!name.trim()) throw new BusError("workspace name is required");
    const [row] = await this.sql<{ id: string; name: string }[]>`INSERT INTO workspaces (id, name) VALUES (${id}, ${name.trim()})
      ON CONFLICT (id) DO NOTHING RETURNING id, name`;
    if (!row) throw new BusError(`workspace ${id} already exists`);
    return row;
  }

  /** Creates an agent in a workspace; refuses an id that exists. Start it with `fh agent run`. */
  async createAgent(a: { workspaceId: string; id: string; name: string; role: string; defaultModel: Model; acceptsFrom?: string[]; prompt?: string }): Promise<AgentSettings> {
    if (!ID_RE.test(a.id) || a.id === HUMAN || a.id === SYSTEM) throw new BusError("agent id: lowercase letters, digits and -, starting with a letter or digit (max 40); not you or system");
    const [ws] = await this.sql`SELECT 1 FROM workspaces WHERE id = ${a.workspaceId}`;
    if (!ws) throw new BusError(`workspace ${a.workspaceId} not found`);
    const [exists] = await this.sql`SELECT 1 FROM agents WHERE workspace_id = ${a.workspaceId} AND id = ${a.id}`;
    if (exists) throw new BusError(`agent ${a.id} already exists in ${a.workspaceId}`);
    if (!a.name.trim() || !a.role.trim()) throw new BusError("name and role are required");
    await this.upsertAgent({ ...a, name: a.name.trim(), role: a.role.trim() });
    return this.agentSettings(a.workspaceId, a.id);
  }

  async updateAgent(workspaceId: string, id: string, p: { name?: string; role?: string; defaultModel?: Model; acceptsFrom?: string[]; prompt?: string }): Promise<AgentSettings> {
    const cur = await this.agentSettings(workspaceId, id);
    const name = p.name?.trim() ?? cur.name;
    const role = p.role?.trim() ?? cur.role;
    if (!name || !role) throw new BusError("name and role are required");
    await this.sql`UPDATE agents SET name = ${name}, role = ${role}, default_model = ${p.defaultModel ?? cur.default_model},
        accepts_from = ${p.acceptsFrom ?? cur.accepts_from},
        config = config || ${this.sql.json({ prompt: p.prompt ?? cur.prompt })}
      WHERE workspace_id = ${workspaceId} AND id = ${id}`;
    return this.agentSettings(workspaceId, id);
  }

  async agentSettings(workspaceId: string, id: string): Promise<AgentSettings> {
    const [a] = await this.sql<AgentRow[]>`SELECT * FROM agents WHERE workspace_id = ${workspaceId} AND id = ${id}`;
    if (!a) throw new BusError(`agent ${workspaceId}/${id} not found`);
    const credentials = await this.sql<AgentSettings["credentials"]>`SELECT provider, token_hint, created_at FROM agent_credentials
      WHERE workspace_id = ${workspaceId} AND agent_id = ${id} ORDER BY provider`;
    return {
      id: a.id, name: a.name, role: a.role, default_model: a.default_model, accepts_from: a.accepts_from,
      prompt: a.config.prompt ?? "", permissions: a.config.permissions ?? {}, credentials: [...credentials],
    };
  }

  async setAgentCredential(workspaceId: string, agentId: string, provider: string, raw: string): Promise<AgentSettings["credentials"][number]> {
    if (!HOST_PROVIDERS.includes(provider as HostProvider)) throw new BusError(`provider must be one of ${HOST_PROVIDERS.join(", ")}`);
    await this.agentSettings(workspaceId, agentId);
    const token = raw.replace(/\s+/g, "");
    if (token.length < 20) throw new BusError("that does not look like an access token");
    await writeAgentHostToken(workspaceId, agentId, provider, token);
    const [row] = await this.sql<AgentSettings["credentials"]>`INSERT INTO agent_credentials (workspace_id, agent_id, provider, token_hint)
      VALUES (${workspaceId}, ${agentId}, ${provider}, ${token.slice(-4)})
      ON CONFLICT (workspace_id, agent_id, provider) DO UPDATE SET token_hint = EXCLUDED.token_hint, created_at = now()
      RETURNING provider, token_hint, created_at`;
    return row!;
  }

  async deleteAgentCredential(workspaceId: string, agentId: string, provider: string): Promise<void> {
    if (!HOST_PROVIDERS.includes(provider as HostProvider)) throw new BusError(`provider must be one of ${HOST_PROVIDERS.join(", ")}`);
    await this.sql`DELETE FROM agent_credentials WHERE workspace_id = ${workspaceId} AND agent_id = ${agentId} AND provider = ${provider}`;
    await removeAgentHostToken(workspaceId, agentId, provider);
  }

  /** Host tokens handed to the agent's runner with each claim. */
  private async agentHostAccess(workspaceId: string, agentId: string): Promise<{ provider: HostProvider; token: string }[]> {
    const rows = await this.sql<{ provider: HostProvider }[]>`SELECT provider FROM agent_credentials WHERE workspace_id = ${workspaceId} AND agent_id = ${agentId}`;
    const out: { provider: HostProvider; token: string }[] = [];
    for (const r of rows) {
      const token = await readAgentHostToken(workspaceId, agentId, r.provider);
      if (token) out.push({ provider: r.provider, token });
    }
    return out;
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

  async createThread(t: { workspaceId: string; title: string; createdBy: string; assignee: string; severity?: string | null; repoId?: string | null }): Promise<ThreadRow> {
    if (t.repoId && !(await this.repo(t.workspaceId, t.repoId))) throw new BusError(`repo ${t.repoId} does not exist in this workspace`);
    const [row] = await this.sql<ThreadRow[]>`INSERT INTO threads (workspace_id, title, created_by, assignee, severity, repo_id)
      VALUES (${t.workspaceId}, ${t.title}, ${t.createdBy}, ${t.assignee}, ${t.severity ?? null}, ${t.repoId ?? null}) RETURNING *`;
    if (t.repoId) {
      row!.branch = threadBranch(row!.id);
      await this.sql`UPDATE threads SET branch = ${row!.branch} WHERE id = ${row!.id}`;
    }
    await notify(this.sql, { kind: "thread", workspace: row!.workspace_id, thread: row!.id });
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
      const closed = next === "done" || next === "cancelled";
      if (closed) await cancelQueuedRuns(tx, m.threadId);
      // Notices ride along with the recipient's next run instead of waking it up.
      if (m.to !== HUMAN && m.type !== "notify" && !closed) await this.enqueue(tx, thread, m.to, m.type);
      await notify(tx, { kind: "message", workspace: m.workspaceId, thread: m.threadId, message: msg!.id });
      return msg!;
    });
  }

  /** The user closes a thread (done or cancelled), optionally telling the assignee why. */
  async closeThread(threadId: string, state: "done" | "cancelled", note: string | null): Promise<void> {
    await this.sql.begin(async (tx) => {
      const [t] = await tx<ThreadRow[]>`SELECT * FROM threads WHERE id = ${threadId} FOR UPDATE`;
      if (!t) throw new BusError(`thread ${threadId} not found`);
      if (t.state === "done" || t.state === "cancelled") throw new BusError(`thread ${threadId} is already ${t.state}`);
      await tx`UPDATE threads SET state = ${state}, updated_at = now() WHERE id = ${threadId}`;
      await cancelQueuedRuns(tx, threadId);
      const body = `${state === "done" ? "Marked done" : "Cancelled"} by the user.${note ? ` ${note}` : ""}`;
      const [msg] = await tx<{ id: string }[]>`INSERT INTO messages (workspace_id, thread_id, type, from_actor, to_actor, body)
        VALUES (${t.workspace_id}, ${threadId}, 'notify', ${HUMAN}, ${t.assignee ?? HUMAN}, ${body}) RETURNING id`;
      await notify(tx, { kind: "message", workspace: t.workspace_id, thread: threadId, message: msg!.id });
    });
  }

  /** The user reopens a closed or blocked thread; the note wakes the assignee. */
  async reopenThread(threadId: string, note: string): Promise<void> {
    const t = await this.thread(threadId);
    if (!t) throw new BusError(`thread ${threadId} not found`);
    if (!["done", "cancelled", "blocked"].includes(t.state)) throw new BusError(`thread ${threadId} is ${t.state}, not closed`);
    if (!t.assignee || t.assignee === HUMAN) throw new BusError(`thread ${threadId} has no agent assignee to reopen it for`);
    await this.sql`UPDATE threads SET state = 'in_progress', updated_at = now() WHERE id = ${threadId}`;
    await this.postMessage({ workspaceId: t.workspace_id, threadId, type: "request", from: HUMAN, to: t.assignee, body: note });
  }

  async setEscalation(threadId: string, agentId: string, reason: string): Promise<void> {
    await this.sql`UPDATE threads SET flags = jsonb_set(flags, '{escalate}', coalesce(flags->'escalate', '{}'::jsonb) || ${this.sql.json({ [agentId]: reason })})
      WHERE id = ${threadId}`;
  }

  // ---------- runs ----------

  /** Queues a run unless one is already waiting for the same agent and thread. */
  private async enqueue(tx: Tx, thread: ThreadRow, agentId: string, trigger: MessageType, delaySeconds = 0): Promise<void> {
    const [waiting] = await tx`SELECT id FROM runs WHERE thread_id = ${thread.id} AND agent_id = ${agentId} AND state = 'queued'`;
    if (waiting) return;
    const [agent] = await tx<AgentRow[]>`SELECT * FROM agents WHERE workspace_id = ${thread.workspace_id} AND id = ${agentId}`;
    // Only failures since the last success count: one bad patch must not pin a thread to Opus.
    const failures = (await tx<{ failures: number }[]>`SELECT count(*)::int AS failures FROM runs
      WHERE thread_id = ${thread.id} AND agent_id = ${agentId} AND state = 'failed'
        AND id > coalesce((SELECT max(id) FROM runs WHERE thread_id = ${thread.id} AND agent_id = ${agentId} AND state = 'done'), 0)`)[0]!.failures;
    const r = route({
      trigger,
      agentDefault: agent!.default_model,
      severity: thread.severity,
      failures,
      escalation: thread.flags.escalate?.[agentId] ?? null,
    });
    await tx`INSERT INTO runs (workspace_id, agent_id, thread_id, model, effort, route_reason, priority, not_before)
      VALUES (${thread.workspace_id}, ${agentId}, ${thread.id}, ${r.model}, ${r.effort}, ${r.reason}, ${r.priority},
        ${delaySeconds > 0 ? tx`now() + make_interval(secs => ${delaySeconds})` : null})`;
  }

  /**
   * Hands the next queued run of this agent to its runner, with the prompt built from every
   * message not yet delivered to the agent in that thread. Returns null when there is nothing to do.
   */
  /** Records that this agent's runner is polling, so the console can show it as online. */
  async touchRunner(agent: AgentRow): Promise<void> {
    const [prev] = await this.sql<{ stale: boolean }[]>`
      UPDATE agents a SET runner_seen_at = now()
      FROM (SELECT runner_seen_at FROM agents WHERE workspace_id = ${agent.workspace_id} AND id = ${agent.id}) old
      WHERE a.workspace_id = ${agent.workspace_id} AND a.id = ${agent.id}
      RETURNING (old.runner_seen_at IS NULL OR old.runner_seen_at < now() - interval '60 seconds') AS stale`;
    // Only the offline -> online transition is worth a live update; polls are frequent.
    if (prev?.stale) await notify(this.sql, { kind: "agent", workspace: agent.workspace_id, agent: agent.id });
  }

  async claimRun(agent: AgentRow, maxRunningPerWorkspace: number, mode: RunnerMode = "container"): Promise<RunClaim | null> {
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
          AND (not_before IS NULL OR not_before <= now())
          -- one run per thread at a time: agents share the thread's branch
          AND NOT EXISTS (SELECT 1 FROM runs o WHERE o.thread_id = runs.thread_id AND o.state = 'running')
        ORDER BY priority, queued_at LIMIT 1 FOR UPDATE SKIP LOCKED`;
      if (!run) return null;
      await tx`UPDATE runs SET state = 'running', started_at = now(), heartbeat_at = now(), runner_mode = ${mode} WHERE id = ${run.id}`;
      await notify(tx, { kind: "run", workspace: agent.workspace_id, thread: run.thread_id, run: Number(run.id), state: "running" });
      const pending = await tx<MessageRow[]>`UPDATE messages SET delivered_run = ${run.id}
        WHERE thread_id = ${run.thread_id} AND to_actor = ${agent.id} AND delivered_run IS NULL RETURNING *`;
      pending.sort((a, b) => Number(a.id) - Number(b.id));
      const [thread] = await tx<ThreadRow[]>`SELECT * FROM threads WHERE id = ${run.thread_id}`;
      const [session] = await tx<{ session_id: string }[]>`SELECT session_id FROM sessions WHERE thread_id = ${run.thread_id} AND agent_id = ${agent.id}`;
      if (thread!.state === "open") await tx`UPDATE threads SET state = 'in_progress', updated_at = now() WHERE id = ${run.thread_id}`;
      // A new run starts from the escalation it was routed with; clear the flag for the next one.
      await tx`UPDATE threads SET flags = flags #- ${["escalate", agent.id]} WHERE id = ${run.thread_id}`;
      const hostAccess = await this.agentHostAccess(agent.workspace_id, agent.id);
      return {
        runId: Number(run.id),
        workspaceId: agent.workspace_id,
        agentId: agent.id,
        threadId: run.thread_id,
        model: run.model,
        effort: run.effort,
        routeReason: run.route_reason,
        sessionId: session?.session_id ?? null,
        prompt: buildPrompt({ agent, thread: thread!, messages: pending, resumed: Boolean(session), hostAccess: hostAccess.map((h) => h.provider) }),
        agentPrompt: agent.config.prompt ?? "",
        allowedTools: rulesFor(mode, agent.config.permissions).allow,
        permissions: rulesFor(mode, agent.config.permissions),
        runnerMode: mode,
        hostAccess,
        repo: thread!.repo_id && thread!.branch
          ? { id: thread!.repo_id, base: (await tx<{ base_branch: string }[]>`SELECT base_branch FROM repos WHERE workspace_id = ${agent.workspace_id} AND id = ${thread!.repo_id}`)[0]!.base_branch, branch: thread!.branch }
          : null,
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
      await tx`UPDATE runs SET heartbeat_at = now() WHERE id = ${runId}`;
      await notify(tx, { kind: "run_event", workspace: agent.workspace_id, run: runId });
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
      await this.afterRun(tx, { workspaceId: agent.workspace_id, agentId: agent.id, threadId: run.thread_id, runId, ok: f.ok, error: f.error });
      await this.pinApprovals(tx, run.thread_id, agent.id);
      await this.approvalForCompletedChanges(tx, run.thread_id, agent.id);
    });
  }

  /**
   * An agent may complete a thread during the same run that produced its changes, before they are
   * pushed, so the complete tool cannot see them. If the run left unmerged commits on a thread it
   * completed, the completion becomes an approval request: changes never close without the user.
   */
  private async approvalForCompletedChanges(tx: Tx, threadId: string, agentId: string): Promise<void> {
    const [t] = await tx<ThreadRow[]>`SELECT * FROM threads WHERE id = ${threadId}`;
    if (!t || t.state !== "done" || !t.repo_id) return;
    const [last] = await tx<{ type: string; from_actor: string; body: string }[]>`SELECT type, from_actor, body FROM messages
      WHERE thread_id = ${threadId} ORDER BY created_at DESC, id DESC LIMIT 1`;
    if (last?.type !== "complete" || last.from_actor !== agentId) return;
    const { repo, staging, branch } = await this.threadRepo(t);
    const diff = await branchDiff(staging, repo.base_branch, branch);
    if (!diff.headSha || diff.commits.length === 0) return;
    const [ws] = await tx<{ approval_policy: string }[]>`SELECT approval_policy FROM workspaces WHERE id = ${t.workspace_id}`;
    await tx`UPDATE approvals SET state = 'superseded' WHERE thread_id = ${threadId} AND state = 'pending'`;
    await tx`INSERT INTO approvals (workspace_id, thread_id, policy, requested_by, summary, head_sha)
      VALUES (${t.workspace_id}, ${threadId}, ${ws!.approval_policy}, ${agentId}, ${last.body}, ${diff.headSha})`;
    await tx`UPDATE threads SET state = 'awaiting_approval', updated_at = now() WHERE id = ${threadId}`;
    const [msg] = await tx<{ id: string }[]>`INSERT INTO messages (workspace_id, thread_id, type, from_actor, to_actor, body)
      VALUES (${t.workspace_id}, ${threadId}, 'notify', ${SYSTEM}, ${HUMAN}, ${`${agentId} completed the thread with changes on ${branch} that are not in ${repo.base_branch} yet. Review and approve them to merge.`}) RETURNING id`;
    await notify(tx, { kind: "message", workspace: t.workspace_id, thread: threadId, message: msg!.id });
    await notify(tx, { kind: "thread", workspace: t.workspace_id, thread: threadId });
  }

  /**
   * Decides what happens after a run ends. Success: queue a run if messages arrived meanwhile.
   * Failure: retry with backoff up to MAX_ATTEMPTS, then block the thread and tell the user.
   * A blocked thread resumes when anyone posts a new message to the agent.
   */
  private async afterRun(tx: Tx, r: { workspaceId: string; agentId: string; threadId: string; runId: number; ok: boolean; error: string | null }): Promise<void> {
    const [thread] = await tx<ThreadRow[]>`SELECT * FROM threads WHERE id = ${r.threadId}`;
    if (r.ok) {
      const [pending] = await tx<{ type: MessageType }[]>`SELECT type FROM messages
        WHERE thread_id = ${r.threadId} AND to_actor = ${r.agentId} AND delivered_run IS NULL ORDER BY id LIMIT 1`;
      if (pending) await this.enqueue(tx, thread!, r.agentId, pending.type);
    } else {
      // The messages this run carried go back to the queue so a retry sees them again.
      await tx`UPDATE messages SET delivered_run = NULL WHERE delivered_run = ${r.runId}`;
      const recent = await tx<{ state: string }[]>`SELECT state FROM runs
        WHERE thread_id = ${r.threadId} AND agent_id = ${r.agentId} AND state IN ('done', 'failed') ORDER BY id DESC LIMIT ${MAX_ATTEMPTS}`;
      const streak = recent.findIndex((x) => x.state !== "failed");
      const failures = streak === -1 ? recent.length : streak;
      const fatal = FATAL_ERROR.test(r.error ?? "");
      const [pending] = await tx<{ type: MessageType }[]>`SELECT type FROM messages
        WHERE thread_id = ${r.threadId} AND to_actor = ${r.agentId} AND delivered_run IS NULL ORDER BY id LIMIT 1`;
      if (fatal || failures >= MAX_ATTEMPTS) {
        await tx`UPDATE threads SET state = 'blocked', updated_at = now() WHERE id = ${r.threadId}`;
        const why = fatal ? "this cannot be fixed by retrying" : `${failures} attempts in a row failed`;
        const [msg] = await tx<{ id: string }[]>`INSERT INTO messages (workspace_id, thread_id, type, from_actor, to_actor, body, delivered_run)
          VALUES (${r.workspaceId}, ${r.threadId}, 'notify', ${SYSTEM}, ${HUMAN},
            ${`${r.agentId} stopped working on this thread: ${why}. Last error: ${r.error ?? "unknown"}. Fix the cause, then reply in the thread to retry.`}, NULL)
          RETURNING id`;
        await notify(tx, { kind: "message", workspace: r.workspaceId, thread: r.threadId, message: msg!.id });
      } else if (pending) {
        await this.enqueue(tx, thread!, r.agentId, pending.type, RETRY_BASE_SECONDS * 2 ** (failures - 1));
      }
    }
    await notify(tx, { kind: "run", workspace: r.workspaceId, thread: r.threadId, run: r.runId, state: r.ok ? "done" : "failed" });
  }

  /** Pins approvals requested during a run to what the run pushed, or withdraws them if nothing was. */
  private async pinApprovals(tx: Tx, threadId: string, agentId: string): Promise<void> {
    const waiting = await tx<ApprovalRow[]>`SELECT * FROM approvals WHERE thread_id = ${threadId} AND requested_by = ${agentId} AND state = 'pending' AND head_sha IS NULL`;
    if (waiting.length === 0) return;
    const [t] = await tx<ThreadRow[]>`SELECT * FROM threads WHERE id = ${threadId}`;
    const { repo, staging, branch } = await this.threadRepo(t!);
    const diff = await branchDiff(staging, repo.base_branch, branch);
    for (const a of waiting) {
      if (diff.headSha && diff.commits.length > 0) {
        await tx`UPDATE approvals SET head_sha = ${diff.headSha} WHERE id = ${a.id}`;
      } else {
        await tx`UPDATE approvals SET state = 'superseded', comment = 'no changes were pushed' WHERE id = ${a.id}`;
        await tx`UPDATE threads SET state = 'in_progress', updated_at = now() WHERE id = ${threadId} AND state = 'awaiting_approval'`;
        const [msg] = await tx<{ id: string }[]>`INSERT INTO messages (workspace_id, thread_id, type, from_actor, to_actor, body)
          VALUES (${t!.workspace_id}, ${threadId}, 'notify', ${SYSTEM}, ${HUMAN}, ${`Approval withdrawn: ${agentId} asked for approval but pushed no changes to ${branch}.`}) RETURNING id`;
        await notify(tx, { kind: "message", workspace: t!.workspace_id, thread: threadId, message: msg!.id });
      }
    }
  }

  async heartbeat(agent: AgentRow, runId: number): Promise<void> {
    const rows = await this.sql`UPDATE runs SET heartbeat_at = now()
      WHERE id = ${runId} AND workspace_id = ${agent.workspace_id} AND agent_id = ${agent.id} AND state = 'running' RETURNING id`;
    if (rows.length === 0) throw new BusError(`run ${runId} is not running for this agent`);
  }

  /**
   * Fails runs whose runner stopped reporting (crash, kill, lost network) and puts their
   * messages back in the queue, so the work is retried instead of stuck forever.
   */
  async reapStaleRuns(timeoutSeconds: number): Promise<number[]> {
    return this.sql.begin(async (tx) => {
      const stale = await tx<{ id: string; workspace_id: string; agent_id: string; thread_id: string }[]>`
        UPDATE runs SET state = 'failed', ended_at = now(), error = 'runner stopped responding'
        WHERE state = 'running' AND coalesce(heartbeat_at, started_at) < now() - make_interval(secs => ${timeoutSeconds})
        RETURNING id, workspace_id, agent_id, thread_id`;
      for (const r of stale) {
        await this.afterRun(tx, { workspaceId: r.workspace_id, agentId: r.agent_id, threadId: r.thread_id, runId: Number(r.id), ok: false, error: "runner stopped responding" });
      }
      return stale.map((r) => Number(r.id));
    });
  }

  // ---------- repositories & approvals ----------

  async upsertRepo(r: { workspaceId: string; id: string; upstreamUrl: string; base?: string; provider?: string }): Promise<RepoRow> {
    const base = r.base ?? "main";
    // Credentials never live in the URL: the bus adds its own token when it talks to the host.
    let upstreamUrl = stripCredentials(r.upstreamUrl);
    const provider = (r.provider ?? detectProvider(upstreamUrl)) as ProviderKind;
    if (provider !== "local") {
      const ref = parseRepoUrl(upstreamUrl);
      // The bus authenticates with a token over HTTPS; it has no SSH keys.
      if (ref.provider === "github" && /^git@/.test(upstreamUrl)) upstreamUrl = `https://github.com/${ref.owner}/${ref.repo}.git`;
    }
    await ensureStaging(r.workspaceId, r.id, upstreamUrl, base, await this.upstreamAuth(r.workspaceId, provider));
    const [row] = await this.sql<RepoRow[]>`INSERT INTO repos (workspace_id, id, upstream_url, provider, base_branch)
      VALUES (${r.workspaceId}, ${r.id}, ${upstreamUrl}, ${provider}, ${base})
      ON CONFLICT (workspace_id, id) DO UPDATE SET upstream_url = EXCLUDED.upstream_url, provider = EXCLUDED.provider, base_branch = EXCLUDED.base_branch
      RETURNING *`;
    return row!;
  }

  async repo(workspaceId: string, repoId: string): Promise<RepoRow | null> {
    const [row] = await this.sql<RepoRow[]>`SELECT * FROM repos WHERE workspace_id = ${workspaceId} AND id = ${repoId}`;
    return row ?? null;
  }

  async repos(workspaceId: string): Promise<RepoRow[]> {
    return this.sql<RepoRow[]>`SELECT * FROM repos WHERE workspace_id = ${workspaceId} ORDER BY id`;
  }

  /** The thread's repo and branch, or an error when the thread has no repository. */
  private async threadRepo(t: ThreadRow): Promise<{ repo: RepoRow; staging: string; branch: string }> {
    if (!t.repo_id || !t.branch) throw new BusError(`thread ${t.id} has no repository`);
    const repo = await this.repo(t.workspace_id, t.repo_id);
    if (!repo) throw new BusError(`repo ${t.repo_id} not found`);
    return { repo, staging: stagingPath(t.workspace_id, repo.id), branch: t.branch };
  }

  async threadDiff(threadId: string) {
    const t = await this.thread(threadId);
    if (!t) throw new BusError(`thread ${threadId} not found`);
    const { repo, staging, branch } = await this.threadRepo(t);
    return branchDiff(staging, repo.base_branch, branch);
  }

  /**
   * An agent asks the user to approve a thread. With a repository, the request pins the branch
   * commit being approved, so later pushes cannot slip into an approval unseen.
   */
  async requestApproval(agent: AgentRow, threadId: string, summary: string): Promise<{ message: MessageRow; approval: ApprovalRow | null }> {
    const t = await this.thread(threadId);
    if (!t || t.workspace_id !== agent.workspace_id) throw new BusError(`thread ${threadId} does not exist in this workspace`);
    let approval: ApprovalRow | null = null;
    if (t.repo_id) {
      const { repo, staging, branch } = await this.threadRepo(t);
      // During its own run the agent's edits are not pushed yet: pin the commit when the run ends.
      const [running] = await this.sql`SELECT 1 FROM runs WHERE thread_id = ${threadId} AND agent_id = ${agent.id} AND state = 'running'`;
      const diff = await branchDiff(staging, repo.base_branch, branch);
      const head = running ? null : await revParse(staging, branch);
      if (!running && (!head || diff.commits.length === 0)) throw new BusError(`nothing to approve: ${branch} has no commits ahead of ${repo.base_branch}`);
      const [ws] = await this.sql<{ approval_policy: string }[]>`SELECT approval_policy FROM workspaces WHERE id = ${t.workspace_id}`;
      await this.sql`UPDATE approvals SET state = 'superseded' WHERE thread_id = ${threadId} AND state = 'pending'`;
      [approval] = await this.sql<ApprovalRow[]>`INSERT INTO approvals (workspace_id, thread_id, policy, requested_by, summary, head_sha)
        VALUES (${t.workspace_id}, ${threadId}, ${ws!.approval_policy}, ${agent.id}, ${summary}, ${head}) RETURNING *` as unknown as [ApprovalRow];
    }
    const message = await this.postMessage({ workspaceId: t.workspace_id, threadId, type: "approval", from: agent.id, to: HUMAN, body: summary });
    return { message, approval };
  }

  async approvals(threadId: string): Promise<ApprovalRow[]> {
    return this.sql<ApprovalRow[]>`SELECT * FROM approvals WHERE thread_id = ${threadId} ORDER BY id DESC`;
  }

  /**
   * The user decides on a pending approval. Approve (policy merge): merge the pinned commit into
   * the base branch, publish it upstream and close the thread. Reject: the comment goes back to
   * the assignee, who gets a new run.
   */
  /**
   * The user decides on a pending approval. Reject: the comment goes back to the assignee, who
   * gets a new run. Approve: the bus squashes the pinned commit onto the base branch with the
   * workspace's commit identity and publishes it according to the policy:
   * - merge: the commit becomes the base branch upstream; the thread closes.
   * - branch_only: the commit is pushed as the thread branch upstream; the thread closes.
   * - pull_request: the branch is pushed and a pull request opened with the chosen reviewers; the
   *   thread waits in external_review until the host reports it merged or closed.
   */
  async decideApproval(
    approvalId: number,
    decision: "approve" | "reject",
    comment: string | null,
    opts: { reviewers?: string[]; title?: string } = {},
  ): Promise<ApprovalRow> {
    const [a] = await this.sql<ApprovalRow[]>`SELECT * FROM approvals WHERE id = ${approvalId}`;
    if (!a) throw new BusError(`approval ${approvalId} not found`);
    if (a.state !== "pending") throw new BusError(`approval ${approvalId} is already ${a.state}`);
    const t = (await this.thread(a.thread_id))!;
    const assignee = t.assignee && t.assignee !== HUMAN ? t.assignee : a.requested_by;

    if (decision === "reject") {
      if (!comment?.trim()) throw new BusError("say what should change");
      await this.sql`UPDATE approvals SET state = 'rejected', comment = ${comment}, decided_at = now() WHERE id = ${approvalId}`;
      await this.postMessage({ workspaceId: t.workspace_id, threadId: t.id, type: "decision", from: HUMAN, to: assignee, body: `Changes requested: ${comment.trim()}` });
      return (await this.sql<ApprovalRow[]>`SELECT * FROM approvals WHERE id = ${approvalId}`)[0]!;
    }

    if (!a.head_sha) throw new BusError("the agent is still pushing its changes; try again in a moment");
    const policy = a.policy as ApprovalPolicy;
    if (!APPROVAL_POLICIES.includes(policy)) throw new BusError(`unknown approval policy ${a.policy}`);
    const { repo, staging, branch } = await this.threadRepo(t);
    const pub = await this.publishing(t.workspace_id);
    const title = opts.title?.trim() || t.title;
    if (policy === "pull_request" && repo.provider === "local") {
      throw new BusError(`repo ${repo.id} is a local repository: pull requests need GitHub or Azure DevOps. Change the workspace policy to merge or branch_only.`);
    }
    const auth = await this.upstreamAuth(t.workspace_id, repo.provider as ProviderKind);
    if (policy === "pull_request" && !auth) throw new BusError(`no ${repo.provider} credential for workspace ${t.workspace_id}: add one in Settings → Publishing`);

    const author = { name: pub.git_author_name || DEFAULT_AUTHOR.name, email: pub.git_author_email || DEFAULT_AUTHOR.email };
    const message = [title, a.summary.trim(), pub.ai_trailer ? AI_TRAILER : ""].filter(Boolean).join("\n\n");
    let result: ApprovalResult;
    let note: string;
    try {
      const commit = await squashApproved(staging, repo.base_branch, branch, a.head_sha, message, author, auth);
      if (policy === "merge") {
        await publishToBase(staging, repo.base_branch, commit, auth);
        result = { merged: commit };
        note = `Approved and merged into ${repo.base_branch} as ${commit.slice(0, 7)}.`;
      } else {
        await publishBranch(staging, branch, commit, auth);
        result = { branch, commit };
        note = `Approved and pushed to ${branch} as ${commit.slice(0, 7)}.`;
        if (policy === "pull_request") {
          const provider = createProvider(parseRepoUrl(repo.upstream_url), (await readProviderToken(t.workspace_id, repo.provider))!);
          const pr = await provider.createPullRequest({
            source: branch, target: repo.base_branch, title,
            description: [a.summary.trim(), `Thread ${t.id}.`].join("\n\n"),
            reviewerIds: opts.reviewers ?? [],
          });
          result = { branch, commit, pr: { id: pr.id, url: pr.url, status: "open" }, ...(pr.warnings?.length ? { warnings: pr.warnings } : {}) };
          note = `Approved: pull request ${pr.id} opened for review (${pr.url}).${pr.warnings?.length ? ` Warnings: ${pr.warnings.join("; ")}` : ""}`;
        }
      }
    } catch (e) {
      if (e instanceof MergeConflictError || e instanceof ProviderError) throw new BusError(e.message);
      throw new BusError(`publishing failed: ${redactAuth((e as Error).message.split("\n").slice(-2).join(" "))}`);
    }

    await this.sql`UPDATE approvals SET state = 'approved', comment = ${comment}, decided_at = now(), result = ${this.sql.json(result as never)} WHERE id = ${approvalId}`;
    const body = `${note}${comment?.trim() ? ` ${comment.trim()}` : ""}`;
    if (result.pr) {
      // The real review happens on the host: tell the assignee without waking it, and wait.
      await this.postMessage({ workspaceId: t.workspace_id, threadId: t.id, type: "notify", from: HUMAN, to: assignee, body });
      await this.setThreadState(t, "external_review");
    } else {
      await this.postMessage({ workspaceId: t.workspace_id, threadId: t.id, type: "complete", from: HUMAN, to: assignee, body });
    }
    return (await this.sql<ApprovalRow[]>`SELECT * FROM approvals WHERE id = ${approvalId}`)[0]!;
  }

  private async setThreadState(t: ThreadRow, state: ThreadState): Promise<void> {
    await this.sql.begin(async (tx) => {
      await tx`UPDATE threads SET state = ${state}, updated_at = now() WHERE id = ${t.id}`;
      await notify(tx, { kind: "thread", workspace: t.workspace_id, thread: t.id });
    });
  }

  /**
   * Checks the pull requests the bus opened and closes their threads when the host reports them
   * merged, or hands them back to the user when closed without merging. Called periodically.
   */
  async pollPullRequests(): Promise<number> {
    const open = await this.sql<ApprovalRow[]>`SELECT * FROM approvals
      WHERE state = 'approved' AND result ? 'pr' AND result->'pr'->>'status' = 'open'`;
    let changed = 0;
    for (const a of open) {
      try {
        const t = (await this.thread(a.thread_id))!;
        const { repo, staging } = await this.threadRepo(t);
        const token = await readProviderToken(t.workspace_id, repo.provider);
        if (!token) continue;
        const status = await createProvider(parseRepoUrl(repo.upstream_url), token).pullRequestStatus(a.result!.pr!.id);
        if (status === "open") continue;
        const result: ApprovalResult = { ...a.result!, pr: { ...a.result!.pr!, status } };
        await this.sql`UPDATE approvals SET result = ${this.sql.json(result as never)} WHERE id = ${a.id}`;
        changed++;
        if (t.state !== "external_review") continue;
        const assignee = t.assignee && t.assignee !== HUMAN ? t.assignee : a.requested_by;
        if (status === "merged") {
          // Bring staging's base up to date so later threads start from the merged code.
          await syncBase(staging, repo.base_branch, await this.upstreamAuth(t.workspace_id, repo.provider as ProviderKind)).catch(() => {});
          await this.postMessage({ workspaceId: t.workspace_id, threadId: t.id, type: "complete", from: SYSTEM, to: assignee, body: `Pull request ${a.result!.pr!.id} was merged on ${repo.provider}.` });
        } else {
          await this.postMessage({ workspaceId: t.workspace_id, threadId: t.id, type: "notify", from: SYSTEM, to: HUMAN, body: `Pull request ${a.result!.pr!.id} was closed without merging. Reopen the thread with instructions, or close it.` });
          await this.setThreadState(t, "blocked");
        }
      } catch (e) {
        console.error(`[bus] checking pull request of approval ${a.id}: ${redactAuth((e as Error).message)}`);
      }
    }
    return changed;
  }

  // ---------- publishing settings ----------

  async publishing(workspaceId: string): Promise<Publishing> {
    const [w] = await this.sql<{ approval_policy: ApprovalPolicy; git_author_name: string | null; git_author_email: string | null; ai_trailer: boolean }[]>`
      SELECT approval_policy, git_author_name, git_author_email, ai_trailer FROM workspaces WHERE id = ${workspaceId}`;
    if (!w) throw new BusError(`workspace ${workspaceId} not found`);
    const credentials = await this.sql<Publishing["credentials"]>`SELECT provider, token_hint, created_at FROM provider_credentials
      WHERE workspace_id = ${workspaceId} ORDER BY provider`;
    return { ...w, credentials: [...credentials] };
  }

  async updatePublishing(
    workspaceId: string,
    p: { approval_policy?: string; git_author_name?: string | null; git_author_email?: string | null; ai_trailer?: boolean },
  ): Promise<Publishing> {
    const cur = await this.publishing(workspaceId);
    const policy = p.approval_policy ?? cur.approval_policy;
    if (!APPROVAL_POLICIES.includes(policy as ApprovalPolicy)) throw new BusError(`approval_policy must be one of ${APPROVAL_POLICIES.join(", ")}`);
    const clean = (v: string | null | undefined, old: string | null) => (v === undefined ? old : v?.trim() || null);
    const name = clean(p.git_author_name, cur.git_author_name);
    const email = clean(p.git_author_email, cur.git_author_email);
    if (name && (name.length > 100 || /[<>\n]/.test(name))) throw new BusError("git_author_name must be a plain name");
    if (email && !/^[^\s@<>]+@[^\s@<>]+$/.test(email)) throw new BusError("git_author_email must be an e-mail address");
    const trailer = p.ai_trailer ?? cur.ai_trailer;
    await this.sql`UPDATE workspaces SET approval_policy = ${policy}, git_author_name = ${name}, git_author_email = ${email}, ai_trailer = ${trailer}
      WHERE id = ${workspaceId}`;
    return this.publishing(workspaceId);
  }

  async setProviderCredential(workspaceId: string, provider: string, raw: string): Promise<Publishing["credentials"][number]> {
    if (!HOST_PROVIDERS.includes(provider as HostProvider)) throw new BusError(`provider must be one of ${HOST_PROVIDERS.join(", ")}`);
    await this.publishing(workspaceId);
    const token = raw.replace(/\s+/g, "");
    if (token.length < 20) throw new BusError("that does not look like an access token");
    await writeProviderToken(workspaceId, provider, token);
    const [row] = await this.sql<Publishing["credentials"]>`INSERT INTO provider_credentials (workspace_id, provider, token_hint)
      VALUES (${workspaceId}, ${provider}, ${token.slice(-4)})
      ON CONFLICT (workspace_id, provider) DO UPDATE SET token_hint = EXCLUDED.token_hint, created_at = now()
      RETURNING provider, token_hint, created_at`;
    return row!;
  }

  async deleteProviderCredential(workspaceId: string, provider: string): Promise<void> {
    if (!HOST_PROVIDERS.includes(provider as HostProvider)) throw new BusError(`provider must be one of ${HOST_PROVIDERS.join(", ")}`);
    await this.sql`DELETE FROM provider_credentials WHERE workspace_id = ${workspaceId} AND provider = ${provider}`;
    await removeProviderToken(workspaceId, provider);
  }

  /** The git header the bus uses with a host, or undefined (local repos, or no credential: public read only). */
  private async upstreamAuth(workspaceId: string, provider: ProviderKind): Promise<UpstreamAuth> {
    if (provider === "local") return undefined;
    const token = await readProviderToken(workspaceId, provider);
    return token ? gitAuthHeader(provider, token) : undefined;
  }

  /** Reviewer search for a thread's pull request, through the repo's host. */
  async reviewers(threadId: string, query: string): Promise<Reviewer[]> {
    const t = await this.thread(threadId);
    if (!t) throw new BusError(`thread ${threadId} not found`);
    const { repo } = await this.threadRepo(t);
    if (repo.provider === "local") throw new BusError(`repo ${repo.id} is local: it has no reviewers`);
    const token = await readProviderToken(t.workspace_id, repo.provider);
    if (!token) throw new BusError(`no ${repo.provider} credential for workspace ${t.workspace_id}: add one in Settings → Publishing`);
    try {
      return await createProvider(parseRepoUrl(repo.upstream_url), token).searchReviewers(query.trim());
    } catch (e) {
      if (e instanceof ProviderError) throw new BusError(e.message);
      throw e;
    }
  }

  // ---------- Claude accounts ----------

  async accounts(): Promise<AccountRow[]> {
    return this.sql<AccountRow[]>`SELECT a.*, coalesce(array_agg(w.id) FILTER (WHERE w.id IS NOT NULL), '{}') AS workspaces
      FROM claude_accounts a LEFT JOIN workspaces w ON w.claude_account_id = a.id GROUP BY a.id ORDER BY a.created_at`;
  }

  /** Saves a subscription token (file, 0600) and its metadata. API keys are refused: they bill per token. */
  async addAccount(a: { id: string; label: string; plan: string; token: string }): Promise<AccountRow> {
    // Tokens have no whitespace; terminals wrap long ones, so a pasted token can carry line breaks.
    const token = a.token.replace(/\s+/g, "");
    if (/^sk-ant-api/i.test(token)) throw new BusError("This is an API key, which is billed per token. Use a subscription token from `claude setup-token`.");
    if (!/^sk-ant-oat\d+-[\w-]{20,}$/.test(token)) {
      throw new BusError("That does not look like a token from `claude setup-token`: it starts with sk-ant-oat01- and has only letters, digits, - and _. Paste just the token line.");
    }
    await writeAccountToken(a.id, token);
    const [row] = await this.sql<AccountRow[]>`INSERT INTO claude_accounts (id, label, plan, token_hint)
      VALUES (${a.id}, ${a.label}, ${a.plan}, ${token.slice(-4)})
      ON CONFLICT (id) DO UPDATE SET label = EXCLUDED.label, plan = EXCLUDED.plan, token_hint = EXCLUDED.token_hint
      RETURNING *, '{}'::text[] AS workspaces`;
    return row!;
  }

  async deleteAccount(id: string): Promise<void> {
    await this.sql`DELETE FROM claude_accounts WHERE id = ${id}`;
    await removeAccountToken(id);
  }

  async setWorkspaceAccount(workspaceId: string, accountId: string | null): Promise<void> {
    const rows = await this.sql`UPDATE workspaces SET claude_account_id = ${accountId} WHERE id = ${workspaceId} RETURNING id`;
    if (rows.length === 0) throw new BusError(`workspace ${workspaceId} not found`);
  }

  /** The token agents of this workspace sign in with, or null when the workspace has no account. */
  async workspaceToken(workspaceId: string): Promise<{ account: string; token: string } | null> {
    const [ws] = await this.sql<{ claude_account_id: string | null }[]>`SELECT claude_account_id FROM workspaces WHERE id = ${workspaceId}`;
    if (!ws?.claude_account_id) return null;
    const token = await readAccountToken(ws.claude_account_id);
    return token ? { account: ws.claude_account_id, token } : null;
  }

  // ---------- settings & tool permissions ----------

  async setting<T>(key: string, fallback: T): Promise<T> {
    const [row] = await this.sql<{ value: T }[]>`SELECT value FROM settings WHERE key = ${key}`;
    return row ? row.value : fallback;
  }

  async settings(): Promise<Record<string, unknown>> {
    const rows = await this.sql<{ key: string; value: unknown }[]>`SELECT key, value FROM settings ORDER BY key`;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async setSetting(key: string, value: unknown): Promise<void> {
    await this.sql`INSERT INTO settings (key, value) VALUES (${key}, ${this.sql.json(value as never)})
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
  }

  /** Records a tool use the agent needs the user to approve, tied to the agent's current run. */
  async createPermissionRequest(agent: AgentRow, toolName: string, input: unknown): Promise<PermissionRow> {
    const [run] = await this.sql<{ id: string; thread_id: string }[]>`SELECT id, thread_id FROM runs
      WHERE workspace_id = ${agent.workspace_id} AND agent_id = ${agent.id} AND state = 'running' ORDER BY id DESC LIMIT 1`;
    const [row] = await this.sql<PermissionRow[]>`INSERT INTO permission_requests (workspace_id, agent_id, run_id, thread_id, tool_name, input, rule)
      VALUES (${agent.workspace_id}, ${agent.id}, ${run?.id ?? null}, ${run?.thread_id ?? null}, ${toolName}, ${this.sql.json((input ?? {}) as never)}, ${suggestRule(toolName, input)})
      RETURNING *`;
    await notify(this.sql, { kind: "permission", workspace: agent.workspace_id, permission: row!.id, thread: row!.thread_id });
    return row!;
  }

  async permission(id: string | number): Promise<PermissionRow | null> {
    const [row] = await this.sql<PermissionRow[]>`SELECT * FROM permission_requests WHERE id = ${id}`;
    return row ?? null;
  }

  async permissions(workspaceId: string, state = "pending"): Promise<PermissionRow[]> {
    return this.sql<PermissionRow[]>`SELECT * FROM permission_requests WHERE workspace_id = ${workspaceId} AND state = ${state} ORDER BY id`;
  }

  /** Waits for the user's answer; unanswered requests expire (deny) so runs do not hang. */
  async awaitPermission(id: string, timeoutMs: number): Promise<PermissionRow> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const row = await this.permission(id);
      if (row && row.state !== "pending") return row;
      if (Date.now() >= deadline) {
        const [expired] = await this.sql<PermissionRow[]>`UPDATE permission_requests SET state = 'expired', decided_at = now()
          WHERE id = ${id} AND state = 'pending' RETURNING *`;
        if (expired) await notify(this.sql, { kind: "permission", workspace: expired.workspace_id, permission: expired.id, thread: expired.thread_id });
        return expired ?? (await this.permission(id))!;
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  /** The user answers a request. "Remember" adds the suggested rule to the agent's allow list (isolated runners only). */
  async decidePermission(id: number, allow: boolean, remember: boolean, reason: string | null): Promise<PermissionRow> {
    const [row] = await this.sql<PermissionRow[]>`UPDATE permission_requests
      SET state = ${allow ? "allowed" : "denied"}, remember = ${allow && remember}, reason = ${reason}, decided_at = now()
      WHERE id = ${id} AND state = 'pending' RETURNING *`;
    if (!row) throw new BusError(`permission request ${id} is not pending`);
    if (allow && remember) {
      const agent = await this.agent(row.workspace_id, row.agent_id);
      const current = agent?.config.permissions ?? {};
      const permissions = { ...current, allow: [...new Set([...(current.allow ?? []), row.rule])] };
      await this.sql`UPDATE agents SET config = config || ${this.sql.json({ permissions })} WHERE workspace_id = ${row.workspace_id} AND id = ${row.agent_id}`;
    }
    await notify(this.sql, { kind: "permission", workspace: row.workspace_id, permission: row.id, thread: row.thread_id });
    return row;
  }

  // ---------- read models for the console ----------

  async workspaces() {
    return this.sql<{ id: string; name: string; claude_account_id: string | null }[]>`SELECT id, name, claude_account_id FROM workspaces ORDER BY id`;
  }

  /** Agents with what they are doing right now, derived from their runs. */
  async agentsOverview(workspaceId: string) {
    return this.sql`
      SELECT a.id, a.name, a.role, a.default_model, a.runner_seen_at,
        (a.runner_seen_at > now() - interval '60 seconds') AS runner_online,
        cur.id AS run_id, cur.thread_id AS run_thread, cur.model AS run_model, cur.started_at AS run_started_at,
        (SELECT count(*)::int FROM runs q WHERE q.workspace_id = a.workspace_id AND q.agent_id = a.id AND q.state = 'queued') AS queued,
        last.state AS last_state, last.error AS last_error, last.ended_at AS last_ended_at,
        (SELECT count(*)::int FROM runs t WHERE t.workspace_id = a.workspace_id AND t.agent_id = a.id AND t.queued_at > now() - interval '1 day') AS runs_today
      FROM agents a
      LEFT JOIN LATERAL (SELECT id, thread_id, model, started_at FROM runs r
        WHERE r.workspace_id = a.workspace_id AND r.agent_id = a.id AND r.state = 'running' ORDER BY id DESC LIMIT 1) cur ON true
      LEFT JOIN LATERAL (SELECT state, error, ended_at FROM runs r
        WHERE r.workspace_id = a.workspace_id AND r.agent_id = a.id AND r.state IN ('done', 'failed') ORDER BY id DESC LIMIT 1) last ON true
      WHERE a.workspace_id = ${workspaceId}
      ORDER BY a.id`;
  }

  async threadsOverview(workspaceId: string) {
    return this.sql`
      SELECT t.*,
        (SELECT count(*)::int FROM messages m WHERE m.thread_id = t.id) AS message_count,
        (SELECT array_agg(DISTINCT x) FROM (SELECT from_actor AS x FROM messages m WHERE m.thread_id = t.id
           UNION SELECT to_actor FROM messages m WHERE m.thread_id = t.id) p) AS participants,
        EXISTS (SELECT 1 FROM messages m WHERE m.thread_id = t.id AND m.to_actor = ${HUMAN}
           AND NOT EXISTS (SELECT 1 FROM messages r WHERE r.thread_id = t.id AND r.from_actor = ${HUMAN} AND r.id > m.id)) AS waiting_on_you
      FROM threads t WHERE t.workspace_id = ${workspaceId} ORDER BY t.updated_at DESC`;
  }

  async threadRuns(threadId: string) {
    return this.sql`SELECT id, agent_id, model, effort, route_reason, state, queued_at, started_at, ended_at,
        input_tokens, output_tokens, cost_usd, error
      FROM runs WHERE thread_id = ${threadId} ORDER BY id`;
  }

  async runEvents(runId: number, afterSeq = 0) {
    return this.sql`SELECT seq, ts, kind, payload FROM run_events WHERE run_id = ${runId} AND seq > ${afterSeq} ORDER BY seq`;
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
  if (type === "complete") return "done";
  // A new message to a blocked thread means someone wants it retried.
  if (current === "blocked") return type === "notify" ? current : "in_progress";
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
