import { NavLink, Route, Routes, useMatch } from "react-router-dom";
import { AppProvider, useApp } from "./context";
import { LiveProvider, useLiveStatus } from "./live";
import { useAgents, useThreads } from "./queries";
import { Avatar, Icon, StatusChip } from "./ui";
import { agentStatus } from "./util";
import { ContextPanel } from "./components/ContextPanel";
import { NewTaskModal } from "./components/NewTaskModal";
import { Palette } from "./components/Palette";
import { WorkspaceSwitcher } from "./components/WorkspaceSwitcher";
import { Team } from "./pages/Team";
import { Threads } from "./pages/Threads";
import { ThreadPage } from "./pages/ThreadPage";
import { AgentPage } from "./pages/AgentPage";
import { Settings } from "./pages/Settings";

export function App() {
  return (
    <AppProvider>
      <WithLive />
    </AppProvider>
  );
}

function WithLive() {
  const { workspace } = useApp();
  return (
    <LiveProvider workspace={workspace}>
      <Shell />
    </LiveProvider>
  );
}

function Shell() {
  const app = useApp();
  const live = useLiveStatus();
  const threads = useThreads(app.workspace);
  const waiting = (threads.data ?? []).filter((t) => t.waiting_on_you).length;

  return (
    <div className="app">
      <nav className="rail" aria-label="Navigation">
        <div className="logo" aria-hidden="true">F</div>
        <NavLink to="/" end className="rail-btn" title="Team"><Icon n="team" /></NavLink>
        <NavLink to="/threads" className="rail-btn" title="Threads"><Icon n="threads" />{waiting > 0 && <span className="badge" />}</NavLink>
        <div className="spacer" />
        <NavLink to="/settings" className="rail-btn" title="Settings"><Icon n="settings" /></NavLink>
      </nav>

      <Side />

      <main className="main">
        {app.offline && (
          <div className="banner" role="alert">
            <span>Bus offline at 127.0.0.1:4545 — start it with <code>node packages/bus/dist/index.js</code></span>
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "6px 24px 0" }}>
          <span className={`live ${live === "live" ? "on" : "off"}`} title="Live updates over SSE"><i />{live === "live" ? "live" : "reconnecting"}</span>
        </div>
        <Routes>
          <Route path="/" element={<Team />} />
          <Route path="/threads" element={<Threads />} />
          <Route path="/threads/:id" element={<ThreadPage />} />
          <Route path="/agents/:id" element={<AgentPage />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<div className="main-body"><p className="empty">Page not found.</p></div>} />
        </Routes>
      </main>

      <ContextPanel />
      {app.paletteOpen && <Palette />}
      {app.newTaskOpen && <NewTaskModal />}
      {app.toastMsg && <div className="toast" role="status">{app.toastMsg}</div>}
    </div>
  );
}

function Side() {
  const app = useApp();
  const agents = useAgents(app.workspace);
  const match = useMatch("/agents/:id");
  const list = agents.data ?? [];
  const running = list.filter((a) => a.run_id).length;

  return (
    <aside className="side" aria-label="Agents">
      <WorkspaceSwitcher />
      <div className="side-head"><h2>Team</h2><span className="faint mono">{app.workspace ? `${running}/${list.length} running` : ""}</span></div>
      <button className="search" onClick={() => app.setPaletteOpen(true)}>
        <Icon n="search" size={14} /><span>Search or run…</span><kbd>Ctrl K</kbd>
      </button>
      <div className="group-label"><span>Agents</span><span>{list.length || ""}</span></div>
      <ul className="agent-list">
        {list.map((a) => {
          const st = agentStatus(a);
          return (
            <li key={a.id}>
              <NavLink to={`/agents/${a.id}`} className={`agent-row ${match?.params.id === a.id ? "active" : ""}`} aria-current={match?.params.id === a.id ? "true" : undefined}>
                <Avatar id={a.id} name={a.name} status={st} />
                <div style={{ minWidth: 0 }}>
                  <div className="nm"><span>{a.name}</span><span className="role">{a.role}</span></div>
                  <div className="sub">{a.run_thread ? `Working on ${a.run_thread}` : a.queued ? `${a.queued} queued` : st === "error" ? "Last run failed" : "Idle"}</div>
                </div>
                <StatusChip s={st} />
              </NavLink>
            </li>
          );
        })}
        {app.workspace && agents.isSuccess && list.length === 0 && <li className="empty" style={{ padding: "8px 12px" }}>No agents. Run <span className="mono">fh agent add {app.workspace} …</span></li>}
      </ul>
      <div className="side-foot">
        <button className="btn primary grow" disabled={!app.workspace} onClick={() => app.openNewTask()}>New task</button>
      </div>
    </aside>
  );
}
