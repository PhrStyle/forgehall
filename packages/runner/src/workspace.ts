import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import type { RunClaim } from "@forgehall/shared";

const exec = promisify(execFile);

export interface RepoCheckout {
  dir: string;
  /** Runs git with the agent's bus credentials, which are never written to disk. */
  git: (args: string[]) => Promise<string>;
}

/** Masks credentials in text that may reach logs, the bus or the console. */
export const redact = (s: string) => s.replace(/\b(Basic|Bearer) [A-Za-z0-9+/=._~-]+/g, "$1 ***");

/**
 * Agents never run git: the runner checks out the thread branch before a run and commits and
 * pushes the result after it. Credentials go in a per-command header passed through the
 * environment, never into .git/config or the command line (which ends up in error messages).
 */
export async function prepareCheckout(claim: RunClaim, busUrl: string, agentToken: string, workRoot: string): Promise<RepoCheckout> {
  const repo = claim.repo!;
  const dir = join(workRoot, claim.threadId);
  const auth = Buffer.from(`${claim.agentId}:${agentToken}`).toString("base64");
  const env = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${auth}`,
  };
  const git = async (args: string[], cwd = dir) => {
    try {
      return (await exec("git", args, { cwd, maxBuffer: 32 * 1024 * 1024, env })).stdout;
    } catch (e) {
      // Report git's own reason (stderr), not the command line.
      const stderr = String((e as { stderr?: string }).stderr ?? "").trim();
      throw new Error(redact(`git ${args[0]}: ${stderr.split("\n").pop() || (e as Error).message}`));
    }
  };

  const exists = await access(join(dir, ".git")).then(() => true, () => false);
  if (!exists) {
    await mkdir(workRoot, { recursive: true });
    await git(["clone", "--quiet", `${busUrl}/git/${claim.workspaceId}/${repo.id}.git`, dir], workRoot);
  }
  await git(["config", "user.name", `${claim.agentId} (forgehall)`]);
  await git(["config", "user.email", `${claim.agentId}@forgehall.invalid`]);
  await git(["fetch", "--quiet", "--prune", "origin"]);
  // Start from what the thread branch holds now (another agent may have pushed), or from the base.
  // Leftovers of a failed run are discarded on purpose.
  await git(["reset", "--quiet", "--hard"]);
  await git(["clean", "-fdq"]);
  const remoteBranch = await git(["ls-remote", "--heads", "origin", repo.branch]);
  await git(["checkout", "--quiet", "-B", repo.branch, remoteBranch.trim() ? `origin/${repo.branch}` : `origin/${repo.base}`]);
  return { dir, git: (args) => git(args) };
}

/** Commits whatever the agent changed and pushes it to the thread branch. Returns the new commit, if any. */
export async function commitAndPush(co: RepoCheckout, claim: RunClaim): Promise<string | null> {
  await co.git(["add", "-A"]);
  const staged = await co.git(["diff", "--cached", "--name-only"]);
  if (!staged.trim()) return null;
  await co.git(["commit", "--quiet", "-m", `${claim.agentId}: ${claim.threadId} (run ${claim.runId})`]);
  await co.git(["push", "--quiet", "origin", `HEAD:refs/heads/${claim.repo!.branch}`]);
  return (await co.git(["rev-parse", "HEAD"])).trim();
}
