import { useState } from "react";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard unavailable: user can select the text */ }
  };
  return (
    <div className="term copycmd">
      <code><span className="p">$</span> {command}</code>
      <button type="button" className="btn sm" onClick={copy} aria-label={`Copy command: ${command}`}>{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
