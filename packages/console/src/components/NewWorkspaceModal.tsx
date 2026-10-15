import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { useApp } from "../context";
import { slugify } from "../util";
import { ErrorBox } from "../ui";
import { FieldError, focusFirstInvalid } from "./formErrors";
import "../styles/agent-settings.css";

export function NewWorkspaceModal() {
  const app = useApp();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const first = useRef<HTMLInputElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const [tried, setTried] = useState(false);
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
  const errs = {
    name: name.trim() ? null : "Name is required.",
    id: idOk ? null : id ? "Use lowercase letters, digits and dashes, starting with a letter or digit." : "ID is required.",
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (focusFirstInvalid([[errs.name, first.current], [errs.id, idRef.current]])) return;
    if (!m.isPending) m.mutate();
  };
  const shown = (k: keyof typeof errs) => (tried ? errs[k] : null);

  return (
    <div className="scrim modal" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <form className="modal-box" role="dialog" aria-modal="true" aria-label="New workspace" onSubmit={submit} noValidate>
        <h3>New workspace</h3>
        <label className="field">Name
          <input ref={first} value={name} maxLength={60} placeholder="Dev" aria-invalid={!!shown("name")} aria-describedby="nw-name-err" onChange={(e) => { setName(e.target.value); if (!idTouched) setId(slugify(e.target.value)); }} />
          <FieldError id="nw-name-err" msg={shown("name")} />
        </label>
        <label className="field">ID
          <input ref={idRef} className="mono" value={id} maxLength={40} aria-invalid={(id !== "" || tried) && !idOk} aria-describedby="nw-id-err" onChange={(e) => { setId(e.target.value); setIdTouched(true); }} />
          <FieldError id="nw-id-err" msg={shown("id")} />
          <span className="faint">Lowercase letters, digits and dashes. Used in commands and cannot be changed later.</span>
        </label>
        <ErrorBox error={m.error} />
        <div className="row-end">
          <button type="button" className="btn" onClick={close}>Cancel</button>
          <button type="submit" className="btn primary" disabled={m.isPending}>{m.isPending ? "Creating…" : "Create workspace"}</button>
        </div>
      </form>
    </div>
  );
}
