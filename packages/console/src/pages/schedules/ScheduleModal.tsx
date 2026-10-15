import { useEffect, useRef, useState, type FormEvent } from "react";
import { DAY_SHORT, fmtRun, isTime, nextRuns, pad, toCron, type Repeat, type Rule } from "./cron";
import { AGENTS, REPOS, type Schedule } from "./mock";

export interface Prefill { day?: number; hour?: number }
type Kind = Repeat["kind"];

const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const TZS = [...new Set([browserTz, "UTC", "America/Sao_Paulo", "America/New_York", "Europe/Berlin"])];

export function ScheduleModal({ editing, prefill, onClose, onSave }: {
  editing: Schedule | null; prefill: Prefill | null; onClose: () => void; onSave: (s: Schedule) => void;
}) {
  const r = editing?.rule.repeat;
  const [agent, setAgent] = useState(editing?.agent ?? AGENTS[0]?.id ?? "");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [body, setBody] = useState(editing?.body ?? "");
  const [repo, setRepo] = useState(editing?.repo ?? "");
  const [kind, setKind] = useState<Kind>(r?.kind ?? (prefill?.day != null ? "days" : "weekdays"));
  const [days, setDays] = useState<number[]>(r?.kind === "days" ? r.days : prefill?.day != null ? [prefill.day] : [0]);
  const [every, setEvery] = useState(String(r?.kind === "every" ? r.hours : 4));
  const [time, setTime] = useState(editing && r?.kind !== "every" ? editing.rule.time : prefill?.hour != null ? `${pad(prefill.hour)}:00` : "09:00");
  const [minute, setMinute] = useState(editing && r?.kind === "every" ? editing.rule.time.slice(3) : "00");
  const [tz, setTz] = useState(editing?.tz ?? browserTz);
  const [thread, setThread] = useState<"new" | "same">(editing?.thread ?? "new");
  const [skipOpen, setSkipOpen] = useState(editing?.skipIfOpen ?? true);
  const [skipUse, setSkipUse] = useState(editing ? editing.skipAbovePct != null : true);
  const [pct, setPct] = useState(String(editing?.skipAbovePct ?? 70));
  const [tried, setTried] = useState(false);
  const first = useRef<HTMLSelectElement>(null);
  useEffect(() => first.current?.focus(), []);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  const n = Number(every);
  const errors = {
    title: title.trim().length < 3 ? "Enter a title of at least 3 characters." : "",
    body: body.trim() ? "" : "Describe what the agent should do.",
    days: kind === "days" && days.length === 0 ? "Pick at least one day." : "",
    every: kind === "every" && !(Number.isInteger(n) && n >= 1 && n <= 23) ? "Enter a whole number from 1 to 23." : "",
    time: kind !== "every" && !isTime(time) ? "Use the format HH:MM, for example 02:00." : "",
    minute: kind === "every" && !(/^\d{1,2}$/.test(minute) && Number(minute) <= 59) ? "Enter a minute from 0 to 59." : "",
    pct: skipUse && !(Number.isInteger(Number(pct)) && Number(pct) >= 1 && Number(pct) <= 100) ? "Enter a percentage from 1 to 100." : "",
  };
  const ruleErr = errors.days || errors.every || errors.time || errors.minute;
  const hasErr = Object.values(errors).some(Boolean);
  const show = (m: string) => (tried && m ? <span className="sch-err" role="alert">{m}</span> : null);

  const repeat: Repeat = kind === "every" ? { kind, hours: n } : kind === "days" ? { kind, days } : { kind };
  const rule: Rule = { repeat, time: kind === "every" ? `00:${pad(Number(minute) || 0)}` : time };
  const cron = ruleErr ? null : toCron(rule);
  const upcoming = ruleErr ? [] : nextRuns(rule, new Date(), 3);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (hasErr) return;
    onSave({
      id: editing?.id ?? `s${Date.now()}`, agent, title: title.trim(), body: body.trim(), repo, rule, tz, thread,
      skipIfOpen: skipOpen, skipAbovePct: skipUse ? Number(pct) : null, enabled: editing?.enabled ?? true, last: editing?.last ?? null,
    });
  };
  const bad = (m: string) => (tried && m ? true : undefined);
  const toggleDay = (d: number) => setDays((x) => (x.includes(d) ? x.filter((y) => y !== d) : [...x, d]));

  return (
    <div className="scrim modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal-box sch-modal" role="dialog" aria-label={editing ? "Edit schedule" : "New schedule"} onSubmit={submit} noValidate>
        <h3>{editing ? "Edit schedule" : "New schedule"}</h3>
        <label className="field">Agent
          <select ref={first} value={agent} onChange={(e) => setAgent(e.target.value)}>
            {AGENTS.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.role}</option>)}
          </select>
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
            {REPOS.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.base_branch}</option>)}
          </select>
        </label>

        <fieldset className="sch-fs">
          <legend>Repeat</legend>
          <div className="sch-opts">
            {([["daily", "Every day"], ["weekdays", "Weekdays"], ["days", "Specific days"], ["every", "Every N hours"]] as [Kind, string][]).map(([k, l]) => (
              <label key={k} className={`sch-opt ${kind === k ? "on" : ""}`}><input type="radio" name="repeat" checked={kind === k} onChange={() => setKind(k)} />{l}</label>
            ))}
          </div>
          {kind === "days" && (
            <div className="field">
              <div className="sch-days" role="group" aria-label="Days of the week">
                {DAY_SHORT.map((d, i) => <button key={d} type="button" className={`sch-day ${days.includes(i) ? "on" : ""}`} aria-pressed={days.includes(i)} onClick={() => toggleDay(i)}>{d}</button>)}
              </div>
              {show(errors.days)}
            </div>
          )}
          <div className="sch-row">
            {kind === "every" ? (
              <>
                <label className="field">Every (hours)
                  <input inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value)} aria-invalid={bad(errors.every)} />
                  {show(errors.every)}
                </label>
                <label className="field">At minute
                  <input inputMode="numeric" value={minute} onChange={(e) => setMinute(e.target.value)} aria-invalid={bad(errors.minute)} />
                  {show(errors.minute)}
                </label>
              </>
            ) : (
              <label className="field">Time (HH:MM)
                <input value={time} onChange={(e) => setTime(e.target.value)} placeholder="02:00" aria-invalid={bad(errors.time)} />
                {show(errors.time)}
              </label>
            )}
            <label className="field">Timezone
              <select value={tz} onChange={(e) => setTz(e.target.value)}>{TZS.map((z) => <option key={z} value={z}>{z}{z === browserTz ? " (this browser)" : ""}</option>)}</select>
            </label>
          </div>
          <div className="sch-preview" aria-live="polite">
            <div><span className="faint">Cron</span> <code className="mono">{cron ?? "—"}</code></div>
            <div><span className="faint">Next runs</span>
              {upcoming.length ? <ul>{upcoming.map((d) => <li key={d.getTime()} className="mono">{fmtRun(d)}</li>)}</ul> : <span> —</span>}
            </div>
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
        <div className="row-end">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{editing ? "Save changes" : "Create schedule"}</button>
        </div>
      </form>
    </div>
  );
}
