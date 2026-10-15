import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
import type { RunClaim } from "@forgehall/shared";

/**
 * Installs what the agent knows before each run, using Claude Code's own mechanisms:
 * - user memory `~/.claude/CLAUDE.md`: the workspace knowledge and the agent's memory files;
 * - user skills `~/.claude/skills/<name>/`: the agent's skills.
 * Both are rewritten on every run, so a forgotten memory or a removed skill is gone next time.
 * `home` is the agent's home directory inside its isolated container.
 */
export async function installContext(context: RunClaim["context"], home: string): Promise<void> {
  const claudeDir = join(home, ".claude");
  await mkdir(claudeDir, { recursive: true });
  await writeFile(join(claudeDir, "CLAUDE.md"), renderMemory(context));

  const skillsDir = join(claudeDir, "skills");
  await rm(skillsDir, { recursive: true, force: true });
  for (const skill of context.skills) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(skill.name)) continue;
    const base = join(skillsDir, skill.name);
    for (const f of skill.files) {
      const full = normalize(join(base, f.path));
      if (relative(base, full).startsWith("..")) continue;
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, f.content);
    }
  }
}

export function renderMemory(context: RunClaim["context"]): string {
  const parts = ["<!-- Written by Forgehall before each run. Edits here are lost: use the remember and forget tools. -->", ""];
  if (context.knowledge.trim()) {
    parts.push("# Workspace knowledge", "", "Shared by every agent of this workspace, written by the user.", "", context.knowledge.trim(), "");
  }
  parts.push("# Your memory", "");
  if (context.memory.length === 0) {
    parts.push("Nothing yet. Use the remember tool when you learn something worth keeping for future work.", "");
  } else {
    parts.push("What you learned in earlier threads. Each entry is a file you can update with remember or delete with forget.", "");
    for (const m of context.memory) parts.push(`## ${m.path.replace(/^memory\//, "").replace(/\.md$/, "")}`, "", m.content.trim(), "");
  }
  return parts.join("\n");
}
