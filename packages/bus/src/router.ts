import type { Effort, MessageType, Model } from "@forgehall/shared";

export interface RouteInput {
  /** Type of the message that triggered the run. */
  trigger: MessageType;
  agentDefault: Model;
  severity: string | null;
  /** Failed runs of this agent on this thread so far. */
  failures: number;
  /** Reason given by the agent when it called `escalate`, if any. */
  escalation: string | null;
  /**
   * The answer carries real work for the recipient: the result of a verification it asked for, or
   * the user's reply to its question. Usually it now fixes something or asks for approval.
   */
  substantiveAnswer?: boolean;
}

export interface Route {
  model: Model;
  effort: Effort;
  reason: string;
  /** Lower runs first: answers and decisions unblock other agents. */
  priority: number;
}

const PRIORITY: Record<MessageType, number> = {
  answer: 1,
  decision: 1,
  complete: 6,
  verify: 3,
  request: 5,
  ask: 4,
  notify: 6,
  approval: 6,
};

/** Deterministic v1 routing rules (see docs/ARCHITECTURE.md, "Model routing"). */
export function route(input: RouteInput): Route {
  const priority = PRIORITY[input.trigger];
  if (input.escalation) {
    return { model: "opus", effort: "high", reason: `escalated by the agent: ${input.escalation}`, priority };
  }
  if (input.failures >= 2) {
    return { model: "opus", effort: "high", reason: `${input.failures} failed runs on this thread`, priority };
  }
  if (input.trigger === "answer" && input.substantiveAnswer) {
    return { model: input.agentDefault, effort: "medium", reason: "answer that continues the work (verification result or the user's reply): agent default model", priority };
  }
  if (input.trigger === "answer" || input.trigger === "notify" || input.trigger === "ask") {
    return { model: "haiku", effort: "low", reason: `handling ${input.trigger}: short task`, priority };
  }
  if (input.severity === "high" && input.agentDefault === "haiku") {
    return { model: "sonnet", effort: "medium", reason: "high severity with a Haiku default agent", priority };
  }
  return { model: input.agentDefault, effort: "medium", reason: `${input.trigger} received: agent default model`, priority };
}
