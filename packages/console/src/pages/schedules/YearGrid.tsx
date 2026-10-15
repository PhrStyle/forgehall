import { useMemo } from "react";
import type { Schedule } from "../../api";
import { DAY_SHORT, MONTH_LONG, dateKey, monthWeeks, sameDay } from "./cron";
import type { Occ } from "./status";

/** 12 small months; each day gets a dot by how many (non-frequent) runs it has: none, 1, 2–3, 4+. */
export function YearGrid({ anchor, now, occs, dimmed, onOpenDay }: {
  anchor: Date; now: Date; occs: Occ[]; dimmed: (s: Schedule) => boolean; onOpenDay: (d: Date) => void;
}) {
  const year = anchor.getFullYear();
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of occs) {
      if (dimmed(o.s)) continue;
      const k = dateKey(o.at);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [occs, dimmed]);

  return (
    <div className="sch-year">
      {Array.from({ length: 12 }, (_, mi) => (
        <section key={mi} className="sch-ymonth" aria-label={`${MONTH_LONG[mi]} ${year}`}>
          <h4>{MONTH_LONG[mi]}</h4>
          <div className="sch-ygrid">
            {DAY_SHORT.map((d) => <span key={d} className="sch-yh">{d[0]}</span>)}
            {monthWeeks(year, mi).flat().map((d) => {
              if (d.getMonth() !== mi) return <span key={dateKey(d)} />;
              const n = counts.get(dateKey(d)) ?? 0;
              const lvl = n === 0 ? 0 : n === 1 ? 1 : n <= 3 ? 2 : 3;
              return (
                <button key={dateKey(d)} className={`sch-yd l${lvl} ${sameDay(d, now) ? "today" : ""}`} onClick={() => onOpenDay(d)}
                  aria-label={`${d.getDate()} ${MONTH_LONG[mi]}: ${n} ${n === 1 ? "run" : "runs"}`} title={`${d.getDate()} ${MONTH_LONG[mi]}: ${n} ${n === 1 ? "run" : "runs"}`}>
                  <span>{d.getDate()}</span><i />
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
