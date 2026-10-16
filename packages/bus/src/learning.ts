import { AgentData, AgentDataError, isSlug, LIMITS } from "./agent-data.js";
import { BusError, CHANGES_CHANNEL, type AgentRow, type Store } from "./store.js";

/**
 * How agents learn. An agent changes its own memory and skills through MCP tools; the bus writes
 * them to the workspace data repository with the reason and the thread, so the history shows what
 * was learned, when and why, and any change can be undone. By default changes apply at once
 * (automatic learning); an agent set to "ask before saving" files a proposal the user decides on.
 * Agents never write the shared workspace knowledge: only the user does.
 */

export type LearningAction = "remember" | "forget" | "save_skill" | "remove_skill";

export interface LearningChange {
  action: LearningAction;
  name: string;
  /** remember: the memory text. save_skill: the full SKILL.md. */
  content?: string;
  reason: string;
  threadId?: string | null;
}

export interface ProposalRow {
  id: string;
  workspace_id: string;
  agent_id: string;
  thread_id: string | null;
  action: LearningAction;
  name: string;
  content: string | null;
  reason: string;
  state: "pending" | "approved" | "rejected";
  comment: string | null;
  commit: string | null;
  created_at: Date;
  decided_at: Date | null;
}

const SUBJECT: Record<LearningAction, (agent: string, name: string) => string> = {
  remember: (a, n) => `${a} remembered ${n}`,
  forget: (a, n) => `${a} forgot ${n}`,
  save_skill: (a, n) => `${a} saved the skill ${n}`,
  remove_skill: (a, n) => `${a} removed the skill ${n}`,
};

const USER_SUBJECT: Record<LearningAction, (agent: string, name: string) => string> = {
  remember: (a, n) => `You changed ${a}'s memory ${n}`,
  forget: (a, n) => `You removed ${a}'s memory ${n}`,
  save_skill: (a, n) => `You changed ${a}'s skill ${n}`,
  remove_skill: (a, n) => `You removed ${a}'s skill ${n}`,
};

