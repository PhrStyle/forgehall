import { describe, expect, it } from "vitest";
import { isTimezone, localToUtc, nextRun, runsBetween } from "./schedule-time.js";

const SP = "America/Sao_Paulo"; // UTC-3, no daylight saving since 2019
const at = (iso: string) => new Date(iso);

describe("schedule time", () => {
  it("evaluates rules in the schedule's timezone", () => {
    expect(nextRun({ kind: "weekdays", time: "02:00" }, SP, at("2026-10-15T12:00:00Z"))!.toISOString()).toBe("2026-10-16T05:00:00.000Z");
    expect(nextRun({ kind: "monthly", day: "last", months: [1, 4, 7, 10], time: "08:00" }, SP, at("2026-10-15T12:00:00Z"))!.toISOString()).toBe("2026-10-31T11:00:00.000Z");
    expect(nextRun({ kind: "monthly", day: 1, months: [3], time: "09:00" }, "UTC", at("2026-10-15T12:00:00Z"))!.toISOString()).toBe("2027-03-01T09:00:00.000Z");
  });

  it("runs a one-off once, then never", () => {
    expect(localToUtc("2026-11-03T09:00", SP).toISOString()).toBe("2026-11-03T12:00:00.000Z");
    expect(nextRun({ kind: "once", at: "2026-11-03T09:00" }, SP, at("2026-10-15T12:00:00Z"))!.toISOString()).toBe("2026-11-03T12:00:00.000Z");
    expect(nextRun({ kind: "once", at: "2026-11-03T09:00" }, SP, at("2026-11-03T12:00:00Z"))).toBeNull();
  });

  it("lists runs in a range", () => {
    const week = runsBetween({ kind: "weekdays", time: "02:00" }, SP, at("2026-10-12T00:00:00Z"), at("2026-10-19T00:00:00Z"));
    expect(week.map((d) => d.toISOString())).toEqual([
      "2026-10-12T05:00:00.000Z", "2026-10-13T05:00:00.000Z", "2026-10-14T05:00:00.000Z", "2026-10-15T05:00:00.000Z", "2026-10-16T05:00:00.000Z",
    ]);
    expect(runsBetween({ kind: "every", hours: 1, minute: 0 }, "UTC", at("2026-10-12T00:00:00Z"), at("2026-10-13T00:00:00Z"))).toHaveLength(24);
    expect(runsBetween({ kind: "every", hours: 1, minute: 0 }, "UTC", at("2026-10-12T00:00:00Z"), at("2026-10-20T00:00:00Z"), 10)).toHaveLength(10);
  });

  it("knows valid timezones", () => {
    expect(isTimezone(SP)).toBe(true);
    expect(isTimezone("Mars/Olympus")).toBe(false);
  });
});
