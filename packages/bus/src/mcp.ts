import { HUMAN, Outcome } from "@forgehall/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BusError, type AgentRow, type Store } from "./store.js";
import { Learning, skillFile } from "./learning.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolResult => ({ content: [{ type: "text", text }], isError: true });

/** Runs a tool body and turns bus errors into tool errors the agent can read and act on. */
async function guard(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof BusError) return fail(e.message);
    throw e;
  }
}

/** Builds the bus MCP server for one authenticated agent. Every tool is scoped to its workspace. */
export interface McpOptions {
  /** How long a permission request waits for the user before it is denied. */
  permissionTimeoutMs: number;
}

export function busMcpServer(store: Store, me: AgentRow, opts: McpOptions = { permissionTimeoutMs: 15 * 60_000 }): McpServer {
  const server = new McpServer({ name: "bus", version: "0.1.0" });
  const ws = me.workspace_id;
  const recipient = z.string().describe(`id of an agent in this workspace, or "${HUMAN}" for the user`);

  const threadInWs = async (threadId: string) => {
    const t = await store.thread(threadId);
    if (!t || t.workspace_id !== ws) throw new BusError(`thread ${threadId} does not exist in this workspace`);
    return t;
  };

  server.registerTool(
    "request",
    {
      description: "Opens a new thread asking another agent (or the user) for work. Include acceptance criteria.",
      inputSchema: {
        to: recipient,
        title: z.string().min(3),
        body: z.string().min(1),
        severity: z.enum(["low", "medium", "high"]).optional(),
        repo: z.string().optional().describe("repository the work happens in; gives the thread its own branch"),
      },
    },
    ({ to, title, body, severity, repo }) =>
      guard(async () => {
        const t = await store.createThread({ workspaceId: ws, title, createdBy: me.id, assignee: to, severity: severity ?? null, repoId: repo ?? null });
        const m = await store.postMessage({ workspaceId: ws, threadId: t.id, type: "request", from: me.id, to, body });
        return ok(`Thread ${t.id} opened, request sent to ${to} (message ${m.id}).`);
      }),
  );

  server.registerTool(
    "ask",
    {
      description:
        "Asks another agent or the user something within a thread. End the turn afterwards: the reply arrives in a new turn. " +
        `When asking the user (to="${HUMAN}"), start with the question itself in one short sentence, then a blank line and the context; ` +
        "when the answer is a choice, pass the choices as options (the user sees them as buttons).",
      inputSchema: {
        to: recipient,
        thread_id: z.string(),
        question: z.string().min(1),
        options: z.array(z.string().min(1).max(80)).min(2).max(6).optional().describe("short answer choices, for questions to the user"),
      },
    },
    ({ to, thread_id, question, options }) =>
      guard(async () => {
        await threadInWs(thread_id);
        const m = await store.postMessage({ workspaceId: ws, threadId: thread_id, type: "ask", from: me.id, to, body: question, options: options ?? null });
        return ok(`Question sent to ${to} (message ${m.id}). End the turn; the reply will arrive in a new turn.`);
      }),
  );

  server.registerTool(
    "answer",
    {
      description: "Replies to a message (question or verification request). For verifications, set outcome.",
      inputSchema: { message_id: z.string(), body: z.string().min(1), outcome: Outcome.optional() },
    },
    ({ message_id, body, outcome }) =>
      guard(async () => {
        const original = await store.message(message_id);
        if (!original || original.to_actor !== me.id) throw new BusError(`message ${message_id} was not sent to you`);
        await threadInWs(original.thread_id);
        const m = await store.postMessage({
          workspaceId: ws, threadId: original.thread_id, type: "answer", from: me.id, to: original.from_actor,
          body, outcome: outcome ?? null, replyTo: message_id,
        });
        return ok(`Reply sent to ${original.from_actor} (message ${m.id}).`);
      }),
  );

  server.registerTool(
    "verify",
    {
      description: "Asks another agent for an independent verification (for example, running the reproduction against a branch).",
      inputSchema: { to: recipient, thread_id: z.string(), instructions: z.string().min(1) },
    },
    ({ to, thread_id, instructions }) =>
      guard(async () => {
        await threadInWs(thread_id);
        const m = await store.postMessage({ workspaceId: ws, threadId: thread_id, type: "verify", from: me.id, to, body: instructions });
        return ok(`Verification request sent to ${to} (message ${m.id}). End the turn.`);
      }),
  );

  server.registerTool(
    "request_approval",
    {
      description: "Asks the user to approve the thread's work. On a thread with a repository, the user reviews the branch diff and approving publishes it. Summarize what was done and how it was verified.",
      inputSchema: { thread_id: z.string(), summary: z.string().min(1) },
    },
    ({ thread_id, summary }) =>
      guard(async () => {
        await threadInWs(thread_id);
        const { message, approval } = await store.requestApproval(me, thread_id, summary);
        const pinned = !approval ? "" : approval.head_sha ? ` for commit ${approval.head_sha.slice(0, 7)}` : " (your changes are pushed and pinned when this turn ends)";
        return ok(`Approval requested from the user${pinned} (message ${message.id}). End the turn.`);
      }),
  );

  server.registerTool(
    "notify",
    {
      description: "Notifies something without waiting for a reply.",
      inputSchema: { to: recipient, thread_id: z.string(), body: z.string().min(1) },
    },
    ({ to, thread_id, body }) =>
      guard(async () => {
        await threadInWs(thread_id);
        const m = await store.postMessage({ workspaceId: ws, threadId: thread_id, type: "notify", from: me.id, to, body });
        return ok(`Notice sent to ${to} (message ${m.id}).`);
      }),
  );

  // Claude Code calls this (--permission-prompt-tool) for any tool use that is neither allowed nor denied.
  server.registerTool(
    "permission",
    {
      description: "Internal: asks the user to approve a tool use. Called by the runtime, not by agents.",
      inputSchema: { tool_name: z.string(), input: z.any(), tool_use_id: z.string().optional() },
    },
    async ({ tool_name, input }) => {
      const req = await store.createPermissionRequest(me, tool_name, input);
      const done = await store.awaitPermission(req.id, opts.permissionTimeoutMs);
      const decision = done.state === "allowed"
        ? { behavior: "allow", updatedInput: input }
        : { behavior: "deny", message: done.state === "expired" ? "The user did not answer in time. Do not retry this action; ask the user with ask(to=\"you\") if it is needed." : `The user denied this action.${done.reason ? ` Reason: ${done.reason}` : ""} Do not retry it.` };
      return ok(JSON.stringify(decision));
    },
  );

  server.registerTool(
    "complete",
    {
      description: "Closes a thread you are responsible for, when the work is finished and nothing waits on anyone. Give a short summary of the outcome.",
      inputSchema: { thread_id: z.string(), summary: z.string().min(3) },
    },
    ({ thread_id, summary }) =>
      guard(async () => {
        const t = await threadInWs(thread_id);
        if (t.assignee !== me.id) throw new BusError(`only the assignee (${t.assignee ?? "nobody"}) can complete ${thread_id}; tell them with notify`);
        if (t.state === "awaiting_approval") throw new BusError(`${thread_id} is waiting for the user's approval; it closes when the user decides`);
        if (t.repo_id && (await store.threadDiff(thread_id)).commits.length > 0) {
          throw new BusError(`${t.branch} has changes the user has not approved; call request_approval instead of complete`);
        }
        const m = await store.postMessage({ workspaceId: ws, threadId: thread_id, type: "complete", from: me.id, to: HUMAN, body: summary });
        return ok(`Thread ${thread_id} completed (message ${m.id}).`);
      }),
  );

  // Learning: the agent keeps its own memory and skills. Each change is recorded with its reason.
  const learning = new Learning(store);
  const name = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).describe("short id, e.g. coupon-seed");
  const reason = z.string().min(3).describe("why this is worth keeping, in one sentence");
  const threadRef = z.string().optional().describe("the thread this comes from");
  const learned = (r: { applied: boolean; proposal?: string }, what: string) =>
    ok(r.applied ? `${what}. It is in your memory from your next run.` : `${what} proposed (proposal ${r.proposal}); it applies when the user approves.`);
  server.registerTool(
    "remember",
    {
      description:
        "Keeps something in your memory for future threads: a fact about the codebase or tools, or how the user wants things done (corrections and preferences especially). " +
        "Short and general, not specific to one task. Using an existing name replaces that memory (update instead of adding near-duplicates).",
      inputSchema: { name, content: z.string().min(1).max(4000), reason, thread_id: threadRef },
    },
    ({ name, content, reason, thread_id }) =>
      guard(async () => learned(await learning.propose(me, { action: "remember", name, content, reason, threadId: thread_id ?? null }), `Remembered ${name}`)),
  );
  server.registerTool(
    "forget",
    {
      description: "Deletes one of your memories that turned out wrong or outdated.",
      inputSchema: { name, reason, thread_id: threadRef },
    },
    ({ name, reason, thread_id }) =>
      guard(async () => learned(await learning.propose(me, { action: "forget", name, reason, threadId: thread_id ?? null }), `Forgot ${name}`)),
  );
  server.registerTool(
    "save_skill",
    {
      description:
        "Saves a procedure you had to work out and will need again as a skill (Claude Code SKILL.md). The description says when to use it; the instructions are the steps. " +
        "Using an existing name replaces that skill.",
      inputSchema: {
        name,
        description: z.string().min(10).max(300).describe("when to use this skill, e.g. 'Use when releasing checkout-app: version bump, changelog, tag'"),
        instructions: z.string().min(10).max(12_000).describe("the steps, in Markdown"),
        reason,
        thread_id: threadRef,
      },
    },
    ({ name, description, instructions, reason, thread_id }) =>
      guard(async () => learned(await learning.propose(me, { action: "save_skill", name, content: skillFile(name, description, instructions), reason, threadId: thread_id ?? null }), `Saved the skill ${name}`)),
  );
  server.registerTool(
    "remove_skill",
    {
      description: "Removes one of your skills that is wrong or no longer useful.",
      inputSchema: { name, reason, thread_id: threadRef },
    },
    ({ name, reason, thread_id }) =>
      guard(async () => learned(await learning.propose(me, { action: "remove_skill", name, reason, threadId: thread_id ?? null }), `Removed the skill ${name}`)),
  );

  server.registerTool(
    "escalate",
    {
      description: "Requests a stronger model for your next turn in this thread. Use when the task is beyond what you can handle well.",
      inputSchema: { thread_id: z.string(), reason: z.string().min(3) },
    },
    ({ thread_id, reason }) =>
      guard(async () => {
        await threadInWs(thread_id);
        await store.setEscalation(thread_id, me.id, reason);
        return ok("Escalation recorded: your next turn in this thread will use a stronger model.");
      }),
  );

  server.registerTool(
    "thread_read",
    {
      description: "Reads the state and full history of a workspace thread.",
      inputSchema: { thread_id: z.string() },
    },
    ({ thread_id }) =>
      guard(async () => {
        const t = await threadInWs(thread_id);
        const msgs = await store.messages(thread_id);
        const lines = [`${t.id} "${t.title}" · state ${t.state} · assignee ${t.assignee ?? "-"}`];
        for (const m of msgs) lines.push(`#${m.id} ${m.type}${m.outcome ? `/${m.outcome}` : ""} ${m.from_actor} → ${m.to_actor}: ${m.body}`);
        return ok(lines.join("\n"));
      }),
  );

  server.registerTool(
    "threads_list",
    {
      description: "Lists workspace threads, to see what is already in progress before starting something.",
      inputSchema: { state: z.string().optional() },
    },
    ({ state }) =>
      guard(async () => {
        const rows = await store.threads(ws, state);
        if (rows.length === 0) return ok("No threads.");
        return ok(rows.map((t) => `${t.id} [${t.state}] ${t.title} · assignee ${t.assignee ?? "-"}`).join("\n"));
      }),
  );

  return server;
}
