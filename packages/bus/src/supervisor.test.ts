import { describe, expect, it } from "vitest";
import { backoffMs, decide } from "./supervisor.js";

const now = Date.parse("2026-10-15T12:00:00Z");
const target = { desired_state: "running" as const, restart_requested_at: null, claude_account_id: "team", busy: false };
const running = { running: true, state: "running", status: "Up 5 minutes", fingerprint: "fp", startedAt: new Date(now - 300_000) };
const exited = { ...running, running: false, state: "exited", status: "Exited (1) 3 seconds ago" };

describe("supervisor decide", () => {
  it("starts an agent that should run and has no container", () => {
    expect(decide(target, undefined, "fp", undefined, now).action).toBe("start");
  });

  it("leaves a stopped agent stopped, also after a reboot", () => {
    expect(decide({ ...target, desired_state: "stopped" }, undefined, "fp", undefined, now)).toMatchObject({ action: "none", state: "stopped" });
    expect(decide({ ...target, desired_state: "stopped" }, exited, "fp", undefined, now).action).toBe("none");
    expect(decide({ ...target, desired_state: "stopped" }, running, "fp", undefined, now).action).toBe("stop");
  });

  it("does nothing for a healthy container", () => {
    expect(decide(target, running, "fp", undefined, now)).toEqual({ action: "none", state: "running", detail: null });
  });

  it("restarts on request, once", () => {
    expect(decide({ ...target, restart_requested_at: new Date(now - 1000) }, running, "fp", undefined, now).action).toBe("restart");
    expect(decide({ ...target, restart_requested_at: new Date(now - 600_000) }, running, "fp", undefined, now).action).toBe("none");
  });

  it("applies a new account or image only between runs", () => {
    expect(decide(target, running, "fp2", undefined, now)).toMatchObject({ action: "restart", state: "updating" });
    expect(decide({ ...target, busy: true }, running, "fp2", undefined, now).action).toBe("none");
  });

  it("restarts a crashed container with backoff", () => {
    expect(decide(target, exited, "fp", undefined, now).action).toBe("start");
    expect(decide(target, exited, "fp", { failures: 1, lastStart: now - 5_000 }, now)).toMatchObject({ action: "none", state: "error" });
    expect(decide(target, exited, "fp", { failures: 1, lastStart: now - 11_000 }, now).action).toBe("start");
    expect(backoffMs(10)).toBe(5 * 60_000);
  });

  it("reports a missing Claude account instead of starting", () => {
    expect(decide({ ...target, claude_account_id: null }, undefined, "fp", undefined, now)).toMatchObject({ action: "none", state: "error" });
  });
});
