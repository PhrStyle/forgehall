import { type ReactNode } from "react";
import { HUMAN, type ModelName } from "./api";
import { hue, STATUS_LABEL, type AgentStatus } from "./util";

const P = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const paths: Record<string, ReactNode> = {
  team: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  threads: <><path d="M9 6h12M9 12h12M9 18h12" /><circle cx="4.5" cy="6" r="1" /><circle cx="4.5" cy="12" r="1" /><circle cx="4.5" cy="18" r="1" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
  chevron: <path d="m6 9 6 6 6-6" />,
  "chevron-left": <path d="m15 6-6 6 6 6" />,
  "chevron-right": <path d="m9 6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  task: <path d="M12 5v14M5 12l7 7 7-7" />,
  tool: <path d="m4 17 6-6-6-6M12 19h8" />,
  say: <path d="M4 6h16M4 12h10M4 18h13" />,
  dm: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />,
  escalate: <path d="M12 19V5M5 12l7-7 7 7" />,
  check: <path d="m5 12 5 5 9-10" />,
  run: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4z" /></>,
  result: <><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v5h1" /></>,
};
export function Icon({ n, size }: { n: string; size?: number }) {
  return <svg viewBox="0 0 24 24" {...P} width={size} height={size} aria-hidden="true">{paths[n]}</svg>;
}

export function Avatar({ id, name, status, size }: { id: string; name?: string; status?: AgentStatus; size?: "lg" }) {
  const you = id === HUMAN;
  const label = (name ?? id)[0]?.toUpperCase() ?? "?";
  const h = hue(id);
  return (
    <span className={`avatar ${size ?? ""} ${you ? "you" : ""}`} style={you ? undefined : { background: `hsl(${h} 30% 20%)`, color: `hsl(${h} 70% 78%)` }} title={name ?? id}>
      {you ? "Y" : label}
      {status && <span className={`st ${status}`} title={STATUS_LABEL[status]} />}
    </span>
  );
}

export function People({ ids }: { ids: string[] }) {
  return <span className="people">{ids.slice(0, 5).map((p) => <Avatar key={p} id={p} />)}</span>;
}

const MODEL_NAME: Record<ModelName, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };
export function ModelChip({ model, effort }: { model: string | null | undefined; effort?: string }) {
  if (!model) return null;
  const m = model in MODEL_NAME ? (model as ModelName) : null;
  return <span className={`chip ${m ?? ""}`}><i />{m ? MODEL_NAME[m] : model}{effort ? ` · ${effort}` : ""}</span>;
}

export function Chip({ tone, children }: { tone?: string; children: ReactNode }) {
  return <span className={`chip ${tone ?? ""}`}>{children}</span>;
}

export function StatusChip({ s }: { s: AgentStatus }) {
  return <Chip tone={s === "running" ? "ok" : s === "waiting" ? "warn" : s === "error" || s === "offline" ? "err" : ""}>{STATUS_LABEL[s]}</Chip>;
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  return <div className="errbox" role="alert">{error instanceof Error ? error.message : String(error)}</div>;
}

export function PreviewBadge() {
  return <div className="preview-badge"><Icon n="info" size={14} />Preview · sample data — arrives in a later phase</div>;
}

export function Meter({ value }: { value: number | null | undefined }) {
  const v = Math.max(0, Math.min(1, value ?? 0));
  return <div className={`meterbar ${v > 0.95 ? "err" : v > 0.85 ? "warn" : ""}`}><span style={{ width: `${v * 100}%` }} /></div>;
}

/** "@you": something needs the user's answer. */
export function WaitBadge({ reason, label }: { reason?: string | null; label?: string }) {
  return <span className="wait-badge" title="Waiting on you"><i aria-hidden="true" />{label ?? "Waiting on you"}{reason ? <span className="why"> · {reason}</span> : null}</span>;
}
