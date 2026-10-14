# 0007. The runner handles git, and the bus hosts a staging remote

- Status: Accepted (implemented for the `local` provider and the `merge` policy; refines [ADR 0005](0005-provider-adapters-and-approval-policies.md))
- Date: 2026-10-14

## Context

Agents must change code in a repository without being able to publish it. [ADR 0005](0005-provider-adapters-and-approval-policies.md) decided on a staging remote and a credential split; building it raised the concrete questions of who runs git, where agents push, and how a run's work becomes something a human can approve. Agents are model-driven and can be steered by text they read, so anything they can do must be safe to do wrongly. By default they have file tools only, with no `Bash`.

## Decision

- **Agents never run git.** They edit files with the file tools. Before a run, the runner clones or fetches the staging remote and checks out the thread branch (from the branch if it exists, otherwise from the base), discarding leftovers of failed runs. After a successful run, the runner commits (author `<agent> (forgehall) <agent@forgehall.invalid>`, message `<agent>: <thread> (run N)`) and pushes to `fh/<THREAD-ID>`. Credentials are passed per command in an HTTP header and never written to `.git/config`.
- **The bus hosts the staging remote**: one bare repository per workspace repo, at `$FORGEHALL_HOME/staging/<ws>/<repo>.git`, served over git smart HTTP at `/git/<ws>/<repo>.git` with `git http-backend`. Authentication is HTTP basic with the agent token as password; an agent reaches only repos of its own workspace.
- **A `pre-receive` hook** in each staging repo accepts only `refs/heads/fh/*` and refuses deletions. An agent token cannot move `main`, even by mistake.
- **Only the bus publishes upstream**, and only after you approve. It merges the approved commit into the base branch and pushes to the upstream with its own credentials (see the [decision log](../decisions.md) for how the merge is made).
- **One run per thread at a time**, so agents sharing a thread never race on its branch.

## Alternatives considered

- **Give agents `Bash` and git credentials.** Most flexible (agents could run tests and use git freely), but it puts a write credential and arbitrary command execution in the hands of a model that reads untrusted text. Rejected for now; letting agents run tests in a sandbox is a separate, later decision.
- **Agents push to the provider directly.** No staging remote needed, but any agent could publish a branch to a shared host unreviewed, and many teams only issue read-only tokens.
- **A shared bare repository on the filesystem, mounted into containers.** Simple locally, but it needs a mount per agent, cannot enforce per-agent identity or workspace scope, and does not work for agents in VMs on other hosts. HTTP with the agent token works the same everywhere.

## Consequences

- Agent capability is limited to editing files. An agent cannot run the project's tests unless the owner adds tools to it; verification is done by reading, or by another agent asking the same.
- Commit authorship, messages and the push are uniform and attributable to the agent and run.
- The bus must have `git` installed and serves an extra HTTP route. It stays on loopback by default (tokens travel over plain HTTP).
- Throughput per thread is serial: a second message to a thread waits while a run on that thread is in progress.
- The staging remote is a mirror of the base branch plus thread branches. It is refreshed from the upstream whenever the bus merges; humans pushing to the upstream meanwhile are picked up at that point.
- Only the `local` provider and the `merge` policy are built. `pull_request`, `branch_only` and the GitHub and Azure DevOps adapters (phase F3) reuse the same staging remote.
