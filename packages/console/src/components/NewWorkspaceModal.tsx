import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { useApp } from "../context";
import { slugify } from "../util";
import { ErrorBox } from "../ui";

export function NewWorkspaceModal() {
  const app = useApp();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const close = () => app.setNewWorkspaceOpen(false);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") app.setNewWorkspaceOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [app]);

  const m = useMutation({
    mutationFn: () => api.createWorkspace({ id, name: name.trim() }),
    onSuccess: async (w) => {
      await qc.invalidateQueries({ queryKey: ["workspaces"] });
      app.setWorkspace(w.id);
      app.setNextSteps(w.id);
      close();
    },
  });
  const idOk = /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);
  const valid = name.trim().length > 0 && idOk;
  const submit = (e: FormEvent) => { e.preventDefault(); if (valid && !m.isPending) m.mutate(); };

  return (
    <div className="scrim modal" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <form className="modal-box" role="dialog" aria-modal="true" aria-label="New workspace" onSubmit={submit}>
        <h3>New workspace</h3>
        <label className="field">Name
          <input ref={first} value={name} maxLength={60} placeholder="Dev" onChange={(e) => { setName(e.target.value); if (!idTouched) setId(slugify(e.target.value)); }} />
        </label>
        <label className="field">ID
          <input className="mono" value={id} maxLength={40} aria-invalid={id !== "" && !idOk} onChange={(e) => { setId(e.target.value); setIdTouched(true); }} />
          <span className="faint">Lowercase letters, digits and dashes. Used in commands and cannot be changed later.</span>
        </label>
        <ErrorBox error={m.error} />
        <div className="row-end">
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="submit" className="btn primary" disabled={!valid || m.isPending}>{m.isPending ? "Creating…" : "Create workspace"}</button>
        </div>
      </form>
    </div>
  );
}
