// Console API client. Row shapes mirror packages/bus/src/store.ts (read models).

export type ThreadState = "open" | "in_progress" | "verifying" | "awaiting_approval" | "external_review" | "done" | "blocked" | "cancelled";
export type MessageType = "request" | "ask" | "answer" | "verify" | "approval" | "notify" | "decision";
export type ModelName = "haiku" | "sonnet" | "opus";

export interface Workspace { id: string; name: string; claude_account_id?: string | null }
export type AccountPlan = "pro" | "max-5x" | "max-20x" | "team-standard" | "team-premium" | "enterprise";
export interface Account { id: string; label: string; plan: AccountPlan; token_hint: string; created_at: string; workspaces: string[] }

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
  /** A runner for this agent asked for work in the last minute. */
  runner_online: boolean | null;
  desired_state?: "running" | "stopped";
  container_state?: ContainerState | null;
  container_detail?: string | null;
  container_seen_at?: string | null;
}
export type ContainerState = "running" | "stopped" | "starting" | "stopping" | "restarting" | "updating" | "error";
export interface SupervisorStatus { online: boolean; seen_at: string | null }

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
  repo_id?: string | null;
  branch?: string | null;
}

export type RepoProvider = "local" | "github" | "azure-devops";
export interface RepoRow { workspace_id: string; id: string; upstream_url: string; provider: RepoProvider; base_branch: string }

export type ApprovalPolicy = "merge" | "pull_request" | "branch_only";
export type HostProvider = "github" | "azure-devops";
export interface HostCredential { provider: HostProvider; token_hint: string; created_at: string }
export interface Publishing {
  approval_policy: ApprovalPolicy;
  git_author_name: string | null;
  git_author_email: string | null;
  ai_trailer: boolean;
  credentials: HostCredential[];
}
export type PublishingPatch = Partial<Pick<Publishing, "approval_policy" | "git_author_name" | "git_author_email" | "ai_trailer">>;
export interface Reviewer { id: string; displayName: string; uniqueName: string }
export interface PullRequestRef { id: string; url: string; status: "open" | "merged" | "closed" }
export interface ApprovalResult { merged?: string; commit?: string; branch?: string; pr?: PullRequestRef; warnings?: string[] }

export interface BranchDiff {
  base: string;
  branch: string;
  baseSha: string | null;
  headSha: string | null;
  commits: { sha: string; author: string; date: string; subject: string }[];
  files: { path: string; additions: number; deletions: number }[];
  patch: string;
  truncated: boolean;
}

