import { useMemo } from "react";
import type { Schedule, ScheduleCalendar } from "../../api";
import { Icon } from "../../ui";
import { MonthGrid } from "./MonthGrid";
import { TimeGrid } from "./TimeGrid";
import { YearGrid } from "./YearGrid";
import { addDays, periodLabel, startOfDay, startOfWeek, type CalView } from "./cron";
import { STATUS_GLYPH, STATUS_TEXT, frequentLabel, toOccs } from "./status";

const VIEWS: [CalView, string][] = [["day", "Day"], ["week", "Week"], ["month", "Month"], ["year", "Year"]];

export function Calendar({ view, anchor, now, data, loading, schedules, agentName, repoLabel, selectedId, agentFilter, onView, onNav, onToday, onSelect, onSlot, onOpenDay }: {
  view: CalView; anchor: Date; now: Date; data: ScheduleCalendar | undefined; loading: boolean; schedules: Schedule[];
  agentName: (id: string) => string; repoLabel: (id: string | null) => string; selectedId: string | null; agentFilter: string[];
  onView: (v: CalView) => void; onNav: (dir: 1 | -1) => void; onToday: () => void; onSelect: (id: string) => void;
  onSlot: (day: number, hour: number) => void; onOpenDay: (d: Date) => void;
}) {
  const byId = useMemo(() => new Map(schedules.map((s) => [s.id, s])), [schedules]);
  const occs = useMemo(() => toOccs(data?.occurrences ?? [], byId, now), [data, byId, now]);
  const bands = useMemo(() => (data?.frequent ?? []).map((id) => byId.get(id)).filter((s): s is Schedule => !!s), [data, byId]);
  const dimmed = useMemo(() => (s: Schedule) => agentFilter.length > 0 && !agentFilter.includes(s.agent_id), [agentFilter]);
  const days = useMemo(() => {
    const d = startOfDay(anchor);
    return view === "day" ? [d] : Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(d), i));
  }, [view, anchor]);

  return (
    <section className="sch-cal" aria-label="Schedule calendar" aria-busy={loading}>
      <div className="sch-cal-head">
        <div className="sch-seg" role="group" aria-label="Calendar view">
          {VIEWS.map(([v, l]) => <button key={v} aria-pressed={view === v} onClick={() => onView(v)}>{l}</button>)}
        </div>
        <div className="sch-nav">
          <button className="btn sm ghost" onClick={() => onNav(-1)} aria-label={`Previous ${view}`}><Icon n="chevron-left" /></button>
          <button className="btn sm" onClick={onToday}>Today</button>
          <button className="btn sm ghost" onClick={() => onNav(1)} aria-label={`Next ${view}`}><Icon n="chevron-right" /></button>
        </div>
        <h2 className="sch-period" aria-live="polite">{periodLabel(view, anchor)}</h2>
      </div>
      <div className="sch-cal-bar">
        <div className="sch-legend" aria-label="Legend">
          {(["done", "needs_you", "failed", "running", "skipped"] as const).map((s) => <span key={s}><b className={s}>{STATUS_GLYPH[s]}</b> {STATUS_TEXT[s]}</span>)}
        </div>
      </div>
      {view === "month" && bands.length > 0 && (
        <p className="sch-freq muted" aria-label="Frequent schedules, not listed per day">
          {bands.map((s) => <span key={s.id}>{frequentLabel(s)} · {s.title}</span>)}
        </p>
      )}

      {(view === "day" || view === "week") && (
        <TimeGrid days={days} now={now} occs={occs} bands={bands} agentName={agentName} repoLabel={repoLabel} selectedId={selectedId} dimmed={dimmed}
          onSelect={onSelect} onSlot={onSlot} onOpenDay={onOpenDay} />
      )}
      {view === "month" && <MonthGrid anchor={anchor} now={now} occs={occs} agentName={agentName} selectedId={selectedId} dimmed={dimmed} onSelect={onSelect} onOpenDay={onOpenDay} />}
      {view === "year" && <YearGrid anchor={anchor} now={now} occs={occs} dimmed={dimmed} onOpenDay={onOpenDay} />}
    </section>
  );
}
