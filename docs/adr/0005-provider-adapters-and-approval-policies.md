# 0005. Provider adapters and approval policies

- Status: Accepted (implemented in phase 2: policies, adapters for GitHub and Azure DevOps, squash publishing; reviewer comments and early pull requests still planned)
- Date: 2026-10-13

## Context

Repositories live on different hosts (GitHub, Azure DevOps, others) and the approval process differs by context: a personal project can merge on one click, a company project requires human reviewers on the host. Agents must not be able to ship code on their own.

## Decision

- **Plain git** (clone, fetch, push a branch) over HTTPS or SSH for everything that works on any host. No component depends on a host-specific CLI.
- A **`RepoProvider` interface** for the host-specific part only: compare branches, list and read pull requests and comments, search reviewers, create and merge pull requests. Adapters: `local` (bare repo, simulated PRs, for tests), then `azure-devops` and `github`; others by implementing the interface.
- Three **approval policies**, set per workspace:
  - `merge`: the bus opens the pull request when verification is requested (so CI runs); approving merges it.
  - `pull_request`: approving makes the bus open the pull request, with title, description and **reviewers chosen at approval time**; the real approval is the reviewer's on the host, and reviewer comments return to the agent.
  - `branch_only`: approving only confirms the pushed branch.
- **Credential split.** Agent credentials on the provider are **read-only** (for example an Azure DevOps PAT with *Code (Read)*). Agents push their branches to a **staging remote**: a bare repository per work repository, hosted by the bus on the user's machine and authenticated with the agent token. Other agents fetch from it to verify. Only the bus holds a write credential: after approval it pushes the branch to the provider and opens (or merges) the pull request. The barrier is technical, not a prompt rule.
- **Commit identity and AI attribution** are workspace settings (`git.author`, `git.ai_trailer`), applied by the bus when it publishes, because policies differ between companies.

## Alternatives considered

- **Use the `gh` CLI everywhere.** Simple for GitHub, wrong for Azure DevOps and others, and it would put PR and merge power in the agent's environment.
- **Give agents a push credential on the provider.** Simpler (no staging remote), but any agent could publish branches to a shared host without review, and many teams will only hand out read-only tokens.
- **Let agents open pull requests themselves.** Fewer moving parts, but an injected or confused agent could publish work without a human decision.
- **One fixed policy for all workspaces.** Does not fit personal versus company contexts.
- **Fixed reviewer lists in config.** Predictable, but the right reviewers depend on the change.

## Consequences

- Adding a provider means implementing one interface; the bus and console stay unchanged.
- The bus is a sensitive component: it holds the credential with real power and must be run and secured accordingly.
- Reviewer selection needs a provider search call and a place in the approval UI (console, phase 3).
- Phase 1 has none of this: `request_approval` records a message and sets the thread state `awaiting_approval`.
