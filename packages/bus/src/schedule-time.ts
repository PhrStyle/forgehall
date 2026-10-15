import { ruleToCron, type ScheduleRule } from "@forgehall/shared";
import cronParser from "cron-parser";

/**
 * Date math for schedules: when a rule runs, in its timezone. Pure, so it is tested without
 * Postgres. Cron evaluation is cron-parser's, which handles timezones and daylight saving.
 */

/** UTC instant of a local wall-clock time ("YYYY-MM-DDTHH:MM") in a timezone. */
export function localToUtc(at: string, timezone: string): Date {
  const [date, time] = at.split("T") as [string, string];
  const [y, mo, d] = date.split("-").map(Number) as [number, number, number];
  const [h, mi] = time.split(":").map(Number) as [number, number];
  // The first time this minute/hour/day/month occurs in the zone from the start of that day, UTC-wise.
  const it = cronParser.parseExpression(`${mi} ${h} ${d} ${mo} *`, { tz: timezone, currentDate: new Date(Date.UTC(y, mo - 1, d) - 36 * 3600_000) });
  return it.next().toDate();
}

/** Next run strictly after `after`, or null (a past one-off). */
export function nextRun(rule: ScheduleRule, timezone: string, after: Date): Date | null {
  if (rule.kind === "once") {
    const at = localToUtc(rule.at, timezone);
    return at > after ? at : null;
  }
  return cronParser.parseExpression(ruleToCron(rule)!, { tz: timezone, currentDate: after }).next().toDate();
}

/** Runs in [from, to), at most `limit`. */
export function runsBetween(rule: ScheduleRule, timezone: string, from: Date, to: Date, limit = 1000): Date[] {
  if (rule.kind === "once") {
    const at = localToUtc(rule.at, timezone);
    return at >= from && at < to ? [at] : [];
  }
  const it = cronParser.parseExpression(ruleToCron(rule)!, { tz: timezone, currentDate: new Date(from.getTime() - 1), endDate: to });
  const out: Date[] = [];
  while (out.length < limit && it.hasNext()) {
    const d = it.next().toDate();
    if (d >= to) break;
    out.push(d);
  }
  return out;
}

/** A timezone name the runtime knows, e.g. America/Sao_Paulo. */
export function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
