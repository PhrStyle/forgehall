import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { forgehallHome } from "./git.js";

/**
 * The console API acts with the user's authority (approvals, settings), so it requires the admin
 * token. Agents share a network with the bus and must never hold it.
 */
export const adminTokenPath = () => join(forgehallHome(), "admin-token");

export async function ensureAdminToken(): Promise<string> {
  if (process.env.FORGEHALL_ADMIN_TOKEN) return process.env.FORGEHALL_ADMIN_TOKEN;
  try {
    const t = (await readFile(adminTokenPath(), "utf8")).trim();
    if (t) return t;
  } catch {
    /* created below */
  }
  const token = `fha_${randomBytes(24).toString("base64url")}`;
  await mkdir(dirname(adminTokenPath()), { recursive: true });
  await writeFile(adminTokenPath(), token + "\n", { mode: 0o600 });
  return token;
}

export function isAdmin(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
