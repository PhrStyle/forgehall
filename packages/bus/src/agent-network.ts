import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

/**
 * Isolated agents and the bus share this Docker network (created by the stack's compose file),
 * where agents reach the bus as http://bus:4545. Nothing on it may use the console API: that
 * requires the admin token, which agents never get.
 */
export const AGENT_NETWORK = process.env.FORGEHALL_AGENT_NETWORK ?? "forgehall-agents";
export const AGENT_BUS_URL = process.env.FORGEHALL_AGENT_BUS_URL ?? "http://bus:4545";

export async function agentNetworkExists(): Promise<boolean> {
  try {
    await exec("docker", ["network", "inspect", AGENT_NETWORK]);
    return true;
  } catch {
    return false;
  }
}

/** Rootless Docker maps the container's root to the calling user, so the stack runs as root there. */
export async function dockerIsRootless(): Promise<boolean> {
  try {
    const { stdout } = await exec("docker", ["info", "--format", "{{.SecurityOptions}}"]);
    return stdout.includes("rootless");
  } catch {
    return false;
  }
}
