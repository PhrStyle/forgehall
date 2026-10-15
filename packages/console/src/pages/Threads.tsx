import { useMemo, useState } from "react";
import { useApp } from "../context";
import { NoWorkspace } from "../components/Empty";
import { ThreadRow } from "../components/ThreadRow";
import { useThreads } from "../queries";
import { ErrorBox } from "../ui";
import { isOpen } from "../util";
import type { ThreadOverview } from "../api";

const FILTERS: [string, string, (t: ThreadOverview) => boolean][] = [
  ["active", "Active", (t) => isOpen(t.state)],
  ["waiting", "Waiting on you", (t) => t.waiting_on_you],
  ["done", "Done", (t) => t.state === "done"],
  ["all", "All", () => true],
];

export function Threads() {
  const app = useApp();
  const q = useThreads(app.workspace);
  const [f, setF] = useState("active");
  const [text, setText] = useState("");
  const [agent, setAgent] = useState("");
  const [repo, setRepo] = useState("");
  const all = q.data ?? [];
  const agents = useMemo(() => [...new Set(all.flatMap((t) => (t.assignee ? [t.assignee] : [])))].sort(), [all]);
  const repos = useMemo(() => [...new Set(all.flatMap((t) => (t.repo_id ? [t.repo_id] : [])))].sort(), [all]);
  if (!app.workspace) return <NoWorkspace />;

  const needle = text.trim().toLowerCase();
  const scoped = all.filter((t) =>
    (!needle || t.title.toLowerCase().includes(needle) || t.id.toLowerCase().includes(needle)) &&
    (!agent || t.assignee === agent) && (!repo || t.repo_id === repo));
  const cur = FILTERS.find((x) => x[0] === f)!;
  const rows = scoped.filter(cur[2]);
  const filtering = !!(needle || agent || repo);

  return (
    <>
      <div className="main-head">
        <div className="title-row"><h1>Threads</h1></div>
        <div className="tabs" role="tablist">
          {FILTERS.map(([id, label, fn]) => {
            const n = scoped.filter(fn).length;
            return <button key={id} className="tab" role="tab" aria-selected={id === f} onClick={() => setF(id)}>{label} <span className={`n ${id === "waiting" && n ? "hot" : ""}`}>{n}</span></button>;
          })}
        </div>
      </div>
      <div className="main-body">
        <ErrorBox error={q.error} />
        {all.length > 0 && (
          <div className="filters" role="search">
            <input className="input sm grow" type="search" aria-label="Search threads by title or id" placeholder="Search title or id…" value={text} onChange={(e) => setText(e.target.value)} />
            <select className="select" aria-label="Filter by agent" value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">All agents</option>
              {agents.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
            <select className="select" aria-label="Filter by repository" value={repo} onChange={(e) => setRepo(e.target.value)}>
              <option value="">All repositories</option>
              {repos.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {filtering && <button className="btn sm ghost" onClick={() => { setText(""); setAgent(""); setRepo(""); }}>Clear</button>}
          </div>
        )}
        {q.isSuccess && all.length === 0 ? (
          <div className="empty-state"><h3>No threads yet</h3><p>Threads hold the conversation between you and your agents. Send a task to begin.</p><button className="btn primary" onClick={() => app.openNewTask()}>New task</button></div>
        ) : rows.length === 0 && q.isSuccess ? (
          <p className="empty">No threads in “{cur[1]}”{filtering ? " match the filters" : ""}.</p>
        ) : (
          <div className="list">{rows.map((t) => <ThreadRow key={t.id} t={t} />)}</div>
        )}
      </div>
    </>
  );
}
