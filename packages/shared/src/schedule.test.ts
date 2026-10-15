import { describe, expect, it } from "vitest";
import { describeRule, isFrequent, ruleToCron, ScheduleRule } from "./schedule.js";

describe("schedule rules", () => {
  it("turns rules into cron expressions", () => {
    expect(ruleToCron({ kind: "weekdays", time: "02:00" })).toBe("0 2 * * 1-5");
    expect(ruleToCron({ kind: "daily", time: "18:30" })).toBe("30 18 * * *");
    expect(ruleToCron({ kind: "days", days: [0, 6], time: "09:00" })).toBe("0 9 * * 1,0");
    expect(ruleToCron({ kind: "every", hours: 1, minute: 5 })).toBe("5 * * * *");
    expect(ruleToCron({ kind: "every", hours: 2, minute: 30 })).toBe("30 */2 * * *");
    expect(ruleToCron({ kind: "monthly", day: 15, months: [], time: "09:00" })).toBe("0 9 15 * *");
    expect(ruleToCron({ kind: "monthly", day: "last", months: [10, 1, 4, 7], time: "08:00" })).toBe("0 8 L 1,4,7,10 *");
    expect(ruleToCron({ kind: "once", at: "2026-11-03T09:00" })).toBeNull();
  });

  it("describes rules in plain words", () => {
    expect(describeRule({ kind: "weekdays", time: "02:00" })).toBe("Weekdays at 02:00");
    expect(describeRule({ kind: "days", days: [4, 0], time: "09:00" })).toBe("Mondays and Fridays at 09:00");
    expect(describeRule({ kind: "monthly", day: 1, months: [3, 9], time: "09:00" })).toBe("On the 1st of March and September at 09:00");
    expect(describeRule({ kind: "monthly", day: "last", months: [], time: "17:00" })).toBe("On the last day of every month at 17:00");
    expect(describeRule({ kind: "once", at: "2026-11-03T09:00" })).toBe("Once, on 2026-11-03 at 09:00");
  });

  it("validates input and marks frequent schedules", () => {
    expect(ScheduleRule.safeParse({ kind: "daily", time: "25:00" }).success).toBe(false);
    expect(ScheduleRule.safeParse({ kind: "days", days: [], time: "09:00" }).success).toBe(false);
    expect(isFrequent({ kind: "every", hours: 2, minute: 0 })).toBe(true);
    expect(isFrequent({ kind: "every", hours: 6, minute: 0 })).toBe(false);
  });
});
