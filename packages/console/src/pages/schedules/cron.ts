/** Plain-language repeat rules → cron text and upcoming occurrences. Pure helpers, no I/O. Days: 0 = Monday … 6 = Sunday. */
export type Repeat =
  | { kind: "daily" }
  | { kind: "weekdays" }
  | { kind: "days"; days: number[] }
  | { kind: "every"; hours: number };

/** `time` is HH:MM; for "every N hours" only the minute part is used. */
export interface Rule { repeat: Repeat; time: string }

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export const pad = (n: number) => String(n).padStart(2, "0");
export const isTime = (s: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

function hm(time: string): [number, number] {
  const [h, m] = time.split(":").map(Number);
  return [h ?? 0, m ?? 0];
}

/** Every 2 hours or more often: drawn as a band, not as blocks. */
export const isFrequent = (r: Rule) => r.repeat.kind === "every" && r.repeat.hours <= 2;

/** Minutes after midnight at which the rule fires on weekday `day` (0 = Monday). */
export function minutesOnDay(r: Rule, day: number): number[] {
  const [h, m] = hm(r.time);
  const p = r.repeat;
  if (p.kind === "every") {
    const out: number[] = [];
    for (let x = 0; x < 24; x += Math.max(1, p.hours)) out.push(x * 60 + m);
    return out;
  }
  const on = p.kind === "daily" || (p.kind === "weekdays" && day < 5) || (p.kind === "days" && p.days.includes(day));
  return on ? [h * 60 + m] : [];
}

export function toCron(r: Rule): string {
  const [h, m] = hm(r.time);
  const p = r.repeat;
  if (p.kind === "every") return p.hours <= 1 ? `${m} * * * *` : `${m} */${p.hours} * * *`;
  const dow = p.kind === "daily" ? "*" : p.kind === "weekdays" ? "1-5" : [...p.days].sort().map((d) => (d + 1) % 7).join(",");
  return `${m} ${h} * * ${dow}`;
}

export function describeRule(r: Rule): string {
  const [, m] = hm(r.time);
  const p = r.repeat;
  if (p.kind === "every") {
    const base = p.hours <= 1 ? "Every hour" : `Every ${p.hours} hours`;
    return m > 0 ? `${base} at :${pad(m)}` : base;
  }
  const at = ` at ${r.time}`;
  if (p.kind === "daily") return `Every day${at}`;
  if (p.kind === "weekdays") return `Weekdays${at}`;
  const ds = [...p.days].sort();
  if (ds.length === 1) return `${DAY_LONG[ds[0]!]}s${at}`;
  return `${ds.map((d) => DAY_SHORT[d]).join(", ")}${at}`;
}

export const dayIndex = (d: Date) => (d.getDay() + 6) % 7;

export function startOfWeek(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - dayIndex(x));
  return x;
}

export function nextRuns(r: Rule, from: Date, count: number): Date[] {
  const out: Date[] = [];
  for (let d = 0; d < 400 && out.length < count; d++) {
    const base = new Date(from.getFullYear(), from.getMonth(), from.getDate() + d);
    for (const min of minutesOnDay(r, dayIndex(base))) {
      const at = new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(min / 60), min % 60);
      if (at > from && out.length < count) out.push(at);
    }
  }
  return out;
}

export function fmtRun(d: Date): string {
  return `${DAY_SHORT[dayIndex(d)]} ${d.getDate()} ${d.toLocaleString([], { month: "short" })}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
