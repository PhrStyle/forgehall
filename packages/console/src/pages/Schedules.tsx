import { useEffect, useState } from "react";
import { useApp } from "../context";
import { Icon } from "../ui";
import { startOfWeek } from "./schedules/cron";
import { INITIAL_SCHEDULES, WORKSPACE, type Schedule } from "./schedules/mock";
import { ScheduleList, type StatusFilter } from "./schedules/ScheduleList";
import { ScheduleModal, type Prefill } from "./schedules/ScheduleModal";
import { WeekCalendar } from "./schedules/WeekCalendar";

export function Schedules() {
  const app = useApp();
  const [items, setItems] = useState<Schedule[]>(INITIAL_SCHEDULES);
  const [selected, setSelected] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [offset, setOffset] = useState(0);
  const [modal, setModal] = useState<{ editing: Schedule | null; prefill: Prefill | null } | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const weekStart = startOfWeek(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset * 7));
  const save = (s: Schedule) => {
    const exists = items.some((x) => x.id === s.id);
    setItems((l) => (exists ? l.map((x) => (x.id === s.id ? s : x)) : [...l, s]));
    setSelected(s.id);
    setModal(null);
    app.toast(exists ? `Schedule updated: ${s.title}` : `Schedule created: ${s.title}`);
  };

  return (
    <>
      <div className="main-head">
        <div className="title-row">
          <h1>Schedules</h1>
          <span className="chip warn" title="No backend yet: nothing here is saved or run">Draft — sample data</span>
          <div className="meta">{WORKSPACE}</div>
          <div className="actions">
            <div className="sch-seg" role="group" aria-label="Week">
              <button aria-pressed={offset === 0} onClick={() => setOffset(0)}>This week</button>
              <button aria-pressed={offset === 1} onClick={() => setOffset(1)}>Next week</button>
            </div>
            <button className="btn primary" onClick={() => setModal({ editing: null, prefill: null })}><Icon n="plus" />New schedule</button>
          </div>
        </div>
        <div />
      </div>
      <div className="main-body">
        <div className="sch-layout">
          <WeekCalendar weekStart={weekStart} offset={offset} now={now} schedules={items} selectedId={selected} agentFilter={agentFilter} onSelect={setSelected}
            onSlot={(day, hour) => setModal({ editing: null, prefill: { day, hour } })} />
          <ScheduleList schedules={items.filter((x) => (agentFilter.length === 0 || agentFilter.includes(x.agent)) && (statusFilter === "all" || (statusFilter === "on") === x.enabled))} total={items.length}
            agentFilter={agentFilter} statusFilter={statusFilter} onStatusFilter={setStatusFilter}
            onAgentFilter={(id) => setAgentFilter((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))} selectedId={selected} now={now} onSelect={setSelected}
            onToggle={(id) => setItems((l) => l.map((x) => (x.id === id ? { ...x, enabled: !x.enabled } : x)))}
            onRun={(s) => app.toast(`Draft: “${s.title}” would run now`)}
            onEdit={(s) => setModal({ editing: s, prefill: null })}
            onHistory={(s) => app.toast(`Draft: history for “${s.title}” is not available yet`)} />
        </div>
      </div>
      {modal && <ScheduleModal editing={modal.editing} prefill={modal.prefill} onClose={() => setModal(null)} onSave={save} />}
    </>
  );
}
