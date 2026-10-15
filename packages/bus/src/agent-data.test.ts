import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { AgentData, AgentDataError } from "./agent-data.js";

let data: AgentData;

beforeEach(async () => {
  process.env.FORGEHALL_HOME = await mkdtemp(join(tmpdir(), "fh-data-"));
  data = new AgentData();
});

describe("agent data", () => {
  it("keeps shared knowledge, memory and skills per workspace", async () => {
    expect(await data.knowledge("dev")).toBe("");
    await data.setKnowledge("dev", "# Conventions\nPrices are in cents.");
    await data.commit("dev", { write: [{ path: "agents/atlas/memory/seed.md", content: "Run the coupon seed before checkout tests." }] }, "learn(atlas): coupon seed");
    await data.commit("dev", { write: [{ path: "agents/atlas/skills/release-notes/SKILL.md", content: "---\nname: release-notes\n---\nSteps." }] }, "learn(atlas): skill");
    expect(await data.knowledge("dev")).toContain("Prices are in cents.");
    expect(await data.memory("dev", "atlas")).toEqual([{ path: "memory/seed.md", content: "Run the coupon seed before checkout tests.\n" }]);
    expect((await data.skills("dev", "atlas")).map((s) => [s.name, s.files.map((f) => f.path)])).toEqual([["release-notes", ["SKILL.md"]]]);
    expect(await data.memory("sandbox", "atlas")).toEqual([]);
  });

  it("records a learning history per agent and can undo one change", async () => {
    const c1 = (await data.commit("dev", { write: [{ path: "agents/atlas/memory/a.md", content: "one" }] }, "learn(atlas): a", ))!;
    await data.commit("dev", { write: [{ path: "agents/vigil/memory/b.md", content: "two" }] }, "learn(vigil): b");
    const history = await data.history("dev", "atlas");
    expect(history.map((h) => h.subject)).toEqual(["learn(atlas): a"]);
    expect(history[0]!.files).toEqual([{ status: "A", path: "memory/a.md" }]);
    expect(await data.show("dev", c1)).toContain("+one");
    await data.revert("dev", c1, "wrong");
    expect(await data.memory("dev", "atlas")).toEqual([]);
    expect((await data.history("dev", "atlas"))[0]!.subject).toBe("Undo: learn(atlas): a");
  });

  it("skips empty commits and refuses paths outside the repository", async () => {
    await data.commit("dev", { write: [{ path: "agents/atlas/memory/a.md", content: "x" }] }, "first");
    expect(await data.commit("dev", { write: [{ path: "agents/atlas/memory/a.md", content: "x" }] }, "again")).toBeNull();
    await expect(data.commit("dev", { write: [{ path: "../escape.md", content: "x" }] }, "bad")).rejects.toThrow(AgentDataError);
  });
});
