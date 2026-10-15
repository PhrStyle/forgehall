import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { api, type AgentSettings as Settings, type HostCredential, type HostProvider, type ModelName } from "../api";
import { useApp } from "../context";
import { useAgents, useAgentSettings } from "../queries";
import { ago } from "../util";
import { ErrorBox } from "../ui";
import { AcceptsFrom, IdentityField, ModelSelect } from "./AgentForm";
import { CopyCommand } from "./CopyCommand";
import { TokenInput } from "./TokenInput";

const HOSTS: [HostProvider, string, string][] = [
  ["github", "GitHub", "Personal access token"],
  ["azure-devops", "Azure DevOps", "Personal access token"],
];
const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");

function EditForm({ ws, s }: { ws: string; s: Settings }) {
  const qc = useQueryClient();
  const others = (useAgents(ws).data ?? []).filter((a) => a.id !== s.id);
  const [name, setName] = useState(s.name);
  const [role, setRole] = useState(s.role);
  const [model, setModel] = useState<ModelName>(s.default_model);
  const [from, setFrom] = useState(s.accepts_from);
  const [prompt, setPrompt] = useState(s.prompt);
  // Reset the form when the saved settings change (after a save or a refetch).
  useEffect(() => { setName(s.name); setRole(s.role); setModel(s.default_model); setFrom(s.accepts_from); setPrompt(s.prompt); },
    [s.name, s.role, s.default_model, s.accepts_from, s.prompt]);
  const m = useMutation({
    mutationFn: () => api.patchAgent(ws, s.id, { name: name.trim(), role: role.trim(), default_model: model, accepts_from: from, prompt }),
    onSuccess: (r) => {
      qc.setQueryData(["agentSettings", ws, s.id], r);
      void qc.invalidateQueries({ queryKey: ["agents"] });
    },
  });
  const changed = name.trim() !== s.name || role.trim() !== s.role || model !== s.default_model || !same(from, s.accepts_from) || prompt !== s.prompt;
  const valid = name.trim().length > 0 && role.trim().length > 0;
  const submit = (e: FormEvent) => { e.preventDefault(); if (changed && valid && !m.isPending) m.mutate(); };
  return (
    <form className="settings-form" onSubmit={submit}>
      <label className="field">Name<input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field">Role<input value={role} maxLength={60} placeholder="Dev, QA, Research…" onChange={(e) => setRole(e.target.value)} /></label>
      <ModelSelect value={model} onChange={setModel} />
      <AcceptsFrom others={others} value={from} onChange={setFrom} />
      <IdentityField value={prompt} onChange={setPrompt} />
      <ErrorBox error={m.error} />
      <div className="row-end" style={{ alignItems: "center" }}>
        {m.isSuccess && !changed && <span className="faint" role="status">Saved</span>}
        <button type="submit" className="btn primary" disabled={!changed || !valid || m.isPending}>{m.isPending ? "Saving…" : "Save changes"}</button>
      </div>
    </form>
  );
}

function HostRow({ ws, agent, provider, label, placeholder, cred }: { ws: string; agent: string; provider: HostProvider; label: string; placeholder: string; cred?: HostCredential }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"none" | "set" | "remove">("none");
  const [token, setToken] = useState("");
  const done = () => { setMode("none"); setToken(""); void qc.invalidateQueries({ queryKey: ["agentSettings", ws, agent] }); };
  const save = useMutation({ mutationFn: () => api.saveAgentCredential(ws, agent, provider, token.trim()), onSuccess: done });
  const del = useMutation({ mutationFn: () => api.deleteAgentCredential(ws, agent, provider), onSuccess: done });
  const cancel = () => { setMode("none"); setToken(""); save.reset(); del.reset(); };
  return (
    <div className="li" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
        <div style={{ minWidth: 0 }}>
          <div className="t">{label}</div>
          <div className="d">{cred ? <><span className="mono">…{cred.token_hint}</span> · added {ago(cred.created_at)}</> : "No access"}</div>
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
          <span>Remove this agent's {label} token?</span>
          <button className="btn sm danger" disabled={del.isPending} onClick={() => del.mutate()}>Remove</button>
          <button className="btn sm ghost" onClick={cancel}>Cancel</button>
        </div>
      )}
      <ErrorBox error={save.error ?? del.error} />
    </div>
  );
}

export function AgentSettings({ agentId, runnerOnline }: { agentId: string; runnerOnline: boolean | null }) {
  const app = useApp();
  const ws = app.workspace!;
  const q = useAgentSettings(ws, agentId);
  const s = q.data;
  const allow = s?.permissions.allow ?? [];
  return (
    <div className="main-body">
      <ErrorBox error={q.error} />
      {!s && !q.error && <p className="empty">Loading…</p>}
      {runnerOnline === false && (
        <>
          <div className="section-title"><span>Runner</span></div>
          <p className="muted" style={{ maxWidth: 700, margin: "0 0 8px" }}>This agent's runner is offline. Start it on this machine:</p>
          <CopyCommand command={`fh agent run ${ws} ${agentId}`} />
        </>
      )}
      {s && (
        <>
          <div className="section-title"><span>Agent</span></div>
          <EditForm key={s.id} ws={ws} s={s} />

          <div className="section-title"><span>Host access</span></div>
          <p className="muted" style={{ maxWidth: 700 }}>Given to this agent's runs as <span className="mono">GH_TOKEN</span> (GitHub) or <span className="mono">AZURE_DEVOPS_EXT_PAT</span> (Azure DevOps), never to other agents. The token's own scopes decide what the agent can do: prefer read-only tokens, and give write access only to agents that must create or edit on the host. Commands that use it still ask for your permission unless you chose Always allow.</p>
          <p className="faint" style={{ maxWidth: 700 }}>This is separate from the workspace's publishing credential (Settings → Publishing), which only the bus uses after you approve.</p>
          <div className="list">
            {HOSTS.map(([p, l, ph]) => <HostRow key={p} ws={ws} agent={s.id} provider={p} label={l} placeholder={ph} cred={s.credentials.find((c) => c.provider === p)} />)}
          </div>

          <div className="section-title"><span>Always allowed</span><span className="faint mono">{allow.length}</span></div>
          {allow.length === 0 ? <p className="empty">None yet</p> : (
            <ul className="rules">{allow.map((r) => <li key={r} className="mono">{r}</li>)}</ul>
          )}
        </>
      )}
    </div>
  );
}
