import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api, type Schedule } from "../api";
import { useApp } from "../context";
import { useAgents, useRepos, useScheduleCalendar, useSchedules } from "../queries";
import { ErrorBox, Icon } from "../ui";
import { Calendar } from "./schedules/Calendar";
import { ScheduleList, type StatusFilter } from "./schedules/ScheduleList";
import { ScheduleModal, type Prefill } from "./schedules/ScheduleModal";
import { rangeFor, shiftAnchor, startOfDay, type CalView } from "./schedules/cron";

export function Schedules() {
  const app = useApp();
  const ws = app.workspace;
  const qc = useQueryClient();
  const schedulesQ = useSchedules(ws);
  const agentsQ = useAgents(ws);
  const reposQ = useRepos(ws);
  const [selected, setSelected] = useState<string | null>(null);
  const [agentFilter, setAgentFilter] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [view, setView] = useState<CalView>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [historyId, setHistoryId] = useState<string | null>(null);
  const [modal, setModal] = useState<{ editing: Schedule | null; prefill: Prefill | null } | null>(null);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);

  const range = useMemo(() => rangeFor(view, anchor), [view, anchor]);
  const calQ = useScheduleCalendar(ws, range.from.toISOString(), range.to.toISOString());

  const items = schedulesQ.data ?? [];
  const agents = agentsQ.data ?? [];
  const repos = reposQ.data ?? [];
  const agentName = useCallback((id: string) => agents.find((a) => a.id === id)?.name ?? id, [agents]);
  const repoLabel = useCallback((id: string | null) => (id ? `${id} (${repos.find((r) => r.id === id)?.base_branch ?? "main"})` : "none"), [repos]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["schedules", ws] });

  const [busyId, setBusyId] = useState<string | null>(null);
  const toggle = useMutation({
    mutationFn: (s: Schedule) => { setBusyId(s.id); return api.patchSchedule(s.id, { enabled: !s.enabled }); },
    onSuccess: refresh,
    onError: (e) => app.toast(e instanceof Error ? e.message : "Could not update the schedule"),
    onSettled: () => setBusyId(null),
  });
  const run = useMutation({
    mutationFn: (s: Schedule) => { setBusyId(s.id); return api.runSchedule(s.id); },
    onSuccess: (r) => {
      refresh();
      app.toast(<>Started {r.thread_id}<Link to={`/threads/${r.thread_id}`}>Open thread</Link></>, 8000);
    },
    onError: (e) => app.toast(e instanceof Error ? e.message : "Could not start the run"),
    onSettled: () => setBusyId(null),
  });

  const openDay = (d: Date) => { setAnchor(startOfDay(d)); setView("day"); };
  const filtered = items.filter((x) => (agentFilter.length === 0 || agentFilter.includes(x.agent_id)) && (statusFilter === "all" || (statusFilter === "on") === x.enabled));
  const newSchedule = () => setModal({ editing: null, prefill: null });

  return (
    <>
      <div className="main-head">
        <div className="title-row">
          <h1>Schedules</h1>
          <div className="meta">{ws}</div>
          <div className="actions">
            <button className="btn primary" onClick={newSchedule}><Icon n="plus" />New schedule</button>
          </div>
        </div>
        <div />
      </div>
      <div className="main-body">
        {schedulesQ.isError && <ErrorBox error={schedulesQ.error} />}
        {schedulesQ.isPending && !schedulesQ.isError && <p className="empty">Loading schedules…</p>}
        {schedulesQ.isSuccess && items.length === 0 && (
          <div className="empty-state">
            <h3>No schedules yet</h3>
            <p>Let an agent do recurring work on its own: a nightly regression run, a Monday dependency check, a monthly report.</p>
            <button className="btn primary" onClick={newSchedule}><Icon n="plus" />New schedule</button>
          </div>
        )}
        {items.length > 0 && calQ.isError && <ErrorBox error={calQ.error} />}
        {items.length > 0 && (
          <div className="sch-layout">
            <Calendar view={view} anchor={anchor} now={now} data={calQ.data} loading={calQ.isFetching} schedules={items} agentName={agentName} repoLabel={repoLabel}
              selectedId={selected} agentFilter={agentFilter} onView={setView} onNav={(d) => setAnchor((a) => shiftAnchor(view, a, d))} onToday={() => setAnchor(startOfDay(new Date()))}
              onSelect={setSelected} onSlot={(day, hour) => setModal({ editing: null, prefill: { day, hour } })} onOpenDay={openDay} />
            <ScheduleList ws={ws!} schedules={filtered} total={items.length} agents={agents} repos={repos} selectedId={selected} now={now}
              agentFilter={agentFilter} statusFilter={statusFilter} historyId={historyId} busyId={busyId} onStatusFilter={setStatusFilter}
              onAgentFilter={(id) => setAgentFilter((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]))}
              onSelect={setSelected} onToggle={(s) => toggle.mutate(s)} onRun={(s) => run.mutate(s)} onEdit={(s) => setModal({ editing: s, prefill: null })} onHistory={setHistoryId} />
          </div>
        )}
      </div>
      {modal && ws && (
        <ScheduleModal ws={ws} editing={modal.editing} prefill={modal.prefill} agents={agents} repos={repos} onClose={() => setModal(null)}
          onSaved={(s, created) => { setSelected(s.id); setModal(null); refresh(); app.toast(created ? `Schedule created: ${s.title}` : `Schedule updated: ${s.title}`); }}
          onDeleted={(s) => { setSelected((x) => (x === s.id ? null : x)); setModal(null); refresh(); app.toast(`Schedule deleted: ${s.title}`); }} />
      )}
    </>
  );
}
