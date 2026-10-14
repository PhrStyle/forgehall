import type { RunnerMode } from "@forgehall/shared";

/**
 * Tool permissions for agents, in Claude Code's own rule syntax ("Tool" or "Tool(pattern)").
 * Claude Code applies allow and deny itself; anything else becomes a request the user answers.
 */
export interface PermissionRules {
  allow: string[];
  ask: string[];
  deny: string[];
}


/** Inside the agent's own container or VM: build, test and inspect freely; ask before reaching out or deleting. */
export const ISOLATED_DEFAULTS: PermissionRules = {
  allow: [
    "Read", "Glob", "Grep", "Edit", "Write",
    "Bash(ls *)", "Bash(cat *)", "Bash(head *)", "Bash(tail *)", "Bash(wc *)", "Bash(find *)", "Bash(grep *)", "Bash(rg *)",
    "Bash(node *)", "Bash(npm test *)", "Bash(npm run *)", "Bash(npx vitest *)", "Bash(npx tsc *)", "Bash(pnpm test *)", "Bash(pnpm run *)",
    "Bash(python *)", "Bash(python3 *)", "Bash(pytest *)", "Bash(dotnet build *)", "Bash(dotnet test *)",
    "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)", "Bash(git show *)",
  ],
  ask: [
    "Bash(npm install *)", "Bash(npm i *)", "Bash(pnpm add *)", "Bash(pip install *)", "Bash(dotnet add *)",
    "Bash(curl *)", "Bash(wget *)", "WebFetch", "WebSearch",
    "Bash(rm -r *)", "Bash(rm -rf *)",
  ],
  deny: [
    "Bash(sudo *)", "Bash(su *)",
    "Read(**/.env)", "Read(**/.env.*)", "Read(**/*.pem)", "Read(**/id_rsa*)", "Read(~/.ssh/**)", "Read(~/.claude/**)",
  ],
};

/** On the host (only when the user allows it): nothing runs without the user's approval. */
export const HOST_DEFAULTS: PermissionRules = {
  allow: [],
  ask: [],
  deny: ISOLATED_DEFAULTS.deny,
};

/** Rules for a run: mode defaults plus the agent's own additions ("Always allow" decisions, isolated runners only). */
export function rulesFor(mode: RunnerMode, agent: Partial<PermissionRules> | undefined): PermissionRules {
  const base = mode === "host" ? HOST_DEFAULTS : ISOLATED_DEFAULTS;
  return {
    // On the host every action is approved one at a time: standing "always allow" rules do not apply.
    allow: mode === "host" ? [] : [...new Set([...base.allow, ...(agent?.allow ?? [])])],
    ask: [...new Set([...base.ask, ...(agent?.ask ?? [])])],
    deny: [...new Set([...base.deny, ...(agent?.deny ?? [])])],
  };
}

/**
 * The rule "Always allow" would add for a request: the tool plus, for Bash, the first two words
 * of the command (e.g. `npm install left-pad` -> `Bash(npm install *)`).
 */
export function suggestRule(toolName: string, input: unknown): string {
  if (toolName === "Bash") {
    const cmd = String((input as { command?: unknown })?.command ?? "").trim();
    const words = cmd.split(/\s+/).filter(Boolean).slice(0, 2);
    return words.length ? `Bash(${words.join(" ")} *)` : "Bash";
  }
  return toolName;
}
