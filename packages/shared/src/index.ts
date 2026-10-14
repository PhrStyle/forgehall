import { z } from "zod";

export const VERSION = "0.0.0";

/** Who can appear as sender or recipient of a bus message. */
export const HUMAN = "you";
export const SYSTEM = "system";

export const MessageType = z.enum([
  "request",
  "ask",
  "answer",
  "verify",
  "approval",
  "notify",
  "decision",
  "complete",
]);
export type MessageType = z.infer<typeof MessageType>;

export const ThreadState = z.enum([
  "open",
  "in_progress",
  "verifying",
  "awaiting_approval",
  "external_review",
  "done",
  "blocked",
  "cancelled",
]);
export type ThreadState = z.infer<typeof ThreadState>;

export const Model = z.enum(["haiku", "sonnet", "opus"]);
export type Model = z.infer<typeof Model>;

export const Effort = z.enum(["low", "medium", "high"]);
export type Effort = z.infer<typeof Effort>;

export const Outcome = z.enum(["passed", "failed"]);
export type Outcome = z.infer<typeof Outcome>;

/** Where a runner executes. `container` and `vm` are isolated; `host` is refused unless the user allows it. */
export const RunnerMode = z.enum(["container", "vm", "host"]);
export type RunnerMode = z.infer<typeof RunnerMode>;
export const isIsolated = (m: RunnerMode) => m !== "host";

/** What the bus hands a runner when it claims a run. */
export const RunClaim = z.object({
  runId: z.number(),
  workspaceId: z.string(),
  agentId: z.string(),
  threadId: z.string(),
  model: Model,
  effort: Effort,
  routeReason: z.string(),
  sessionId: z.string().nullable(),
  prompt: z.string(),
  /** Agent identity (agent.md), appended to the engine's system prompt. */
  agentPrompt: z.string(),
  /** Engine tools allowed without asking, besides the bus tools. */
  allowedTools: z.array(z.string()),
  /** Claude Code permission rules for this run; anything not allowed or denied is asked to the user. */
  permissions: z
    .object({ allow: z.array(z.string()), ask: z.array(z.string()), deny: z.array(z.string()) })
    .default({ allow: [], ask: [], deny: [] }),
  /** Where the runner executes: isolated in a container or VM, or directly on the host (opt-in only). */
  runnerMode: RunnerMode.default("container"),
  /** Repository checkout for the run, or null for threads without a repo. */
  repo: z
    .object({ id: z.string(), base: z.string(), branch: z.string() })
    .nullable()
    .default(null),
});
export type RunClaim = z.infer<typeof RunClaim>;

export const RateLimitWindow = z.object({
  utilization: z.number(),
  resetsAt: z.number(),
});

/** Usage snapshot reported by the engine (Claude Code `rate_limit_event`). */
export const RateLimitInfo = z.object({
  status: z.string(),
  resetsAt: z.number().optional(),
  rateLimitType: z.string().optional(),
  unifiedWindows: z
    .object({
      five_hour: RateLimitWindow.optional(),
      seven_day: RateLimitWindow.optional(),
    })
    .optional(),
});
export type RateLimitInfo = z.infer<typeof RateLimitInfo>;

/** What a runner reports when a run ends. */
export const RunFinish = z.object({
  ok: z.boolean(),
  sessionId: z.string().nullable(),
  inputTokens: z.number().default(0),
  outputTokens: z.number().default(0),
  costUsd: z.number().default(0),
  error: z.string().nullable().default(null),
  rateLimit: RateLimitInfo.nullable().default(null),
});
export type RunFinish = z.infer<typeof RunFinish>;

/** One raw engine event, forwarded for the activity feed. */
export const RunEvent = z.object({
  kind: z.string(),
  payload: z.unknown(),
});
export type RunEvent = z.infer<typeof RunEvent>;
