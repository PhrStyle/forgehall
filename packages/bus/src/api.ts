import { EventEmitter } from "node:events";
import { HUMAN, MessageType, Model } from "@forgehall/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PLANS } from "./accounts.js";
import { isAdmin } from "./admin.js";
import { CHANGES_CHANNEL, type Change, type Store } from "./store.js";

/**
 * Console API: read models, human actions and a live change stream (SSE).
 * Served on loopback only, like the rest of the bus; there is no user auth yet.
 */
export async function registerApi(app: FastifyInstance, store: Store, adminToken: string): Promise<void> {
  // Everything under /api acts as the user: require the admin token (the console proxy adds it).
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/api/") && !isAdmin(req.headers.authorization, adminToken)) {
      return reply.code(401).send({ error: "admin token required" });
    }
  });

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

  // Creating and editing workspaces and agents. Starting an agent's container stays on the host
  // (`fh agent run`): the bus has no access to Docker, on purpose.
  const Id = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, "lowercase letters, digits and -, max 40");
  app.post("/api/workspaces", async (req, reply) => {
    const b = z.object({ id: Id, name: z.string().min(1).max(60) }).parse(req.body);
    return reply.code(201).send(await store.createWorkspace(b.id, b.name));
  });
  const AgentBody = z.object({
    name: z.string().min(1).max(60),
    role: z.string().min(1).max(60),
    default_model: Model,
    accepts_from: z.array(z.string().max(40)).max(50).optional(),
    prompt: z.string().max(20_000).optional(),
  });
  app.post<{ Params: { ws: string } }>("/api/workspaces/:ws/agents", async (req, reply) => {
    const b = AgentBody.extend({ id: Id }).parse(req.body);
    return reply.code(201).send(await store.createAgent({
      workspaceId: req.params.ws, id: b.id, name: b.name, role: b.role, defaultModel: b.default_model, acceptsFrom: b.accepts_from, prompt: b.prompt,
    }));
  });
  // Desired container state; the supervisor on the host (`fh supervise`) applies it.
  app.post<{ Params: { ws: string; id: string; action: string } }>("/api/workspaces/:ws/agents/:id/:action(^start|stop|restart$)", async (req, reply) => {
    const { ws, id, action } = req.params;
    if (action === "restart") await store.requestRestart(ws, id);
    else await store.setDesiredState(ws, id, action === "start" ? "running" : "stopped");
    return reply.code(204).send();
  });
  app.get("/api/supervisor", async () => store.supervisorStatus());
  app.get<{ Params: { ws: string; id: string } }>("/api/workspaces/:ws/agents/:id/settings", async (req) => store.agentSettings(req.params.ws, req.params.id));
  app.patch<{ Params: { ws: string; id: string } }>("/api/workspaces/:ws/agents/:id", async (req) => {
    const b = AgentBody.partial().parse(req.body);
    return store.updateAgent(req.params.ws, req.params.id, {
      name: b.name, role: b.role, defaultModel: b.default_model, acceptsFrom: b.accepts_from, prompt: b.prompt,
    });
  });
  app.put<{ Params: { ws: string; id: string; provider: string } }>("/api/workspaces/:ws/agents/:id/credentials/:provider", async (req) =>
    store.setAgentCredential(req.params.ws, req.params.id, req.params.provider, z.object({ token: z.string().min(1).max(2000) }).parse(req.body).token),
  );
  app.delete<{ Params: { ws: string; id: string; provider: string } }>("/api/workspaces/:ws/agents/:id/credentials/:provider", async (req, reply) => {
    await store.deleteAgentCredential(req.params.ws, req.params.id, req.params.provider);
    return reply.code(204).send();
  });

  app.get<{ Params: { ws: string } }>("/api/workspaces/:ws/threads", async (req) => store.threadsOverview(req.params.ws));

  app.get<{ Params: { ws: string }; Querystring: { limit?: string } }>("/api/workspaces/:ws/runs", async (req) =>
    store.runs(req.params.ws, Math.min(Number(req.query.limit ?? 50), 500)),
  );

  app.get<{ Params: { ws: string } }>("/api/workspaces/:ws/usage", async (req) => (await store.usage(req.params.ws)) ?? {});

  app.get<{ Params: { id: string } }>("/api/threads/:id", async (req, reply) => {
    const thread = await store.thread(req.params.id);
    if (!thread) return reply.code(404).send(notFound("thread"));
    const [messages, runs, questions] = await Promise.all([store.messages(thread.id), store.threadRuns(thread.id), store.threadQuestions(thread.id)]);
    return { thread, messages, runs, questions };
  });

  app.get<{ Params: { id: string }; Querystring: { after?: string } }>("/api/runs/:id/events", async (req) =>
    store.runEvents(Number(req.params.id), Number(req.query.after ?? 0)),
  );

  // Human actions. The sender is always the user; agents act only through MCP.
  app.get<{ Params: { ws: string } }>("/api/workspaces/:ws/repos", async (req) => store.repos(req.params.ws));

  // Repos are registered through the bus because it owns the staging remotes (it may run in a container).
  const NewRepo = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9._-]*$/i), upstream: z.string().min(1), base: z.string().optional() });
  app.post<{ Params: { ws: string } }>("/api/workspaces/:ws/repos", async (req, reply) => {
    const r = NewRepo.parse(req.body);
    return reply.code(201).send(await store.upsertRepo({ workspaceId: req.params.ws, id: r.id, upstreamUrl: r.upstream, ...(r.base ? { base: r.base } : {}) }));
  });

  app.get<{ Params: { id: string } }>("/api/threads/:id/diff", async (req) => store.threadDiff(req.params.id));

  app.get<{ Params: { id: string } }>("/api/threads/:id/approvals", async (req) => store.approvals(req.params.id));

  const Decide = z.object({
    decision: z.enum(["approve", "reject"]),
    comment: z.string().optional(),
    reviewers: z.array(z.string().min(1).max(200)).max(20).optional(),
    title: z.string().max(200).optional(),
  });
  app.post<{ Params: { id: string } }>("/api/approvals/:id/decide", async (req) => {
    const d = Decide.parse(req.body);
    return store.decideApproval(Number(req.params.id), d.decision, d.comment ?? null, { reviewers: d.reviewers, title: d.title });
  });
  app.get<{ Params: { id: string }; Querystring: { q?: string } }>("/api/threads/:id/reviewers", async (req) =>
    store.reviewers(req.params.id, (req.query.q ?? "").slice(0, 100)),
  );

  // Publishing: approval policy, commit identity, and the bus's write credential per host.
  app.get<{ Params: { ws: string } }>("/api/workspaces/:ws/publishing", async (req) => store.publishing(req.params.ws));
  const PublishingPatch = z.object({
    approval_policy: z.enum(["merge", "pull_request", "branch_only"]).optional(),
    git_author_name: z.string().max(100).nullable().optional(),
    git_author_email: z.string().max(200).nullable().optional(),
    ai_trailer: z.boolean().optional(),
  });
  app.patch<{ Params: { ws: string } }>("/api/workspaces/:ws/publishing", async (req) =>
    store.updatePublishing(req.params.ws, PublishingPatch.parse(req.body)),
  );
  app.put<{ Params: { ws: string; provider: string } }>("/api/workspaces/:ws/credentials/:provider", async (req) =>
    store.setProviderCredential(req.params.ws, req.params.provider, z.object({ token: z.string().min(1).max(2000) }).parse(req.body).token),
  );
  app.delete<{ Params: { ws: string; provider: string } }>("/api/workspaces/:ws/credentials/:provider", async (req, reply) => {
    await store.deleteProviderCredential(req.params.ws, req.params.provider);
    return reply.code(204).send();
  });

  const NewThread = z.object({
    workspace: z.string(),
    repo: z.string().optional(),
    to: z.string(),
    title: z.string().min(3),
    body: z.string().min(1),
    severity: z.enum(["low", "medium", "high"]).optional(),
  });
  app.post("/api/threads", async (req, reply) => {
    const t = NewThread.parse(req.body);
    const thread = await store.createThread({ workspaceId: t.workspace, title: t.title, createdBy: HUMAN, assignee: t.to, severity: t.severity ?? null, repoId: t.repo ?? null });
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

  app.get("/api/accounts", async () => store.accounts());
  const NewAccount = z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/), label: z.string().min(1), plan: z.enum(PLANS), token: z.string().min(1) });
  app.post("/api/accounts", async (req, reply) => reply.code(201).send(await store.addAccount(NewAccount.parse(req.body))));
  app.delete<{ Params: { id: string } }>("/api/accounts/:id", async (req, reply) => {
    await store.deleteAccount(req.params.id);
    return reply.code(204).send();
  });
  app.put<{ Params: { ws: string } }>("/api/workspaces/:ws/account", async (req, reply) => {
    await store.setWorkspaceAccount(req.params.ws, z.object({ account: z.string().nullable() }).parse(req.body).account);
    return reply.code(204).send();
  });

  app.get("/api/settings", async () => store.settings());
  const SettingsPatch = z.object({ allow_host_runners: z.boolean().optional() });
  app.patch("/api/settings", async (req) => {
    const patch = SettingsPatch.parse(req.body);
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) await store.setSetting(k, v);
    return store.settings();
  });

  app.get<{ Params: { ws: string }; Querystring: { state?: string } }>("/api/workspaces/:ws/permissions", async (req) =>
    store.permissions(req.params.ws, req.query.state ?? "pending"),
  );
  const PermissionDecision = z.object({ decision: z.enum(["allow", "deny"]), remember: z.boolean().optional(), reason: z.string().optional() });
  app.post<{ Params: { id: string } }>("/api/permissions/:id/decide", async (req) => {
    const d = PermissionDecision.parse(req.body);
    return store.decidePermission(Number(req.params.id), d.decision === "allow", d.remember ?? false, d.reason?.trim() || null);
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