export interface Approval {
  id: string;
  thread_id: string;
  policy: ApprovalPolicy;
  requested_by: string;
  summary: string;
  head_sha: string | null;
  state: "pending" | "approved" | "rejected" | "superseded";
  comment: string | null;
  result: ApprovalResult | null;
  created_at: string;
  decided_at: string | null;
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

export interface PermissionRow {
  id: number;
  workspace_id: string;
  agent_id: string;
  run_id: number | null;
  thread_id: string | null;
  tool_name: string;
  input: Record<string, any> | null;
  rule: string | null;
  state: "pending" | "allowed" | "denied" | "expired";
  remember: boolean;
  reason: string | null;
  created_at: string;
  decided_at: string | null;
}
export interface Settings { allow_host_runners: boolean; [k: string]: unknown }

export interface AgentSettings {
  id: string;
  name: string;
  role: string;
  default_model: ModelName;
  accepts_from: string[];
  prompt: string;
  permissions: { allow?: string[]; ask?: string[]; deny?: string[] };
  credentials: HostCredential[];
}
export interface AgentCreate { id: string; name: string; role: string; default_model: ModelName; accepts_from?: string[]; prompt?: string }
export type AgentPatch = Partial<Omit<AgentCreate, "id">>;

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    // Only requests with a body are JSON: the bus refuses an empty body labelled as JSON.
    res = await fetch(path, { ...init, headers: { ...(init?.body !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers } });
  } catch {
    throw new ApiError("Cannot reach the bus", 0);
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try { const j = await res.json(); if (j?.message || j?.error) msg = String(j.message ?? j.error); } catch { /* keep default */ }
    // The Vite proxy answers 500/502/504 when the bus is down.
    throw new ApiError(msg, res.status === 502 || res.status === 504 || res.status === 500 && msg.includes("ECONNREFUSED") ? 0 : res.status);
  }
  // 204 No Content (close, reopen…) has no body to parse.
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const enc = encodeURIComponent;
export const api = {
  workspaces: () => request<Workspace[]>("/api/workspaces"),
  createWorkspace: (b: { id: string; name: string }) =>
    request<Workspace>("/api/workspaces", { method: "POST", body: JSON.stringify(b) }),
  createAgent: (ws: string, b: AgentCreate) =>
    request<AgentSettings>(`/api/workspaces/${enc(ws)}/agents`, { method: "POST", body: JSON.stringify(b) }),
  agentSettings: (ws: string, id: string) => request<AgentSettings>(`/api/workspaces/${enc(ws)}/agents/${enc(id)}/settings`),
  patchAgent: (ws: string, id: string, b: AgentPatch) =>
    request<AgentSettings>(`/api/workspaces/${enc(ws)}/agents/${enc(id)}`, { method: "PATCH", body: JSON.stringify(b) }),
  // Per-agent host token: only travels in the request body, never returned.
  saveAgentCredential: (ws: string, id: string, provider: HostProvider, token: string) =>
    request<HostCredential>(`/api/workspaces/${enc(ws)}/agents/${enc(id)}/credentials/${enc(provider)}`, { method: "PUT", body: JSON.stringify({ token }) }),
  deleteAgentCredential: (ws: string, id: string, provider: HostProvider) =>
    request<void>(`/api/workspaces/${enc(ws)}/agents/${enc(id)}/credentials/${enc(provider)}`, { method: "DELETE" }),
  accounts: () => request<Account[]>("/api/accounts"),
  // The token only travels in this request body; it is never returned, logged or cached.
  saveAccount: (b: { id: string; label: string; plan: AccountPlan; token: string }) =>
    request<Account>("/api/accounts", { method: "POST", body: JSON.stringify(b) }),
  deleteAccount: (id: string) => request<void>(`/api/accounts/${enc(id)}`, { method: "DELETE" }),
  setWorkspaceAccount: (ws: string, account: string | null) =>
    request<void>(`/api/workspaces/${enc(ws)}/account`, { method: "PUT", body: JSON.stringify({ account }) }),
  agents: (ws: string) => request<AgentOverview[]>(`/api/workspaces/${enc(ws)}/agents`),
  startAgent: (ws: string, id: string) => request<void>(`/api/workspaces/${enc(ws)}/agents/${enc(id)}/start`, { method: "POST" }),
  stopAgent: (ws: string, id: string) => request<void>(`/api/workspaces/${enc(ws)}/agents/${enc(id)}/stop`, { method: "POST" }),
  restartAgent: (ws: string, id: string) => request<void>(`/api/workspaces/${enc(ws)}/agents/${enc(id)}/restart`, { method: "POST" }),
  supervisor: () => request<SupervisorStatus>("/api/supervisor"),
  threads: (ws: string) => request<ThreadOverview[]>(`/api/workspaces/${enc(ws)}/threads`),
  repos: (ws: string) => request<RepoRow[]>(`/api/workspaces/${enc(ws)}/repos`),
  diff: (id: string) => request<BranchDiff>(`/api/threads/${enc(id)}/diff`),
  approvals: (id: string) => request<Approval[]>(`/api/threads/${enc(id)}/approvals`),
  decide: (id: string, b: { decision: "approve" | "reject"; comment?: string; reviewers?: string[]; title?: string }) =>
    request<Approval>(`/api/approvals/${enc(id)}/decide`, { method: "POST", body: JSON.stringify(b) }),
  publishing: (ws: string) => request<Publishing>(`/api/workspaces/${enc(ws)}/publishing`),
  patchPublishing: (ws: string, b: PublishingPatch) =>
    request<Publishing>(`/api/workspaces/${enc(ws)}/publishing`, { method: "PATCH", body: JSON.stringify(b) }),
  // Like Claude tokens: only travels in the request body, never returned.
  saveCredential: (ws: string, provider: HostProvider, token: string) =>
    request<HostCredential>(`/api/workspaces/${enc(ws)}/credentials/${enc(provider)}`, { method: "PUT", body: JSON.stringify({ token }) }),
  deleteCredential: (ws: string, provider: HostProvider) =>
    request<void>(`/api/workspaces/${enc(ws)}/credentials/${enc(provider)}`, { method: "DELETE" }),
  reviewers: (threadId: string, q: string) => request<Reviewer[]>(`/api/threads/${enc(threadId)}/reviewers?q=${enc(q)}`),
  runs: (ws: string, limit = 50) => request<Run[]>(`/api/workspaces/${enc(ws)}/runs?limit=${limit}`),
  usage: (ws: string) => request<Usage>(`/api/workspaces/${enc(ws)}/usage`),
  thread: (id: string) => request<ThreadDetail>(`/api/threads/${enc(id)}`),
  runEvents: (id: string | number, after = 0) => request<RunEvent[]>(`/api/runs/${id}/events?after=${after}`),
  createThread: (b: { workspace: string; to: string; title: string; body: string; severity?: string; repo?: string }) =>
    request<{ id: string }>("/api/threads", { method: "POST", body: JSON.stringify(b) }),
  postMessage: (threadId: string, b: { to: string; type: MessageType; body: string; replyTo?: string }) =>
    request<Message>(`/api/threads/${enc(threadId)}/messages`, { method: "POST", body: JSON.stringify(b) }),
  closeThread: (threadId: string, b: { state: "done" | "cancelled"; note?: string }) =>
    request<void>(`/api/threads/${enc(threadId)}/close`, { method: "POST", body: JSON.stringify(b) }),
  settings: () => request<Settings>("/api/settings"),
  patchSettings: (b: { allow_host_runners: boolean }) => request<Settings>("/api/settings", { method: "PATCH", body: JSON.stringify(b) }),
  permissions: (ws: string) => request<PermissionRow[]>(`/api/workspaces/${enc(ws)}/permissions?state=pending`),
  decidePermission: (id: number, b: { decision: "allow" | "deny"; remember?: boolean; reason?: string }) =>
    request<PermissionRow>(`/api/permissions/${enc(String(id))}/decide`, { method: "POST", body: JSON.stringify(b) }),
  reopenThread: (threadId: string, note: string) =>
    request<void>(`/api/threads/${enc(threadId)}/reopen`, { method: "POST", body: JSON.stringify({ note }) }),
};

export const HUMAN = "you";
