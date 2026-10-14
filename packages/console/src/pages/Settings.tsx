import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Account, type AccountPlan } from "../api";
import { useApp } from "../context";
import { useAccounts, useSettings } from "../queries";
import { ago } from "../util";
import { Chip, ErrorBox, Icon, ModelChip, PreviewBadge } from "../ui";

const RULES: [string, string, "haiku" | "sonnet" | "opus" | "agent", string][] = [
  ["1", "The agent called `escalate` on this thread", "opus", "high"],
  ["2", "Two or more failed runs of this agent on this thread", "opus", "high"],
  ["3", "Triggering message is `answer`, `notify` or `ask`", "haiku", "low"],
  ["4", "Thread severity is `high` and the agent default is `haiku`", "sonnet", "medium"],
  ["5", "Anything else (`request`, `verify`, `decision`, `approval`)", "agent", "medium"],
];

function IsolationSection() {
  const qc = useQueryClient();
  const q = useSettings();
  const m = useMutation({
    mutationFn: (v: boolean) => api.patchSettings({ allow_host_runners: v }),
    onSuccess: (s) => qc.setQueryData(["settings"], s),
  });
  const on = q.data?.allow_host_runners ?? false;
  return (
    <>
      <div className="section-title"><span>Agent isolation</span></div>
      <div className="switch-row">
        <div className="txt">
          <b id="host-runners-label">Allow agents directly on this machine</b>
          <span className="muted" id="host-runners-desc">Agents run isolated (container now, VM later). A runner started directly on this machine is refused.</span>
        </div>
        <button type="button" role="switch" className="switch" aria-checked={on} aria-labelledby="host-runners-label" aria-describedby="host-runners-desc"
          disabled={!q.data || m.isPending} onClick={() => m.mutate(!on)} />
      </div>
      {on && <div className="warnbox" role="status">Agents started outside a container or VM will be accepted, and every action they take will need your approval here.</div>}
      <div style={{ maxWidth: 700, marginTop: 8 }}><ErrorBox error={m.error ?? q.error} /></div>
    </>
  );
}

const PLANS: [AccountPlan, string][] = [
  ["pro", "Pro"], ["max-5x", "Max 5x"], ["max-20x", "Max 20x"],
  ["team-standard", "Team Standard"], ["team-premium", "Team Premium"], ["enterprise", "Enterprise"],
];
const planLabel = (p: string) => PLANS.find(([k]) => k === p)?.[1] ?? p;
const slugify = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

function TokenInput({ value, onChange, label, autoFocus }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input className="input" style={{ flex: 1 }} type={shown ? "text" : "password"} autoComplete="off" spellCheck={false} autoCapitalize="off" autoFocus={autoFocus}
        aria-label={label} placeholder="sk-ant-oat01-…" value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="btn sm" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? "Hide" : "Show"}</button>
    </div>
  );
}

