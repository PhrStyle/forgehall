import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { RateLimitInfo } from "@forgehall/shared";
import type { Engine, EngineResult, EngineRun } from "./engine.js";

const MODEL_IDS: Record<string, string> = { haiku: "haiku", sonnet: "sonnet", opus: "opus" };

/**
 * Variables that make Claude Code bill per token instead of using the subscription.
 * Forgehall runs on plan limits only, so they never reach the engine.
 */
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

  constructor(private readonly bin = process.env.CLAUDE_BIN ?? "claude") {}

  args(r: EngineRun): string[] {
    const { claim } = r;
    const mcp = { mcpServers: { bus: { type: "http", url: `${r.bus.url}/mcp`, headers: { Authorization: `Bearer ${r.bus.token}` } } } };
    const args = [
      "-p", claim.prompt,
      "--model", MODEL_IDS[claim.model] ?? claim.model,
      "--effort", claim.effort,
      "--output-format", "stream-json",
      "--verbose",
      "--mcp-config", JSON.stringify(mcp),
      "--strict-mcp-config",
      "--permission-mode", "dontAsk",
      "--allowedTools", ["mcp__bus__*", ...claim.allowedTools].join(","),
    ];
    if (claim.agentPrompt.trim()) args.push("--append-system-prompt", claim.agentPrompt);
    if (claim.sessionId) args.push("--resume", claim.sessionId);
    return args;
  }

  run(r: EngineRun): Promise<EngineResult> {
    return new Promise((resolve) => {
      const result: EngineResult = { ok: false, sessionId: r.claim.sessionId, inputTokens: 0, outputTokens: 0, costUsd: 0, error: null, rateLimit: null };
      // stdin closed: headless mode otherwise waits for piped input.
      const child = spawn(this.bin, this.args(r), { cwd: r.cwd, env: subscriptionOnlyEnv(process.env, r.env), stdio: ["ignore", "pipe", "pipe"], signal: r.signal });
      // Last line of defence against money charges: stop the moment the engine reports
      // a non-subscription credential or paid overage.
      const refuse = (why: string) => {
        if (result.error?.startsWith("subscription-only")) return;
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
