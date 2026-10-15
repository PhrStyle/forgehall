import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type ModelName } from "../api";
import { useApp } from "../context";
import { useAgents } from "../queries";
import { slugify } from "../util";
import { ErrorBox } from "../ui";
import { AcceptsFrom, IdentityField, ModelSelect } from "./AgentForm";
import { CopyCommand } from "./CopyCommand";

export function AddAgentModal() {
  const app = useApp();
  const qc = useQueryClient();
  const ws = app.workspace!;
  const others = useAgents(ws).data ?? [];
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [role, setRole] = useState("");
  const [model, setModel] = useState<ModelName>("sonnet");
  const [from, setFrom] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const first = useRef<HTMLInputElement>(null);
  const close = () => app.setAddAgentOpen(false);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") app.setAddAgentOpen(false); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [app]);

  const m = useMutation({
    mutationFn: () => api.createAgent(ws, { id, name: name.trim(), role: role.trim(), default_model: model, accepts_from: from, ...(prompt.trim() ? { prompt: prompt.trim() } : {}) }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["agents"] }); },
  });
  const idOk = /^[a-z0-9][a-z0-9-]{0,39}$/.test(id);
  const valid = name.trim().length > 0 && role.trim().length > 0 && idOk;
  const submit = (e: FormEvent) => { e.preventDefault(); if (valid && !m.isPending) m.mutate(); };

  return (
    <div className="scrim modal" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      {m.isSuccess ? (
        <div className="modal-box" role="dialog" aria-modal="true" aria-label="Agent added">
          <h3>{m.data.name} was added</h3>
          <p style={{ margin: 0 }}>Start it on this machine:</p>
          <CopyCommand command={`fh agent run ${ws} ${m.data.id}`} />
          <span className="faint">It shows as offline until its runner starts.</span>
          <div className="row-end"><button className="btn primary" autoFocus onClick={close}>Done</button></div>
        </div>
      ) : (
        <form className="modal-box" role="dialog" aria-modal="true" aria-label="Add agent" onSubmit={submit}>
          <h3>Add agent</h3>
          <label className="field">Name
            <input ref={first} value={name} maxLength={60} placeholder="Atlas" onChange={(e) => { setName(e.target.value); if (!idTouched) setId(slugify(e.target.value)); }} />
          </label>
          <label className="field">ID
            <input className="mono" value={id} maxLength={40} aria-invalid={id !== "" && !idOk} onChange={(e) => { setId(e.target.value); setIdTouched(true); }} />
            <span className="faint">Lowercase letters, digits and dashes. Cannot be changed later.</span>
          </label>
          <label className="field">Role
            <input value={role} maxLength={60} placeholder="Dev, QA, Research…" onChange={(e) => setRole(e.target.value)} />
          </label>
          <ModelSelect value={model} onChange={setModel} />
          <AcceptsFrom others={others} value={from} onChange={setFrom} />
          <IdentityField value={prompt} onChange={setPrompt} />
          <ErrorBox error={m.error} />
          <div className="row-end">
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button type="submit" className="btn primary" disabled={!valid || m.isPending}>{m.isPending ? "Adding…" : "Add agent"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
