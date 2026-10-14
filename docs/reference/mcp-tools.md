# MCP tools

Agents see the bus as an MCP server named `bus`, reached at `POST /mcp` with `Authorization: Bearer <agent token>`. The runner configures this for every run (`--mcp-config`, `--strict-mcp-config`), and Claude Code exposes the tools as `mcp__bus__<name>`.

Status: the tools below are **implemented**. See the end of this page for **planned** tools.

Common rules:

- **Identity** comes from the token. An agent never states who it is, so it cannot send as someone else.
- **Scope**: all tools act only inside the caller's workspace. A thread id from another workspace is rejected.
- **Recipients** (`to`) are an agent id in the same workspace, or `you` for the human.
- Bus errors (unknown thread, unknown recipient, ...) come back as a tool result with `isError: true` and a readable message, so the agent can react.
- A message addressed to an agent queues a run for it; one addressed to `you` waits in the thread.

State effects follow the [thread state machine](../concepts/threads-and-messages.md#thread-state-machine).

## `request`

Opens a new thread asking another agent (or you) for work. Include acceptance criteria in `body`.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `to` | string | yes | Recipient |
| `title` | string (min 3 chars) | yes | Thread title |
| `body` | string (min 1) | yes | The request |
| `severity` | `low` \| `medium` \| `high` | no | `high` can raise a Haiku agent to Sonnet |
| `repo` | string | no | Id of a registered repository (`fh repos <ws>`). The thread gets its own branch `fh/<THREAD-ID>`; the assignee edits files in a checkout of it. Unknown ids are rejected |

Effect: creates a thread (`open`, moves to `in_progress` when the first run starts), posts a `request`. Rejected if the recipient has `accepts_from` set and the caller is not in it.

```json
{"name": "request", "arguments": {"to": "atlas", "title": "Checkout total wrong with coupon", "body": "Steps: add 2 items, apply coupon SAVE10. Expected 90.00, got 91.00. Accept when the total is correct.", "severity": "high"}}
```

## `ask`

Asks something inside an existing thread. The agent should end its turn afterwards; the answer arrives in a new run.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `to` | string | yes | Recipient |
| `thread_id` | string | yes | For example `THR-0001` |
| `question` | string (min 1) | yes | |

Effect: posts an `ask`; no state change.

```json
{"name": "ask", "arguments": {"to": "vigil", "thread_id": "THR-0001", "question": "Does it happen without a coupon?"}}
```

## `answer`

Replies to a message addressed to the caller. Use it for answers to `ask` and for verification results.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `message_id` | string | yes | Id of the message being answered; must have been sent to the caller |
| `body` | string (min 1) | yes | |
| `outcome` | `passed` \| `failed` | no | For `verify` replies |

Effect: posts an `answer` to the original sender, linked with `reply_to`. `outcome=failed` moves the thread back to `in_progress`.

```json
{"name": "answer", "arguments": {"message_id": "7", "body": "Reproduction passes on the branch.", "outcome": "passed"}}
```

## `verify`

Asks another agent for an independent verification, for example rerunning a reproduction against a branch.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `to` | string | yes | Recipient |
| `thread_id` | string | yes | |
| `instructions` | string (min 1) | yes | What to verify and how |

Effect: posts a `verify`; thread becomes `verifying`.

```json
{"name": "verify", "arguments": {"to": "vigil", "thread_id": "THR-0001", "instructions": "Run the coupon reproduction on branch fix/checkout-total."}}
```

## `request_approval`

Asks the human for a decision. Summarise what was done and how it was verified.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `thread_id` | string | yes | |
| `summary` | string (min 1) | yes | |

Effect: posts an `approval` to `you`; thread becomes `awaiting_approval`.

On a thread **with a repository**, it also creates an approval record **pinned to a commit**, and you review the branch diff in the console:

- Called when the branch already has commits ahead of the base: pinned to the branch head now.
- Called during the agent's own run: the edits are not pushed yet, so the commit is pinned when the run finishes and the runner has pushed. If the run pushed nothing, the approval is withdrawn (state `superseded`, thread back to `in_progress`) and you get a notice.
- Called with nothing to approve (no commits ahead of the base, outside a run): fails with `nothing to approve`.
- A new request supersedes any earlier pending approval on the thread.

Approving merges the pinned commit into the base branch, publishes it upstream and closes the thread; rejecting sends your comment back as `Changes requested: ...`. The agent cannot call `complete` while the approval is pending. On a thread without a repository this is only a message, and you answer in the thread.

```json
{"name": "request_approval", "arguments": {"thread_id": "THR-0001", "summary": "Fixed rounding in coupon stacking; vigil verified 5 of 5 runs passed."}}
```

## `notify`

Informs without expecting a reply.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `to` | string | yes | Recipient |
| `thread_id` | string | yes | |
| `body` | string (min 1) | yes | |

Effect: posts a `notify`; no state change. It does not wake the recipient: the notice is delivered with that agent's next run in the thread.

```json
{"name": "notify", "arguments": {"to": "vigil", "thread_id": "THR-0001", "body": "Branch pushed, no action needed yet."}}
```

## `complete`

Closes a thread when the work is finished and nothing waits on anyone.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `thread_id` | string | yes | |
| `summary` | string (min 3) | yes | Outcome in a sentence or two; shown to the user |

Only the thread's assignee can complete it, and not while it is `awaiting_approval` (the user's decision closes it). Effect: posts a `complete` message to the user, moves the thread to `done` and cancels any queued runs on it.

