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
