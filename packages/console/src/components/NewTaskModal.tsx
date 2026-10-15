import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "../context";
import { api } from "../api";
import { useAgents, useRepos } from "../queries";
import { ErrorBox } from "../ui";
import { AddRepoModal } from "./AddRepoModal";

export function NewTaskModal() {
  const app = useApp();
  const nav = useNavigate();
  const qc = useQueryClient();
  const agents = useAgents(app.workspace).data ?? [];
  const [to, setTo] = useState(app.newTaskTo ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [severity, setSeverity] = useState("");
  const [repo, setRepo] = useState("");
  const repos = useRepos(app.workspace);
  const [addingRepo, setAddingRepo] = useState(false);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape" && !addingRepo) app.closeNewTask(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [app, addingRepo]);
  const assignee = to || agents[0]?.id || "";

  const m = useMutation({
    mutationFn: () => api.createThread({ workspace: app.workspace!, to: assignee, title: title.trim(), body: body.trim(), ...(severity ? { severity } : {}), ...(repo ? { repo } : {}) }),
    onSuccess: (t) => {
      void qc.invalidateQueries({ queryKey: ["threads"] });
      void qc.invalidateQueries({ queryKey: ["agents"] });
      app.closeNewTask();
      app.toast(`Task sent: ${t.id}`);
      nav(`/threads/${t.id}`);
    },
  });
  const valid = assignee && title.trim().length >= 3 && body.trim().length > 0;
  const submit = (e: FormEvent) => { e.preventDefault(); if (valid) m.mutate(); };

  return (
    <div className="scrim modal" onMouseDown={(e) => { if (e.target === e.currentTarget) app.closeNewTask(); }}>
      <form className="modal-box" role="dialog" aria-label="New task" onSubmit={submit}>
        <h3>New task</h3>
        {agents.length === 0 && <div className="errbox">This workspace has no agents. Add one with <code>fh agent add {app.workspace} &lt;id&gt; --name … --role … --model haiku</code>.</div>}
        <label className="field">Assignee
          <select ref={first} value={assignee} onChange={(e) => setTo(e.target.value)}>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role ? ` · ${a.role}` : ""}</option>)}
          </select>
        </label>
        <label className="field">Title (min. 3 characters)
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short summary" />
        </label>
        <label className="field">Description
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should the agent do?" />
        </label>
        <label className="field">Severity
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">Not set</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High (may route to a stronger model)</option>
          </select>
        </label>
        <div className="field">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <label htmlFor="task-repo">Repository</label>
            {(repos.data ?? []).length > 0 && <button type="button" className="btn sm ghost" onClick={() => setAddingRepo(true)}>+ Add</button>}
          </div>
          {repos.data && repos.data.length === 0 ? (
            <div><button type="button" className="btn sm" onClick={() => setAddingRepo(true)}>+ Add repository</button></div>
          ) : (
            <select id="task-repo" value={repo} onChange={(e) => setRepo(e.target.value)}>
              <option value="">None</option>
              {(repos.data ?? []).map((r) => <option key={r.id} value={r.id}>{r.id} · {r.base_branch}</option>)}
            </select>
          )}
          {repo && <span className="faint">The agent works on its own branch; you review and merge it from the thread.</span>}
        </div>
        <ErrorBox error={m.error} />
        <div className="row-end">
          <button type="button" className="btn" onClick={app.closeNewTask}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!valid || m.isPending}>{m.isPending ? "Sending…" : "Send task"}</button>
        </div>
      </form>
      {addingRepo && app.workspace && <AddRepoModal ws={app.workspace} onClose={() => setAddingRepo(false)} onAdded={(r) => setRepo(r.id)} />}
    </div>
  );
}