function AccountRowView({ a, onChanged }: { a: Account; onChanged: () => void }) {
  const [mode, setMode] = useState<"none" | "replace" | "remove">("none");
  const [token, setToken] = useState("");
  const save = useMutation({
    mutationFn: () => api.saveAccount({ id: a.id, label: a.label, plan: a.plan, token: token.trim() }),
    onSuccess: () => { setToken(""); setMode("none"); onChanged(); },
  });
  const del = useMutation({ mutationFn: () => api.deleteAccount(a.id), onSuccess: () => { setMode("none"); onChanged(); } });
  const cancel = () => { setMode("none"); setToken(""); save.reset(); del.reset(); };
  return (
    <div className="li" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div className="t">{a.label} <Chip>{planLabel(a.plan)}</Chip></div>
          <div className="d"><span className="mono">{a.id}</span> · <span className="mono">•••• {a.token_hint}</span> · added {ago(a.created_at)}</div>
          <div className="d">{a.workspaces.length ? <>Used by {a.workspaces.map((w, i) => <span key={w}>{i > 0 && ", "}<span className="mono">{w}</span></span>)}</> : "Not used by any workspace"}</div>
        </div>
        {mode === "none" && (
          <div className="r">
            <button className="btn sm" onClick={() => setMode("replace")}>Replace token</button>
            <button className="btn sm danger" onClick={() => setMode("remove")}>Remove</button>
          </div>
        )}
      </div>
      {mode === "replace" && (
        <form style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, flexWrap: "wrap" }}
          onSubmit={(e) => { e.preventDefault(); if (token.trim()) save.mutate(); }}>
          <div style={{ flex: 1, minWidth: 240 }}><TokenInput value={token} onChange={setToken} label={`New token for ${a.label}`} autoFocus /></div>
          <button className="btn sm primary" type="submit" disabled={!token.trim() || save.isPending}>Save</button>
          <button className="btn sm ghost" type="button" onClick={cancel}>Cancel</button>
        </form>
      )}
      {mode === "remove" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }} role="alertdialog" aria-label="Confirm removal">
          <span>Remove account {a.label}? Workspaces using it will have no account.</span>
          <button className="btn sm danger" disabled={del.isPending} onClick={() => del.mutate()}>Remove</button>
          <button className="btn sm ghost" onClick={cancel}>Cancel</button>
        </div>
      )}
      <ErrorBox error={save.error ?? del.error} />
    </div>
  );
}

function AddAccountForm({ onChanged }: { onChanged: () => void }) {
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [plan, setPlan] = useState<AccountPlan>("pro");
  const [token, setToken] = useState("");
  const [tried, setTried] = useState(false);
  const m = useMutation({
    mutationFn: () => api.saveAccount({ id, label: label.trim(), plan, token: token.trim() }),
    onSuccess: () => { setToken(""); setLabel(""); setId(""); setIdTouched(false); setTried(false); onChanged(); },
  });
  const problems = {
    label: label.trim() ? null : "Label is required.",
    id: SLUG.test(id) ? null : "ID must be lowercase letters, digits and dashes, starting with a letter or digit.",
    token: token.trim() ? null : "Token is required.",
  };
  const show = (k: keyof typeof problems) => tried && problems[k] && <span style={{ color: "var(--err)" }}>{problems[k]}</span>;
  return (
    <form style={{ maxWidth: 700, display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }} noValidate
      onSubmit={(e) => { e.preventDefault(); setTried(true); if (!problems.label && !problems.id && !problems.token) m.mutate(); }}>
      <b>Add account</b>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
        <label className="field">Label
          <input value={label} placeholder="Personal, Work Team" maxLength={60} onChange={(e) => { setLabel(e.target.value); if (!idTouched) setId(slugify(e.target.value)); }} />
          {show("label")}
        </label>
        <label className="field">ID
          <input className="mono" value={id} placeholder="personal" maxLength={40} onChange={(e) => { setId(e.target.value); setIdTouched(true); }} />
          {show("id")}
        </label>
        <label className="field">Plan
          <select value={plan} onChange={(e) => setPlan(e.target.value as AccountPlan)}>{PLANS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        </label>
      </div>
      <label className="field">Token
        <TokenInput value={token} onChange={setToken} label="Token" />
        {show("token")}
      </label>
      <ErrorBox error={m.error} />
      <div><button className="btn primary" type="submit" disabled={m.isPending}><Icon n="plus" size={14} />Add account</button></div>
    </form>
  );
}

function WorkspaceAccounts({ accounts }: { accounts: Account[] }) {
  const app = useApp();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: { ws: string; account: string | null }) => api.setWorkspaceAccount(v.ws, v.account),
    onSettled: () => { qc.invalidateQueries({ queryKey: ["workspaces"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); },
  });
  if (app.workspaces.length === 0) return null;
  return (
    <>
      <div className="section-title" style={{ marginTop: 18 }}><span>Account per workspace</span></div>
      <div className="list">{app.workspaces.map((w) => {
        const cur = w.claude_account_id ?? "";
        return (
          <div key={w.id} className="li">
            <div>
              <div className="t">{w.name} {!cur && <Chip tone="warn">No account: agents of this workspace cannot start</Chip>}</div>
              <div className="d mono">{w.id}</div>
            </div>
            <div className="r">
              <select className="select" aria-label={`Claude account for ${w.name}`} value={cur} disabled={m.isPending && m.variables?.ws === w.id}
                onChange={(e) => m.mutate({ ws: w.id, account: e.target.value || null })}>
                <option value="">None</option>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
              </select>
            </div>
          </div>
        );
      })}</div>
      <div style={{ maxWidth: 700, marginTop: 8 }}><ErrorBox error={m.error} /></div>
    </>
  );
}

