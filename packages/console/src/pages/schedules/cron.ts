/** Date math for the schedule calendar. Pure helpers, no I/O. Weeks start on Monday (index 0 = Monday … 6 = Sunday). */
export type CalView = "day" | "week" | "month" | "year";

export const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const pad = (n: number) => String(n).padStart(2, "0");
/** "HH:MM" for a minute-of-day. */
export const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const clockOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

export const dayIndex = (d: Date) => (d.getDay() + 6) % 7;
export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const startOfWeek = (d: Date) => addDays(d, -dayIndex(d));
export const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
/** Local calendar day as YYYY-MM-DD (a map key, not a UTC date). */
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Weeks (Mon–Sun) that cover a month, 4 to 6 rows; includes days of the neighbouring months. */
export function monthWeeks(year: number, month: number): Date[][] {
  const first = new Date(year, month, 1);
  const start = startOfWeek(first);
  const last = new Date(year, month + 1, 0);
  const weeks: Date[][] = [];
  for (let w = start; w <= last; w = addDays(w, 7)) weeks.push(Array.from({ length: 7 }, (_, i) => addDays(w, i)));
  return weeks;
}

/** The half-open local range [from, to) a view needs from the calendar endpoint. */
export function rangeFor(view: CalView, anchor: Date): { from: Date; to: Date } {
  const d = startOfDay(anchor);
  switch (view) {
    case "day": return { from: d, to: addDays(d, 1) };
    case "week": { const s = startOfWeek(d); return { from: s, to: addDays(s, 7) }; }
    case "month": { const w = monthWeeks(d.getFullYear(), d.getMonth()); return { from: w[0]![0]!, to: addDays(w.at(-1)![0]!, 7) }; }
    case "year": return { from: new Date(d.getFullYear(), 0, 1), to: new Date(d.getFullYear() + 1, 0, 1) };
  }
}

export function shiftAnchor(view: CalView, anchor: Date, dir: 1 | -1): Date {
  const d = startOfDay(anchor);
  switch (view) {
    case "day": return addDays(d, dir);
    case "week": return addDays(d, 7 * dir);
    case "month": return new Date(d.getFullYear(), d.getMonth() + dir, 1);
    case "year": return new Date(d.getFullYear() + dir, d.getMonth(), 1);
  }
}

/** "15 – 21 October 2026", "October 2026", "2026", "Thursday, 15 October 2026". */
export function periodLabel(view: CalView, anchor: Date): string {
  const d = startOfDay(anchor);
  switch (view) {
    case "day": return `${DAY_LONG[dayIndex(d)]}, ${d.getDate()} ${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;
    case "week": {
      const a = startOfWeek(d);
      const b = addDays(a, 6);
      if (a.getFullYear() !== b.getFullYear()) return `${a.getDate()} ${MONTH_SHORT[a.getMonth()]} ${a.getFullYear()} – ${b.getDate()} ${MONTH_SHORT[b.getMonth()]} ${b.getFullYear()}`;
      if (a.getMonth() !== b.getMonth()) return `${a.getDate()} ${MONTH_SHORT[a.getMonth()]} – ${b.getDate()} ${MONTH_SHORT[b.getMonth()]} ${b.getFullYear()}`;
      return `${a.getDate()} – ${b.getDate()} ${MONTH_LONG[b.getMonth()]} ${b.getFullYear()}`;
    }
    case "month": return `${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;
    case "year": return String(d.getFullYear());
  }
}

/** "Mon 15 Oct, 09:00" */
export function fmtRun(d: Date): string {
  return `${DAY_SHORT[dayIndex(d)]} ${d.getDate()} ${MONTH_SHORT[d.getMonth()]}, ${clockOf(d)}`;
}
