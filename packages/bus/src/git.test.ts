import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { beforeEach, describe, expect, it } from "vitest";
import { branchDiff, ensureStaging, MergeConflictError, publishBranch, publishToBase, revParse, squashApproved, stagingPath } from "./git.js";

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

describe("publishing an approved branch", () => {
  const author = { name: "Dana Reyes", email: "dana@example.com" };
  const squashAndMerge = async (branch: string, head: string, message: string) => {
    const c = await squashApproved(staging, "main", branch, head, message, author);
    await publishToBase(staging, "main", c);
    return c;
  };

  it("squashes the approved commits into one commit by the workspace author and publishes it", async () => {
    await agentCommit("fh/THR-0001", "a.txt", "one\nmore\n");
    const head = await agentCommit("fh/THR-0001", "b.txt", "two\nmore\n", "fh/THR-0001");
    const c = await squashAndMerge("fh/THR-0001", head, "Add more\n\nCo-Authored-By: Claude <noreply@anthropic.com>");
    expect(await revParse(upstream, "main")).toBe(c);
    expect(await sh(root, "--git-dir", upstream, "show", "main:a.txt")).toBe("one\nmore");
    expect(await sh(root, "--git-dir", upstream, "show", "main:b.txt")).toBe("two\nmore");
    const [who, parents] = (await sh(root, "--git-dir", upstream, "log", "-1", "--format=%an <%ae>%x1f%P", "main")).split("\x1f");
    expect(who).toBe("Dana Reyes <dana@example.com>");
    expect(parents!.split(" ")).toHaveLength(1);
    expect(await sh(root, "--git-dir", upstream, "log", "-1", "--format=%B", "main")).toContain("Co-Authored-By: Claude");
  });

  it("publishes a branch without touching the base branch", async () => {
    const before = await revParse(upstream, "main");
    const head = await agentCommit("fh/THR-0001", "a.txt", "one\nmore\n");
    const c = await squashApproved(staging, "main", "fh/THR-0001", head, "Add more", author);
    await publishBranch(staging, "fh/THR-0001", c);
    expect(await revParse(upstream, "fh/THR-0001")).toBe(c);
    expect(await revParse(upstream, "main")).toBe(before);
    // A later approval replaces the published branch.
    const next = await agentCommit("fh/THR-0001", "b.txt", "two\nlater\n", "fh/THR-0001");
    const c2 = await squashApproved(staging, "main", "fh/THR-0001", next, "Add more and later", author);
    await publishBranch(staging, "fh/THR-0001", c2);
    expect(await revParse(upstream, "fh/THR-0001")).toBe(c2);
  });

  it("refuses when the branch moved after approval was requested", async () => {
    const approved = await agentCommit("fh/THR-0001", "a.txt", "one\nmore\n");
    await agentCommit("fh/THR-0001", "b.txt", "two\nlater\n", "fh/THR-0001");
    await expect(squashApproved(staging, "main", "fh/THR-0001", approved, "m", author)).rejects.toThrow(MergeConflictError);
  });

  it("refuses conflicting changes instead of resolving them", async () => {
    const first = await agentCommit("fh/THR-0001", "a.txt", "first\n");
    await squashAndMerge("fh/THR-0001", first, "m1");
    const second = await agentCommit("fh/THR-0002", "a.txt", "second\n", "main~1");
    await expect(squashApproved(staging, "main", "fh/THR-0002", second, "m2", author)).rejects.toThrow(/conflicts/);
  });
});
