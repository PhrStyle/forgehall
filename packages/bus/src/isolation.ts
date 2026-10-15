import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { AGENT_BUS_URL, AGENT_NETWORK, agentNetworkExists } from "./agent-network.js";

const exec = promisify(execFile);

/** How an agent is isolated. Docker today; VMs (Incus) are planned and will use the same commands. */
export type Isolation = "docker" | "vm";

export const RUNNER_IMAGE = process.env.FORGEHALL_RUNNER_IMAGE ?? "forgehall/runner:dev";
export const claudeTokenPath = () => process.env.FORGEHALL_CLAUDE_TOKEN_FILE ?? join(homedir(), ".config", "forgehall", "claude-token");

const name = (ws: string, agent: string) => `fh-${ws}-${agent}`;

export class IsolationError extends Error {}

/**
 * The Claude token for an agent: CLAUDE_CODE_OAUTH_TOKEN if set, else the workspace's account
 * (Settings → Claude accounts), else the legacy file. Containers cannot use the interactive login.
 */
async function claudeToken(workspaceToken: string | null): Promise<string> {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (workspaceToken) return workspaceToken;
  try {
    const t = (await readFile(claudeTokenPath(), "utf8")).trim();
    if (t) return t;
  } catch {
    /* handled below */
  }
  throw new IsolationError(
    "No Claude account for this workspace. Create a token once with `claude setup-token`, then add it in the console: Settings → Claude accounts, and pick it for the workspace.",
  );
}

export interface StartOptions {
  workspace: string;
  agent: string;
  agentToken: string;
  isolation: Isolation;
  billing?: string;
  /** Token of the workspace's Claude account, if one is configured. */
  workspaceToken?: string | null;
  /** What the container was started with (account, image); the supervisor restarts it when this changes. */
  fingerprint?: string;
}

/** Starts (or restarts) the agent's isolated runner. */
export async function startAgent(o: StartOptions): Promise<string> {
  if (o.isolation === "vm") throw new IsolationError("VM isolation (Incus) is planned for phase 5; use --isolation docker for now.");
  try {
    await exec("docker", ["image", "inspect", RUNNER_IMAGE]);
  } catch {
    throw new IsolationError(`Runner image ${RUNNER_IMAGE} not found. Build it from the repository root:\n  docker build -f infra/docker/Dockerfile --target runner -t ${RUNNER_IMAGE} .`);
  }
  if (!(await agentNetworkExists())) {
    throw new IsolationError(`The ${AGENT_NETWORK} network does not exist: start the stack first:\n  docker compose -f infra/docker/compose.yaml -p forgehall up -d --build`);
  }
  const token = await claudeToken(o.workspaceToken ?? null);
  const n = name(o.workspace, o.agent);
  await exec("docker", ["rm", "-f", n]).catch(() => {});
  const env = [
    `AGENT_TOKEN=${o.agentToken}`,
    `CLAUDE_CODE_OAUTH_TOKEN=${token}`,
    `BUS_URL=${AGENT_BUS_URL}`,
    ...(o.billing ? [`FORGEHALL_BILLING=${o.billing}`] : []),
  ];
  const { stdout } = await exec("docker", [
    "run", "-d", "--name", n,
    "--network", AGENT_NETWORK,
    "--restart", "unless-stopped",
    "--label", "forgehall.workspace=" + o.workspace,
    "--label", "forgehall.agent=" + o.agent,
    "--label", "forgehall.fingerprint=" + (o.fingerprint ?? ""),
    "--label", "forgehall.started=" + new Date().toISOString(),
    "--volume", `${n}-work:/home/agent/work`,
    ...env.flatMap((e) => ["--env", e]),
    RUNNER_IMAGE,
  ]);
  return stdout.trim().slice(0, 12);
}

export async function stopAgent(workspace: string, agent: string): Promise<boolean> {
  try {
    await exec("docker", ["rm", "-f", name(workspace, agent)]);
    return true;
  } catch {
    return false;
  }
}

export async function listAgents(): Promise<string> {
  const { stdout } = await exec("docker", [
    "ps", "-a", "--filter", "label=forgehall.agent",
    "--format", "{{.Label \"forgehall.workspace\"}}/{{.Label \"forgehall.agent\"}}\t{{.Status}}\t{{.Names}}",
  ]);
  return stdout.trim() || "no isolated agents";
}

export interface AgentContainer {
  workspace: string;
  agent: string;
  name: string;
  running: boolean;
  /** Docker's state: running, restarting, exited, created, dead, paused. */
  state: string;
  status: string;
  fingerprint: string;
  startedAt: Date | null;
}

/** The agent containers on this machine, as the supervisor needs them. */
export async function agentContainers(): Promise<AgentContainer[]> {
  const { stdout } = await exec("docker", [
    "ps", "-a", "--filter", "label=forgehall.agent", "--no-trunc",
    "--format", "{{json .}}",
  ]);
  return stdout.split("\n").filter(Boolean).map((line) => {
    const c = JSON.parse(line) as { Names: string; State: string; Status: string; Labels: string };
    const labels = Object.fromEntries(c.Labels.split(",").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i), kv.slice(i + 1)];
    }));
    const started = labels["forgehall.started"];
    return {
      workspace: labels["forgehall.workspace"] ?? "",
      agent: labels["forgehall.agent"] ?? "",
      name: c.Names,
      running: c.State === "running",
      state: c.State,
      status: c.Status,
      fingerprint: labels["forgehall.fingerprint"] ?? "",
      startedAt: started ? new Date(started) : null,
    };
  });
}

/** Id of the runner image, so the supervisor can restart agents after it is rebuilt. */
export async function runnerImageId(): Promise<string | null> {
  try {
    return (await exec("docker", ["image", "inspect", "--format", "{{.Id}}", RUNNER_IMAGE])).stdout.trim() || null;
  } catch {
    return null;
  }
}
