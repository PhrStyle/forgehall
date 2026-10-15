import { Avatar, Chip } from "../../ui";
import { inFuture } from "../../util";
import { describeRule, nextRuns } from "./cron";
import { AGENTS, REPOS, STATUS_TEXT, type Schedule } from "./mock";

export type StatusFilter = "all" | "on" | "off";

export function ScheduleList({ schedules, total, selectedId, now, agentFilter, statusFilter, onAgentFilter, onStatusFilter, onSelect, onToggle, onRun, onEdit, onHistory }: {
  schedules: Schedule[]; total: number; selectedId: string | null; now: Date; agentFilter: string[]; statusFilter: StatusFilter;
  onAgentFilter: (id: string) => void; onStatusFilter: (f: StatusFilter) => void;
  onSelect: (id: string) => void; onToggle: (id: string) => void;
  onRun: (s: Schedule) => void; onEdit: (s: Schedule) => void; onHistory: (s: Schedule) => void;
}) {
  return (
    <section className="sch-list" aria-label="Schedules">
      <div className="sch-filters">
        <div className="sch-chips" role="group" aria-label="Filter by agent">
          {AGENTS.map((a) => (
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
        const agent = AGENTS.find((a) => a.id === s.agent);
        const next = s.enabled ? nextRuns(s.rule, now, 1)[0] : undefined;
        const sel = s.id === selectedId;
        const detail = `${s.repo ? `${s.repo} (${REPOS.find((r) => r.id === s.repo)?.base_branch ?? "main"})` : "No repository"} · ${s.thread === "new" ? "New thread each time" : "Same thread"}`;
        return (
          <article key={s.id} className={`sch-card ${sel ? "sel" : ""} ${s.enabled ? "" : "off"}`} onClick={() => onSelect(s.id)} aria-current={sel ? "true" : undefined} title={detail}>
            <Avatar id={s.agent} name={agent?.name} />
            <div className="sch-card-main">
              <div className="sch-l1"><b>{s.title}</b></div>
              <div className="sch-l2">
                <span>{describeRule(s.rule)}</span>
                <span className="faint">·</span>
                <span className="muted">{s.enabled ? (next ? inFuture(next.toISOString()) : "—") : "Paused"}</span>
                {s.last ? <Chip tone={s.last.status === "passed" ? "ok" : s.last.status === "issues" ? "warn" : ""}>{STATUS_TEXT[s.last.status]}</Chip> : <span className="faint">No runs yet</span>}
              </div>
            </div>
            <div className="sch-actions">
              <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); onRun(s); }}>Run</button>
              <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); onEdit(s); }}>Edit</button>
              <button className="btn sm ghost" onClick={(e) => { e.stopPropagation(); onHistory(s); }}>History</button>
            </div>
            <button className="switch" role="switch" aria-checked={s.enabled} aria-label={`${s.title}: ${s.enabled ? "on" : "off"}`}
              onClick={(e) => { e.stopPropagation(); onToggle(s.id); }} />
          </article>
        );
      })}
      {schedules.length === 0 && <p className="empty">{total === 0 ? "No schedules yet. Create one with “New schedule”." : "No schedules match these filters."}</p>}
    </section>
  );
}
