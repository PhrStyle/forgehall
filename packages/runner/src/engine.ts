import type { RateLimitInfo, RunClaim, RunEvent } from "@forgehall/shared";

/** Everything an engine needs to run one turn of an agent. */
export interface EngineRun {
  claim: RunClaim;
  /** Working directory of the agent (the thread's checkout). */
  cwd: string;
  /** MCP config pointing at the bus, authenticated as this agent. */
  bus: { url: string; token: string };
  /** Extra environment for the engine process (e.g. account credentials). */
  env: NodeJS.ProcessEnv;
  onEvent: (event: RunEvent) => void;
  signal?: AbortSignal;
}

export interface EngineResult {
  ok: boolean;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error: string | null;
  rateLimit: RateLimitInfo | null;
}

/**
 * A coding-agent engine. Claude Code is the only implementation today; the interface exists so
 * other agent CLIs can be added without touching the bus or the console.
 */
export interface Engine {
  readonly name: string;
  run(run: EngineRun): Promise<EngineResult>;
}
