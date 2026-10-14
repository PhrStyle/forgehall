import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { RunClaim, type RunEvent } from "@forgehall/shared";
import { billingModeFrom, ClaudeCodeEngine } from "./claude-code.js";
import type { Engine } from "./engine.js";

export type { Engine, EngineResult, EngineRun } from "./engine.js";
export { ClaudeCodeEngine, billingModeFrom, type BillingMode } from "./claude-code.js";

export interface RunnerConfig {
  busUrl: string;
  agentToken: string;
  /** Root of the agent's work area; each thread gets its own directory under it. */
  workRoot: string;
  /** Environment passed to the engine (account credentials live here). */
  engineEnv: NodeJS.ProcessEnv;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class Runner {
  private stopping = false;

  constructor(private readonly cfg: RunnerConfig, private readonly engine: Engine = new ClaudeCodeEngine()) {}

  private async call(path: string, body?: unknown): Promise<Response> {
    return fetch(`${this.cfg.busUrl}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.cfg.agentToken}`, "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
  }

  /** Claims and executes runs until stopped. Network errors back off instead of crashing. */
  async loop(): Promise<void> {
    let backoff = 1000;
    while (!this.stopping) {
      try {
        const res = await this.call("/runner/claim");
        if (res.status === 204) { backoff = 1000; continue; }
        if (!res.ok) throw new Error(`claim: HTTP ${res.status} ${await res.text()}`);
        await this.execute(RunClaim.parse(await res.json()));
        backoff = 1000;
      } catch (e) {
        console.error(`[runner] ${(e as Error).message}; retrying in ${backoff / 1000}s`);
        await sleep(backoff);
        backoff = Math.min(backoff * 2, 30_000);
      }
    }
  }

  stop(): void {
    this.stopping = true;
  }

  async execute(claim: RunClaim): Promise<void> {
    const cwd = join(this.cfg.workRoot, claim.threadId);
    await mkdir(cwd, { recursive: true });
    console.log(`[runner] run ${claim.runId} · ${claim.threadId} · ${claim.model}/${claim.effort} · ${claim.routeReason}`);

    // Events go to the bus in small batches so the console can follow along.
    let buffer: RunEvent[] = [];
    let flushing = Promise.resolve();
    const flush = () => {
      if (buffer.length === 0) return flushing;
      const batch = buffer;
      buffer = [];
      flushing = flushing.then(async () => {
        const res = await this.call(`/runner/runs/${claim.runId}/events`, batch);
        if (!res.ok) console.error(`[runner] events for run ${claim.runId}: HTTP ${res.status}`);
      }).catch((e) => console.error(`[runner] events for run ${claim.runId}: ${(e as Error).message}`));
      return flushing;
    };
    const timer = setInterval(() => void flush(), 1000);
    // Liveness even when the engine is silent for a while (long tool calls).
    const heartbeat = setInterval(() => {
      this.call(`/runner/runs/${claim.runId}/heartbeat`).catch((e) => console.error(`[runner] heartbeat: ${(e as Error).message}`));
    }, 30_000);

    const result = await this.engine.run({
      claim,
      cwd,
      bus: { url: this.cfg.busUrl, token: this.cfg.agentToken },
      env: this.cfg.engineEnv,
      onEvent: (e) => {
        buffer.push(e);
        if (buffer.length >= 50) void flush();
      },
    });
    clearInterval(timer);
    clearInterval(heartbeat);
    await flush();

    const res = await this.call(`/runner/runs/${claim.runId}/finish`, result);
    if (!res.ok) throw new Error(`finish for run ${claim.runId}: HTTP ${res.status} ${await res.text()}`);
    console.log(`[runner] run ${claim.runId} ${result.ok ? "ok" : "failed: " + result.error}`);
  }
}

async function main() {
  const token = process.env.AGENT_TOKEN;
  if (!token) throw new Error("set AGENT_TOKEN (generated with `fh agent token <ws> <id>`)");
  const env: NodeJS.ProcessEnv = {};
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) env.CLAUDE_CODE_OAUTH_TOKEN = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  const billing = billingModeFrom(process.env.FORGEHALL_BILLING);
  const runner = new Runner(
    {
      busUrl: process.env.BUS_URL ?? "http://127.0.0.1:4545",
      agentToken: token,
      workRoot: process.env.WORK_ROOT ?? join(process.cwd(), ".work"),
      engineEnv: env,
    },
    new ClaudeCodeEngine(undefined, billing),
  );
  console.log(`[runner] billing mode: ${billing}`);
  process.on("SIGINT", () => runner.stop());
  process.on("SIGTERM", () => runner.stop());
  await runner.loop();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
