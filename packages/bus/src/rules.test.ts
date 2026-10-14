import { describe, expect, it } from "vitest";
import { buildPrompt } from "./prompt.js";
import { route } from "./router.js";
import { nextState, type AgentRow, type MessageRow, type ThreadRow } from "./store.js";

describe("route", () => {
  const base = { agentDefault: "sonnet" as const, severity: null, failures: 0, escalation: null };

  it("sends short replies to Haiku", () => {
    expect(route({ ...base, trigger: "answer" }).model).toBe("haiku");
    expect(route({ ...base, trigger: "ask" }).model).toBe("haiku");
  });

  it("uses the agent default for requests and verifications", () => {
    expect(route({ ...base, trigger: "request" })).toMatchObject({ model: "sonnet", effort: "medium" });
    expect(route({ ...base, trigger: "verify", agentDefault: "haiku" }).model).toBe("haiku");
  });

  it("escalates to Opus after two failures or on request", () => {
    expect(route({ ...base, trigger: "answer", failures: 2 }).model).toBe("opus");
    expect(route({ ...base, trigger: "request", escalation: "cause not isolated" })).toMatchObject({ model: "opus", effort: "high" });
  });

  it("lifts Haiku agents to Sonnet on high severity", () => {
    expect(route({ ...base, trigger: "request", agentDefault: "haiku", severity: "high" }).model).toBe("sonnet");
  });

  it("runs answers before new requests", () => {
    expect(route({ ...base, trigger: "answer" }).priority).toBeLessThan(route({ ...base, trigger: "request" }).priority);
  });
});

describe("nextState", () => {
  it("follows verification and approval", () => {
    expect(nextState("in_progress", "verify", null)).toBe("verifying");
    expect(nextState("verifying", "answer", "failed")).toBe("in_progress");
    expect(nextState("verifying", "answer", "passed")).toBe("verifying");
    expect(nextState("verifying", "approval", null)).toBe("awaiting_approval");
    expect(nextState("awaiting_approval", "decision", null)).toBe("in_progress");
  });

  it("never reopens finished threads", () => {
    expect(nextState("done", "request", null)).toBe("done");
    expect(nextState("cancelled", "verify", null)).toBe("cancelled");
  });
});

describe("buildPrompt", () => {
  const agent = { workspace_id: "dev", id: "vigil", name: "Vigil", role: "QA" } as AgentRow;
  const thread = { id: "THR-0001", workspace_id: "dev", title: "Bug", state: "in_progress" } as ThreadRow;
  const msg = (id: string, from: string, body: string): MessageRow =>
    ({ id, thread_id: "THR-0001", type: "ask", from_actor: from, to_actor: "vigil", body, outcome: null, reply_to: null, created_at: new Date() }) as MessageRow;

  it("introduces the agent only on a fresh session", () => {
    expect(buildPrompt({ agent, thread, messages: [], resumed: false })).toContain("You are Vigil (QA)");
    expect(buildPrompt({ agent, thread, messages: [], resumed: true })).not.toContain("You are Vigil");
  });

  it("wraps messages with id and sender, naming the human as the user", () => {
    const p = buildPrompt({ agent, thread, messages: [msg("7", "you", "hi"), msg("8", "atlas", "hello")], resumed: true });
    expect(p).toContain('<message id="7" type="ask" from="the user">');
    expect(p).toContain('<message id="8" type="ask" from="atlas">');
    expect(p).toContain("thread_id: THR-0001");
  });
});