/** A SKILL.md with the frontmatter Claude Code needs (name, description). */
export function skillFile(name: string, description: string, instructions: string): string {
  const desc = description.replace(/\s+/g, " ").trim().replace(/"/g, "'");
  return `---\nname: ${name}\ndescription: "${desc}"\n---\n\n${instructions.trim()}\n`;
}

export class Learning {
  constructor(private readonly store: Store, private readonly data: AgentData = store.data) {}

  private async changed(workspaceId: string, agentId: string) {
    await this.store.sql`SELECT pg_notify(${CHANGES_CHANNEL}, ${JSON.stringify({ kind: "learning", workspace: workspaceId, agent: agentId })})`;
  }

  /** Whether this agent asks the user before saving what it learns (off by default). */
  requiresApproval(agent: AgentRow): boolean {
    return Boolean((agent.config as { learning?: { require_approval?: boolean } }).learning?.require_approval);
  }

  private validate(c: LearningChange) {
    if (!isSlug(c.name)) throw new BusError("name: lowercase letters, digits and -, up to 64, e.g. coupon-seed");
    if (!c.reason.trim()) throw new BusError("say why this is worth keeping (reason)");
    if ((c.action === "remember" || c.action === "save_skill") && !c.content?.trim()) throw new BusError("content is required");
    if (c.content && Buffer.byteLength(c.content) > LIMITS.fileBytes) throw new BusError(`content is larger than ${LIMITS.fileBytes} bytes; keep memory short`);
  }

  /** Called by the agent's tools: applies the change, or files a proposal when the agent asks first. */
  async propose(agent: AgentRow, c: LearningChange): Promise<{ applied: boolean; commit?: string | null; proposal?: string }> {
    this.validate(c);
    if (c.action === "remember" && (await this.data.memory(agent.workspace_id, agent.id)).length >= LIMITS.memoryFiles && !(await this.exists(agent, c))) {
      throw new BusError(`you already keep ${LIMITS.memoryFiles} memory files: merge or forget some first`);
    }
    if (this.requiresApproval(agent)) {
      const [row] = await this.store.sql<{ id: string }[]>`INSERT INTO learning_proposals (workspace_id, agent_id, thread_id, action, name, content, reason)
        VALUES (${agent.workspace_id}, ${agent.id}, ${c.threadId ?? null}, ${c.action}, ${c.name}, ${c.content ?? null}, ${c.reason.trim()}) RETURNING id`;
      await this.changed(agent.workspace_id, agent.id);
      return { applied: false, proposal: row!.id };
    }
    const commit = await this.apply(agent.workspace_id, agent.id, c);
    return { applied: true, commit };
  }

  private async exists(agent: AgentRow, c: LearningChange) {
    return (await this.data.memory(agent.workspace_id, agent.id)).some((m) => m.path === `memory/${c.name}.md`);
  }

  private async apply(workspaceId: string, agentId: string, c: LearningChange, author = agentId): Promise<string | null> {
    const base = `agents/${agentId}`;
    const changes =
      c.action === "remember" ? { write: [{ path: `${base}/memory/${c.name}.md`, content: c.content! }] }
      : c.action === "forget" ? { remove: [`${base}/memory/${c.name}.md`] }
      : c.action === "save_skill" ? { write: [{ path: `${base}/skills/${c.name}/SKILL.md`, content: c.content! }] }
      : { remove: [`${base}/skills/${c.name}`] };
    const body = [c.reason.trim(), c.threadId ? `Thread: ${c.threadId}` : ""].filter(Boolean).join("\n\n");
    // The user's own edits read as such: "You changed atlas's memory coupon-seed".
    const subject = author === "you" ? USER_SUBJECT[c.action](agentId, c.name) : SUBJECT[c.action](agentId, c.name);
    try {
      const commit = await this.data.commit(workspaceId, changes, `${subject}\n\n${body}`, author);
      await this.changed(workspaceId, agentId);
      return commit;
    } catch (e) {
      if (e instanceof AgentDataError) throw new BusError(e.message);
      throw e;
    }
  }

  /** The user edits an agent's memory by hand from the console. */
  async editByUser(workspaceId: string, agentId: string, c: Omit<LearningChange, "reason"> & { reason?: string }): Promise<string | null> {
    const change = { ...c, reason: c.reason?.trim() || "Edited by the user in the console" };
    this.validate(change);
    return this.apply(workspaceId, agentId, change, "you");
  }

  async proposals(workspaceId: string, state: string = "pending"): Promise<ProposalRow[]> {
    return state === "all"
      ? this.store.sql<ProposalRow[]>`SELECT * FROM learning_proposals WHERE workspace_id = ${workspaceId} ORDER BY id DESC LIMIT 200`
      : this.store.sql<ProposalRow[]>`SELECT * FROM learning_proposals WHERE workspace_id = ${workspaceId} AND state = ${state} ORDER BY id DESC LIMIT 200`;
  }

  async decide(id: number, decision: "approve" | "reject", comment: string | null): Promise<ProposalRow> {
    const [p] = await this.store.sql<ProposalRow[]>`SELECT * FROM learning_proposals WHERE id = ${id}`;
    if (!p) throw new BusError(`proposal ${id} not found`);
    if (p.state !== "pending") throw new BusError(`proposal ${id} is already ${p.state}`);
    let commit: string | null = null;
    if (decision === "approve") {
      commit = await this.apply(p.workspace_id, p.agent_id, { action: p.action, name: p.name, content: p.content ?? undefined, reason: p.reason, threadId: p.thread_id });
    }
    const [row] = await this.store.sql<ProposalRow[]>`UPDATE learning_proposals SET state = ${decision === "approve" ? "approved" : "rejected"},
        comment = ${comment}, commit = ${commit}, decided_at = now() WHERE id = ${id} RETURNING *`;
    await this.changed(p.workspace_id, p.agent_id);
    return row!;
  }
}
