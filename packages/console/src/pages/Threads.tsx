import { useState } from "react";
import { useApp } from "../context";
import { NoWorkspace } from "../components/Empty";
import { ThreadRow } from "../components/ThreadRow";
import { useThreads } from "../queries";
import { ErrorBox } from "../ui";
import { isOpen } from "../util";
import type { ThreadOverview } from "../api";

const FILTERS: [string, string, (t: ThreadOverview) => boolean][] = [
  ["open", "Open", (t) => isOpen(t.state)],
  ["waiting", "Waiting on you", (t) => t.waiting_on_you],
  ["done", "Done", (t) => t.state === "done"],
  ["all", "All", () => true],
];

export function Threads() {
  const app = useApp();
  const q = useThreads(app.workspace);
  const [f, setF] = useState("open");
  if (!app.workspace) return <NoWorkspace />;
  const all = q.data ?? [];
  const cur = FILTERS.find((x) => x[0] === f)!;
  const rows = all.filter(cur[2]);

  return (
    <>
      <div className="main-head">
        <div className="title-row">
          <h1>Threads</h1>
          <div className="actions"><button className="btn primary" onClick={() => app.openNewTask()}>New task</button></div>
        </div>
        <div className="tabs" role="tablist">
          {FILTERS.map(([id, label, fn]) => {
            const n = all.filter(fn).length;
            return <button key={id} className="tab" role="tab" aria-selected={id === f} onClick={() => setF(id)}>{label} <span className={`n ${id === "waiting" && n ? "hot" : ""}`}>{n}</span></button>;
          })}
        </div>
      </div>
      <div className="main-body">
        <ErrorBox error={q.error} />
        {q.isSuccess && all.length === 0 ? (
          <div className="empty-state"><h3>No threads yet</h3><p>Threads hold the conversation between you and your agents. Send a task to begin.</p><button className="btn primary" onClick={() => app.openNewTask()}>Send a task</button></div>
        ) : rows.length === 0 && q.isSuccess ? (
          <p className="empty">No threads in “{cur[1]}”.</p>
        ) : (
          <div className="list">{rows.map((t) => <ThreadRow key={t.id} t={t} />)}</div>
        )}
      </div>
    </>
  );
}
