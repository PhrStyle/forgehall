import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context";
import { useAgents, useThreads } from "../queries";

interface Item { id: string; label: string; hint: string; run: () => void }

export function Palette() {
  const app = useApp();
  const nav = useNavigate();
  const agents = useAgents(app.workspace).data ?? [];
  const threads = useThreads(app.workspace).data ?? [];
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const close = () => app.setPaletteOpen(false);
    const go = (path: string) => () => { nav(path); close(); };
    const all: Item[] = [
      { id: "new", label: "New task", hint: "action", run: () => app.openNewTask() },
      { id: "team", label: "Go to Team", hint: "page", run: go("/") },
      { id: "threads", label: "Go to Threads", hint: "page", run: go("/threads") },
      { id: "settings", label: "Go to Settings", hint: "page", run: go("/settings") },
      ...agents.map((a) => ({ id: `a-${a.id}`, label: `Open agent ${a.name}`, hint: a.id, run: go(`/agents/${a.id}`) })),
      ...agents.map((a) => ({ id: `t-${a.id}`, label: `New task for ${a.name}`, hint: "action", run: () => app.openNewTask(a.id) })),
      ...threads.slice(0, 40).map((t) => ({ id: `th-${t.id}`, label: `${t.id} · ${t.title}`, hint: t.state, run: go(`/threads/${t.id}`) })),
      ...app.workspaces.filter((w) => w.id !== app.workspace).map((w) => ({ id: `w-${w.id}`, label: `Switch workspace to ${w.name}`, hint: "workspace", run: () => { app.setWorkspace(w.id); close(); app.toast(`Workspace: ${w.name}`); } })),
    ];
    const n = q.trim().toLowerCase();
    return n ? all.filter((i) => i.label.toLowerCase().includes(n) || i.hint.toLowerCase().includes(n)) : all;
  }, [q, agents, threads, app, nav]);

  const cur = Math.min(sel, Math.max(0, items.length - 1));
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") app.setPaletteOpen(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel(Math.min(cur + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(Math.max(cur - 1, 0)); }
    else if (e.key === "Enter") { items[cur]?.run(); }
  };

  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) app.setPaletteOpen(false); }}>
      <div className="palette" role="dialog" aria-label="Command palette" onKeyDown={onKey}>
        <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} placeholder="Type a command, agent or thread" autoComplete="off" />
        <ul>
          {items.length === 0 && <li className="pal-empty">No matches</li>}
          {items.slice(0, 30).map((i, idx) => (
            <li key={i.id}><button className={idx === cur ? "on" : ""} onMouseEnter={() => setSel(idx)} onClick={i.run}><span>{i.label}</span><small>{i.hint}</small></button></li>
          ))}
        </ul>
      </div>
    </div>
  );
}
