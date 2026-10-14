import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { branchDiff, ensureStaging, MergeConflictError, mergeAndPublish, revParse, stagingPath } from "./git.js";

const exec = promisify(execFile);
const sh = async (cwd: string, ...args: string[]) =>
  (await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], { cwd })).stdout.trim();

let root: string;
let upstream: string;
let staging: string;

/** A thread branch in staging with one commit that edits `file`. */
async function agentCommit(branch: string, file: string, content: string, from = "main"): Promise<string> {
  const wt = await mkdtemp(join(root, "wt-"));
  await sh(root, "clone", "-q", staging, wt);
  await sh(wt, "checkout", "-q", "-B", branch, `origin/${from}`);
  await writeFile(join(wt, file), content);
  await sh(wt, "commit", "-qam", `edit ${file}`);
  // Agents can only push fh/*; this test pushes directly as the runner would.
  await sh(wt, "push", "-q", "origin", `HEAD:refs/heads/${branch}`);
  return sh(wt, "rev-parse", "HEAD");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "fh-git-"));
  process.env.FORGEHALL_HOME = join(root, "home");
  upstream = join(root, "upstream.git");
  await sh(root, "init", "-q", "--bare", "-b", "main", upstream);
  const seed = join(root, "seed");
  await sh(root, "clone", "-q", upstream, seed);
  await writeFile(join(seed, "a.txt"), "one\n");
  await writeFile(join(seed, "b.txt"), "two\n");
  await sh(seed, "add", "-A");
  await sh(seed, "commit", "-qm", "initial");
  await sh(seed, "push", "-q", "origin", "HEAD:main");
  staging = await ensureStaging("dev", "app", upstream, "main");
});

describe("staging remote", () => {
  it("is created under FORGEHALL_HOME with the upstream base branch", async () => {
    expect(staging).toBe(stagingPath("dev", "app"));
    expect(await revParse(staging, "main")).toBe(await revParse(upstream, "main"));
  });

  it("rejects pushes outside fh/*", async () => {
    const wt = join(root, "evil");
    await sh(root, "clone", "-q", staging, wt);
    await writeFile(join(wt, "a.txt"), "hacked\n");
    await sh(wt, "commit", "-qam", "sneaky");
    await expect(sh(wt, "push", "-q", "origin", "HEAD:main")).rejects.toThrow(/fh\/\*/);
  });
});

describe("branchDiff", () => {
  it("lists commits, files and the patch of a thread branch", async () => {
    await agentCommit("fh/THR-0001", "a.txt", "one\nmore\n");
    const d = await branchDiff(staging, "main", "fh/THR-0001");
    expect(d.commits).toHaveLength(1);
    expect(d.files).toEqual([{ path: "a.txt", additions: 1, deletions: 0 }]);
    expect(d.patch).toContain("+more");
  });
});

describe("mergeAndPublish", () => {
  const author = { name: "Forgehall", email: "forgehall@localhost" };

  it("merges the approved commit and publishes it upstream", async () => {
    const head = await agentCommit("fh/THR-0001", "a.txt", "one\nmore\n");
    const merged = await mergeAndPublish(staging, "main", "fh/THR-0001", head, "Merge fh/THR-0001", author);
    expect(await revParse(upstream, "main")).toBe(merged);
    expect(await sh(root, "--git-dir", upstream, "show", "main:a.txt")).toBe("one\nmore");
  });

  it("refuses when the branch moved after approval was requested", async () => {
    const approved = await agentCommit("fh/THR-0001", "a.txt", "one\nmore\n");
    await agentCommit("fh/THR-0001", "b.txt", "two\nlater\n", "fh/THR-0001");
    await expect(mergeAndPublish(staging, "main", "fh/THR-0001", approved, "m", author)).rejects.toThrow(MergeConflictError);
  });

  it("refuses conflicting changes instead of resolving them", async () => {
    const first = await agentCommit("fh/THR-0001", "a.txt", "first\n");
    await mergeAndPublish(staging, "main", "fh/THR-0001", first, "m1", author);
    const second = await agentCommit("fh/THR-0002", "a.txt", "second\n", "main~1");
    await expect(mergeAndPublish(staging, "main", "fh/THR-0002", second, "m2", author)).rejects.toThrow(/conflicts/);
  });
});
