import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { isFrequent } from "@forgehall/shared";
import type { AgentOverview, RepoRow, Schedule } from "../../api";
import { useScheduleCalendar } from "../../queries";
import { Avatar, Chip } from "../../ui";
import { ago, inFuture } from "../../util";
import { addDays, fmtRun, startOfDay } from "./cron";
import { STATUS_TEXT, STATUS_TONE } from "./status";

export type StatusFilter = "all" | "on" | "off";

function History({ ws, s, now, onClose }: { ws: string; s: Schedule; now: Date; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const today = startOfDay(now);
  const q = useScheduleCalendar(ws, addDays(today, -30).toISOString(), addDays(today, 1).toISOString());
  const runs = useMemo(
    () => (q.data?.occurrences ?? []).filter((o) => o.schedule_id === s.id && o.status !== "upcoming").sort((a, b) => b.at.localeCompare(a.at)).slice(0, 10),
    [q.data, s.id],
  );
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key); };
  }, [onClose]);
  const frequent = isFrequent(s.rule);

  return (
    <div ref={ref} className="sch-pop sch-history left" role="dialog" aria-label={`History of ${s.title}`} onClick={(e) => e.stopPropagation()}>
      <b>Last runs · 30 days</b>
      {q.isPending && <span className="faint sch-pop-note">Loading…</span>}
      {q.isError && <span className="sch-err sch-pop-note">Could not load the history.</span>}
      {frequent && <span className="faint sch-pop-note">Runs this often are not listed one by one.</span>}
      {!frequent && q.data && runs.length === 0 && <span className="faint sch-pop-note">No runs in the last 30 days.</span>}
      {runs.map((o) => {
        const row = (
          <>
            <span className="mono">{fmtRun(new Date(o.at))}</span>
            <Chip tone={STATUS_TONE[o.status]}>{STATUS_TEXT[o.status]}</Chip>
            {o.reason && <span className="faint sch-hreason" title={o.reason}>{o.reason}</span>}
          </>
        );
        return o.thread_id
          ? <Link key={o.at} className="sch-pop-item" to={`/threads/${o.thread_id}`} onClick={onClose}>{row}</Link>
          : <span key={o.at} className="sch-pop-item">{row}</span>;
      })}
      {s.last_run?.thread_id && (frequent || runs.length === 0) && (
        <Link className="sch-pop-item" to={`/threads/${s.last_run.thread_id}`} onClick={onClose}>Latest thread · {ago(s.last_run.at)}</Link>
      )}
    </div>
  );
}

export function ScheduleList({ ws, schedules, total, agents, repos, selectedId, now, agentFilter, statusFilter, historyId, busyId, onAgentFilter, onStatusFilter, onSelect, onToggle, onRun, onEdit, onHistory }: {
  ws: string; schedules: Schedule[]; total: number; agents: AgentOverview[]; repos: RepoRow[]; selectedId: string | null; now: Date;
  agentFilter: string[]; statusFilter: StatusFilter; historyId: string | null; busyId: string | null;
  onAgentFilter: (id: string) => void; onStatusFilter: (f: StatusFilter) => void;
  onSelect: (id: string) => void; onToggle: (s: Schedule) => void;
  onRun: (s: Schedule) => void; onEdit: (s: Schedule) => void; onHistory: (id: string | null) => void;
}) {
  const agentById = (id: string) => agents.find((a) => a.id === id);
  return (
    <section className="sch-list" aria-label="Schedules">
      <div className="sch-filters">
        <div className="sch-chips" role="group" aria-label="Filter by agent">
          {agents.map((a) => (
            <button key={a.id} className={`sch-fchip ${agentFilter.includes(a.id) ? "on" : ""}`} aria-pressed={agentFilter.includes(a.id)} onClick={() => onAgentFilter(a.id)}>
              <Avatar id={a.id} name={a.name} />{a.name}
            </button>
          ))}
        </div>
        <div className="sch-filter-row">
          <div className="sch-seg" role="group" aria-label="Filter by status">
            {(["all", "on", "off"] as StatusFilter[]).map((f) => <button key={f} aria-pressed={statusFilter === f} onClick={() => onStatusFilter(f)}>{f === "all" ? "All" : f === "on" ? "On" : "Off"}</button>)}
          </div>
          <span className="faint mono">{schedules.length}/{total}</span>
        </div>
      </div>
      {schedules.map((s) => {
        const agent = agentById(s.agent_id);
        const sel = s.id === selectedId;
        const last = s.last_run;
        const base = repos.find((r) => r.id === s.repo_id)?.base_branch;
        const detail = `${s.repo_id ? `${s.repo_id}${base ? ` (${base})` : ""}` : "No repository"} · ${s.thread_mode === "new" ? "New thread each time" : "Same thread"}`;
        return (
          <article key={s.id} className={`sch-card ${sel ? "sel" : ""} ${s.enabled ? "" : "off"} ${historyId === s.id ? "hist" : ""}`} onClick={() => onSelect(s.id)} aria-current={sel ? "true" : undefined} title={detail}>
            <Avatar id={s.agent_id} name={agent?.name} />
            <div className="sch-card-main">
              <div className="sch-l1"><b>{s.title}</b></div>
              <div className="sch-l2">
                <span>{s.description}</span>
                <span className="faint">·</span>
                <span className="muted">{s.enabled ? (s.next_run_at ? inFuture(s.next_run_at) : "—") : "Paused"}</span>
                {last ? (
                  last.thread_id ? (
                    <Link className="sch-lastlink" to={`/threads/${last.thread_id}`} onClick={(e) => e.stopPropagation()} title={`${ago(last.at)}${last.reason ? ` — ${last.reason}` : ""}`}>
                      <Chip tone={STATUS_TONE[last.status]}>{STATUS_TEXT[last.status]}</Chip>
                    </Link>
                  ) : <span title={`${ago(last.at)}${last.reason ? ` — ${last.reason}` : ""}`}><Chip tone={STATUS_TONE[last.status]}>{STATUS_TEXT[last.status]}</Chip></span>
                ) : <span className="faint">No runs yet</span>}
              </div>
            </div>
            <div className="sch-actions">
              <button className="btn sm ghost" disabled={busyId === s.id} onClick={(e) => { e.stopPropagation(); onRun(s); }}>Run</button>
              <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); onEdit(s); }}>Edit</button>
              <button className="btn sm ghost" aria-expanded={historyId === s.id} onClick={(e) => { e.stopPropagation(); onHistory(historyId === s.id ? null : s.id); }}>History</button>
            </div>
            <button className="switch" role="switch" aria-checked={s.enabled} aria-label={`${s.title}: ${s.enabled ? "on" : "off"}`} disabled={busyId === s.id}
              onClick={(e) => { e.stopPropagation(); onToggle(s); }} />
            {historyId === s.id && <History ws={ws} s={s} now={now} onClose={() => onHistory(null)} />}
          </article>
        );
      })}
      {schedules.length === 0 && <p className="empty">No schedules match these filters.</p>}
    </section>
  );
}
