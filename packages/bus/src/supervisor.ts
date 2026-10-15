import { agentContainers, IsolationError, runnerImageId, startAgent, stopAgent, type AgentContainer } from "./isolation.js";
import type { Store, SupervisorTarget } from "./store.js";

/**
 * The supervisor runs on the host (`fh supervise`), as the user, and is the only Forgehall
 * process that touches Docker for agents. The bus stores what the user wants (desired state,
 * restart requests); the supervisor makes the containers match. A compromised bus can at most
 * ask to start or stop agents that exist, always with the fixed runner image.
 */

export type Action = "start" | "stop" | "restart" | "none";

export interface Decision {
  action: Action;
  /** What the console shows: running, stopped, starting, restarting, updating, error. */
  state: string;
  detail: string | null;
}

/** Restarts after a crash wait longer each time: 10 s, 20 s, 40 s… up to 5 minutes. */
export const backoffMs = (failures: number) => Math.min(10_000 * 2 ** Math.max(0, failures - 1), 5 * 60_000);

/**
 * What to do with one agent. Pure, so it can be tested without Docker or Postgres.
 * `fingerprint` describes what a container should be started with (account, image); a container
 * started with another one is replaced, but only while the agent is not in a run.
 */
export function decide(
  t: Pick<SupervisorTarget, "desired_state" | "restart_requested_at" | "claude_account_id" | "busy">,
  c: Pick<AgentContainer, "running" | "state" | "status" | "fingerprint" | "startedAt"> | undefined,
  fingerprint: string,
  crash: { failures: number; lastStart: number } | undefined,
  now = Date.now(),
): Decision {
  if (t.desired_state === "stopped") {
    return c && (c.running || c.state === "restarting")
      ? { action: "stop", state: "stopping", detail: null }
      : { action: "none", state: "stopped", detail: null };
  }
  if (!t.claude_account_id) {
    return { action: c?.running ? "stop" : "none", state: "error", detail: "No Claude account for this workspace: pick one in Settings → Account per workspace." };
  }
  if (!c) return { action: "start", state: "starting", detail: null };
  if (c.state === "restarting") return { action: "none", state: "restarting", detail: `The container keeps exiting (${c.status}). See: docker logs` };
  if (!c.running) {
    if (crash && now - crash.lastStart < backoffMs(crash.failures)) {
      return { action: "none", state: "error", detail: `Exited (${c.status}); retrying in ${Math.ceil((backoffMs(crash.failures) - (now - crash.lastStart)) / 1000)} s` };
    }
    return { action: "start", state: "starting", detail: null };
  }
  if (t.restart_requested_at && (!c.startedAt || t.restart_requested_at > c.startedAt)) {
    return { action: "restart", state: "restarting", detail: null };
  }
  if (c.fingerprint !== fingerprint) {
    return t.busy
      ? { action: "none", state: "running", detail: "An update (account or runner image) applies when the current run ends." }
      : { action: "restart", state: "updating", detail: null };
  }
  return { action: "none", state: "running", detail: null };
}

/** What a container should be started with: the workspace's account and the runner image. */
export const fingerprintOf = (t: Pick<SupervisorTarget, "claude_account_id" | "account_hint">, image: string | null) =>
  `${t.claude_account_id ?? ""}:${t.account_hint ?? ""}:${image ?? ""}`;

export interface SuperviseOptions {
  intervalMs?: number;
  log?: (line: string) => void;
}

/** Runs until the process is stopped. Only one supervisor runs at a time (Postgres advisory lock). */
export async function supervise(store: Store, opts: SuperviseOptions = {}): Promise<never> {
  const log = opts.log ?? ((l: string) => console.log(`[supervisor] ${l}`));
  const lock = await store.sql.reserve();
  const [row] = await lock<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext('forgehall-supervisor')) AS ok`;
  if (!row?.ok) throw new Error("another supervisor is already running");
  log(`watching agents every ${(opts.intervalMs ?? 3000) / 1000} s`);

  const crashes = new Map<string, { failures: number; lastStart: number }>();
  for (;;) {
    try {
      await tick(store, crashes, log);
    } catch (e) {
      log(`error: ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 3000));
  }
}

async function tick(store: Store, crashes: Map<string, { failures: number; lastStart: number }>, log: (l: string) => void) {
  const [targets, containers, image] = await Promise.all([store.supervisorTargets(), agentContainers(), runnerImageId()]);
  const byName = new Map(containers.map((c) => [`${c.workspace}/${c.agent}`, c]));
  const reports: { workspaceId: string; id: string; state: string; detail: string | null }[] = [];

  for (const t of targets) {
    const key = `${t.workspace_id}/${t.id}`;
    const c = byName.get(key);
    const fingerprint = fingerprintOf(t, image);
    const d = decide(t, c, fingerprint, crashes.get(key));
    let state = d.state;
    let detail = d.detail;
    try {
      if (d.action === "stop") {
        await stopAgent(t.workspace_id, t.id);
        log(`${key}: stopped`);
        state = t.desired_state === "stopped" ? "stopped" : state;
      } else if (d.action === "start" || d.action === "restart") {
        const prev = crashes.get(key);
        // A container that exited on its own counts as a crash; a requested restart does not.
        if (d.action === "start" && c && !c.running) crashes.set(key, { failures: (prev?.failures ?? 0) + 1, lastStart: Date.now() });
        else crashes.delete(key);
        const account = await store.workspaceToken(t.workspace_id);
        await startAgent({
          workspace: t.workspace_id, agent: t.id, agentToken: await store.issueAgentToken(t.workspace_id, t.id),
          isolation: "docker", billing: process.env.FORGEHALL_BILLING, workspaceToken: account?.token ?? null, fingerprint,
        });
        log(`${key}: ${d.action === "restart" ? `restarted (${d.state})` : "started"}`);
        state = "running";
        detail = null;
      } else if (d.state === "running" && !d.detail) {
        crashes.delete(key);
      }
    } catch (e) {
      state = "error";
      detail = e instanceof IsolationError ? e.message : `${d.action} failed: ${(e as Error).message.split("\n")[0]}`;
      log(`${key}: ${detail}`);
    }
    reports.push({ workspaceId: t.workspace_id, id: t.id, state, detail });
  }

  // Containers of agents that no longer exist are removed.
  for (const c of containers) {
    if (!targets.some((t) => t.workspace_id === c.workspace && t.id === c.agent)) {
      await stopAgent(c.workspace, c.agent);
      log(`${c.workspace}/${c.agent}: removed (agent no longer exists)`);
    }
  }
  await store.reportContainers(reports);
}
