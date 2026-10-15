import { useEffect, useRef, useState } from "react";
import { useApp } from "../context";
import { Icon } from "../ui";

export function WorkspaceSwitcher() {
  const app = useApp();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  const cur = app.workspaces.find((w) => w.id === app.workspace);
  return (
    <div className="wsw" ref={ref}>
      <button className="wsbtn" aria-haspopup="listbox" aria-expanded={open} title="Switch workspace" onClick={() => setOpen((v) => !v)} disabled={app.workspaces.length === 0 && app.offline}>
        <span className="wsn"><span className="faint">Workspace</span><b>{cur ? cur.name : app.offline ? "offline" : "none"}</b></span>
        <Icon n="chevron" />
      </button>
      {open && (
        <ul className="wspop" role="listbox" aria-label="Workspaces">
          {app.workspaces.map((w) => (
            <li key={w.id}>
              <button className="wsopt" role="option" aria-selected={w.id === app.workspace} onClick={() => { app.setWorkspace(w.id); setOpen(false); }}>
                <span><b>{w.name}</b><small className="mono">{w.id}</small></span>
              </button>
            </li>
          ))}
          <li>
            <button className="wsopt wsnew" onClick={() => { setOpen(false); app.setNewWorkspaceOpen(true); }}>+ New workspace</button>
          </li>
        </ul>
      )}
    </div>
  );
}
