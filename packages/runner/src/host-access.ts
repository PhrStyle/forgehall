import type { RunClaim } from "@forgehall/shared";

/**
 * Environment variables for the host tokens an agent was given. The names are fixed here, in the
 * runner, so a claim can only fill these and never set other variables (an API key, a proxy).
 * They are the names the GitHub and Azure DevOps CLIs read.
 */
const VARS: Record<RunClaim["hostAccess"][number]["provider"], string[]> = {
  github: ["GH_TOKEN", "GITHUB_TOKEN"],
  "azure-devops": ["AZURE_DEVOPS_EXT_PAT"],
};

export function hostEnv(access: RunClaim["hostAccess"]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const a of access) for (const name of VARS[a.provider] ?? []) env[name] = a.token;
  return env;
}
