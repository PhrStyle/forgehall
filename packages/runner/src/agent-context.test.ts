import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installContext, renderMemory } from "./agent-context.js";

describe("agent context", () => {
  it("writes memory as CLAUDE.md and skills as user skills, replacing old skills", async () => {
    const home = await mkdtemp(join(tmpdir(), "fh-home-"));
    await installContext({ knowledge: "Prices are in cents.", memory: [{ path: "memory/seed.md", content: "Run the coupon seed first." }], skills: [{ name: "old", files: [{ path: "SKILL.md", content: "x" }] }] }, home);
    await installContext({ knowledge: "", memory: [], skills: [{ name: "release-notes", files: [{ path: "SKILL.md", content: "---\nname: release-notes\n---\n" }, { path: "../../escape.md", content: "no" }] }] }, home);
    expect(await readdir(join(home, ".claude", "skills"))).toEqual(["release-notes"]);
    expect(await readFile(join(home, ".claude", "CLAUDE.md"), "utf8")).toContain("Nothing yet");
    expect(await readdir(home)).toEqual([".claude"]);
  });

  it("renders the workspace knowledge and each memory file", () => {
    const md = renderMemory({ knowledge: "Prices are in cents.", memory: [{ path: "memory/seed.md", content: "Run the coupon seed first." }], skills: [] });
    expect(md).toContain("# Workspace knowledge");
    expect(md).toContain("## seed\n\nRun the coupon seed first.");
  });
});
