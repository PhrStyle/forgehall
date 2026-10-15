import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useApp } from "../context";
import { NoWorkspace } from "../components/Empty";
import { EventView, RunHeader } from "../components/RunFeed";
import { SamplePanels, type SampleTab } from "../components/Samples";
import { AgentSettings } from "../components/AgentSettings";
import { PermissionList } from "../components/PermissionCard";
import { useAgents, usePermissions, useRuns, useRunsEvents } from "../queries";
import { Avatar, Chip, ErrorBox, ModelChip, StatusChip } from "../ui";
import { agentStatus, ago, clock, money, MONEY_HINT, runDuration } from "../util";

type Tab = "activity" | "runs" | "settings" | SampleTab;
const TABS: [Tab, string][] = [["activity", "Activity"], ["runs", "Runs"], ["memory", "Memory"], ["skills", "Skills"], ["environment", "Environment"], ["versions", "Versions"], ["settings", "Settings"]];

export function AgentPage() {
  const { id } = useParams();
  const app = useApp();
  const agents = useAgents(app.workspace);
  const [tab, setTab] = useState<Tab>("activity");
  if (!app.workspace) return <NoWorkspace />;
  const a = agents.data?.find((x) => x.id === id);
  if (agents.isLoading) return <div className="main-body"><p className="empty">Loading…</p></div>;
  if (!a) return <div className="main-body"><ErrorBox error={agents.error ?? new Error(`Agent “${id}” not found in this workspace`)} /><Link to="/" className="btn sm">Back to team</Link></div>;
  const st = agentStatus(a);

  return (
    <>
      <div className="main-head">
        <div className="title-row">
          <Avatar id={a.id} name={a.name} status={st} size="lg" />
          <div>
            <h1>{a.name}</h1>
            <div className="meta">{a.role} · <StatusChip s={st} /> <ModelChip model={a.run_model ?? a.default_model} /> <span className="mono">{a.id}</span></div>
          </div>
          <div className="actions"><button className="btn primary" onClick={() => app.openNewTask(a.id)}>Send a task</button></div>
        </div>
        <div className="tabs" role="tablist">
          {TABS.map(([k, l]) => <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
        </div>
      </div>
      {tab === "activity" ? <Activity agentId={a.id} /> : tab === "runs" ? <RunsTable agentId={a.id} /> : tab === "settings" ? <AgentSettings agentId={a.id} runnerOnline={a.runner_online} /> : <div className="main-body"><SamplePanels tab={tab} agentId={a.id} /></div>}
    </>
  );
}

function Activity({ agentId }: { agentId: string }) {
  const app = useApp();
  const runsQ = useRuns(app.workspace);
  const perms = (usePermissions(app.workspace).data ?? []).filter((x) => x.agent_id === agentId);
  const mine = (runsQ.data ?? []).filter((r) => r.agent_id === agentId).slice(0, 5).reverse();
  const events = useRunsEvents(mine);
  const body = useRef<HTMLDivElement>(null);
  const total = events.reduce((n, q) => n + (q.data?.length ?? 0), 0) + mine.length;
  const stick = useRef(true);
  useEffect(() => { if (stick.current && body.current) body.current.scrollTop = body.current.scrollHeight; }, [total]);

  return (
    <div className="main-body" ref={body} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80; }}>
      <PermissionList items={perms} />
      <ErrorBox error={runsQ.error ?? events.find((q) => q.error)?.error} />
      {runsQ.isSuccess && mine.length === 0 ? (
        <div className="empty-state"><h3>No activity yet</h3><p>This agent has not run. Send it a task and its runs show up here as they happen.</p><button className="btn primary" onClick={() => app.openNewTask(agentId)}>Send a task</button></div>
      ) : (
        <div className="feed">
          {mine.map((r, i) => (
            <div key={r.id}>
              <RunHeader run={r} />
              {(events[i]?.data ?? []).map((e) => <EventView key={e.seq} e={e} />)}
              {r.state === "running" && <div className="ev-pending-note" style={{ padding: "6px 40px" }}>Running… updates stream in live.</div>}
              {r.error && <div className="errbox" style={{ marginTop: 6 }}>{r.error}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RunsTable({ agentId }: { agentId: string }) {
  const app = useApp();
  const q = useRuns(app.workspace);
  const rows = (q.data ?? []).filter((r) => r.agent_id === agentId);
  return (
    <div className="main-body">
      <ErrorBox error={q.error} />
      {q.isSuccess && rows.length === 0 ? <p className="empty">No runs yet.</p> : (
        <div className="tbl-wrap"><table className="tbl">
          <thead><tr><th>Run</th><th>Thread</th><th>Model</th><th>State</th><th>Queued</th><th>Duration</th><th>Tokens in/out</th><th title={MONEY_HINT}>Est. cost</th><th>Why this model</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="mono">#{r.id}</td>
              <td>{r.thread_id ? <Link to={`/threads/${r.thread_id}`} className="mono">{r.thread_id}</Link> : ""}</td>
              <td><ModelChip model={r.model} effort={r.effort} /></td>
              <td><Chip tone={r.state === "done" ? "ok" : r.state === "failed" ? "err" : r.state === "running" ? "warn" : ""}>{r.state}</Chip></td>
              <td className="mono muted" title={clock(r.queued_at)}>{ago(r.queued_at)}</td>
              <td className="mono">{runDuration(r)}</td>
              <td className="mono muted">{r.input_tokens ?? "–"} / {r.output_tokens ?? "–"}</td>
              <td className="mono" title={MONEY_HINT}>{money(r.cost_usd)}</td>
              <td className="muted">{r.route_reason}{r.error ? <div style={{ color: "var(--err)" }}>{r.error}</div> : null}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
