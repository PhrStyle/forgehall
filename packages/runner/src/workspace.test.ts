import { describe, expect, it } from "vitest";
import { redact } from "./workspace.js";

describe("redact", () => {
  it("masks basic and bearer credentials", () => {
    expect(redact("Authorization: Basic YXRsYXM6YXRfeHl6= clone")).toBe("Authorization: Basic *** clone");
    expect(redact("Bearer at_abc-123.x")).toBe("Bearer ***");
  });

  it("leaves other text alone", () => {
    expect(redact("git clone: Permission denied")).toBe("git clone: Permission denied");
  });
});
