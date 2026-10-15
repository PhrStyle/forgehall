import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Account, type AccountPlan, type ApprovalPolicy, type HostCredential, type HostProvider } from "../api";
import { useApp } from "../context";
import { useAccounts, usePublishing, useRepos, useSettings, useSupervisor } from "../queries";
import { ago, slugify } from "../util";
import { TokenInput } from "../components/TokenInput";
import { AddRepoModal, HOST_LABEL } from "../components/AddRepoModal";
import { Chip, ErrorBox, Icon, ModelChip } from "../ui";
import { FieldError, focusFirstInvalid } from "../components/formErrors";
import "../styles/agent-settings.css";

type RuleModel = "haiku" | "sonnet" | "opus" | "agent";
const RULES: [string, string, RuleModel, string][] = [
  ["1", "The agent escalates the thread", "opus", "high"],
  ["2", "Two or more failed runs since the last success", "opus", "high"],
  ["3", "A review result or your reply (answers that continue the work)", "agent", "medium"],
  ["4", "Other answers, notes and questions", "haiku", "low"],
  ["5", "High difficulty and the agent's default model is Haiku", "sonnet", "medium"],
  ["6", "Anything else", "agent", "medium"],
];

/** Section header with the scope in plain words. */
function SectionHead({ title, scope, children }: { title: string; scope: string; children?: ReactNode }) {
  return (
    <div className="st-head">
      <h2 id="st-title">{title}</h2>
      <p>{scope}</p>
      {children}
    </div>
  );
}

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

