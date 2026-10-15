import { Link } from "react-router-dom";
import { useApp } from "../context";
import { NoWorkspace } from "../components/Empty";
import { SupervisorBanner } from "../components/Supervisor";
import { ThreadRow } from "../components/ThreadRow";
import { useAgents, usePermissions, useThreads, useUsage } from "../queries";
import { Avatar, ErrorBox, ModelChip } from "../ui";
import { ago, inFuture, isOpen, pct } from "../util";
import type { AgentOverview } from "../api";

type Tone = "ok" | "warn" | "err" | "idle";

/** One status line that combines the container and the work. */
function agentLine(a: AgentOverview): { text: string; tone: Tone } {
  const cs = a.container_state;
  if (cs === "error") return { text: `Error: ${a.container_detail ?? "the container could not start"}`, tone: "err" };
  if (a.waiting_thread) return { text: "Waiting for your answer", tone: "warn" };
  if (a.run_thread) return { text: `Working on ${a.run_thread}`, tone: "ok" };
  if (a.run_id) return { text: "Working", tone: "ok" };
  if (a.desired_state === "stopped" && cs !== "starting") return { text: "Stopped", tone: "idle" };
  if (cs === "starting" || cs === "restarting" || cs === "updating") return { text: "Starting…", tone: "warn" };
  if (a.runner_online === false) return { text: "Runner offline", tone: "err" };
  if (a.queued > 0) return { text: `${a.queued} run${a.queued > 1 ? "s" : ""} queued`, tone: "warn" };
  if (a.last_state === "failed") return { text: `Error: ${a.last_error ?? "last run failed"}`, tone: "err" };
  return { text: "Idle", tone: "idle" };
}
const TONE_AV = { ok: "running", warn: "waiting", err: "error", idle: "idle" } as const;


export function Team() {
  const app = useApp();
  const ws = app.workspace;
  const agents = useAgents(ws);
  const threads = useThreads(ws);
  const usage = useUsage(ws);
  const perms = usePermissions(ws).data ?? [];
  if (!ws) return <NoWorkspace />;

  const a = agents.data ?? [];
  const t = threads.data ?? [];
  const online = a.filter((x) => x.run_id || x.runner_online).length;
  const open = t.filter((x) => isOpen(x.state)).length;
  const waitingThreads = t.filter((x) => x.waiting_on_you).length;
  const waiting = waitingThreads + perms.length;
  const u = usage.data ?? {};

  return (
    <>
      <div className="main-head">
        <div className="title-row">
          <h1>Team overview</h1>
          <div className="meta">{app.workspaces.find((w) => w.id === ws)?.name}</div>
        </div>
        <div />
      </div>
      <div className="main-body">
        {app.nextSteps === ws && (
          <div className="notice" role="status" style={{ marginBottom: 12 }}>
            <span>Next: add agents, pick a Claude account in <Link to="/settings">Settings</Link>, and choose how approvals publish.</span>
            <button className="btn sm ghost" onClick={() => app.setNextSteps(null)}>Dismiss</button>
          </div>
        )}
        <SupervisorBanner />
        <ErrorBox error={agents.error ?? threads.error} />
        <div className="stats">
          <div className="stat"><div className="k">Agents online</div><div className="v">{online}<span className="faint" style={{ fontSize: 14 }}> / {a.length}</span></div><div className="s">{a.filter((x) => x.run_id).length} working now</div></div>
          <div className="stat"><div className="k">Active threads</div><div className="v">{open}</div><div className="s">{t.length} in total</div></div>
          <Link to="/inbox" className="stat stat-link"><div className="k">Waiting on you</div><div className="v" style={waiting ? { color: "var(--warn)" } : undefined}>{waiting}</div><div className="s">{perms.length ? `${waitingThreads} thread${waitingThreads === 1 ? "" : "s"} · ${perms.length} permission${perms.length === 1 ? "" : "s"}` : "Open the inbox"}</div></Link>
          <div className="stat"><div className="k">Plan usage, 7-day</div><div className="v">{pct(u.seven_day)}</div><div className="s">{u.status === "rejected" ? "Limit reached" : u.status === "allowed_warning" ? "Near the limit" : u.seven_day_resets_at ? `resets ${inFuture(u.seven_day_resets_at)}` : "no reading yet"}</div></div>
        </div>

        <div className="section-title"><span>Agents</span></div>
        {agents.isSuccess && a.length === 0 ? (
          <div className="empty-state">
            <h3>No agents in this workspace</h3>
            <p>Add your first agent, then start it on this machine.</p>
            <button className="btn primary" onClick={() => app.setAddAgentOpen(true)}>Add agent</button>
          </div>
        ) : (
          <div className="grid">
            {a.map((x) => {
              const line = agentLine(x);
              return (
                <Link key={x.id} to={`/agents/${x.id}`} className="tile">
                  <div className="top">
                    <Avatar id={x.id} name={x.name} status={TONE_AV[line.tone]} />
                    <div className="who"><b>{x.name}</b><span>{x.role}</span></div>
                    <span style={{ marginLeft: "auto" }}><ModelChip model={x.run_model ?? x.default_model} /></span>
                  </div>
                  <div className={`now tone-${line.tone}`}>{line.text}</div>
                  <div className="foot faint mono num"><span>{x.run_started_at && x.run_thread ? `started ${ago(x.run_started_at)}` : x.last_ended_at ? `last run ${ago(x.last_ended_at)}` : "no runs yet"}</span><span>{x.runs_today} run{x.runs_today === 1 ? "" : "s"} today</span></div>
                </Link>
              );
            })}
          </div>
        )}

        <div className="section-title"><span>Recent activity</span><Link className="link" to="/threads">All threads</Link></div>
        {threads.isSuccess && t.length === 0 ? (
          <div className="empty-state"><h3>No threads yet</h3><p>Send a task to an agent to start the first thread.</p><button className="btn primary" onClick={() => app.openNewTask()}>New task</button></div>
        ) : (
          <div className="list">{t.slice(0, 6).map((x) => <ThreadRow key={x.id} t={x} />)}</div>
        )}
      </div>
    </>
  );
}
