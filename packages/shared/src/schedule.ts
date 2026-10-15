import { z } from "zod";

/**
 * When a schedule runs, in plain terms. The console edits this; the bus turns it into a cron
 * expression (or a single date for `once`) and evaluates it in the schedule's timezone.
 * Days of the week are 0 = Monday … 6 = Sunday; months are 1 … 12.
 */
const Time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time as HH:MM");

export const ScheduleRule = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("daily"), time: Time }),
  z.object({ kind: z.literal("weekdays"), time: Time }),
  z.object({ kind: z.literal("days"), days: z.array(z.number().int().min(0).max(6)).min(1), time: Time }),
  z.object({ kind: z.literal("every"), hours: z.number().int().min(1).max(12), minute: z.number().int().min(0).max(59) }),
  /** Day N (or the last day) of the given months; no months = every month. Yearly = one month. */
  z.object({
    kind: z.literal("monthly"),
    day: z.union([z.number().int().min(1).max(31), z.literal("last")]),
    months: z.array(z.number().int().min(1).max(12)).default([]),
    time: Time,
  }),
  /** A single run at a local date and time, e.g. "2026-11-03T09:00". */
  z.object({ kind: z.literal("once"), at: z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/, "date as YYYY-MM-DDTHH:MM") }),
]);
export type ScheduleRule = z.infer<typeof ScheduleRule>;

const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const hm = (time: string) => time.split(":").map(Number) as [number, number];
const list = (items: string[]) => (items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`);
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** Cron expression (minute hour day-of-month month day-of-week) for a rule; null for `once`. */
export function ruleToCron(r: ScheduleRule): string | null {
  switch (r.kind) {
    case "once":
      return null;
    case "every":
      return r.hours === 1 ? `${r.minute} * * * *` : `${r.minute} */${r.hours} * * *`;
    case "monthly": {
      const [h, m] = hm(r.time);
      const months = r.months.length ? [...new Set(r.months)].sort((a, b) => a - b).join(",") : "*";
      return `${m} ${h} ${r.day === "last" ? "L" : r.day} ${months} *`;
    }
    default: {
      const [h, m] = hm(r.time);
      // Cron counts Sunday as 0; rules count Monday as 0.
      const dow = r.kind === "daily" ? "*" : r.kind === "weekdays" ? "1-5" : [...new Set(r.days)].sort((a, b) => a - b).map((d) => (d + 1) % 7).join(",");
      return `${m} ${h} * * ${dow}`;
    }
  }
}

/** The rule in plain English, e.g. "Weekdays at 02:00" or "On the 15th of every month at 09:00". */
export function describeRule(r: ScheduleRule): string {
  switch (r.kind) {
    case "daily":
      return `Every day at ${r.time}`;
    case "weekdays":
      return `Weekdays at ${r.time}`;
    case "days":
      return `${list([...new Set(r.days)].sort((a, b) => a - b).map((d) => `${DAY_NAMES[d]}s`))} at ${r.time}`;
    case "every":
      return `${r.hours === 1 ? "Every hour" : `Every ${r.hours} hours`} at :${String(r.minute).padStart(2, "0")}`;
    case "monthly": {
      const day = r.day === "last" ? "the last day" : `the ${ordinal(r.day)}`;
      const months = r.months.length ? list([...new Set(r.months)].sort((a, b) => a - b).map((m) => MONTH_NAMES[m - 1]!)) : "every month";
      return `On ${day} of ${months} at ${r.time}`;
    }
    case "once":
      return `Once, on ${r.at.replace("T", " at ")}`;
  }
}

/** Schedules that run every hour or two are drawn as bands, not as one block per run. */
export const isFrequent = (r: ScheduleRule) => r.kind === "every" && r.hours <= 2;