function AddAccountForm({ onChanged, onCancel }: { onChanged: () => void; onCancel?: () => void }) {
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [plan, setPlan] = useState<AccountPlan>("pro");
  const [token, setToken] = useState("");
  const [tried, setTried] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const tokenWrap = useRef<HTMLDivElement>(null);
  const m = useMutation({
    mutationFn: () => api.saveAccount({ id, label: label.trim(), plan, token: token.trim() }),
    onSuccess: () => { setToken(""); setLabel(""); setId(""); setIdTouched(false); setTried(false); onChanged(); onCancel?.(); },
  });
  const problems = {
    label: label.trim() ? null : "Label is required.",
    id: SLUG.test(id) ? null : "ID must be lowercase letters, digits and dashes, starting with a letter or digit.",
    token: token.trim() ? null : "Token is required.",
  };
  const show = (k: keyof typeof problems) => <FieldError id={`acc-${k}-err`} msg={tried ? problems[k] : null} />;
  return (
    <form style={{ maxWidth: 700, display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }} noValidate aria-label="Add account"
      onSubmit={(e) => {
        e.preventDefault(); setTried(true);
        if (focusFirstInvalid([[problems.label, labelRef.current], [problems.id, idRef.current], [problems.token, tokenWrap.current?.querySelector("input") ?? null]])) return;
        m.mutate();
      }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
        <label className="field">Label
          <input ref={labelRef} value={label} aria-invalid={tried && !!problems.label} aria-describedby="acc-label-err" placeholder="Personal, Work Team" maxLength={60} onChange={(e) => { setLabel(e.target.value); if (!idTouched) setId(slugify(e.target.value)); }} />
          {show("label")}
        </label>
        <label className="field">ID
          <input ref={idRef} className="mono" value={id} aria-invalid={tried && !!problems.id} aria-describedby="acc-id-err" placeholder="personal" maxLength={40} onChange={(e) => { setId(e.target.value); setIdTouched(true); }} />
          {show("id")}
        </label>
        <label className="field">Plan
          <select value={plan} onChange={(e) => setPlan(e.target.value as AccountPlan)}>{PLANS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}</select>
        </label>
      </div>
      <div className="field" ref={tokenWrap}>Token
        <TokenInput value={token} onChange={setToken} label="Token" />
        {show("token")}
      </div>
      <ErrorBox error={m.error} />
      <div style={{ display: "flex", gap: 8 }}><button className="btn primary" type="submit" disabled={m.isPending}><Icon n="plus" size={14} />Add account</button>{onCancel && <button className="btn ghost" type="button" onClick={onCancel}>Cancel</button>}</div>
    </form>
  );
}

function WorkspaceAccount({ accounts }: { accounts: Account[] }) {
  const app = useApp();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (v: { ws: string; account: string | null }) => api.setWorkspaceAccount(v.ws, v.account),
    onSettled: () => { qc.invalidateQueries({ queryKey: ["workspaces"] }); qc.invalidateQueries({ queryKey: ["accounts"] }); },
  });
  const w = app.workspaces.find((x) => x.id === app.workspace);
  if (!w) return null;
  const cur = w.claude_account_id ?? "";
  return (
    <>
      <div className="field" style={{ maxWidth: 420 }}>
        <label htmlFor="ws-account">Claude account</label>
        <select id="ws-account" className="select" value={cur} disabled={m.isPending} aria-describedby="ws-account-desc"
          onChange={(e) => m.mutate({ ws: w.id, account: e.target.value || null })}>
          <option value="">None</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
        <span className="faint" id="ws-account-desc">All agents of this workspace sign in with it and share its usage limits. Accounts are managed under This machine.</span>
      </div>
      {!cur && <div className="warnbox" role="status" style={{ marginTop: 8 }}>No account: agents of this workspace cannot start.{accounts.length === 0 ? " Add one under Claude accounts first." : ""}</div>}
      <div style={{ marginTop: 8 }}><ErrorBox error={m.error} /></div>
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

function PublishingForm({ ws }: { ws: string }) {
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
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button className="btn sm" onClick={() => setAdding(true)}><Icon n="plus" size={14} />Add repository</button>
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
  return <PublishingForm key={w.id} ws={w.id} />;
}

function AccountsSection() {
  const qc = useQueryClient();
  const q = useAccounts();
  const [adding, setAdding] = useState(false);
  const changed = () => { qc.invalidateQueries({ queryKey: ["accounts"] }); qc.invalidateQueries({ queryKey: ["workspaces"] }); };
  const accounts = q.data ?? [];
  const noAccounts = q.isSuccess && accounts.length === 0;
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>Agents sign in with your own Claude subscription. Create a token once with <span className="mono">claude setup-token</span> (in a terminal where Claude Code is logged in) and paste it here. Tokens are stored on this machine in <span className="mono">~/.forgehall/secrets</span> (readable only by you), never shown again, and used only by your agent containers.</p>
      <ErrorBox error={q.error} />
      {noAccounts && <p className="empty">No accounts yet. Add one below.</p>}
      {accounts.length > 0 && <div className="list">{accounts.map((a) => <AccountRowView key={a.id} a={a} onChanged={changed} />)}</div>}
      {q.isSuccess && (noAccounts || adding
        ? <AddAccountForm onChanged={changed} onCancel={accounts.length > 0 ? () => setAdding(false) : undefined} />
        : <div style={{ marginTop: 12 }}><button className="btn sm" onClick={() => setAdding(true)}><Icon n="plus" size={14} />Add account</button></div>)}
    </>
  );
}

function GeneralSection() {
  const q = useAccounts();
  return (
    <>
      <ErrorBox error={q.error} />
      {q.isSuccess ? <WorkspaceAccount accounts={q.data} /> : q.isLoading ? <p className="empty">Loading…</p> : null}
      <p className="muted" style={{ marginTop: 18 }}>Agents of this workspace: <Link to="/">open the team</Link> to add, start or stop them.</p>
    </>
  );
}

function WorkspacesSection() {
  const app = useApp();
  return (
    <>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}>
        <button className="btn sm" onClick={() => app.setNewWorkspaceOpen(true)}><Icon n="plus" size={14} />New workspace</button>
      </div>
      {app.workspaces.length === 0 ? <p className="empty">None yet. Create one with the button above.</p> : (
        <div className="list">{app.workspaces.map((w) => (
          <div key={w.id} className="li"><div><div className="t">{w.name} {w.id === app.workspace && <Chip tone="ok">current</Chip>}</div><div className="d mono">{w.id}</div></div>
            <div className="r">{w.id !== app.workspace && <button className="btn sm" onClick={() => app.setWorkspace(w.id)}>Switch</button>}</div></div>
        ))}</div>
      )}
    </>
  );
}

