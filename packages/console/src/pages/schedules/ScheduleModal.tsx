import { useMutation, useQuery, keepPreviousData } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { ScheduleRule } from "@forgehall/shared";
import { api, type AgentOverview, type RepoRow, type Schedule, type ScheduleInput } from "../../api";
import { DAY_SHORT, MONTH_SHORT, fmtRun, pad } from "./cron";

export interface Prefill { day?: number; hour?: number }
type Kind = ScheduleRule["kind"];

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const COMMON_TZ = ["UTC", "America/Sao_Paulo", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Tokyo"];
const KINDS: [Kind, string][] = [["daily", "Every day"], ["weekdays", "Weekdays"], ["days", "Specific days"], ["every", "Every N hours"], ["monthly", "Monthly"], ["once", "Once"]];
/** Most days each month can have (February: 29), used to catch "31st of April". */
const MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00`).getTime());

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function ScheduleModal({ ws, editing, prefill, agents, repos, onClose, onSaved, onDeleted }: {
  ws: string; editing: Schedule | null; prefill: Prefill | null; agents: AgentOverview[]; repos: RepoRow[];
  onClose: () => void; onSaved: (s: Schedule, created: boolean) => void; onDeleted: (s: Schedule) => void;
}) {
  const r = editing?.rule;
  const [agent, setAgent] = useState(editing?.agent_id ?? agents[0]?.id ?? "");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.prompt ?? "");
  const [repo, setRepo] = useState(editing?.repo_id ?? "");
  const [kind, setKind] = useState<Kind>(r?.kind ?? (prefill?.day != null ? "days" : "weekdays"));
  const [days, setDays] = useState<number[]>(r?.kind === "days" ? r.days : prefill?.day != null ? [prefill.day] : [0]);
  const [every, setEvery] = useState(String(r?.kind === "every" ? r.hours : 4));
  const [minute, setMinute] = useState(String(r?.kind === "every" ? r.minute : 0));
  const [time, setTime] = useState(r && "time" in r ? r.time : prefill?.hour != null ? `${pad(prefill.hour)}:00` : "09:00");
  const [monthDay, setMonthDay] = useState<string>(r?.kind === "monthly" ? String(r.day) : "1");
  const [months, setMonths] = useState<number[]>(r?.kind === "monthly" ? r.months : []);
  const tomorrow = new Date(Date.now() + 86_400_000);
  const [onceDate, setOnceDate] = useState(r?.kind === "once" ? r.at.slice(0, 10) : `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`);
  const [onceTime, setOnceTime] = useState(r?.kind === "once" ? r.at.slice(11) : "09:00");
  const [tz, setTz] = useState(editing?.timezone ?? browserTz);
  const [thread, setThread] = useState<"new" | "same">(editing?.thread_mode ?? "new");
  const [skipOpen, setSkipOpen] = useState(editing?.skip_if_open ?? true);
  const [skipUse, setSkipUse] = useState(editing ? editing.skip_usage_above != null : true);
  const [pct, setPct] = useState(String(editing?.skip_usage_above != null ? Math.round(editing.skip_usage_above * 100) : 70));
  const [tried, setTried] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const hours = Number(every);
  const min = Number(minute);
  const dayNum = monthDay === "last" ? 0 : Number(monthDay);
  const errors = {
    agent: agent ? "" : "Pick an agent.",
    title: title.trim().length < 3 ? "Enter a title of at least 3 characters." : "",
    body: body.trim() ? "" : "Describe what the agent should do.",
    days: kind === "days" && days.length === 0 ? "Pick at least one day." : "",
    every: kind === "every" && !(Number.isInteger(hours) && hours >= 1 && hours <= 12) ? "Enter a whole number from 1 to 12." : "",
    minute: kind === "every" && !(/^\d{1,2}$/.test(minute) && min <= 59) ? "Enter a minute from 0 to 59." : "",
    time: (kind === "daily" || kind === "weekdays" || kind === "days" || kind === "monthly") && !isTime(time) ? "Enter a time, for example 02:00." : "",
    monthDay: kind === "monthly" && monthDay !== "last" && !(Number.isInteger(dayNum) && dayNum >= 1 && dayNum <= 31) ? "Pick a day from 1 to 31." : "",
    months: kind === "monthly" && monthDay !== "last" && dayNum >= 1 && dayNum <= 31 && months.length > 0 && months.every((m) => MAX_DAYS[m - 1]! < dayNum)
      ? `${months.map((m) => MONTH_SHORT[m - 1]).join(", ")} never ${months.length === 1 ? "has" : "have"} a day ${dayNum}.` : "",
    onceDate: kind === "once" && !isDate(onceDate) ? "Pick a date." : "",
    onceTime: kind === "once" && !isTime(onceTime) ? "Enter a time, for example 09:00." : "",
    pct: skipUse && !(Number.isInteger(Number(pct)) && Number(pct) >= 1 && Number(pct) <= 100) ? "Enter a percentage from 1 to 100." : "",
  };
  const ruleErr = [errors.days, errors.every, errors.minute, errors.time, errors.monthDay, errors.months, errors.onceDate, errors.onceTime].find(Boolean) ?? "";
  const hasErr = Object.values(errors).some(Boolean);
  const show = (m: string) => (tried && m ? <span className="sch-err" role="alert">{m}</span> : null);
  const bad = (m: string) => (tried && m ? true : undefined);

  const rule = useMemo<ScheduleRule | null>(() => {
    if (ruleErr) return null;
    switch (kind) {
      case "daily": case "weekdays": return { kind, time };
      case "days": return { kind, days: [...days].sort((a, b) => a - b), time };
      case "every": return { kind, hours, minute: min };
      case "monthly": return { kind, day: monthDay === "last" ? "last" : dayNum, months: [...months].sort((a, b) => a - b), time };
      case "once": return { kind, at: `${onceDate}T${onceTime}` };
    }
  }, [ruleErr, kind, time, days, hours, min, monthDay, dayNum, months, onceDate, onceTime]);

  const ruleKey = useDebounced(rule ? JSON.stringify(rule) : "", 350);
  const preview = useQuery({
    queryKey: ["schedulePreview", ruleKey, tz],
    queryFn: () => api.previewSchedule({ rule: JSON.parse(ruleKey) as ScheduleRule, timezone: tz }),
    enabled: ruleKey !== "",
    retry: false,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const settling = rule ? JSON.stringify(rule) !== ruleKey || preview.isFetching : false;

  const save = useMutation({
    mutationFn: (b: ScheduleInput) => (editing ? api.patchSchedule(editing.id, b) : api.createSchedule(ws, b)),
    onSuccess: (s) => onSaved(s, !editing),
  });
  const del = useMutation({ mutationFn: () => api.deleteSchedule(editing!.id), onSuccess: () => onDeleted(editing!) });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (hasErr || !rule) return;
    save.mutate({
      agent, title: title.trim(), prompt: body.trim(), repo: repo || null, rule, timezone: tz, thread_mode: thread,
      skip_if_open: skipOpen, skip_usage_above: skipUse ? Number(pct) / 100 : null,
    });
  };
  const toggle = (list: number[], set: (l: number[]) => void, n: number) => set(list.includes(n) ? list.filter((x) => x !== n) : [...list, n]);
  const tzs = [...new Set([browserTz, ...COMMON_TZ, ...(editing ? [editing.timezone] : [])])];
  const needTime = kind === "daily" || kind === "weekdays" || kind === "days" || kind === "monthly";
  const busy = save.isPending || del.isPending;

  return (
    <div className="scrim modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal-box sch-modal" role="dialog" aria-label={editing ? "Edit schedule" : "New schedule"} onSubmit={submit} noValidate>
        <h3>{editing ? "Edit schedule" : "New schedule"}</h3>
        <label className="field">Agent
          <select ref={first} value={agent} onChange={(e) => setAgent(e.target.value)} aria-invalid={bad(errors.agent)}>
            {agents.length === 0 && <option value="">No agents in this workspace</option>}
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role ? ` · ${a.role}` : ""}</option>)}
          </select>
          {show(errors.agent)}
        </label>
        <label className="field">Title (required, min. 3 characters)
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Nightly regression" aria-invalid={bad(errors.title)} />
          {show(errors.title)}
        </label>
        <label className="field">What to do (required)
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="What should the agent do on each run?" style={{ minHeight: 80 }} aria-invalid={bad(errors.body)} />
          {show(errors.body)}
        </label>
        <label className="field">Repository (optional)
          <select value={repo} onChange={(e) => setRepo(e.target.value)}>
            <option value="">None</option>
            {repos.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.base_branch}</option>)}
          </select>
        </label>

        <fieldset className="sch-fs">
          <legend>Repeat</legend>
          <div className="sch-opts">
            {KINDS.map(([k, l]) => (
              <label key={k} className={`sch-opt ${kind === k ? "on" : ""}`}><input type="radio" name="repeat" checked={kind === k} onChange={() => setKind(k)} />{l}</label>
            ))}
          </div>
          {kind === "days" && (
            <div className="field">
              <div className="sch-days" role="group" aria-label="Days of the week">
                {DAY_SHORT.map((d, i) => <button key={d} type="button" className={`sch-day ${days.includes(i) ? "on" : ""}`} aria-pressed={days.includes(i)} onClick={() => toggle(days, setDays, i)}>{d}</button>)}
              </div>
              {show(errors.days)}
            </div>
          )}
          {kind === "monthly" && (
            <>
              <div className="sch-row">
                <label className="field">Day of the month
                  <select value={monthDay} onChange={(e) => setMonthDay(e.target.value)} aria-invalid={bad(errors.monthDay)}>
                    {Array.from({ length: 31 }, (_, i) => <option key={i + 1} value={String(i + 1)}>{i + 1}</option>)}
                    <option value="last">Last day</option>
                  </select>
                  {show(errors.monthDay)}
                </label>
              </div>
              <div className="field">Months
                <div className="sch-days" role="group" aria-label="Months">
                  {MONTH_SHORT.map((m, i) => <button key={m} type="button" className={`sch-day ${months.includes(i + 1) ? "on" : ""}`} aria-pressed={months.includes(i + 1)} onClick={() => toggle(months, setMonths, i + 1)}>{m}</button>)}
                </div>
                <span className="muted sch-help">Pick months for quarterly or yearly schedules</span>
                {show(errors.months)}
              </div>
            </>
          )}
          <div className="sch-row">
            {kind === "every" && (
              <>
                <label className="field">Every (hours, 1 to 12)
                  <input inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} aria-invalid={bad(errors.every)} />
                  {show(errors.every)}
                </label>
                <label className="field">At minute
                  <input inputMode="numeric" value={minute} onChange={(e) => setMinute(e.target.value)} aria-invalid={bad(errors.minute)} />
                  {show(errors.minute)}
                </label>
              </>
            )}
            {needTime && (
              <label className="field">Time
                <input type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-invalid={bad(errors.time)} />
                {show(errors.time)}
              </label>
            )}
            {kind === "once" && (
              <>
                <label className="field">Date
                  <input type="date" value={onceDate} onChange={(e) => setOnceDate(e.target.value)} aria-invalid={bad(errors.onceDate)} />
                  {show(errors.onceDate)}
                </label>
                <label className="field">Time
                  <input type="time" value={onceTime} onChange={(e) => setOnceTime(e.target.value)} aria-invalid={bad(errors.onceTime)} />
                  {show(errors.onceTime)}
                </label>
              </>
            )}
            <label className="field">Timezone
              <select value={tz} onChange={(e) => setTz(e.target.value)}>{tzs.map((z) => <option key={z} value={z}>{z}{z === browserTz ? " (this browser)" : ""}</option>)}</select>
            </label>
          </div>
          <div className="sch-preview" aria-live="polite">
            {!rule ? <span className="faint">Complete the fields above to preview the schedule.</span> : preview.isError && !settling ? (
              <span className="sch-err" role="alert">{preview.error instanceof Error ? preview.error.message : "Could not preview this schedule."}</span>
            ) : preview.data ? (
              <>
                <div><span className="faint">Runs</span> {preview.data.description}</div>
                <div><span className="faint">Cron</span> <code className="mono">{preview.data.cron ?? "— (single run)"}</code></div>
                <div><span className="faint">Next runs</span>
                  {preview.data.next.length ? <ul>{preview.data.next.map((d) => <li key={d} className="mono">{fmtRun(new Date(d))}</li>)}</ul> : <span> —</span>}
                </div>
              </>
            ) : <span className="faint">Loading preview…</span>}
          </div>
        </fieldset>

        <fieldset className="sch-fs">
          <legend>Thread</legend>
          <div className="sch-opts">
            <label className={`sch-opt ${thread === "new" ? "on" : ""}`}><input type="radio" name="thread" checked={thread === "new"} onChange={() => setThread("new")} />New thread each time</label>
            <label className={`sch-opt ${thread === "same" ? "on" : ""}`}><input type="radio" name="thread" checked={thread === "same"} onChange={() => setThread("same")} />Same thread</label>
          </div>
        </fieldset>

        <fieldset className="sch-fs">
          <legend>Guard rails</legend>
          <label className="sch-check"><input type="checkbox" checked={skipOpen} onChange={(e) => setSkipOpen(e.target.checked)} />Skip if the previous run is still open</label>
          <div className="sch-check">
            <input id="sch-skip-use" type="checkbox" checked={skipUse} onChange={(e) => setSkipUse(e.target.checked)} />
            <label htmlFor="sch-skip-use">Skip when weekly usage is above</label>
            <input className="sch-pct" aria-label="Weekly usage threshold in percent" inputMode="numeric" value={pct} disabled={!skipUse} onChange={(e) => setPct(e.target.value)} aria-invalid={bad(errors.pct)} />%
          </div>
          {show(errors.pct)}
        </fieldset>

        {tried && hasErr && <div className="errbox" role="alert" style={{ margin: 0 }}>Fix the highlighted fields to save this schedule.</div>}
        {save.isError && <div className="errbox" role="alert" style={{ margin: 0 }}>{save.error instanceof Error ? save.error.message : "Could not save the schedule."}</div>}
        {del.isError && <div className="errbox" role="alert" style={{ margin: 0 }}>{del.error instanceof Error ? del.error.message : "Could not delete the schedule."}</div>}
        <div className="row-end sch-foot">
          {editing && !confirmDelete && <button type="button" className="btn danger sch-del" onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</button>}
          {editing && confirmDelete && (
            <span className="sch-del sch-confirm" role="alert">
              Delete this schedule?
              <button type="button" className="btn sm" onClick={() => setConfirmDelete(false)} disabled={busy}>Keep</button>
              <button type="button" className="btn sm danger" onClick={() => del.mutate()} disabled={busy}>{del.isPending ? "Deleting…" : "Yes, delete"}</button>
            </span>
          )}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{save.isPending ? "Saving…" : editing ? "Save changes" : "Create schedule"}</button>
        </div>
      </form>
    </div>
  );
}
