import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { RunClaim, RunnerMode, type RunEvent } from "@forgehall/shared";
import { billingModeFrom, ClaudeCodeEngine } from "./claude-code.js";
import type { Engine } from "./engine.js";
import { commitAndPush, prepareCheckout, type RepoCheckout } from "./workspace.js";
import { hostEnv } from "./host-access.js";
import { installContext } from "./agent-context.js";
import { homedir } from "node:os";

export type { Engine, EngineResult, EngineRun } from "./engine.js";
export { ClaudeCodeEngine, billingModeFrom, type BillingMode } from "./claude-code.js";

export interface RunnerConfig {
  busUrl: string;
  agentToken: string;
  /** Root of the agent's work area; each thread gets its own directory under it. */
  workRoot: string;
  /** Where this runner executes; the bus refuses `host` unless the user allows it. */
  mode: RunnerMode;
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
        const res = await this.call("/runner/claim", { mode: this.cfg.mode });
        if (res.status === 204) { backoff = 1000; continue; }
        if (res.status === 403) {
          // Refused by policy (e.g. host runners disabled): retrying will not help.
          console.error(`[runner] ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? "refused by the bus"}`);
          this.stopping = true;
          process.exitCode = 1;
          return;
        }
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
    // Memory and skills go into the agent's own home, which only exists isolated. On the host it
    // would overwrite the user's personal ~/.claude, so it is skipped there.
    if (this.cfg.mode !== "host") {
      await installContext(claim.context, homedir()).catch((e) => console.error(`[runner] installing memory and skills: ${(e as Error).message}`));
    } else if (claim.context.memory.length || claim.context.skills.length || claim.context.knowledge.trim()) {
      console.warn("[runner] host mode: memory, skills and workspace knowledge are not installed (they would overwrite your own ~/.claude)");
    }
    let cwd = join(this.cfg.workRoot, claim.threadId);
    let checkout: RepoCheckout | null = null;
    if (claim.repo) {
      try {
        checkout = await prepareCheckout(claim, this.cfg.busUrl, this.cfg.agentToken, this.cfg.workRoot);
        cwd = checkout.dir;
      } catch (e) {
        const error = `checkout of ${claim.repo.branch} failed: ${(e as Error).message.split("\n")[0]}`;
        console.error(`[runner] ${error}`);
        await this.call(`/runner/runs/${claim.runId}/finish`, { ok: false, sessionId: claim.sessionId, error });
        return;
      }
    } else {
      await mkdir(cwd, { recursive: true });
    }
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
      env: { ...this.cfg.engineEnv, ...hostEnv(claim.hostAccess) },
      onEvent: (e) => {
        buffer.push(e);
        if (buffer.length >= 50) void flush();
      },
    });
    clearInterval(timer);
    clearInterval(heartbeat);

    // The agent's file changes become a commit on the thread branch.
    if (checkout && result.ok) {
      try {
        const commit = await commitAndPush(checkout, claim);
        if (commit) buffer.push({ kind: "git.push", payload: { branch: claim.repo!.branch, commit } });
      } catch (e) {
        result.ok = false;
        result.error = `pushing ${claim.repo!.branch} failed: ${(e as Error).message.split("\n")[0]}`;
      }
    }
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
  const billing = billingModeFrom(process.env.FORGEHALL_BILLING, process.env);
  const runner = new Runner(
    {
      busUrl: process.env.BUS_URL ?? "http://127.0.0.1:4545",
      agentToken: token,
      workRoot: process.env.WORK_ROOT ?? join(process.cwd(), ".work"),
      // Isolated images set FORGEHALL_RUNNER_MODE; anything else is the host.
      mode: RunnerMode.catch("host").parse(process.env.FORGEHALL_RUNNER_MODE ?? "host"),
      engineEnv: env,
    },
    new ClaudeCodeEngine(undefined, billing),
  );
  console.log(`[runner] billing mode: ${billing} · runner mode: ${RunnerMode.catch("host").parse(process.env.FORGEHALL_RUNNER_MODE ?? "host")}`);
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
