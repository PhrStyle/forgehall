import { type ReactNode } from "react";
import { type ModelName } from "../api";

export const MODEL_HINTS: [ModelName, string][] = [
  ["haiku", "Haiku — fast and cheap, for simple replies"],
  ["sonnet", "Sonnet — balanced default"],
  ["opus", "Opus — hardest work, uses more of your plan"],
];

export interface AgentValues { name: string; role: string; model: ModelName; acceptsFrom: string[]; prompt: string }

/** Shared fields of the Add agent modal and the agent Settings form (name and ID are handled by the caller). */
export function ModelSelect({ value, onChange }: { value: ModelName; onChange: (m: ModelName) => void }) {
  return (
    <label className="field">Default model
      <select value={value} onChange={(e) => onChange(e.target.value as ModelName)} aria-describedby="model-hint">
        {MODEL_HINTS.map(([k, l]) => <option key={k} value={k}>{l.split(" — ")[0]}</option>)}
      </select>
      <span className="faint" id="model-hint">{MODEL_HINTS.find(([k]) => k === value)?.[1].split(" — ")[1]}</span>
    </label>
  );
}

export function AcceptsFrom({ others, value, onChange }: { others: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <fieldset className="field cbgroup">
      <legend>Who can send it tasks</legend>
      {others.length === 0 ? <span className="faint">No other agents yet: any agent added later can send tasks.</span> : (
        <div className="cbs">
          {others.map((o) => (
            <label key={o.id} className="cb"><input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} />{o.name} <span className="mono faint">{o.id}</span></label>
          ))}
        </div>
      )}
      <span className="faint">{value.length === 0 ? "Any agent. " : ""}You can always send tasks.</span>
    </fieldset>
  );
}

export function IdentityField({ value, onChange, children }: { value: string; onChange: (v: string) => void; children?: ReactNode }) {
  return (
    <label className="field">Identity (optional)
      <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder="How this agent should behave, its focus, its rules." />
      <span className="faint">Added to the agent's system prompt.</span>
      {children}
    </label>
  );
}
