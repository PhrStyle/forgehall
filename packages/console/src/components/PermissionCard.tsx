import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type PermissionRow } from "../api";
import { useAgents } from "../queries";
import { useApp } from "../context";
import { Avatar, Chip, ErrorBox } from "../ui";
import { ago } from "../util";

const TTL_MS = 15 * 60_000;

function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(t); }, [everyMs]);
  return now;
}

export function expiresIn(createdAt: string, now: number): string {
  const left = new Date(createdAt).getTime() + TTL_MS - now;
  if (left <= 0) return "expiring now";
  return `expires in ${Math.max(1, Math.ceil(left / 60_000))} min`;
}

/** What the agent wants to do, in words a human can judge at a glance. */
function Summary({ p }: { p: PermissionRow }) {
  const i = p.input ?? {};
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  switch (p.tool_name) {
    case "Bash":
      return <>run a command{str(i.description) && <span className="muted"> — {str(i.description)}</span>}<pre className="perm-code">{str(i.command) ?? JSON.stringify(i)}</pre></>;
    case "Edit": case "Write": case "MultiEdit": case "NotebookEdit":
      return <>{p.tool_name === "Write" ? "write" : "edit"} a file<div className="perm-code mono">{str(i.file_path) ?? str(i.notebook_path) ?? JSON.stringify(i)}</div></>;
    case "Read":
      return <>read a file<div className="perm-code mono">{str(i.file_path) ?? JSON.stringify(i)}</div></>;
    case "WebFetch":
      return <>fetch a URL<div className="perm-code mono">{str(i.url) ?? JSON.stringify(i)}</div>{str(i.prompt) && <div className="muted perm-note">{str(i.prompt)}</div>}</>;
    case "WebSearch":
      return <>search the web<div className="perm-code mono">{str(i.query) ?? JSON.stringify(i)}</div></>;
    default:
      return <>use <span className="mono">{p.tool_name}</span><pre className="perm-code">{JSON.stringify(i)}</pre></>;
  }
}

export function PermissionCard({ p, compact }: { p: PermissionRow; compact?: boolean }) {
  const app = useApp();
  const qc = useQueryClient();
  const agents = useAgents(app.workspace).data ?? [];
  const agentName = agents.find((a) => a.id === p.agent_id)?.name ?? p.agent_id;
  const now = useNow();
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: (b: { decision: "allow" | "deny"; remember?: boolean; reason?: string }) => api.decidePermission(p.id, b),
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["permissions", p.workspace_id] }); if (p.thread_id) void qc.invalidateQueries({ queryKey: ["thread", p.thread_id] }); },
  });
  const busy = m.isPending;

  return (
    <div className={`perm ${compact ? "compact" : ""}`} role="group" aria-label={`Permission request from ${agentName}`}>
      <div className="perm-head">
        <Avatar id={p.agent_id} name={agentName} />
        <div className="perm-who"><b>{agentName}</b> wants to <Summary p={p} /></div>
      </div>
      <div className="perm-meta faint">
        {p.thread_id && <><Link to={`/threads/${p.thread_id}`} className="mono">{p.thread_id}</Link><span>·</span></>}
        <span>{ago(p.created_at, now)}</span><span>·</span><Chip tone="warn">{expiresIn(p.created_at, now)}</Chip>
      </div>
      {denying ? (
        <div className="perm-deny">
          <input className="input" autoFocus placeholder="Reason (optional) — the agent will see it" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") m.mutate({ decision: "deny", ...(reason.trim() ? { reason: reason.trim() } : {}) }); }} aria-label="Reason for denying" />
          <div className="perm-acts">
            <button className="btn danger" disabled={busy} onClick={() => m.mutate({ decision: "deny", ...(reason.trim() ? { reason: reason.trim() } : {}) })}>{busy ? "Working…" : "Confirm deny"}</button>
            <button className="btn ghost" disabled={busy} onClick={() => setDenying(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="perm-acts">
          <button className="btn primary" disabled={busy} onClick={() => m.mutate({ decision: "allow" })}>{busy ? "Working…" : "Allow once"}</button>
          {p.rule && (
            <button className="btn" disabled={busy} onClick={() => m.mutate({ decision: "allow", remember: true })} title={`Adds this rule to ${agentName}'s permissions`}>Always allow</button>
          )}
          <button className="btn danger" disabled={busy} onClick={() => setDenying(true)}>Deny</button>
        </div>
      )}
      {p.rule && !denying && <div className="perm-hint faint">Always allow adds <code>{p.rule}</code> to {agentName}'s permissions.</div>}
      <ErrorBox error={m.error} />
    </div>
  );
}

export function PermissionList({ items, compact }: { items: PermissionRow[]; compact?: boolean }) {
  if (items.length === 0) return null;
  return <div className="perm-list">{items.map((p) => <PermissionCard key={p.id} p={p} compact={compact} />)}</div>;
}
