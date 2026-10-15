import type { CalendarOccurrence, Schedule, ScheduleStatus } from "../../api";

export const STATUS_GLYPH: Record<ScheduleStatus, string | null> = { upcoming: null, running: "▶", needs_you: "●", done: "✓", failed: "⚠", skipped: "↷" };
export const STATUS_TEXT: Record<ScheduleStatus, string> = { upcoming: "Upcoming", running: "Running", needs_you: "Needs you", done: "Done", failed: "Failed", skipped: "Skipped" };
export const STATUS_TONE: Record<ScheduleStatus, string> = { upcoming: "", running: "", needs_you: "mention", done: "ok", failed: "err", skipped: "" };

/** One run (past) or computed run (future) of a schedule, ready to draw. */
export interface Occ {
  s: Schedule;
  at: Date;
  status: ScheduleStatus;
  reason: string | null;
  threadId: string | null;
  past: boolean;
}

export function toOccs(items: CalendarOccurrence[], byId: Map<string, Schedule>, now: Date): Occ[] {
  const out: Occ[] = [];
  for (const o of items) {
    const s = byId.get(o.schedule_id);
    if (!s) continue;
    const at = new Date(o.at);
    out.push({ s, at, status: o.status, reason: o.reason, threadId: o.thread_id, past: at < now });
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime() || a.s.title.localeCompare(b.s.title));
}

/** "Every hour" / "Every 2 hours" for the frequent-schedules legend. */
export const frequentLabel = (s: Schedule) => (s.rule.kind === "every" ? (s.rule.hours === 1 ? "Every hour" : `Every ${s.rule.hours} hours`) : s.description);

export function Mark({ status }: { status: ScheduleStatus }) {
  const g = STATUS_GLYPH[status];
  return g ? <span className={`sch-mark ${status}`} aria-hidden="true">{g}</span> : null;
}
