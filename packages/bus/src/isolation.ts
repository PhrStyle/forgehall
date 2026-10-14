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

/** Reads the Claude token made with `claude setup-token`; containers cannot use the interactive login. */
async function claudeToken(): Promise<string> {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try {
    const t = (await readFile(claudeTokenPath(), "utf8")).trim();
    if (t) return t;
  } catch {
    /* handled below */
  }
  throw new IsolationError(
    `No Claude token for isolated agents. Create one once with \`claude setup-token\` and save it with:\n` +
      `  install -D -m 600 /dev/null ${claudeTokenPath()} && $EDITOR ${claudeTokenPath()}`,
  );
}

export interface StartOptions {
  workspace: string;
  agent: string;
  agentToken: string;
  isolation: Isolation;
  billing?: string;
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
  const token = await claudeToken();
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
