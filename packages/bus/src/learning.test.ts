import { describe, expect, it } from "vitest";
import { skillFile } from "./learning.js";

describe("skillFile", () => {
  it("writes the frontmatter Claude Code needs", () => {
    const f = skillFile("release-notes", 'Use when "releasing"\\n checkout-app', "1. Bump the version.\n2. Tag.");
    expect(f.startsWith("---\nname: release-notes\ndescription: \"Use when 'releasing'")).toBe(true);
    expect(f).toContain("\n---\n\n1. Bump the version.");
  });
});
