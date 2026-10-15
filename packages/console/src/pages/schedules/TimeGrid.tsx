import { useMemo, useState, type CSSProperties } from "react";
import type { Schedule } from "../../api";
import { hue } from "../../util";
import { DAY_SHORT, clockOf, dateKey, dayIndex, pad, sameDay } from "./cron";
import { Mark, STATUS_TEXT, frequentLabel, type Occ } from "./status";

const ROW = 40;
const MAX_SIDE = 3;
const MAX_BANDS = 3;

interface Placed { o: Occ; slot: number; slots: number }
interface More { key: string; day: number; hour: number; min: number; slot: number; items: Occ[] }

/** Day (one column) and week (seven columns) views: full day, 40px per hour. */
export function TimeGrid({ days, now, occs, bands, agentName, repoLabel, selectedId, dimmed, onSelect, onSlot, onOpenDay }: {
  days: Date[]; now: Date; occs: Occ[]; bands: Schedule[]; agentName: (id: string) => string; repoLabel: (id: string | null) => string;
  selectedId: string | null; dimmed: (s: Schedule) => boolean; onSelect: (id: string) => void;
  onSlot: (day: number, hour: number) => void; onOpenDay: (d: Date) => void;
}) {
  const single = days.length === 1;
  const [bandsOpen, setBandsOpen] = useState(false);
  const [pop, setPop] = useState<string | null>(null);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const { placed, mores } = useMemo(() => {
    const buckets = new Map<string, Occ[]>();
    for (const o of occs) {
      const k = `${dateKey(o.at)}|${o.at.getHours()}`;
      const l = buckets.get(k) ?? [];
      l.push(o);
      buckets.set(k, l);
    }
    const placed: Placed[] = [];
    const mores: More[] = [];
    for (const [key, l] of buckets) {
      const first = l[0]!;
      const col = days.findIndex((d) => sameDay(d, first.at));
      if (col < 0) continue;
      if (l.length <= MAX_SIDE) l.forEach((o, i) => placed.push({ o, slot: i, slots: l.length }));
      else {
        l.slice(0, MAX_SIDE - 1).forEach((o, i) => placed.push({ o, slot: i, slots: MAX_SIDE }));
        const rest = l.slice(MAX_SIDE - 1);
        mores.push({ key, day: col, hour: first.at.getHours(), min: first.at.getHours() * 60, slot: MAX_SIDE - 1, items: rest });
      }
    }
    return { placed, mores };
  }, [occs, days]);

  const shownBands = bandsOpen ? bands : bands.slice(0, MAX_BANDS);
  const colStyle: CSSProperties = { height: 24 * ROW };
  const gridStyle: CSSProperties = { gridTemplateColumns: `44px repeat(${days.length},minmax(0,1fr))` };

  return (
    <div className="sch-grid" style={gridStyle} role="grid" aria-label={single ? "Schedule day" : "Schedule week"}>
      <div className="sch-corner" />
      {days.map((d, i) => {
        const today = sameDay(d, now);
        return (
          <div key={i} className={`sch-dayhead ${today ? "today" : ""}`} role="columnheader" aria-current={today ? "date" : undefined}>
            <span>{DAY_SHORT[dayIndex(d)]}</span>
            {single ? <b>{d.getDate()}</b> : <button className="sch-daynum" onClick={() => onOpenDay(d)} aria-label={`Open ${DAY_SHORT[dayIndex(d)]} ${d.getDate()}`}><b>{d.getDate()}</b></button>}
          </div>
        );
      })}

      {shownBands.map((s) => (
        <button key={s.id} className={`sch-band ${s.enabled ? "" : "off"} ${dimmed(s) ? "dim" : ""} ${selectedId === s.id ? "sel" : ""}`} style={{ "--h": hue(s.agent_id) } as CSSProperties}
          onClick={() => onSelect(s.id)} aria-pressed={selectedId === s.id}>
          {s.description} · {agentName(s.agent_id)} · {s.title}{s.enabled ? "" : " (off)"}
        </button>
      ))}
      {bands.length > MAX_BANDS && (
        <button className="sch-band more" onClick={() => setBandsOpen((v) => !v)} aria-expanded={bandsOpen}>
          {bandsOpen ? "Show fewer frequent schedules" : `+${bands.length - MAX_BANDS} frequent`}
        </button>
      )}

      <div className="sch-hours" style={colStyle} aria-hidden="true">
        {hours.map((h) => <div key={h} className="sch-hour" style={{ height: ROW }}>{`${pad(h)}:00`}</div>)}
      </div>

      {days.map((d, di) => {
        const today = sameDay(d, now);
        const dk = dateKey(d);
        const wd = dayIndex(d);
        return (
          <div key={di} className={`sch-col ${today ? "today" : ""}`} style={colStyle} role="gridcell">
            {hours.map((h) => (
              <button key={h} className="sch-cell" style={{ height: ROW }} tabIndex={-1} aria-label={`New schedule on ${DAY_SHORT[wd]} ${d.getDate()} at ${pad(h)}:00`} onClick={() => onSlot(wd, h)} />
            ))}
            {placed.filter((p) => dateKey(p.o.at) === dk).map(({ o, slot, slots }) => {
              const sel = selectedId === o.s.id;
              const compact = !single && slots > 1;
              const time = clockOf(o.at);
              const name = agentName(o.s.agent_id);
              const min = o.at.getHours() * 60 + o.at.getMinutes();
              const tipSide = !single && di >= 4 ? "left" : "right";
              return (
                <button key={`${o.s.id}-${o.at.getTime()}`}
                  className={`sch-block ${compact ? "compact" : ""} ${o.past ? "past" : ""} ${o.s.enabled ? "" : "off"} ${dimmed(o.s) ? "dim" : ""} ${sel ? "sel" : ""} ${o.status === "running" ? "running" : ""}`}
                  style={{ "--h": hue(o.s.agent_id), top: (min / 60) * ROW + 1, height: ROW - 2, left: `calc(${(slot / slots) * 100}% + 2px)`, width: `calc(${100 / slots}% - 4px)` } as CSSProperties}
                  onClick={() => onSelect(o.s.id)} aria-pressed={sel}
                  aria-label={`${name}: ${o.s.title}, ${DAY_SHORT[wd]} ${time}, ${STATUS_TEXT[o.status]}`}>
                  {compact ? (
                    <span className="sch-cmp"><i>{time}</i><span className="sch-cmp-r"><b className="sch-av">{(name[0] ?? "?").toUpperCase()}</b><Mark status={o.status} /></span></span>
                  ) : (
                    <>
                      <span className="sch-bt"><i>{time}</i>{`${name} · ${o.s.title}`}</span>
                      <Mark status={o.status} />
                    </>
                  )}
                  <span className={`sch-tip ${tipSide}`} role="tooltip">
                    <b>{o.s.title}</b>
                    <span>{DAY_SHORT[wd]} {time} · {name}</span>
                    <span>Repo: {repoLabel(o.s.repo_id)}</span>
                    <span>{o.s.thread_mode === "new" ? "New thread each time" : "Same thread"}</span>
                    <span>{STATUS_TEXT[o.status]}{o.reason ? ` — ${o.reason}` : ""}</span>
                  </span>
                </button>
              );
            })}
            {mores.filter((m) => m.day === di).map((m) => {
              const open = pop === m.key;
              return (
                <div key={m.key} className="sch-morewrap" style={{ top: (m.min / 60) * ROW + 1, height: ROW - 2, left: `calc(${(m.slot / MAX_SIDE) * 100}% + 2px)`, width: `calc(${100 / MAX_SIDE}% - 4px)`, zIndex: open ? 6 : 2 }}>
                  <button className="sch-more" aria-expanded={open} aria-label={`${m.items.length} more at ${pad(m.hour)}:00 on ${DAY_SHORT[wd]}`} onClick={() => setPop(open ? null : m.key)}>+{m.items.length}</button>
                  {open && (
                    <div className={`sch-pop ${!single && di >= 4 ? "left" : "right"}`} role="dialog" aria-label="More schedules">
                      <b>{DAY_SHORT[wd]} {pad(m.hour)}:00</b>
                      {m.items.map((o) => (
                        <button key={`${o.s.id}-${o.at.getTime()}`} className="sch-pop-item" style={{ "--h": hue(o.s.agent_id) } as CSSProperties} onClick={() => { onSelect(o.s.id); setPop(null); }}>
                          <i />{clockOf(o.at)} · {agentName(o.s.agent_id)} · {o.s.title}<Mark status={o.status} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {today && <div className="sch-now" style={{ top: (nowMin / 60) * ROW }} aria-label={`Now ${pad(now.getHours())}:${pad(now.getMinutes())}`} />}
          </div>
        );
      })}
    </div>
  );
}