```json
{"name": "complete", "arguments": {"thread_id": "THR-0006", "summary": "Answered: the bug also happens without a coupon (2 of 5 runs)."}}
```

## `escalate`

Asks for a stronger model on the caller's next run in this thread.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `thread_id` | string | yes | |
| `reason` | string (min 3) | yes | Recorded as the routing reason |

Effect: sets an escalation flag for this agent on the thread (no message, no state change). The next run is routed to Opus with high effort, and the flag clears when that run is claimed.

```json
{"name": "escalate", "arguments": {"thread_id": "THR-0001", "reason": "root cause spans three modules"}}
```

## `thread_read`

Reads a thread's state and full history.

| Parameter | Type | Required |
|---|---|---|
| `thread_id` | string | yes |

Effect: none (read-only). Returns a header line and one line per message.

```json
{"name": "thread_read", "arguments": {"thread_id": "THR-0001"}}
```

## `threads_list`

Lists threads in the caller's workspace, so an agent can see what is already in progress.

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `state` | string | no | Filter by state, e.g. `in_progress` |

Effect: none (read-only).

```json
{"name": "threads_list", "arguments": {"state": "in_progress"}}
```

## `permission` (internal)

Not for agents. Claude Code calls it itself (`--permission-prompt-tool mcp__bus__permission`) when a tool use is neither allowed nor denied by the run's rules. Agents should not call it and need not know it exists.

| Parameter | Type | Notes |
|---|---|---|
| `tool_name` | string | The tool Claude Code wants to use, for example `Bash` |
| `input` | any | The tool's input, for example `{"command": "npm install left-pad"}` |
| `tool_use_id` | string | Optional |

Effect: stores a permission request for the agent's current run and waits for your answer in the console ([console API](console-api.md#permission-requests)). The call returns Claude Code's decision as JSON text: `{"behavior": "allow", ...}` or `{"behavior": "deny", "message": "..."}`. A denial tells the agent not to retry; an expiry (no answer within `PERMISSION_TIMEOUT_MS`, 15 minutes) tells it the user did not answer and to ask in the thread if the action is needed. The runner raises `MCP_TOOL_TIMEOUT` so the call can last that long. See [Isolation and permissions](../concepts/isolation-and-permissions.md#permission-requests).

## Planned tools

Not implemented; do not rely on them.

| Tool | Purpose |
|---|---|
| `inbox()` | Pending messages for me |
| `attach(thread_id, path)` | Upload a file (trace, screenshot) to the bus |
| `prs_list(repo)` | Open pull requests on the provider, including those not from agents |
| `work_touching(repo, paths[])` | Threads and pull requests that change these files |
| `request` extras | `acceptance[]` and `attachments[]` parameters |
| `request_approval` extras | `kind` and `pr_url` parameters (for `pull_request` and `branch_only` policies) |
| `threads_list` extras | filters by repository and text query |
