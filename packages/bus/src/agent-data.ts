import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative, sep } from "node:path";
import { promisify } from "node:util";
import { forgehallHome } from "./git.js";

const exec = promisify(execFile);

/**
 * Agent data lives in one local git repository per workspace, with no remote (ADR 0006):
 *
 *   $FORGEHALL_HOME/workspaces/<ws>/
 *     knowledge.md                       shared by every agent of the workspace; written by the user only
 *     agents/<id>/memory/<name>.md       what the agent learned
 *     agents/<id>/skills/<name>/SKILL.md procedures the agent made into skills
 *
 * Git gives the learning history (what changed, when, from which thread) and undo. Only the bus
 * writes here: agents propose changes through MCP tools, the user edits knowledge in the console.
 */

export const workspaceDataPath = (workspaceId: string) => join(forgehallHome(), "workspaces", workspaceId);

const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const isSlug = (s: string) => SLUG.test(s);

export class AgentDataError extends Error {}

export interface DataFile {
  path: string;
  content: string;
}

export interface Skill {
  name: string;
  files: DataFile[];
}

export interface HistoryEntry {
  commit: string;
  at: string;
  author: string;
  subject: string;
  body: string;
  /** Files touched, relative to the agent's folder (memory/x.md, skills/y/SKILL.md) or the workspace (knowledge.md). */
  files: { status: string; path: string }[];
}

/** Limits that keep what each run receives small. */
export const LIMITS = { fileBytes: 16_000, memoryFiles: 60, skillFiles: 10, knowledgeBytes: 32_000 };

const IDENTITY = { GIT_AUTHOR_NAME: "Forgehall", GIT_AUTHOR_EMAIL: "forgehall@localhost", GIT_COMMITTER_NAME: "Forgehall", GIT_COMMITTER_EMAIL: "forgehall@localhost" };

async function git(repo: string, args: string[]): Promise<string> {
  const { stdout } = await exec("git", ["-C", repo, ...args], { maxBuffer: 32 * 1024 * 1024, env: { ...process.env, ...IDENTITY, GIT_TERMINAL_PROMPT: "0" } });
  return stdout;
}

/** Keeps a relative path inside its folder: no absolute paths, no "..". */
function inside(base: string, rel: string): string {
  const full = normalize(join(base, rel));
  if (rel.startsWith("/") || relative(base, full).startsWith("..") || full === base) throw new AgentDataError(`invalid path ${rel}`);
  return full;
}

export class AgentData {
  private locks = new Map<string, Promise<unknown>>();

