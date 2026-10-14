import { Link } from "react-router-dom";
import { useApp } from "../context";
import { NoWorkspace } from "../components/Empty";
import { ThreadRow } from "../components/ThreadRow";
import { useAgents, useThreads, useUsage } from "../queries";
import { Avatar, ErrorBox, ModelChip, StatusChip } from "../ui";
import { agentStatus, ago, inFuture, isOpen, pct } from "../util";

export function Team() {
  const app = useApp();
  const ws = app.workspace;
  const agents = useAgents(ws);
  const threads = useThreads(ws);
  const usage = useUsage(ws);
  if (!ws) return <NoWorkspace />;

  const a = agents.data ?? [];
  const t = threads.data ?? [];
  const running = a.filter((x) => x.run_id).length;
  const open = t.filter((x) => isOpen(x.state)).length;
  const waiting = t.filter((x) => x.waiting_on_you).length;
  const u = usage.data ?? {};

  return (
    <>
      <div className="main-head">
        <div className="title-row">
          <h1>Team overview</h1>
          <div className="meta">{app.workspaces.find((w) => w.id === ws)?.name}</div>
          <div className="actions"><button className="btn primary" onClick={() => app.openNewTask()}>New task</button></div>
        </div>
        <div />
      </div>
      <div className="main-body">
        <ErrorBox error={agents.error ?? threads.error} />
        <div className="stats">
          <div className="stat"><div className="k">Agents running</div><div className="v">{running}<span className="faint" style={{ fontSize: 14 }}> / {a.length}</span></div><div className="s">{a.filter((x) => agentStatus(x) === "error").length} with a failed last run</div></div>
          <div className="stat"><div className="k">Threads open</div><div className="v">{open}</div><div className="s">{t.length} in total</div></div>
          <div className="stat"><div className="k">Waiting on you</div><div className="v" style={waiting ? { color: "var(--warn)" } : undefined}>{waiting}</div><div className="s">threads with a message for you</div></div>
          <div className="stat"><div className="k">Weekly usage</div><div className="v">{pct(u.seven_day)}</div><div className="s">{u.seven_day_resets_at ? `resets ${inFuture(u.seven_day_resets_at)}` : "no reading yet"}</div></div>
        </div>

        <div className="section-title"><span>Agents</span></div>
        {agents.isSuccess && a.length === 0 ? (
          <div className="empty-state">
            <h3>No agents in this workspace</h3>
            <p>Add the first agents with the CLI:</p>
            <div className="term"><span className="p">$</span> fh agent add {ws} vigil --name Vigil --role QA --model haiku<br /><span className="p">$</span> fh agent add {ws} atlas --name Atlas --role Dev --model haiku</div>
          </div>
        ) : (
          <div className="grid">
            {a.map((x) => {
              const st = agentStatus(x);
              return (
                <Link key={x.id} to={`/agents/${x.id}`} className="tile">
                  <div className="top">
                    <Avatar id={x.id} name={x.name} status={st} />
                    <div className="who"><b>{x.name}</b><span>{x.role}</span></div>
                    <span style={{ marginLeft: "auto" }}><ModelChip model={x.run_model ?? x.default_model} /></span>
                  </div>
                  <div className="now">
                    {x.run_thread ? <>Working on <span className="mono">{x.run_thread}</span> · started {ago(x.run_started_at)}</>
                      : x.queued ? `${x.queued} run${x.queued > 1 ? "s" : ""} queued`
                      : st === "error" ? <span style={{ color: "var(--err)" }}>{x.last_error ?? "Last run failed"}</span>
                      : <span className="muted">No task right now{x.last_ended_at ? ` · last run ${ago(x.last_ended_at)}` : ""}</span>}
                  </div>
                  <div className="foot"><StatusChip s={st} /><span className="faint mono num">{x.runs_today} run{x.runs_today === 1 ? "" : "s"} today</span></div>
                </Link>
              );
            })}
          </div>
        )}

        <div className="section-title"><span>Recent activity</span><Link className="btn sm ghost" to="/threads">All threads</Link></div>
        {threads.isSuccess && t.length === 0 ? (
          <div className="empty-state"><h3>No threads yet</h3><p>Send a task to an agent to start the first thread.</p><button className="btn primary" onClick={() => app.openNewTask()}>Send a task</button></div>
        ) : (
          <div className="list">{t.slice(0, 6).map((x) => <ThreadRow key={x.id} t={x} />)}</div>
        )}
      </div>
    </>
  );
}
