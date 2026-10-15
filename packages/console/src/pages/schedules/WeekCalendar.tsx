import { useMemo, useState, type CSSProperties } from "react";
import { hue } from "../../util";
import { DAY_SHORT, describeRule, isFrequent, minutesOnDay, pad } from "./cron";
import { AGENTS, REPOS, RESULTS, STATUS_GLYPH, STATUS_TEXT, type Schedule } from "./mock";

const ROW = 40;
const MAX_SIDE = 3;
const MAX_BANDS = 3;

interface Occ { s: Schedule; day: number; min: number; past: boolean; status?: keyof typeof STATUS_GLYPH; reason?: string }
interface Placed extends Occ { slot: number; slots: number }
interface More { day: number; min: number; slot: number; items: Occ[] }

const agentName = (id: string) => AGENTS.find((a) => a.id === id)?.name ?? id;
const hh = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

export function WeekCalendar({ weekStart, offset, now, schedules, selectedId, agentFilter, onSelect, onSlot }: {
  weekStart: Date; offset: number; now: Date; schedules: Schedule[]; selectedId: string | null; agentFilter: string[];
  onSelect: (id: string) => void; onSlot: (day: number, hour: number) => void;
}) {
  const [bandsOpen, setBandsOpen] = useState(false);
  const [pop, setPop] = useState<{ day: number; hour: number } | null>(null);
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const days = Array.from({ length: 7 }, (_, i) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + i));
  const todayIdx = offset === 0 ? ((now.getDay() + 6) % 7) : -1;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const dimmed = (s: Schedule) => agentFilter.length > 0 && !agentFilter.includes(s.agent);

  const { placed, mores, bands } = useMemo(() => {
    const buckets = new Map<string, Occ[]>();
    for (const s of schedules) {
      if (isFrequent(s.rule)) continue;
      for (let d = 0; d < 7; d++) {
        for (const min of minutesOnDay(s.rule, d)) {
          const past = offset === 0 && (d < todayIdx || (d === todayIdx && min < nowMin));
          const rec = past ? RESULTS.find((r) => r.scheduleId === s.id && r.day === d && r.time === hh(min)) : undefined;
          const status = past ? rec?.status ?? (s.enabled ? "passed" : undefined) : undefined;
          const k = `${d}|${Math.floor(min / 60)}`;
          const l = buckets.get(k) ?? [];
          l.push({ s, day: d, min, past, status, reason: rec?.reason });
          buckets.set(k, l);
        }
      }
    }
    const placed: Placed[] = [];
    const mores: More[] = [];
    for (const l of buckets.values()) {
      l.sort((a, b) => a.min - b.min || a.s.title.localeCompare(b.s.title));
      if (l.length <= MAX_SIDE) l.forEach((o, i) => placed.push({ ...o, slot: i, slots: l.length }));
      else {
        l.slice(0, MAX_SIDE - 1).forEach((o, i) => placed.push({ ...o, slot: i, slots: MAX_SIDE }));
        mores.push({ day: l[0]!.day, min: l[0]!.min, slot: MAX_SIDE - 1, items: l.slice(MAX_SIDE - 1) });
      }
    }
    return { placed, mores, bands: schedules.filter((s) => isFrequent(s.rule)) };
  }, [schedules, offset, todayIdx, nowMin]);

  const shownBands = bandsOpen ? bands : bands.slice(0, MAX_BANDS);
  const colStyle: CSSProperties = { height: 24 * ROW };

  return (
    <section className="sch-cal" aria-label="Weekly calendar">
      <div className="sch-cal-bar">
        <div className="sch-legend" aria-label="Legend">
          <span><b className="ok">✓</b> Passed</span>
          <span><b className="warn">⚠</b> Found issues</span>
          <span><b className="mut">↷</b> Skipped</span>
          <span className="faint">Drag to move</span>
        </div>
      </div>

      <div className="sch-grid" role="grid" aria-label="Schedule week">
        <div className="sch-corner" />
        {days.map((d, i) => (
          <div key={i} className={`sch-dayhead ${i === todayIdx ? "today" : ""}`} role="columnheader" aria-current={i === todayIdx ? "date" : undefined}>
            <span>{DAY_SHORT[i]}</span><b>{d.getDate()}</b>
          </div>
        ))}

        {shownBands.map((s) => (
          <button key={s.id} className={`sch-band ${s.enabled ? "" : "off"} ${dimmed(s) ? "dim" : ""} ${selectedId === s.id ? "sel" : ""}`} style={{ "--h": hue(s.agent) } as CSSProperties}
            onClick={() => onSelect(s.id)} aria-pressed={selectedId === s.id}>
            {describeRule(s.rule)} · {agentName(s.agent)} · {s.title}{s.enabled ? "" : " (off)"}
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

        {days.map((d, di) => (
          <div key={di} className={`sch-col ${di === todayIdx ? "today" : ""}`} style={colStyle} role="gridcell">
            {hours.map((h) => (
              <button key={h} className="sch-cell" style={{ height: ROW }} tabIndex={-1} aria-label={`New schedule on ${DAY_SHORT[di]} ${d.getDate()} at ${pad(h)}:00`} onClick={() => onSlot(di, h)} />
            ))}
            {placed.filter((o) => o.day === di).map((o) => {
              const sel = selectedId === o.s.id;
              const mark = o.status ? STATUS_GLYPH[o.status] : null;
              const tipSide = di >= 4 ? "left" : "right";
              return (
                <button key={`${o.s.id}-${o.min}`}
                  className={`sch-block ${o.past ? "past" : ""} ${o.s.enabled ? "" : "off"} ${dimmed(o.s) ? "dim" : ""} ${sel ? "sel" : ""}`}
                  style={{ "--h": hue(o.s.agent), top: (o.min / 60) * ROW + 1, height: ROW - 2, left: `calc(${(o.slot / o.slots) * 100}% + 2px)`, width: `calc(${100 / o.slots}% - 4px)` } as CSSProperties}
                  onClick={() => onSelect(o.s.id)} aria-pressed={sel}
                  aria-label={`${agentName(o.s.agent)}: ${o.s.title}, ${DAY_SHORT[di]} ${hh(o.min)}${o.status ? `, ${STATUS_TEXT[o.status]}` : ""}`}>
                  <span className="sch-bt"><i>{hh(o.min)}</i>{o.slots > 1 ? o.s.title : `${agentName(o.s.agent)} · ${o.s.title}`}</span>
                  {mark && <span className={`sch-mark ${o.status}`} aria-hidden="true">{mark}</span>}
                  <span className={`sch-tip ${tipSide}`} role="tooltip">
                    <b>{o.s.title}</b>
                    <span>{DAY_SHORT[di]} {hh(o.min)} · {agentName(o.s.agent)}</span>
                    <span>Repo: {o.s.repo ? `${o.s.repo} (${REPOS.find((r) => r.id === o.s.repo)?.base_branch ?? "main"})` : "none"}</span>
                    <span>{o.s.thread === "new" ? "New thread each time" : "Same thread"}</span>
                    {o.status && <span>{STATUS_TEXT[o.status]}{o.reason ? ` — ${o.reason}` : ""}</span>}
                  </span>
                </button>
              );
            })}
            {mores.filter((m) => m.day === di).map((m) => {
              const hour = Math.floor(m.min / 60);
              const open = pop?.day === di && pop.hour === hour;
              return (
                <div key={hour} className="sch-morewrap" style={{ top: (m.min / 60) * ROW + 1, height: ROW - 2, left: `calc(${(m.slot / MAX_SIDE) * 100}% + 2px)`, width: `calc(${100 / MAX_SIDE}% - 4px)`, zIndex: open ? 6 : 2 }}>
                  <button className="sch-more" aria-expanded={open} aria-label={`${m.items.length} more at ${pad(hour)}:00 on ${DAY_SHORT[di]}`} onClick={() => setPop(open ? null : { day: di, hour })}>+{m.items.length}</button>
                  {open && (
                    <div className={`sch-pop ${di >= 4 ? "left" : "right"}`} role="dialog" aria-label="More schedules">
                      <b>{DAY_SHORT[di]} {pad(hour)}:00</b>
                      {m.items.map((o) => (
                        <button key={o.s.id} className="sch-pop-item" style={{ "--h": hue(o.s.agent) } as CSSProperties} onClick={() => { onSelect(o.s.id); setPop(null); }}>
                          <i />{hh(o.min)} · {agentName(o.s.agent)} · {o.s.title}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {di === todayIdx && <div className="sch-now" style={{ top: (nowMin / 60) * ROW }} aria-label={`Now ${hh(nowMin)}`} />}
          </div>
        ))}
      </div>
    </section>
  );
}
