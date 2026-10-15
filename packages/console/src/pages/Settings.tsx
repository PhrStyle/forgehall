import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Account, type AccountPlan, type ApprovalPolicy, type HostCredential, type HostProvider } from "../api";
import { useApp } from "../context";
import { useAccounts, usePublishing, useRepos, useSettings } from "../queries";
import { ago, slugify } from "../util";
import { TokenInput } from "../components/TokenInput";
import { AddRepoModal, HOST_LABEL } from "../components/AddRepoModal";
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
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

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

const POLICIES: [ApprovalPolicy, string, string][] = [
  ["merge", "Merge", "Approving merges into the base branch and publishes it."],
  ["pull_request", "Pull request", "Approving pushes the branch and opens a pull request for the reviewers you pick."],
  ["branch_only", "Branch only", "Approving only pushes the branch to the host."],
];
const HOSTS: [HostProvider, string, string][] = [
  ["github", "GitHub", "ghp_… or github_pat_…"],
  ["azure-devops", "Azure DevOps", "Personal access token"],
];

function CredentialRow({ ws, provider, label, placeholder, cred, onChanged }: { ws: string; provider: HostProvider; label: string; placeholder: string; cred?: HostCredential; onChanged: () => void }) {
  const [mode, setMode] = useState<"none" | "set" | "remove">("none");
  const [token, setToken] = useState("");
  const save = useMutation({
    mutationFn: () => api.saveCredential(ws, provider, token.trim()),
    onSuccess: () => { setToken(""); setMode("none"); onChanged(); },
  });
  const del = useMutation({ mutationFn: () => api.deleteCredential(ws, provider), onSuccess: () => { setMode("none"); onChanged(); } });
  const cancel = () => { setMode("none"); setToken(""); save.reset(); del.reset(); };
  return (
    <div className="li" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div className="t">{label}</div>
          <div className="d">{cred ? <><span className="mono">…{cred.token_hint}</span> · added {ago(cred.created_at)}</> : "Not set"}</div>
        </div>
        {mode === "none" && (
          <div className="r">
            <button className="btn sm" onClick={() => setMode("set")}>{cred ? "Replace token" : "Add token"}</button>
            {cred && <button className="btn sm danger" onClick={() => setMode("remove")}>Remove</button>}
          </div>
        )}
      </div>
      {mode === "set" && (
        <form style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 8, flexWrap: "wrap" }}
          onSubmit={(e) => { e.preventDefault(); if (token.trim()) save.mutate(); }}>
          <div style={{ flex: 1, minWidth: 240 }}><TokenInput value={token} onChange={setToken} label={`${cred ? "New token" : "Token"} for ${label}`} placeholder={placeholder} autoFocus /></div>
          <button className="btn sm primary" type="submit" disabled={!token.trim() || save.isPending}>Save</button>
          <button className="btn sm ghost" type="button" onClick={cancel}>Cancel</button>
        </form>
      )}
      {mode === "remove" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }} role="alertdialog" aria-label="Confirm removal">
          <span>Remove the {label} token? Approvals will not be able to publish to {label}.</span>
          <button className="btn sm danger" disabled={del.isPending} onClick={() => del.mutate()}>Remove</button>
          <button className="btn sm ghost" onClick={cancel}>Cancel</button>
        </div>
      )}
      <ErrorBox error={save.error ?? del.error} />
    </div>
  );
}

