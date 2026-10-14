import type { AgentOverview, ModelName, Run, ThreadState } from "./api";

export type AgentStatus = "running" | "offline" | "waiting" | "error" | "idle";

export const STATUS_LABEL: Record<AgentStatus, string> = { running: "Running", offline: "Runner offline", waiting: "Queued", error: "Failed", idle: "Idle" };

export function agentStatus(a: AgentOverview): AgentStatus {
  if (a.run_id) return "running";
  // Without a runner nothing will happen, which matters more than queued or failed.
  if (!a.runner_online) return "offline";
  if (a.queued > 0) return "waiting";
  if (a.last_state === "failed") return "error";
  return "idle";
}

export const STATE_LABEL: Record<ThreadState, string> = {
  open: "Open",
  in_progress: "In progress",
  verifying: "Verifying",
  awaiting_approval: "Awaiting approval",
  external_review: "In review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
};

export const STEPS: ThreadState[] = ["open", "in_progress", "verifying", "awaiting_approval", "done"];

export function stateTone(s: ThreadState): string {
  if (s === "done") return "ok";
  if (s === "awaiting_approval") return "warn";
  if (s === "blocked") return "err";
  if (s === "cancelled") return "";
  return "sonnet";
}

export const isOpen = (s: ThreadState) => s !== "done" && s !== "cancelled";

export function hue(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

export function ago(iso?: string | null, now = Date.now()): string {
  if (!iso) return "";
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function clock(iso?: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function inFuture(iso?: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "now";
  const m = Math.round(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

export function runDuration(r: Pick<Run, "started_at" | "ended_at">): string {
  if (!r.started_at || !r.ended_at) return "";
  const s = (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function money(v: string | number | null | undefined): string {
  if (v == null) return "";
  const n = Number(v);
  return `≈$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
}

export const pct = (v: number | null | undefined) => (v == null ? "n/a" : `${Math.round(v * 100)}%`);

export const modelOf = (m?: string | null): ModelName => (m === "opus" || m === "sonnet" ? m : "haiku");

export function readLS(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function writeLS(key: string, v: string) {
  try { localStorage.setItem(key, v); } catch { /* ignore */ }
}

/** Compact one-line view of a tool input object. */
export function compactInput(input: unknown, max = 160): string {
  if (input == null) return "";
  if (typeof input === "string") return input.slice(0, max);
  const o = input as Record<string, unknown>;
  const pref = o.file_path ?? o.path ?? o.pattern ?? o.command ?? o.body ?? o.title ?? o.query;
  let s: string;
  if (typeof pref === "string" && Object.keys(o).length <= 2) s = pref;
  else s = Object.entries(o).map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`).join(" ");
  s = s.replace(/\s+/g, " ");
  return s.length > max ? s.slice(0, max) + "…" : s;
}

/** Runs are paid by plan limits; the dollar figure is only what the same tokens would cost on the API. */
export const MONEY_HINT = "Claude Code's estimate at API prices. With a subscription login this is not charged; usage counts against your plan limits.";
