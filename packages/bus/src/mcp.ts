import { HUMAN, Outcome } from "@forgehall/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BusError, type AgentRow, type Store } from "./store.js";

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
export function busMcpServer(store: Store, me: AgentRow): McpServer {
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
      },
    },
    ({ to, title, body, severity }) =>
      guard(async () => {
        const t = await store.createThread({ workspaceId: ws, title, createdBy: me.id, assignee: to, severity: severity ?? null });
        const m = await store.postMessage({ workspaceId: ws, threadId: t.id, type: "request", from: me.id, to, body });
        return ok(`Thread ${t.id} opened, request sent to ${to} (message ${m.id}).`);
      }),
  );

  server.registerTool(
    "ask",
    {
      description: "Asks another agent or the user something within a thread. End the turn afterwards: the reply arrives in a new turn.",
      inputSchema: { to: recipient, thread_id: z.string(), question: z.string().min(1) },
    },
    ({ to, thread_id, question }) =>
      guard(async () => {
        await threadInWs(thread_id);
        const m = await store.postMessage({ workspaceId: ws, threadId: thread_id, type: "ask", from: me.id, to, body: question });
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
      description: "Asks the user for a decision (for example, approving a branch). Summarize what was done and how it was verified.",
      inputSchema: { thread_id: z.string(), summary: z.string().min(1) },
    },
    ({ thread_id, summary }) =>
      guard(async () => {
        await threadInWs(thread_id);
        const m = await store.postMessage({ workspaceId: ws, threadId: thread_id, type: "approval", from: me.id, to: HUMAN, body: summary });
        return ok(`Approval requested from the user (message ${m.id}). End the turn.`);
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
