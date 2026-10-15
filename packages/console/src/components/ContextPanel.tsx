import { useApp } from "../context";
import { useUsage } from "../queries";
import { Meter } from "../ui";
import { inFuture, pct } from "../util";

/** Compact plan usage for the bottom of the sidebar. Never shows the raw API status. */
export function UsageBlock() {
  const app = useApp();
  const u = useUsage(app.workspace).data ?? {};
  if (u.five_hour == null && u.seven_day == null) return null;
  const status = (u.status ?? "").toLowerCase();
  const note = status === "rejected" ? { text: "Limit reached", cls: "err" } : status === "allowed_warning" ? { text: "Near the limit", cls: "warn" } : null;
  const rows: [string, number | null | undefined, string | null | undefined][] = [
    ["5-hour", u.five_hour, u.five_hour_resets_at],
    ["7-day", u.seven_day, u.seven_day_resets_at],
  ];
  return (
    <section className="usage" aria-label="Plan usage">
      <div className="usage-head"><span>Plan usage</span>{note && <span className={`usage-note ${note.cls}`}>{note.text}</span>}</div>
      {rows.map(([label, v, reset]) => (
        <div key={label} className="usage-row" title={reset ? `${label} window resets ${inFuture(reset)}` : `${label} window`}>
          <span>{label}</span><Meter value={v} /><span className="mono">{pct(v)}</span>
        </div>
      ))}
    </section>
  );
}
