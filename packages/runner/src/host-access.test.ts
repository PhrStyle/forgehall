import { describe, expect, it } from "vitest";
import { hostEnv } from "./host-access.js";

describe("hostEnv", () => {
  it("maps host tokens to the fixed variable names", () => {
    expect(hostEnv([{ provider: "github", token: "t1" }, { provider: "azure-devops", token: "t2" }])).toEqual({
      GH_TOKEN: "t1",
      GITHUB_TOKEN: "t1",
      AZURE_DEVOPS_EXT_PAT: "t2",
    });
  });

  it("gives nothing for an agent without host access", () => {
    expect(hostEnv([])).toEqual({});
  });
});
