import { execFile } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);

/** Where Forgehall keeps local state (staging remotes today; agent data later). */
export const forgehallHome = () => process.env.FORGEHALL_HOME ?? join(homedir(), ".forgehall");

/** Bare repository the bus hosts for one workspace repo: agents push here, never upstream. */
export const stagingRoot = (workspaceId: string) => join(forgehallHome(), "staging", workspaceId);
export const stagingPath = (workspaceId: string, repoId: string) => join(stagingRoot(workspaceId), `${repoId}.git`);

/** Branch that holds a thread's work. */
export const threadBranch = (threadId: string) => `fh/${threadId}`;

export async function git(repo: string, args: string[], input?: string): Promise<string> {
  const child = exec("git", ["-C", repo, ...args], { maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
  if (input !== undefined) child.child.stdin?.end(input);
  const { stdout } = await child;
  return stdout;
}

/** Agents may only push thread branches; everything else is the bus's job. */
const PRE_RECEIVE = `#!/bin/sh
# Installed by Forgehall. Agents push only thread branches (refs/heads/fh/*) and never delete.
zero=0000000000000000000000000000000000000000
while read old new ref; do
  case "$ref" in
    refs/heads/fh/*) ;;
    *) echo "forgehall: agents can only push refs/heads/fh/* (got $ref)"; exit 1 ;;
  esac
  if [ "$new" = "$zero" ]; then echo "forgehall: deleting branches is not allowed"; exit 1; fi
done
`;

/**
 * Creates (or refreshes) the staging remote for a repo: a bare clone of the upstream base
 * branch with a hook that only accepts thread branches.
 */
export async function ensureStaging(workspaceId: string, repoId: string, upstreamUrl: string, base: string): Promise<string> {
  const path = stagingPath(workspaceId, repoId);
  await mkdir(path, { recursive: true });
  await exec("git", ["init", "--bare", "--quiet", path]);
  await git(path, ["config", "http.receivepack", "true"]);
  await git(path, ["config", "receive.denyDeletes", "true"]);
  const remotes = (await git(path, ["remote"])).split("\n");
  if (!remotes.includes("upstream")) await git(path, ["remote", "add", "upstream", upstreamUrl]);
  else await git(path, ["remote", "set-url", "upstream", upstreamUrl]);
  await syncBase(path, base);
  await git(path, ["symbolic-ref", "HEAD", `refs/heads/${base}`]);
  const hook = join(path, "hooks", "pre-receive");
  await writeFile(hook, PRE_RECEIVE);
  await chmod(hook, 0o755);
  return path;
}

/** Brings the staging base branch up to date with upstream (humans may have merged things). */
export async function syncBase(stagingRepo: string, base: string): Promise<void> {
  await git(stagingRepo, ["fetch", "--quiet", "upstream", `+refs/heads/${base}:refs/heads/${base}`]);
}

export async function revParse(repo: string, ref: string): Promise<string | null> {
  try {
    return (await git(repo, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).trim() || null;
  } catch {
    return null;
  }
}

export interface BranchDiff {
  base: string;
  branch: string;
  baseSha: string | null;
  headSha: string | null;
  commits: { sha: string; author: string; date: string; subject: string }[];
  files: { path: string; additions: number; deletions: number }[];
  patch: string;
  truncated: boolean;
}

const MAX_PATCH = 400_000;

/** What a thread branch changes compared with the base branch (three-dot: since they diverged). */
export async function branchDiff(stagingRepo: string, base: string, branch: string): Promise<BranchDiff> {
  const baseSha = await revParse(stagingRepo, base);
  const headSha = await revParse(stagingRepo, branch);
  const empty: BranchDiff = { base, branch, baseSha, headSha, commits: [], files: [], patch: "", truncated: false };
  if (!baseSha || !headSha) return empty;
  const log = await git(stagingRepo, ["log", "--format=%H%x1f%an%x1f%aI%x1f%s", `${base}..${branch}`]);
  const commits = log.split("\n").filter(Boolean).map((l) => {
    const [sha = "", author = "", date = "", subject = ""] = l.split("\x1f");
    return { sha, author, date, subject };
  });
  const numstat = await git(stagingRepo, ["diff", "--numstat", `${base}...${branch}`]);
  const files = numstat.split("\n").filter(Boolean).map((l) => {
    const [a = "0", d = "0", ...p] = l.split("\t");
    return { path: p.join("\t"), additions: a === "-" ? 0 : Number(a), deletions: d === "-" ? 0 : Number(d) };
  });
  let patch = await git(stagingRepo, ["diff", `${base}...${branch}`]);
  const truncated = patch.length > MAX_PATCH;
  if (truncated) patch = patch.slice(0, MAX_PATCH);
  return { base, branch, baseSha, headSha, commits, files, patch, truncated };
}

export class MergeConflictError extends Error {}

/**
 * Merges a thread branch into the base branch without a working tree and publishes the
 * result upstream. Fails on conflicts instead of resolving them.
 */
export async function mergeAndPublish(
  stagingRepo: string,
  base: string,
  branch: string,
  expectedHead: string,
  message: string,
  author: { name: string; email: string },
): Promise<string> {
  await syncBase(stagingRepo, base);
  const head = await revParse(stagingRepo, branch);
  if (head !== expectedHead) throw new MergeConflictError(`the branch changed after approval was requested (${expectedHead.slice(0, 7)} → ${head?.slice(0, 7)})`);
  let tree: string;
  try {
    tree = (await git(stagingRepo, ["merge-tree", "--write-tree", base, branch])).split("\n")[0]!.trim();
  } catch (e) {
    throw new MergeConflictError(`the branch conflicts with ${base}; ask the agent to update it. ${(e as { stdout?: string }).stdout?.split("\n").slice(1, 6).join(" ") ?? ""}`);
  }
  const env = { GIT_AUTHOR_NAME: author.name, GIT_AUTHOR_EMAIL: author.email, GIT_COMMITTER_NAME: author.name, GIT_COMMITTER_EMAIL: author.email };
  const { stdout } = await exec("git", ["-C", stagingRepo, "commit-tree", tree, "-p", base, "-p", branch, "-m", message], { env: { ...process.env, ...env } });
  const merged = stdout.trim();
  await git(stagingRepo, ["push", "--quiet", "upstream", `${merged}:refs/heads/${base}`]);
  await git(stagingRepo, ["update-ref", `refs/heads/${base}`, merged]);
  return merged;
}