function AccountsSection() {
  const qc = useQueryClient();
  const q = useAccounts();
  const changed = () => { qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["workspaces"] }); };
  const accounts = q.data ?? [];
  return (
    <>
      <div className="section-title"><span>Claude accounts</span><span className="faint mono">{accounts.length}</span></div>
      <p className="muted" style={{ maxWidth: 700 }}>Agents sign in with your own Claude subscription. Create a token once with <span className="mono">claude setup-token</span> (in a terminal where Claude Code is logged in) and paste it here. Tokens are stored on this machine in <span className="mono">~/.forgehall/secrets</span> (readable only by you), never shown again, and used only by your agent containers.</p>
      <p className="faint" style={{ maxWidth: 700 }}>All agents of a workspace share that account's usage limits.</p>
      <ErrorBox error={q.error} />
      {q.isSuccess && accounts.length === 0 && <p className="empty">No accounts yet. Add one below.</p>}
      {accounts.length > 0 && <div className="list">{accounts.map((a) => <AccountRowView key={a.id} a={a} onChanged={changed} />)}</div>}
      <AddAccountForm onChanged={changed} />
      {q.isSuccess && <WorkspaceAccounts accounts={accounts} />}
    </>
  );
}

export function Settings() {
  const app = useApp();
  const busUrl = import.meta.env.VITE_BUS_LABEL ?? "http://127.0.0.1:4545";
  return (
    <>
      <div className="main-head"><div className="title-row"><h1>Settings</h1></div><div /></div>
      <div className="main-body">
        <IsolationSection />
        <AccountsSection />
        <PreviewBadge />
        <div className="section-title"><span>Bus</span></div>
        <div className="kv">
          <div><span>Bus URL</span><b className="mono">{busUrl}</b></div>
          <div><span>Console proxy</span><b className="mono">/api → bus</b></div>
          <div><span>Status</span><b>{app.offline ? "offline" : app.workspacesLoaded ? "online" : "checking…"}</b></div>
        </div>
        <div className="section-title"><span>Workspaces</span><span className="faint mono">{app.workspaces.length}</span></div>
        {app.workspaces.length === 0 ? <p className="empty">None yet. Create one with <span className="mono">fh workspace add &lt;id&gt; "&lt;name&gt;"</span>.</p> : (
          <div className="list">{app.workspaces.map((w) => (
            <div key={w.id} className="li"><div><div className="t">{w.name} {w.id === app.workspace && <Chip tone="ok">current</Chip>}</div><div className="d mono">{w.id}</div></div>
              <div className="r">{w.id !== app.workspace && <button className="btn sm" onClick={() => app.setWorkspace(w.id)}>Switch</button>}</div></div>
          ))}</div>
        )}
        <div className="section-title"><span>Model routing rules (v1)</span><span className="faint">first match wins · static copy of docs/concepts/model-routing-and-limits.md</span></div>
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Order</th><th>Situation</th><th>Model</th><th>Effort</th></tr></thead>
          <tbody>{RULES.map(([o, s, m, e]) => (
            <tr key={o}><td className="mono">{o}</td><td>{s}</td><td>{m === "agent" ? <span className="muted">agent default</span> : <ModelChip model={m} />}</td><td className="mono">{e}</td></tr>
          ))}</tbody>
        </table></div>
        <p className="faint" style={{ maxWidth: 700 }}>Only haiku, sonnet and opus are allowed. Rules are applied when a run is queued and the reason is stored on the run. Editing them from the console is planned.</p>
      </div>
    </>
  );
}
