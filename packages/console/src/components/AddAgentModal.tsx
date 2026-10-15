import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type ModelName } from "../api";
import { useApp } from "../context";
import { useAgents } from "../queries";
import { slugify } from "../util";
import { ErrorBox } from "../ui";
import { AcceptsFrom, IdentityField, ModelSelect } from "./AgentForm";
import { CopyCommand } from "./CopyCommand";
import { useSupervisor } from "../queries";
import { FieldError, focusFirstInvalid } from "./formErrors";
import "../styles/agent-settings.css";

export function AddAgentModal() {
  const app = useApp();
  const qc = useQueryClient();
  const ws = app.workspace!;
  const others = useAgents(ws).data ?? [];
  const sup = useSupervisor().data?.online === true;
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [role, setRole] = useState("");
  const [model, setModel] = useState<ModelName>("sonnet");
  const [from, setFrom] = useState<string[]>([]);
  const [prompt, setPrompt] = useState("");
  const first = useRef<HTMLInputElement>(null);
  const idRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLInputElement>(null);
  const [tried, setTried] = useState(false);
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
  const errs = {
    name: name.trim() ? null : "Name is required.",
    id: idOk ? null : id ? "Use lowercase letters, digits and dashes, starting with a letter or digit." : "ID is required.",
    role: role.trim() ? null : "Role is required.",
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (focusFirstInvalid([[errs.name, first.current], [errs.id, idRef.current], [errs.role, roleRef.current]])) return;
    if (!m.isPending) m.mutate();
  };
  const shown = (k: keyof typeof errs) => (tried ? errs[k] : null);

  return (
    <div className="scrim modal" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      {m.isSuccess ? (
        <div className="modal-box" role="dialog" aria-modal="true" aria-label="Agent added">
          {sup ? (
            <h3>{m.data.name} was added and is starting.</h3>
          ) : (
            <>
              <h3>{m.data.name} was added</h3>
              <p style={{ margin: 0 }}>The supervisor is not running. Start it once on this machine and it starts your agents:</p>
              <CopyCommand command="fh supervise --install" />
              <p className="faint" style={{ margin: 0 }}>Or start just this agent once:</p>
              <CopyCommand command={`fh agent run ${ws} ${m.data.id}`} />
              <span className="faint">It shows as offline until its runner starts.</span>
            </>
          )}
          <div className="row-end"><button className="btn primary" autoFocus onClick={close}>Done</button></div>
        </div>
      ) : (
        <form className="modal-box" role="dialog" aria-modal="true" aria-label="Add agent" onSubmit={submit} noValidate>
          <h3>Add agent</h3>
          <label className="field">Name
            <input ref={first} value={name} maxLength={60} placeholder="Atlas" aria-invalid={!!shown("name")} aria-describedby="aa-name-err" onChange={(e) => { setName(e.target.value); if (!idTouched) setId(slugify(e.target.value)); }} />
            <FieldError id="aa-name-err" msg={shown("name")} />
          </label>
          <label className="field">ID
            <input ref={idRef} className="mono" value={id} maxLength={40} aria-invalid={(id !== "" || tried) && !idOk} aria-describedby="aa-id-err" onChange={(e) => { setId(e.target.value); setIdTouched(true); }} />
            <FieldError id="aa-id-err" msg={shown("id")} />
            <span className="faint">Lowercase letters, digits and dashes. Cannot be changed later.</span>
          </label>
          <label className="field">Role
            <input ref={roleRef} value={role} maxLength={60} placeholder="Dev, QA, Research…" aria-invalid={!!shown("role")} aria-describedby="aa-role-err" onChange={(e) => setRole(e.target.value)} />
            <FieldError id="aa-role-err" msg={shown("role")} />
          </label>
          <ModelSelect value={model} onChange={setModel} />
          <AcceptsFrom others={others} value={from} onChange={setFrom} />
          <IdentityField value={prompt} onChange={setPrompt} />
          <ErrorBox error={m.error} />
          <div className="row-end">
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button type="submit" className="btn primary" disabled={m.isPending}>{m.isPending ? "Adding…" : "Add agent"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
