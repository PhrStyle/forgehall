// Friendly names for the bus protocol's message types. The raw type stays available as a tooltip.
export interface TypeLabel { label: string; icon: string; tone?: string }

export const TYPE_LABEL: Record<string, TypeLabel> = {
  request: { label: "Task", icon: "task" },
  ask: { label: "Question", icon: "dm", tone: "sonnet" },
  answer: { label: "Reply", icon: "say", tone: "haiku" },
  verify: { label: "Review request", icon: "result", tone: "warn" },
  approval: { label: "Approval request", icon: "check", tone: "warn" },
  notify: { label: "Note", icon: "info" },
  decision: { label: "Decision", icon: "escalate", tone: "opus" },
  complete: { label: "Closed", icon: "check", tone: "ok" },
};

export const typeLabel = (t: string): TypeLabel => TYPE_LABEL[t] ?? { label: t, icon: "say" };

export const OUTCOME_LABEL: Record<string, string> = { passed: "Passed", failed: "Failed" };

/** Types a person can send from the composer, with plain descriptions. */
export const SEND_TYPES = [
  { type: "answer", label: "Reply", hint: "Answers what the agent last asked" },
  { type: "request", label: "Task", hint: "Asks the agent to do something" },
  { type: "decision", label: "Decision", hint: "A choice the agent should follow" },
  { type: "notify", label: "Note", hint: "Information, no action expected" },
] as const;
