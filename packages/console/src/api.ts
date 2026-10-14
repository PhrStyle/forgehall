// Console API client. Row shapes mirror packages/bus/src/store.ts (read models).

export type ThreadState = "open" | "in_progress" | "verifying" | "awaiting_approval" | "external_review" | "done" | "blocked" | "cancelled";
export type MessageType = "request" | "ask" | "answer" | "verify" | "approval" | "notify" | "decision";
export type ModelName = "haiku" | "sonnet" | "opus";

export interface Workspace { id: string; name: string }

export interface AgentOverview {
  id: string;
  name: string;
  role: string | null;
  default_model: ModelName;
  run_id: string | null;
  run_thread: string | null;
  run_model: ModelName | null;
  run_started_at: string | null;
  queued: number;
  last_state: "done" | "failed" | null;
  last_error: string | null;
  last_ended_at: string | null;
  runs_today: number;
}

export interface ThreadOverview {
  id: string;
  workspace_id: string;
  title: string;
  state: ThreadState;
  severity: string | null;
  created_by: string;
  assignee: string | null;
  updated_at: string;
  message_count: number;
  participants: string[] | null;
  waiting_on_you: boolean;
}

export interface Message {
  id: string;
  thread_id: string;
  type: MessageType;
  from_actor: string;
  to_actor: string;
  body: string;
  outcome: "passed" | "failed" | null;
  reply_to: string | null;
  created_at: string;
}

export interface Run {
  id: string;
  agent_id: string;
  thread_id?: string;
  model: ModelName;
  effort: string;
  route_reason: string | null;
  state: "queued" | "running" | "done" | "failed";
  queued_at: string;
  started_at: string | null;
  ended_at: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: string | number | null;
  error: string | null;
}

export interface ThreadDetail { thread: Omit<ThreadOverview, "message_count" | "participants" | "waiting_on_you">; messages: Message[]; runs: Run[] }

export interface RunEvent { seq: number; ts: string; kind: string; payload: any }

export interface Usage {
  five_hour?: number | null;
  five_hour_resets_at?: string | null;
  seven_day?: number | null;
  seven_day_resets_at?: string | null;
  status?: string | null;
  updated_at?: string;
}

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { ...init, headers: { "content-type": "application/json", ...init?.headers } });
  } catch {
    throw new ApiError("Cannot reach the bus", 0);
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j?.message || j?.error) msg = String(j.message ?? j.error); } catch { /* keep default */ }
    // The Vite proxy answers 500/502/504 when the bus is down.
    throw new ApiError(msg, res.status === 502 || res.status === 504 || res.status === 500 && msg.includes("ECONNREFUSED") ? 0 : res.status);
  }
  return (await res.json()) as T;
}

const enc = encodeURIComponent;
export const api = {
  workspaces: () => request<Workspace[]>("/api/workspaces"),
  agents: (ws: string) => request<AgentOverview[]>(`/api/workspaces/${enc(ws)}/agents`),
  threads: (ws: string) => request<ThreadOverview[]>(`/api/workspaces/${enc(ws)}/threads`),
  runs: (ws: string, limit = 50) => request<Run[]>(`/api/workspaces/${enc(ws)}/runs?limit=${limit}`),
  usage: (ws: string) => request<Usage>(`/api/workspaces/${enc(ws)}/usage`),
  thread: (id: string) => request<ThreadDetail>(`/api/threads/${enc(id)}`),
  runEvents: (id: string | number, after = 0) => request<RunEvent[]>(`/api/runs/${id}/events?after=${after}`),
  createThread: (b: { workspace: string; to: string; title: string; body: string; severity?: string }) =>
    request<{ id: string }>("/api/threads", { method: "POST", body: JSON.stringify(b) }),
  postMessage: (threadId: string, b: { to: string; type: MessageType; body: string; replyTo?: string }) =>
    request<Message>(`/api/threads/${enc(threadId)}/messages`, { method: "POST", body: JSON.stringify(b) }),
};

export const HUMAN = "you";
