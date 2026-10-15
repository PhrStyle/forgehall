// Sample data for the Schedules draft. Replace with real queries once the backend exists.
import type { Rule } from "./cron";

export interface MockAgent { id: string; name: string; role: string }
export interface MockRepo { id: string; base_branch: string }
export type ResultStatus = "passed" | "issues" | "skipped";

export interface Schedule {
  id: string;
  agent: string;
  title: string;
  body: string;
  repo: string; // "" = none
  rule: Rule;
  tz: string;
  thread: "new" | "same";
  skipIfOpen: boolean;
  skipAbovePct: number | null;
  enabled: boolean;
  last: { status: ResultStatus; label: string } | null;
}

/** A finished occurrence in the current week. `day` is 0 = Monday. Past occurrences without a record are shown as passed. */
export interface RunResult { scheduleId: string; day: number; time: string; status: ResultStatus; reason?: string }

export const WORKSPACE = "Sandbox";

export const AGENTS: MockAgent[] = [
  { id: "atlas", name: "Atlas", role: "Dev" },
  { id: "vigil", name: "Vigil", role: "QA" },
  { id: "scout", name: "Scout", role: "Research" },
  { id: "quill", name: "Quill", role: "Writer" },
  { id: "ledger", name: "Ledger", role: "Data" },
  { id: "probe", name: "Probe", role: "QA" },
];

export const REPOS: MockRepo[] = [{ id: "checkout-app", base_branch: "main" }];

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

type Last = Schedule["last"];
const P: Last = { status: "passed", label: "Passed" };
const I: Last = { status: "issues", label: "Found issues" };
const S: Last = { status: "skipped", label: "Skipped" };
function mk(id: string, agent: string, title: string, rule: Rule, o: { repo?: string; thread?: "new" | "same"; skip?: number | null; on?: boolean; last?: Last } = {}): Schedule {
  return { id, agent, title, body: `${title}: sample instructions for the agent.`, repo: o.repo ?? "", rule, tz, thread: o.thread ?? "new", skipIfOpen: true, skipAbovePct: o.skip ?? null, enabled: o.on ?? true, last: o.last === undefined ? P : o.last };
}
const wk = (time: string): Rule => ({ repeat: { kind: "weekdays" }, time });
const on = (time: string, ...days: number[]): Rule => ({ repeat: { kind: "days", days }, time });
const CA = "checkout-app";

export const INITIAL_SCHEDULES: Schedule[] = [
  mk("s1", "vigil", "Nightly regression", wk("02:00"), { repo: CA }),
  mk("s2", "atlas", "Weekly dependency check", on("09:00", 0), { repo: CA, skip: 70, last: S }),
  mk("s3", "atlas", "Daily digest", wk("18:00"), { thread: "same", on: false }),
  mk("s4", "vigil", "Smoke test", { repeat: { kind: "every", hours: 1 }, time: "00:00" }, { repo: CA }),
  mk("s5", "probe", "Dead-link crawl", { repeat: { kind: "every", hours: 2 }, time: "00:30" }, { last: I }),
  mk("s6", "probe", "Lint sweep", wk("02:00"), { repo: CA, last: I }),
  mk("s7", "scout", "Competitor scan", on("09:00", 0), { thread: "same" }),
  mk("s8", "quill", "Release notes draft", on("09:00", 0), { repo: CA }),
  mk("s9", "ledger", "Weekly metrics", on("09:30", 0), { skip: 70 }),
  mk("s10", "ledger", "Data quality check", wk("06:00"), { last: I }),
  mk("s11", "quill", "Changelog proofread", on("15:00", 4), { repo: CA, on: false }),
  mk("s12", "scout", "Market digest", wk("08:00"), { thread: "same" }),
  mk("s13", "ledger", "Backup verification", { repeat: { kind: "daily" }, time: "03:30" }),
  mk("s14", "probe", "Flaky test triage", on("14:00", 1, 3), { repo: CA, last: null }),
];

export const RESULTS: RunResult[] = [
  { scheduleId: "s1", day: 0, time: "02:00", status: "passed" },
  { scheduleId: "s1", day: 1, time: "02:00", status: "issues" },
  { scheduleId: "s2", day: 0, time: "09:00", status: "skipped", reason: "Weekly usage was above 70%" },
  { scheduleId: "s1", day: 2, time: "02:00", status: "passed" },
  { scheduleId: "s6", day: 1, time: "02:00", status: "issues" },
  { scheduleId: "s9", day: 0, time: "09:30", status: "skipped", reason: "Weekly usage was above 70%" },
  { scheduleId: "s10", day: 2, time: "06:00", status: "issues" },
];

export const STATUS_GLYPH: Record<ResultStatus, string> = { passed: "✓", issues: "⚠", skipped: "↷" };
export const STATUS_TEXT: Record<ResultStatus, string> = { passed: "Passed", issues: "Found issues", skipped: "Skipped" };
