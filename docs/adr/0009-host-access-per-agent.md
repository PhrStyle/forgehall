# 0009. Host access per agent

- Status: Accepted (implemented)
- Date: 2026-10-15

## Context

[ADR 0005](0005-provider-adapters-and-approval-policies.md) gave agents no credential with power on the code host: agents push to the staging remote, and only the bus publishes, after a human approval. That still holds for code. But some general flows need an agent to act on GitHub or Azure DevOps itself: open or comment on issues, read pull request discussions, update a work item. And the need differs per agent: a triage agent may need to write issues, a QA agent only to read, a dev agent nothing.

A single token per workspace would give every agent the same rights. Tokens on hosts already carry their own scopes, and both GitHub fine-grained tokens and Azure DevOps PATs can be limited to read-only or to specific repositories.

## Decision

- **Host access is configured per agent** (console: agent page → Host access), one token per host (`github`, `azure-devops`). No agent has any by default.
- Tokens are files under `$FORGEHALL_HOME/secrets/agents/<ws>/<agent>/<provider>.token` (mode `0600`), never in the database or API responses.
- The bus sends the agent's tokens to its runner with each claim (`hostAccess`), so changes apply on the next run without restarting the container. The **runner** maps them to fixed variable names (`GH_TOKEN` and `GITHUB_TOKEN`, `AZURE_DEVOPS_EXT_PAT`): a claim cannot set any other variable.
- **The token's scopes are the limit.** The console recommends read-only tokens and write access only for agents that must create or edit on the host.
- Commands that use the token go through the normal permission rules: `curl` and unknown commands are asked in the console unless the user chose "Always allow".
- **Publishing stays separate**: the workspace's publishing credential (Settings → Publishing) is used only by the bus after an approval and is never given to agents.

## Alternatives considered

- **One token per workspace for all agents.** Simpler, but every agent gets the rights of the most privileged one.
- **Host actions only through bus MCP tools** (for example `create_issue`), with the bus holding the token. Finer control and an audit trail per action, but every host feature needs a tool, and agents could not use the CLIs and APIs they already know. Worth revisiting for high-risk actions.
- **Tokens as container environment at `fh agent run`.** Works, but a token change needs a container restart, and the bus would not know which agents hold which tokens.

## Consequences

- An agent with a write token can change things on the host without an approval in Forgehall. The barrier is the token's scope plus the permission prompt, not the approval flow. This is the user's choice per agent, and the console says so.
- Agents can read their own token (it is in their environment). Prompt injection could make an agent misuse it within its scopes; read-only and repository-scoped tokens limit the damage.
- The claim response carries secrets: it is served only to the agent's own authenticated runner, on the agents network.
