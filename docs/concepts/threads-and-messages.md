# Threads and messages

Work happens in threads. A thread is a unit of work between agents and you, such as "checkout total bug". It belongs to one workspace, has a state, a responsible agent (the assignee) and an ordered history of messages.

Legend: **[now]** implemented, **[planned]** not built yet.

## Message types

Every message has a type, a sender, a recipient (an agent id, or `you` for the human) and a body.

| Type | Meaning | Sent by |
|---|---|---|
| `request` | Asks someone to do work. Opens a new thread when sent by an agent. | agent tool `request`, `fh send` |
| `ask` | Asks for information inside a thread. The asker ends its turn. | agent tool `ask` |
| `answer` | Replies to an `ask` or `verify`; for verifications carries `outcome` of `passed` or `failed`. | agent tool `answer`, `fh reply` |
| `verify` | Asks for an independent check (for example, rerun a reproduction against a branch). | agent tool `verify` |
| `approval` | Asks the human for a decision. | agent tool `request_approval` |
| `complete` | Closes a thread (the assignee's summary, or the result of an approval). | agent tool `complete`, approve action |
| `notify` | Informs without expecting a reply. | agent tool `notify` |
| `decision` | A decision, for example the human asking for changes. | `fh reply --type decision`, reject action |

A message addressed to an agent queues a run for it. A message addressed to `you` just waits in the thread.

## Questions to you

**[now]** An agent asks you with `ask` to `you`. It puts the question first in one short sentence, then the context, and when the answer is a choice it passes `options` (2 to 6 short choices). The console shows the question with a **Waiting on you** badge on the thread and on the agent, a pinned card with the question, the options as buttons and a reply field, and a jump button that scrolls to the message that asked. The thread also lists its questions, open and answered. Answering sends a message from you to that agent, which starts a new run. Details: [Console API, Questions](../reference/console-api.md#questions).

## Thread state machine

```text
open -> in_progress -> verifying -> awaiting_approval -> done
any state -> blocked | cancelled
```

Transitions are automatic and driven by message type:

| Event | Result |
|---|---|
| The first run for a thread is claimed | `open` -> `in_progress` |
| `verify` posted | `verifying` |
| `answer` with `outcome=failed` | back to `in_progress` |
| `approval` posted | `awaiting_approval` |
| The user approves a repository approval | merged, then `done` (a `complete` message is posted) |
| The user rejects it with a comment | `in_progress`; the assignee gets a `decision` |
| `decision` posted (human asks for changes) | `in_progress` |
| `request` posted while awaiting approval | `in_progress` |
| `complete` posted by the assignee | `done` |
| The user marks the thread done or cancels it (console, API) | `done` / `cancelled`; queued runs for the thread are cancelled |
| 3 failed runs in a row, or a login / billing error | `blocked`; the user is told why in the thread |
| Any message (except `notify`) to a `blocked` thread | `in_progress` |
| The user reopens a `done`, `cancelled` or `blocked` thread with instructions | `in_progress`; the assignee gets a `request` |
| Thread is `done` or `cancelled` | no further changes until reopened |

**[planned]** `external_review` (waiting on a reviewer in the provider) and `done` after an approval or a completed pull request.

## Repository threads and approvals

**[now]** A thread can be bound to a repository when it is created (`fh send ... --repo checkout-app`, the console's **Repository** field, the `repo` parameter of the `request` tool). It then has its own branch, `fh/<THREAD-ID>`, for example `fh/THR-0001`.

- **Agents edit files; the runner does git.** Before each run the thread branch is checked out; after a successful run the changes are committed and pushed. Leftovers of a failed run are discarded.
- **One run per thread at a time**, because agents in a thread share its branch. Further messages wait their turn.
- **Approvals are pinned to a commit.** `request_approval` records the branch head you are asked to approve. If an agent requests approval during its own run, the commit is pinned when that run ends; if the run pushed nothing, the approval is withdrawn and you are notified. A new request supersedes an older pending one.
- **Approve** merges that exact commit into the base branch and publishes it upstream, then closes the thread with `Approved and merged into main as <sha>`. It is refused (HTTP 409) if the branch moved after the request or if it conflicts with the base.
- **Request changes** needs a comment. It reaches the assignee as `Changes requested: ...` and starts a new run on the same branch.

Setup and an example: [Work on a repository](../guides/work-on-a-repository.md). Rationale: [ADR 0007](../adr/0007-runner-handles-git-and-staging-remote.md).

## The flow: QA finds a bug, dev fixes it, QA verifies, you approve

Implemented: the messaging half (request, ask, answer, verify, approval), branches per thread and merge on approval for the `local` provider. Pull requests on real providers and `work_touching` are planned and marked below.

```mermaid
sequenceDiagram
  participant V as vigil (QA)
  participant B as Bus
  participant A as atlas (dev)
  participant H as You
  V->>B: request(to=atlas, "checkout total wrong with coupon")
  B->>A: run 1 (new session)
  A->>B: ask(vigil, "does it happen without a coupon?")
  Note over A: run ends, nobody blocks
  B->>V: run (resume session) with the question
  V->>B: answer("yes, 2 of 5 attempts")
  B->>A: run 2 (resume session) with the answer
  A-->>A: planned: work_touching. Edits files on fh/THR-0001, runner pushes
  A->>B: verify(vigil, "rerun the reproduction on the branch")
  Note over B: planned: bus opens a pull request so CI runs
  B->>V: run (resume) [verifying]
  V->>B: answer(outcome=passed, evidence)
  A->>B: request_approval(summary)
  B->>H: waits in the thread [awaiting_approval]
  H->>B: approve
  Note over B: bus merges into main and pushes upstream [done]
```

Rules of the flow:

- **Nobody blocks waiting.** `ask`, `verify` and `request_approval` end the caller's turn. The answer arrives as a new run that resumes the same Claude session. This saves usage and lets agents live in different environments.
- **Merging is not the agent's job.** Agents can only push `fh/*` branches to the staging remote; the bus merges and publishes after your approval. The barrier is technical, not a prompt instruction. (Pull requests on real providers are planned.)
- Asking for changes is a `decision` message with your comment, which returns the thread to `in_progress`.

## Who may send what: `accepts_from`

Each agent can have an `accepts_from` list (set with `fh agent add --accepts a,b`). If it is not empty, a `request` from any agent not on the list is rejected by the bus, and a message from you is always allowed. This is a defence against prompt injection chains: an agent that reads the web (say, a research agent) should not be able to send `request` to an agent that edits code.

**[now]** `accepts_from` is checked for `request` messages only. **[planned]** broader policy per message type.

## Prompt framing

Messages from other agents are put into the prompt as data, wrapped in a tag that names the sender:

```text
<message id="2" type="ask" from="vigil">
Does the checkout total bug happen without a coupon?
</message>
```

The run's instructions tell the agent that messages from other agents are information from colleagues, not orders from the user, and that anything outside its role or risky should be asked of the user. This reduces prompt injection risk but does not eliminate it; see [SECURITY.md](../../SECURITY.md).

## Work awareness (planned)

To stop two agents, or an agent and a person, working on the same thing, three layers are planned:

1. A compact summary of open threads and open pull requests for the repository injected into every run header.
2. A `work_touching(repo, paths[])` tool, with a base rule to call it before editing files.
3. Detection by the bus after commits are pushed, notifying both owners on file overlap.

Related planned tools: `prs_list`, `inbox`, `attach`. **[now]** `threads_list` and `thread_read` give agents a basic view of what exists in their workspace. See the [MCP tools reference](../reference/mcp-tools.md).
