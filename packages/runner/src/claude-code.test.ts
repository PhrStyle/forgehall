import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { RunClaim } from "@forgehall/shared";
import { billingModeFrom, ClaudeCodeEngine, PAY_PER_USE_ENV, subscriptionOnlyEnv, type BillingMode } from "./claude-code.js";

const claim: RunClaim = {
  runId: 1, workspaceId: "dev", agentId: "vigil", threadId: "THR-0001", model: "haiku", effort: "low",
  routeReason: "test", sessionId: null, prompt: "hi", agentPrompt: "", allowedTools: [],
  permissions: { allow: [], ask: [], deny: [] }, runnerMode: "container", repo: null,
};

/** A stand-in for the `claude` binary that prints the given stream-json lines. */
async function fakeClaude(lines: object[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fh-fake-claude-"));
  const bin = join(dir, "claude");
  const out = lines.map((l) => JSON.stringify(l)).join("\n");
  await writeFile(bin, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(out + "\n")});\nsetTimeout(() => {}, 200);\n`);
  await chmod(bin, 0o755);
  return bin;
}

const run = (bin: string, billing: BillingMode = "subscription-only") =>
  new ClaudeCodeEngine(bin, billing).run({ claim, cwd: tmpdir(), bus: { url: "http://127.0.0.1:1", token: "t" }, env: {}, onEvent: () => {} });

const init = (apiKeySource: string) => ({ type: "system", subtype: "init", session_id: "s1", apiKeySource });
const rateLimit = (isUsingOverage: boolean) => ({ type: "rate_limit_event", rate_limit_info: { status: "allowed", isUsingOverage } });
const success = { type: "result", subtype: "success", session_id: "s1", result: "ok", total_cost_usd: 0.001, usage: { input_tokens: 1, output_tokens: 1 } };

describe("billing mode", () => {
  it("follows the credential by default and accepts the known values", () => {
    expect(billingModeFrom(undefined, { CLAUDE_CODE_OAUTH_TOKEN: "t" })).toBe("subscription-only");
    expect(billingModeFrom(undefined, { CLAUDE_CODE_OAUTH_TOKEN: "t", ANTHROPIC_API_KEY: "k" })).toBe("subscription-only");
    expect(billingModeFrom(undefined, {})).toBe("subscription-only");
    expect(billingModeFrom(undefined, { ANTHROPIC_API_KEY: "k" })).toBe("any");
    expect(billingModeFrom("any", { CLAUDE_CODE_OAUTH_TOKEN: "t" })).toBe("any");
    expect(billingModeFrom("subscription-only")).toBe("subscription-only");
    expect(() => billingModeFrom("cheap")).toThrow();
  });

  it("leaves the operator's authentication alone in the default mode", async () => {
    const r = await run(await fakeClaude([init("ANTHROPIC_API_KEY"), rateLimit(true), success]), "any");
    expect(r.ok).toBe(true);
  });
});

describe("subscription-only guard", () => {
  it("strips every pay-per-use variable from the engine environment", () => {
    const env = subscriptionOnlyEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "sk-x", CLAUDE_CODE_USE_BEDROCK: "1" }, { CLAUDE_CODE_OAUTH_TOKEN: "oat" });
    for (const k of PAY_PER_USE_ENV) expect(env[k]).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe("oat");
  });

  it("accepts a run on the subscription", async () => {
    const r = await run(await fakeClaude([init("none"), rateLimit(false), success]));
    expect(r.ok).toBe(true);
    expect(r.sessionId).toBe("s1");
  });

  it("refuses a run that started with an API key", async () => {
    const r = await run(await fakeClaude([init("ANTHROPIC_API_KEY"), success]));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^subscription-only: .*ANTHROPIC_API_KEY/);
  });

  it("refuses a run that uses paid overage", async () => {
    const r = await run(await fakeClaude([init("none"), rateLimit(true), success]));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/^subscription-only: .*overage/);
  });
});

describe("prompt delivery", () => {
  it("sends large prompts through stdin, not argv", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fh-fake-claude-"));
    const bin = join(dir, "claude");
    // Echoes how many prompt bytes arrived on stdin, as the result text.
    await writeFile(bin, `#!/usr/bin/env node
let n = 0;
process.stdin.on("data", (d) => { n += d.length; });
process.stdin.on("end", () => {
  console.log(JSON.stringify({ type: "system", subtype: "init", session_id: "s1", apiKeySource: "none" }));
  console.log(JSON.stringify({ type: "result", subtype: "success", session_id: "s1", result: String(n), usage: {} }));
});
`);
    await chmod(bin, 0o755);
    const prompt = "x".repeat(300_000);
    let text = "";
    const r = await new ClaudeCodeEngine(bin, "any").run({
      claim: { ...claim, prompt }, cwd: tmpdir(), bus: { url: "http://127.0.0.1:1", token: "t" }, env: {},
      onEvent: (e) => { const p = e.payload as { type?: string; result?: string }; if (p.type === "result") text = p.result ?? ""; },
    });
    expect(r.ok).toBe(true);
    expect(Number(text)).toBe(300_000);
  });
});
