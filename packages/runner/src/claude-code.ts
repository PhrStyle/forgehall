import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { RateLimitInfo } from "@forgehall/shared";
import type { Engine, EngineResult, EngineRun } from "./engine.js";

const MODEL_IDS: Record<string, string> = { haiku: "haiku", sonnet: "sonnet", opus: "opus" };

/**
 * How a runner may be billed.
 * - `any` (default): use whatever authentication the operator configured, as Claude Code would.
 *   With only a subscription login, runs consume plan limits only.
 * - `subscription-only`: an opt-in local guard. Pay-per-use variables never reach the engine and
 *   a run stops if the engine reports a non-subscription credential or paid overage.
 */
export type BillingMode = "any" | "subscription-only";

export function billingModeFrom(value: string | undefined): BillingMode {
  if (value === undefined || value === "" || value === "any") return "any";
  if (value === "subscription-only") return "subscription-only";
  throw new Error(`FORGEHALL_BILLING must be "any" or "subscription-only", got "${value}"`);
}

/** Variables that make Claude Code bill per token instead of using a subscription login. */
export const PAY_PER_USE_ENV = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
  "CLAUDE_CODE_USE_FOUNDRY",
];

/** Engine environment with every pay-per-use credential removed. */
export function subscriptionOnlyEnv(...sources: NodeJS.ProcessEnv[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = Object.assign({}, ...sources);
  for (const k of PAY_PER_USE_ENV) delete env[k];
  return env;
}

/** Runs one turn with the official Claude Code CLI in headless mode (`claude -p`, stream-json). */
export class ClaudeCodeEngine implements Engine {
  readonly name = "claude-code";

  constructor(
    private readonly bin = process.env.CLAUDE_BIN ?? "claude",
    private readonly billing: BillingMode = "any",
  ) {}

  /**
   * CLI arguments. The prompt goes through stdin and the MCP config (which holds the agent's
   * bus token) through a private file, so neither shows up in the process list or hits the
   * per-argument size limit.
   */
  args(r: EngineRun, mcpConfigPath: string): string[] {
    const { claim } = r;
    const args = [
      "-p",
      "--model", MODEL_IDS[claim.model] ?? claim.model,
      "--effort", claim.effort,
      "--output-format", "stream-json",
      "--verbose",
      "--mcp-config", mcpConfigPath,
      "--strict-mcp-config",
      // Allowed and denied tools are settled by Claude Code itself; anything else is asked to the
      // user through the bus (permission requests in the console), never auto-approved.
      "--permission-mode", "default",
      "--permission-prompt-tool", "mcp__bus__permission",
      "--settings", JSON.stringify({ permissions: { allow: claim.permissions.allow, ask: claim.permissions.ask, deny: claim.permissions.deny } }),
      "--allowedTools", ["mcp__bus__*", ...claim.allowedTools].join(","),
    ];
    if (claim.agentPrompt.trim()) args.push("--append-system-prompt", claim.agentPrompt);
    if (claim.sessionId) args.push("--resume", claim.sessionId);
    return args;
  }

  async run(r: EngineRun): Promise<EngineResult> {
    const dir = await mkdtemp(join(tmpdir(), "forgehall-run-"));
    const mcpConfigPath = join(dir, "mcp.json");
    const mcp = { mcpServers: { bus: { type: "http", url: `${r.bus.url}/mcp`, headers: { Authorization: `Bearer ${r.bus.token}` } } } };
    await writeFile(mcpConfigPath, JSON.stringify(mcp), { mode: 0o600 });
    try {
      return await this.spawnRun(r, mcpConfigPath);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private spawnRun(r: EngineRun, mcpConfigPath: string): Promise<EngineResult> {
    return new Promise((resolve) => {
      const result: EngineResult = { ok: false, sessionId: r.claim.sessionId, inputTokens: 0, outputTokens: 0, costUsd: 0, error: null, rateLimit: null };
      // A permission request can wait for the user for minutes; let the MCP call last that long.
      r.env = { MCP_TOOL_TIMEOUT: String(20 * 60_000), ...r.env };
      const child = spawn(this.bin, this.args(r, mcpConfigPath), { cwd: r.cwd, env: this.billing === "subscription-only" ? subscriptionOnlyEnv(process.env, r.env) : { ...process.env, ...r.env }, stdio: ["pipe", "pipe", "pipe"], signal: r.signal });
      child.stdin.on("error", () => {}); // the engine may exit before reading everything
      child.stdin.end(r.claim.prompt);
      // subscription-only: stop the moment the engine reports a non-subscription credential or paid overage.
      const refuse = (why: string) => {
        if (this.billing !== "subscription-only" || result.error?.startsWith("subscription-only")) return;
        result.ok = false;
        result.error = `subscription-only: ${why}`;
        child.kill("SIGTERM");
      };
      let stderr = "";
      let sawResult = false;
      child.stderr.on("data", (d: Buffer) => { stderr = (stderr + d.toString()).slice(-4000); });

      createInterface({ input: child.stdout }).on("line", (line) => {
        if (!line.trim()) return;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(line);
        } catch {
          r.onEvent({ kind: "raw", payload: line });
          return;
        }
        const kind = [ev.type, ev.subtype].filter(Boolean).join(".");
        r.onEvent({ kind, payload: ev });
        if (typeof ev.session_id === "string") result.sessionId = ev.session_id;
        if (ev.type === "system" && ev.subtype === "init" && typeof ev.apiKeySource === "string" && ev.apiKeySource !== "none") {
          refuse(`the engine started with a pay-per-use credential (${ev.apiKeySource}); only subscription logins are allowed`);
        }
        if (ev.type === "rate_limit_event") {
          const parsed = RateLimitInfo.safeParse(ev.rate_limit_info);
          if (parsed.success) result.rateLimit = parsed.data;
          if ((ev.rate_limit_info as { isUsingOverage?: boolean } | undefined)?.isUsingOverage === true) {
            refuse("the account is using paid overage beyond the plan limits");
          }
        }
        if (ev.type === "result") {
          sawResult = true;
          const usage = (ev.usage ?? {}) as Record<string, number>;
          result.inputTokens = (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
          result.outputTokens = usage.output_tokens ?? 0;
          result.costUsd = typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : 0;
          if (!result.error?.startsWith("subscription-only")) {
            result.ok = ev.subtype === "success" && ev.is_error !== true;
            if (!result.ok) result.error = String(ev.result ?? ev.subtype ?? "failure with no details");
          }
        }
      });

      child.on("error", (e) => {
        result.ok = false;
        result.error = `could not start ${this.bin}: ${e.message}`;
      });
      child.on("close", (code) => {
        if (!sawResult && !result.error) result.error = `claude exited with code ${code}: ${stderr.trim().slice(-500)}`;
        if (code !== 0 && result.ok) result.ok = false;
        resolve(result);
      });
    });
  }
}
