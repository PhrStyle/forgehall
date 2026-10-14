import { isIsolated, RunEvent, RunFinish, RunnerMode } from "@forgehall/shared";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { forgehallHome } from "./git.js";
import { busMcpServer } from "./mcp.js";
import { BusError, type AgentRow, type Store } from "./store.js";

export interface HttpOptions {
  /** Max runs in progress per workspace (F1 stand-in for the per-account semaphore). */
  maxRunning: number;
  /** How long a runner's claim request waits for work before returning 204. */
  claimWaitMs: number;
  /** How long a permission request waits for the user before it is denied. */
  permissionTimeoutMs: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildHttp(store: Store, opts: HttpOptions): FastifyInstance {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });

  /** Agent identity comes only from its bearer token, never from what the agent claims. */
  async function agentOf(req: FastifyRequest): Promise<AgentRow | null> {
    const h = req.headers.authorization;
    if (!h?.startsWith("Bearer ")) return null;
    return store.agentByToken(h.slice(7));
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof BusError) return reply.code(409).send({ error: err.message });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "invalid payload", issues: err.issues });
    app.log.error(err);
    return reply.code(500).send({ error: "internal error" });
  });

  // `home` lets the fh CLI translate host paths under ~/.forgehall when the bus runs in a container.
  app.get("/health", async () => ({ ok: true, home: forgehallHome() }));

  // ---------- MCP (agents) ----------
  app.post("/mcp", async (req, reply) => {
    const agent = await agentOf(req);
    if (!agent) return reply.code(401).send({ error: "invalid agent token" });
    const server = busMcpServer(store, agent, { permissionTimeoutMs: opts.permissionTimeoutMs });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });
  // Stateless MCP: no server-initiated streams or sessions to close.
  app.get("/mcp", async (_req, reply) => reply.code(405).send());
  app.delete("/mcp", async (_req, reply) => reply.code(405).send());

  // ---------- runner ----------
  app.post("/runner/claim", async (req, reply) => {
    const agent = await agentOf(req);
    if (!agent) return reply.code(401).send({ error: "invalid agent token" });
    const mode = RunnerMode.catch("host").parse((req.body as { mode?: unknown } | undefined)?.mode ?? "host");
    if (!isIsolated(mode) && !(await store.setting("allow_host_runners", false))) {
      return reply.code(403).send({
        error: "Agents running directly on this machine are disabled. Start the agent isolated (fh agent run <ws> <agent>), or enable \"Allow agents on this machine\" in Settings.",
      });
    }
    await store.touchRunner(agent);
    const deadline = Date.now() + opts.claimWaitMs;
    for (;;) {
      const claim = await store.claimRun(agent, opts.maxRunning, mode);
      if (claim) return claim;
      if (Date.now() >= deadline) return reply.code(204).send();
      await sleep(1000);
    }
  });

  app.post<{ Params: { id: string } }>("/runner/runs/:id/events", async (req, reply) => {
    const agent = await agentOf(req);
    if (!agent) return reply.code(401).send({ error: "invalid agent token" });
    const events = z.array(RunEvent).parse(req.body);
    await store.appendEvents(agent, Number(req.params.id), events);
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/runner/runs/:id/heartbeat", async (req, reply) => {
    const agent = await agentOf(req);
    if (!agent) return reply.code(401).send({ error: "invalid agent token" });
    await store.heartbeat(agent, Number(req.params.id));
    return reply.code(204).send();
  });

  app.post<{ Params: { id: string } }>("/runner/runs/:id/finish", async (req, reply) => {
    const agent = await agentOf(req);
    if (!agent) return reply.code(401).send({ error: "invalid agent token" });
    await store.finishRun(agent, Number(req.params.id), RunFinish.parse(req.body));
    return reply.code(204).send();
  });

  return app;
}
