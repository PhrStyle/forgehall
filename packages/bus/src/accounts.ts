import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { forgehallHome } from "./git.js";

/**
 * Claude tokens (from `claude setup-token`) are kept in files readable only by the user, never in
 * the database and never returned by the API. They stay on this machine and are only handed to
 * the user's own agent containers.
 */
export const accountsDir = () => join(forgehallHome(), "secrets", "claude");
export const accountTokenPath = (id: string) => join(accountsDir(), `${id}.token`);

export const PLANS = ["pro", "max-5x", "max-20x", "team-standard", "team-premium", "enterprise"] as const;

export async function writeAccountToken(id: string, token: string): Promise<void> {
  await mkdir(accountsDir(), { recursive: true, mode: 0o700 });
  await chmod(join(forgehallHome(), "secrets"), 0o700).catch(() => {});
  await writeFile(accountTokenPath(id), token.trim() + "\n", { mode: 0o600 });
  await chmod(accountTokenPath(id), 0o600);
}

export async function readAccountToken(id: string): Promise<string | null> {
  try {
    return (await readFile(accountTokenPath(id), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

export async function removeAccountToken(id: string): Promise<void> {
  await rm(accountTokenPath(id), { force: true });
}

/**
 * The bus's write credential on a host (GitHub, Azure DevOps), per workspace. Same rules as
 * Claude tokens: a 0600 file, never in the database, never returned by the API, never given to agents.
 */
export const providerTokenPath = (workspaceId: string, provider: string) => join(forgehallHome(), "secrets", "providers", workspaceId, `${provider}.token`);

export async function writeProviderToken(workspaceId: string, provider: string, token: string): Promise<void> {
  const dir = join(forgehallHome(), "secrets", "providers", workspaceId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(join(forgehallHome(), "secrets"), 0o700).catch(() => {});
  await chmod(join(forgehallHome(), "secrets", "providers"), 0o700).catch(() => {});
  await writeFile(providerTokenPath(workspaceId, provider), token + "\n", { mode: 0o600 });
  await chmod(providerTokenPath(workspaceId, provider), 0o600);
}

export async function readProviderToken(workspaceId: string, provider: string): Promise<string | null> {
  try {
    return (await readFile(providerTokenPath(workspaceId, provider), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

export async function removeProviderToken(workspaceId: string, provider: string): Promise<void> {
  await rm(providerTokenPath(workspaceId, provider), { force: true });
}

/** Host tokens given to one agent (read or write, as the token allows). Same file rules. */
export const agentTokenPath = (workspaceId: string, agentId: string, provider: string) =>
  join(forgehallHome(), "secrets", "agents", workspaceId, agentId, `${provider}.token`);

export async function writeAgentHostToken(workspaceId: string, agentId: string, provider: string, token: string): Promise<void> {
  const dir = join(forgehallHome(), "secrets", "agents", workspaceId, agentId);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  for (const d of [join(forgehallHome(), "secrets"), join(forgehallHome(), "secrets", "agents"), join(forgehallHome(), "secrets", "agents", workspaceId)]) {
    await chmod(d, 0o700).catch(() => {});
  }
  await writeFile(agentTokenPath(workspaceId, agentId, provider), token + "\n", { mode: 0o600 });
  await chmod(agentTokenPath(workspaceId, agentId, provider), 0o600);
}

export async function readAgentHostToken(workspaceId: string, agentId: string, provider: string): Promise<string | null> {
  try {
    return (await readFile(agentTokenPath(workspaceId, agentId, provider), "utf8")).trim() || null;
  } catch {
    return null;
  }
}

export async function removeAgentHostToken(workspaceId: string, agentId: string, provider: string): Promise<void> {
  await rm(agentTokenPath(workspaceId, agentId, provider), { force: true });
}