function StatusSection() {
  const app = useApp();
  const sup = useSupervisor();
  const busUrl = import.meta.env.VITE_BUS_LABEL ?? "http://127.0.0.1:4545";
  return (
    <>
      <div className="kv">
        <div><span>Bus URL</span><b className="mono">{busUrl}</b></div>
        <div><span>Console proxy</span><b className="mono">/api → bus</b></div>
        <div><span>Bus</span><b>{app.offline ? "offline" : app.workspacesLoaded ? "online" : "checking…"}</b></div>
        <div><span>Supervisor</span><b>{sup.isError ? "unknown" : !sup.data ? "checking…" : sup.data.online ? "running" : "not running"}</b></div>
      </div>
      {sup.data && !sup.data.online && <p className="muted">Start it once on this machine with <span className="mono">fh supervise --install</span>; it starts and stops your agents.</p>}
    </>
  );
}

function RoutingSection() {
  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>When a run is queued, the first rule that matches picks the model and effort. The reason is stored on the run.</p>
      <div className="tbl-wrap"><table className="tbl">
        <thead><tr><th>Rule</th><th>Situation</th><th>Model</th><th>Effort</th></tr></thead>
        <tbody>{RULES.map(([o, sit, m, e]) => (
          <tr key={o}><td className="mono">{o}</td><td>{sit}</td><td>{m === "agent" ? <span className="muted">agent default</span> : <ModelChip model={m} />}</td><td className="mono">{e}</td></tr>
        ))}</tbody>
      </table></div>
      <p className="faint">Only Haiku, Sonnet and Opus are allowed. Editing these is planned.</p>
    </>
  );
}

type SectionKey = "general" | "repositories" | "publishing" | "accounts" | "isolation" | "workspaces" | "routing" | "status";

export function Settings() {
  const app = useApp();
  const [params, setParams] = useSearchParams();
  const wsName = app.workspaces.find((w) => w.id === app.workspace)?.name ?? app.workspace ?? "none";
  const wsScope = `Applies to the ${wsName} workspace`;
  const machine = "Applies to every workspace on this machine";

  const WORKSPACE: [SectionKey, string, string, ReactNode][] = [
    ["general", "General", wsScope, <GeneralSection />],
    ["repositories", "Repositories", `${wsScope}. Agents work on code from these.`, <ReposSection />],
    ["publishing", "Publishing", `${wsScope}. How approved work is published.`, <PublishingSection />],
  ];
  const MACHINE: [SectionKey, string, string, ReactNode][] = [
    ["accounts", "Claude accounts", machine, <AccountsSection />],
    ["isolation", "Agent isolation", machine, <IsolationSection />],
    ["workspaces", "Workspaces", machine, <WorkspacesSection />],
    ["routing", "Model routing", `${machine}. Read-only.`, <RoutingSection />],
    ["status", "Status", machine, <StatusSection />],
  ];
  const all = [...WORKSPACE, ...MACHINE];
  const asked = params.get("section");
  const cur = all.find(([k]) => k === asked) ?? all[0]!;
  const go = (k: SectionKey) => setParams({ section: k }, { replace: true });
  const link = (k: SectionKey, label: string) => (
    <a key={k} href={`?section=${k}`} aria-current={cur[0] === k ? "page" : undefined}
      onClick={(e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); go(k); }}>{label}</a>
  );
  return (
    <>
      <div className="main-head"><div className="title-row"><h1>Settings</h1></div><div /></div>
      <div className="main-body">
        <div className="st-layout">
          <nav className="st-nav" aria-label="Settings sections">
            <h2>Workspace: {wsName}</h2>
            {WORKSPACE.map(([k, l]) => link(k, l))}
            <h2>This machine</h2>
            {MACHINE.map(([k, l]) => link(k, l))}
          </nav>
          <section className="st-sec" aria-labelledby="st-title">
            <SectionHead title={cur[1]} scope={cur[2]} />
            {cur[3]}
          </section>
        </div>
      </div>
    </>
  );
}