  /** One writer per workspace repository at a time. */
  private serial<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(workspaceId) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(fn);
    this.locks.set(workspaceId, next);
    return next;
  }

  async ensureRepo(workspaceId: string): Promise<string> {
    const repo = workspaceDataPath(workspaceId);
    try {
      await stat(join(repo, ".git"));
      return repo;
    } catch {
      /* created below */
    }
    await mkdir(repo, { recursive: true });
    await exec("git", ["init", "--quiet", "-b", "main", repo]);
    await writeFile(join(repo, "knowledge.md"), "");
    await writeFile(join(repo, "README.md"), `# ${workspaceId}\n\nAgent memory, skills and shared knowledge for this Forgehall workspace. Managed by the bus; history is the learning log.\n`);
    await git(repo, ["add", "-A"]);
    await git(repo, ["commit", "--quiet", "-m", "Start the workspace data repository"]);
    return repo;
  }

  /** Writes and deletes files in one commit. Paths are relative to the repository. */
  async commit(workspaceId: string, changes: { write?: DataFile[]; remove?: string[] }, message: string, author = "Forgehall"): Promise<string | null> {
    return this.serial(workspaceId, async () => {
      const repo = await this.ensureRepo(workspaceId);
      for (const f of changes.write ?? []) {
        if (Buffer.byteLength(f.content) > LIMITS.fileBytes && !f.path.endsWith("knowledge.md")) throw new AgentDataError(`${f.path} is larger than ${LIMITS.fileBytes} bytes`);
        const full = inside(repo, f.path);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, f.content.endsWith("\n") || f.content === "" ? f.content : `${f.content}\n`);
      }
      for (const p of changes.remove ?? []) await rm(inside(repo, p), { recursive: true, force: true });
      await git(repo, ["add", "-A"]);
      const staged = (await git(repo, ["diff", "--cached", "--name-only"])).trim();
      if (!staged) return null;
      // The author is who made the change (an agent, or "you"); the committer stays Forgehall.
      await git(repo, ["-c", `user.name=${author.replace(/[^\w .-]/g, "")}`, "commit", "--quiet", "--author", `${author.replace(/[^\w .-]/g, "")} <${author.replace(/[^\w.-]/g, "")}@forgehall.invalid>`, "-m", message]);
      return (await git(repo, ["rev-parse", "HEAD"])).trim();
    });
  }

  async knowledge(workspaceId: string): Promise<string> {
    const repo = await this.ensureRepo(workspaceId);
    return readFile(join(repo, "knowledge.md"), "utf8").catch(() => "");
  }

  async setKnowledge(workspaceId: string, content: string): Promise<string | null> {
    if (Buffer.byteLength(content) > LIMITS.knowledgeBytes) throw new AgentDataError(`knowledge is larger than ${LIMITS.knowledgeBytes} bytes`);
    return this.commit(workspaceId, { write: [{ path: "knowledge.md", content }] }, "Update the workspace knowledge", "you");
  }

  private agentDir = (agentId: string) => join("agents", agentId);

  async memory(workspaceId: string, agentId: string): Promise<DataFile[]> {
    const repo = await this.ensureRepo(workspaceId);
    const dir = join(repo, this.agentDir(agentId), "memory");
    const names = (await readdir(dir).catch(() => [] as string[])).filter((n) => n.endsWith(".md")).sort();
    return Promise.all(names.map(async (n) => ({ path: `memory/${n}`, content: await readFile(join(dir, n), "utf8") })));
  }

  async skills(workspaceId: string, agentId: string): Promise<Skill[]> {
    const repo = await this.ensureRepo(workspaceId);
    const dir = join(repo, this.agentDir(agentId), "skills");
    const names = (await readdir(dir, { withFileTypes: true }).catch(() => [])).filter((d) => d.isDirectory()).map((d) => d.name).sort();
    const out: Skill[] = [];
    for (const name of names) {
      const files: DataFile[] = [];
      for (const f of (await readdir(join(dir, name), { recursive: true, withFileTypes: true })).filter((e) => e.isFile())) {
        const full = join(f.parentPath ?? (f as unknown as { path: string }).path, f.name);
        files.push({ path: relative(join(dir, name), full).split(sep).join("/"), content: await readFile(full, "utf8") });
      }
      out.push({ name, files: files.sort((a, b) => (a.path === "SKILL.md" ? -1 : b.path === "SKILL.md" ? 1 : a.path.localeCompare(b.path))) });
    }
    return out;
  }

  /** Learning history of an agent (or of the knowledge file), newest first. */
  async history(workspaceId: string, agentId: string | null, limit = 100): Promise<HistoryEntry[]> {
    const repo = await this.ensureRepo(workspaceId);
    const scope = agentId ? this.agentDir(agentId) : "knowledge.md";
    const out = await git(repo, ["log", `-n${limit}`, "--name-status", "--format=%x1e%H%x1f%aI%x1f%an%x1f%s%x1f%b%x1f", "--", scope]);
    return out.split("\x1e").filter((c) => c.trim()).map((chunk) => {
      const [commit = "", at = "", author = "", subject = "", body = "", rest = ""] = chunk.split("\x1f");
      const files = rest.split("\n").filter(Boolean).map((l) => {
        const [status = "", ...p] = l.split("\t");
        const path = p.at(-1) ?? "";
        return { status: status[0] ?? "", path: agentId ? path.replace(`${scope}/`, "") : path };
      });
      return { commit, at, author, subject, body: body.trim(), files };
    });
  }

  /** The change a history entry made, as a unified diff. */
  async show(workspaceId: string, commit: string): Promise<string> {
    if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new AgentDataError("invalid commit");
    const repo = await this.ensureRepo(workspaceId);
    return git(repo, ["show", "--format=", "--patch", commit]);
  }

  /** Undoes one history entry with a new commit (the history keeps both). */
  async revert(workspaceId: string, commit: string, why: string): Promise<string | null> {
    if (!/^[0-9a-f]{7,40}$/.test(commit)) throw new AgentDataError("invalid commit");
    return this.serial(workspaceId, async () => {
      const repo = await this.ensureRepo(workspaceId);
      try {
        await git(repo, ["revert", "--no-edit", "--no-commit", commit]);
      } catch (e) {
        await git(repo, ["revert", "--abort"]).catch(() => {});
        throw new AgentDataError(`cannot undo ${commit.slice(0, 7)}: a later change touches the same lines; undo that one first`);
      }
      const subject = (await git(repo, ["log", "-1", "--format=%s", commit])).trim();
      // Undo is the user's action, from the console.
      await git(repo, ["commit", "--quiet", "--author", "you <you@forgehall.invalid>", "-m", `Undo: ${subject}`, "-m", `${why}\n\nReverts ${commit}.`]);
      return (await git(repo, ["rev-parse", "HEAD"])).trim();
    });
  }
}
