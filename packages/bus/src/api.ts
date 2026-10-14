import { EventEmitter } from "node:events";
import { HUMAN, MessageType } from "@forgehall/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CHANGES_CHANNEL, type Change, type Store } from "./store.js";

/**
 * Console API: read models, human actions and a live change stream (SSE).
 * Served on loopback only, like the rest of the bus; there is no user auth yet.
 */
export async function registerApi(app: FastifyInstance, store: Store): Promise<void> {
  const changes = new EventEmitter();
  changes.setMaxListeners(0);
  // Every write path (bus, runners, the fh CLI) notifies through Postgres, so this sees them all.
  await store.sql.listen(CHANGES_CHANNEL, (payload) => {
    try {
      changes.emit("change", JSON.parse(payload) as Change);
    } catch {
      app.log.warn({ payload }, "ignoring malformed change notification");
    }
  });

  const notFound = (what: string) => ({ error: `${what} not found` });

  app.get("/api/workspaces", async () => store.workspaces());

  app.get<{ Params: { ws: string } }>("/api/workspaces/:ws/agents", async (req) => store.agentsOverview(req.params.ws));

  app.get<{ Params: { ws: string } }>("/api/workspaces/:ws/threads", async (req) => store.threadsOverview(req.params.ws));

  app.get<{ Params: { ws: string }; Querystring: { limit?: string } }>("/api/workspaces/:ws/runs", async (req) =>
    store.runs(req.params.ws, Math.min(Number(req.query.limit ?? 50), 500)),
  );

  app.get<{ Params: { ws: string } }>("/api/workspaces/:ws/usage", async (req) => (await store.usage(req.params.ws)) ?? {});

  app.get<{ Params: { id: string } }>("/api/threads/:id", async (req, reply) => {
    const thread = await store.thread(req.params.id);
    if (!thread) return reply.code(404).send(notFound("thread"));
    const [messages, runs] = await Promise.all([store.messages(thread.id), store.threadRuns(thread.id)]);
    return { thread, messages, runs };
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>("/api/runs/:id/events", async (req) =>
    store.runEvents(Number(req.params.id), Number(req.query.after ?? 0)),
  );

  // Human actions. The sender is always the user; agents act only through MCP.
  const NewThread = z.object({
    workspace: z.string(),
    to: z.string(),
    title: z.string().min(3),
    body: z.string().min(1),
    severity: z.enum(["low", "medium", "high"]).optional(),
  });
  app.post("/api/threads", async (req, reply) => {
    const t = NewThread.parse(req.body);
    const thread = await store.createThread({ workspaceId: t.workspace, title: t.title, createdBy: HUMAN, assignee: t.to, severity: t.severity ?? null });
    await store.postMessage({ workspaceId: t.workspace, threadId: thread.id, type: "request", from: HUMAN, to: t.to, body: t.body });
    return reply.code(201).send(thread);
  });

  const NewMessage = z.object({
    to: z.string(),
    type: MessageType.default("answer"),
    body: z.string().min(1),
    replyTo: z.string().optional(),
  });
  app.post<{ Params: { id: string } }>("/api/threads/:id/messages", async (req, reply) => {
    const thread = await store.thread(req.params.id);
    if (!thread) return reply.code(404).send(notFound("thread"));
    const m = NewMessage.parse(req.body);
    const msg = await store.postMessage({ workspaceId: thread.workspace_id, threadId: thread.id, type: m.type, from: HUMAN, to: m.to, body: m.body, replyTo: m.replyTo ?? null });
    return reply.code(201).send(msg);
  });

  const Close = z.object({ state: z.enum(["done", "cancelled"]), note: z.string().optional() });
  app.post<{ Params: { id: string } }>("/api/threads/:id/close", async (req, reply) => {
    const c = Close.parse(req.body);
    await store.closeThread(req.params.id, c.state, c.note?.trim() || null);
    return reply.code(204).send();
  });

  const Reopen = z.object({ note: z.string().min(1) });
  app.post<{ Params: { id: string } }>("/api/threads/:id/reopen", async (req, reply) => {
    await store.reopenThread(req.params.id, Reopen.parse(req.body).note);
    return reply.code(204).send();
  });

  // Live updates: one SSE stream per console tab, filtered by workspace.
  app.get<{ Querystring: { workspace?: string } }>("/api/events", (req, reply) => {
    const ws = req.query.workspace;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write(": connected\n\n");
    const onChange = (c: Change) => {
      if (!ws || c.workspace === ws) res.write(`event: ${c.kind}\ndata: ${JSON.stringify(c)}\n\n`);
    };
    const ping = setInterval(() => res.write(": ping\n\n"), 25_000);
    changes.on("change", onChange);
    req.raw.on("close", () => {
      clearInterval(ping);
      changes.off("change", onChange);
    });
  });
}
