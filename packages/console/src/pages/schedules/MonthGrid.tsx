import { useMemo, type CSSProperties } from "react";
import type { Schedule } from "../../api";
import { hue } from "../../util";
import { DAY_SHORT, clockOf, dateKey, monthWeeks, sameDay } from "./cron";
import { Mark, STATUS_TEXT, type Occ } from "./status";

const MAX_CHIPS = 3;

export function MonthGrid({ anchor, now, occs, agentName, selectedId, dimmed, onSelect, onOpenDay }: {
  anchor: Date; now: Date; occs: Occ[]; agentName: (id: string) => string; selectedId: string | null;
  dimmed: (s: Schedule) => boolean; onSelect: (id: string) => void; onOpenDay: (d: Date) => void;
}) {
  const weeks = useMemo(() => monthWeeks(anchor.getFullYear(), anchor.getMonth()), [anchor]);
  const byDay = useMemo(() => {
    const m = new Map<string, Occ[]>();
    for (const o of occs) {
      const k = dateKey(o.at);
      const l = m.get(k) ?? [];
      l.push(o);
      m.set(k, l);
    }
    return m;
  }, [occs]);

  return (
    <div className="sch-month" role="grid" aria-label="Schedule month">
      {DAY_SHORT.map((d) => <div key={d} className="sch-mhead" role="columnheader">{d}</div>)}
      {weeks.flat().map((d) => {
        const list = byDay.get(dateKey(d)) ?? [];
        const today = sameDay(d, now);
        const out = d.getMonth() !== anchor.getMonth();
        return (
          <div key={dateKey(d)} className={`sch-mcell ${out ? "out" : ""} ${today ? "today" : ""}`} role="gridcell">
            <button className="sch-mnum" onClick={() => onOpenDay(d)} aria-label={`Open ${DAY_SHORT[(d.getDay() + 6) % 7]} ${d.getDate()}`}>{d.getDate()}</button>
            {list.slice(0, MAX_CHIPS).map((o) => (
              <button key={`${o.s.id}-${o.at.getTime()}`} className={`sch-mchip ${o.s.enabled ? "" : "off"} ${dimmed(o.s) ? "dim" : ""} ${selectedId === o.s.id ? "sel" : ""}`}
                style={{ "--h": hue(o.s.agent_id) } as CSSProperties} onClick={() => onSelect(o.s.id)} aria-pressed={selectedId === o.s.id}
                title={`${o.s.title} · ${agentName(o.s.agent_id)} · ${clockOf(o.at)} · ${STATUS_TEXT[o.status]}${o.reason ? ` — ${o.reason}` : ""}`}>
                <i /><span className="mono">{clockOf(o.at)}</span><span className="t">{o.s.title}</span><Mark status={o.status} />
              </button>
            ))}
            {list.length > MAX_CHIPS && <button className="sch-mmore" onClick={() => onOpenDay(d)}>+{list.length - MAX_CHIPS} more</button>}
          </div>
        );
      })}
    </div>
  );
}