function PublishingForm({ ws, wsName }: { ws: string; wsName: string }) {
  const qc = useQueryClient();
  const q = usePublishing(ws);
  const p = q.data;
  const m = useMutation({
    mutationFn: (b: Parameters<typeof api.patchPublishing>[1]) => api.patchPublishing(ws, b),
    onSuccess: (d) => qc.setQueryData(["publishing", ws], d),
  });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  useEffect(() => { if (p) { setName(p.git_author_name ?? ""); setEmail(p.git_author_email ?? ""); } }, [p?.git_author_name, p?.git_author_email]); // eslint-disable-line react-hooks/exhaustive-deps
  const changed = !!p && (name.trim() !== (p.git_author_name ?? "") || email.trim() !== (p.git_author_email ?? ""));
  const policy = p?.approval_policy ?? "merge";
  const trailer = p?.ai_trailer ?? false;
  const credsChanged = () => void qc.invalidateQueries({ queryKey: ["publishing", ws] });
  return (
    <>
      <div className="section-title" style={{ marginTop: 18 }}><span>Publishing</span><span className="faint">workspace <span className="mono">{wsName}</span></span></div>
      <ErrorBox error={q.error} />
      {q.isLoading && <p className="empty">Loading…</p>}
      {p && (
        <div style={{ maxWidth: 700, display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="field">
            <label htmlFor="approval-policy">Approval policy</label>
            <select id="approval-policy" className="select" value={policy} disabled={m.isPending} aria-describedby="approval-policy-desc"
              onChange={(e) => m.mutate({ approval_policy: e.target.value as ApprovalPolicy })}>
              {POLICIES.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
            </select>
            <span className="faint" id="approval-policy-desc">{POLICIES.find(([k]) => k === policy)?.[2]}</span>
          </div>
          <form style={{ display: "flex", flexDirection: "column", gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (changed) m.mutate({ git_author_name: name.trim() || null, git_author_email: email.trim() || null }); }}>
            <b>Commit identity</b>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
              <label className="field">Name<input value={name} placeholder="Forgehall" maxLength={100} onChange={(e) => setName(e.target.value)} /></label>
              <label className="field">E-mail<input type="email" value={email} placeholder="forgehall@localhost" maxLength={200} onChange={(e) => setEmail(e.target.value)} /></label>
            </div>
            <span className="faint">Published commits use this author. Empty: Forgehall &lt;forgehall@localhost&gt;.</span>
            <div><button className="btn sm primary" type="submit" disabled={!changed || m.isPending}>Save</button></div>
          </form>
          <div className="switch-row">
            <div className="txt">
              <b id="ai-trailer-label">Add the AI co-author trailer</b>
              <span className="muted" id="ai-trailer-desc">Adds <span className="mono">Co-Authored-By: Claude &lt;noreply@anthropic.com&gt;</span> to published commits.</span>
            </div>
            <button type="button" role="switch" className="switch" aria-checked={trailer} aria-labelledby="ai-trailer-label" aria-describedby="ai-trailer-desc"
              disabled={m.isPending} onClick={() => m.mutate({ ai_trailer: !trailer })} />
          </div>
          <ErrorBox error={m.error} />
          <div>
            <b>Host credentials</b>
            <p className="muted" style={{ margin: "4px 0 8px" }}>Write token used only by the bus to push approved branches and open pull requests. Agents never get it. GitHub: fine-grained token with Contents and Pull requests read/write. Azure DevOps: PAT with Code (Read &amp; Write) and Identity (Read).</p>
            <div className="list">{HOSTS.map(([k, n, ph]) => (
              <CredentialRow key={k} ws={ws} provider={k} label={n} placeholder={ph} cred={p.credentials.find((c) => c.provider === k)} onChanged={credsChanged} />
            ))}</div>
          </div>
        </div>
      )}
    </>
  );
}

function ReposSection() {
  const app = useApp();
  const ws = app.workspace;
  const q = useRepos(ws);
  const [adding, setAdding] = useState(false);
  if (!ws) return null;
  const repos = q.data ?? [];
  return (
    <>
      <div className="section-title" style={{ marginTop: 18 }}>
        <span>Repositories</span>
        <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="faint">workspace <span className="mono">{ws}</span></span>
          <button className="btn sm" onClick={() => setAdding(true)}><Icon n="plus" size={14} />Add repository</button>
        </span>
      </div>
      <ErrorBox error={q.error} />
      {q.isLoading && <p className="empty">Loading…</p>}
      {q.isSuccess && repos.length === 0 && <p className="empty">No repositories yet. Add one so agents can work on code.</p>}
      {repos.length > 0 && (
        <div className="list">{repos.map((r) => (
          <div key={r.id} className="li" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
            <div className="t"><span className="mono">{r.id}</span> <Chip>{HOST_LABEL[r.provider]}</Chip> <span className="faint">base <span className="mono">{r.base_branch}</span></span></div>
            <div className="d mono" style={{ overflowWrap: "anywhere" }}>{r.upstream_url}</div>
          </div>
        ))}</div>
      )}
      {adding && <AddRepoModal ws={ws} onClose={() => setAdding(false)} />}
    </>
  );
}

function PublishingSection() {
  const app = useApp();
  const w = app.workspaces.find((x) => x.id === app.workspace);
  if (!w) return null;
  return <PublishingForm key={w.id} ws={w.id} wsName={w.name} />;
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
        <ReposSection />
        <PublishingSection />
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
