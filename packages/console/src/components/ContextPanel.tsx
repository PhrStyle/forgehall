import { Link, useMatch } from "react-router-dom";
import { useApp } from "../context";
import { useAgents, useThreads, useUsage } from "../queries";
import { Meter, ModelChip } from "../ui";
import { ago, inFuture, pct } from "../util";

export function ContextPanel() {
  const app = useApp();
  const usage = useUsage(app.workspace);
  const threads = useThreads(app.workspace);
  const agents = useAgents(app.workspace);
  const match = useMatch("/agents/:id");
  const u = usage.data ?? {};
  const hasUsage = u.five_hour != null || u.seven_day != null;
  const waiting = (threads.data ?? []).filter((t) => t.waiting_on_you);
  const selected = agents.data?.find((a) => a.id === match?.params.id);
  const running = (agents.data ?? []).filter((a) => a.run_id);

  return (
    <aside className="ctx" aria-label="Context">
      <section>
        <h4>Usage <span className="faint mono">{u.status ?? ""}</span></h4>
        {hasUsage ? (
          <div className="meter">
            <div>
              <div className="row" style={{ gridTemplateColumns: "44px 1fr 44px" }}><span>5-hour</span><Meter value={u.five_hour} /><span>{pct(u.five_hour)}</span></div>
              <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>resets {inFuture(u.five_hour_resets_at)}</div>
            </div>
            <div>
              <div className="row" style={{ gridTemplateColumns: "44px 1fr 44px" }}><span>7-day</span><Meter value={u.seven_day} /><span>{pct(u.seven_day)}</span></div>
              <div className="faint" style={{ fontSize: 11.5, marginTop: 2 }}>resets {inFuture(u.seven_day_resets_at)}</div>
            </div>
            {u.updated_at && <div className="faint" style={{ fontSize: 11.5 }}>read from the CLI {ago(u.updated_at)}</div>}
          </div>
        ) : (
          <p className="empty">No usage reading yet. It appears after the first run finishes.</p>
        )}
      </section>

      <section>
        <h4>Waiting on you <span className="faint mono">{waiting.length}</span></h4>
        {waiting.length === 0 ? <p className="empty">Nothing is waiting for you.</p> : (
          <div className="ctx-list">
            {waiting.slice(0, 8).map((t) => (
              <Link key={t.id} to={`/threads/${t.id}`} className="ctx-row">
                <span><span className="mono faint">{t.id}</span> {t.title}</span>
                <span className="faint" style={{ fontSize: 11.5 }}>{t.assignee ?? "unassigned"} · {ago(t.updated_at)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4>{selected ? `${selected.name} now` : "Running now"}</h4>
        {selected ? (
          selected.run_id ? (
            <Link to={`/threads/${selected.run_thread}`} className="ctx-row">
              <span><span className="mono">Run #{selected.run_id}</span> <ModelChip model={selected.run_model} /></span>
              <span className="faint" style={{ fontSize: 11.5 }}>{selected.run_thread} · started {ago(selected.run_started_at)}</span>
            </Link>
          ) : <p className="empty">Not running. {selected.queued ? `${selected.queued} queued.` : ""}</p>
        ) : running.length === 0 ? <p className="empty">No agent is running.</p> : (
          <div className="ctx-list">
            {running.map((a) => (
              <Link key={a.id} to={`/agents/${a.id}`} className="ctx-row">
                <span>{a.name} <ModelChip model={a.run_model} /></span>
                <span className="faint" style={{ fontSize: 11.5 }}>{a.run_thread} · {ago(a.run_started_at)}</span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
