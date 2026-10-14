import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { useApp } from "../context";
import { useSettings } from "../queries";
import { Chip, ErrorBox, ModelChip, PreviewBadge } from "../ui";

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

export function Settings() {
  const app = useApp();
  const busUrl = import.meta.env.VITE_BUS_LABEL ?? "http://127.0.0.1:4545";
  return (
    <>
      <div className="main-head"><div className="title-row"><h1>Settings</h1></div><div /></div>
      <div className="main-body">
        <IsolationSection />
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
