import { useState } from "react";

export function TokenInput({ value, onChange, label, autoFocus, placeholder = "sk-ant-oat01-…" }: { value: string; onChange: (v: string) => void; label: string; autoFocus?: boolean; placeholder?: string }) {
  const [shown, setShown] = useState(false);
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input className="input" style={{ flex: 1 }} type={shown ? "text" : "password"} autoComplete="off" spellCheck={false} autoCapitalize="off" autoFocus={autoFocus}
        aria-label={label} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="btn sm" aria-pressed={shown} onClick={() => setShown(!shown)}>{shown ? "Hide" : "Show"}</button>
    </div>
  );
}
