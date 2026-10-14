# Console API

HTTP endpoints the console uses, plus the git endpoint for staging remotes. All are served by the bus (default `http://127.0.0.1:4545`) on loopback, with **no user authentication yet**: anyone who can reach the port can act as the user. Keep the bus on loopback.

Status: **implemented**. JSON bodies and responses unless stated. Validation errors return 400; bus errors (unknown thread, refused approval, ...) return 409 with `{"error": "<message>"}`. For the runner endpoints see the [Runner API](runner-api.md).

## Read

| Endpoint | Returns |
|---|---|
| `GET /api/workspaces` | `[{id, name}]` |
| `GET /api/workspaces/:ws/agents` | Agents with their current run, queued count, last run state, runs in the last day |
| `GET /api/workspaces/:ws/threads` | Threads (all columns, including `repo_id` and `branch`) with message count, participants and `waiting_on_you` |
| `GET /api/workspaces/:ws/runs?limit=50` | Recent runs (max 500) |
| `GET /api/workspaces/:ws/usage` | Latest usage reading, or `{}` |
| `GET /api/workspaces/:ws/repos` | `[{id, upstream_url, provider, base_branch, ...}]` |
| `GET /api/threads/:id` | `{thread, messages, runs}`; 404 if unknown |
| `GET /api/threads/:id/diff` | A **BranchDiff** for a repository thread (below) |
| `GET /api/threads/:id/approvals` | The thread's approvals, newest first |
| `GET /api/runs/:id/events?after=0` | Run events after the given event id |

### BranchDiff

What the thread branch changes compared with the base branch, since they diverged. Empty lists and `null` shas until something is pushed.

```json
{
  "base": "main",
  "branch": "fh/THR-0001",
  "baseSha": "5a7e1c0...",
  "headSha": "81d04e7...",
  "commits": [{"sha": "81d04e7...", "author": "atlas (forgehall)", "date": "2026-10-14T14:09:02+00:00", "subject": "atlas: THR-0001 (run 1)"}],
  "files": [{"path": "total.js", "additions": 1, "deletions": 1}],
  "patch": "diff --git a/total.js b/total.js\n...",
  "truncated": false
}
```

`patch` is cut at 400,000 characters and `truncated` becomes `true`. A thread without a repository returns an error.

### Approval

```json
{"id": 3, "thread_id": "THR-0001", "policy": "merge", "requested_by": "atlas",
 "summary": "Rounds to the nearest cent", "head_sha": "81d04e7...", "state": "pending",
 "comment": null, "result": null}
```

`state` is `pending`, `approved`, `rejected` or `superseded`. `head_sha` is `null` while the requesting agent's run is still pushing. After approval, `result` is `{"merged": "<sha>"}`.

## Act (as the user)

| Endpoint | Body | Effect |
|---|---|---|
| `POST /api/threads` | `{workspace, to, title (min 3), body, severity?, repo?}` | Creates a thread and posts a `request` to `to`. With `repo`, the thread gets branch `fh/<id>`. Returns 201 with the thread |
| `POST /api/threads/:id/messages` | `{to, body, type? (default answer), replyTo?}` | Posts a message as the user. 201 |
| `POST /api/threads/:id/close` | `{state: "done" \| "cancelled", note?}` | Closes the thread and cancels its queued runs. 204 |
| `POST /api/threads/:id/reopen` | `{note}` | Reopens a done, cancelled or blocked thread; the assignee gets a `request` with the note. 204 |
| `POST /api/approvals/:id/decide` | `{decision: "approve" \| "reject", comment?}` | See below |

### Deciding an approval

```bash
curl -s -X POST http://127.0.0.1:4545/api/approvals/3/decide \
  -H 'content-type: application/json' -d '{"decision":"approve"}'
```

- `approve` (policy `merge`): merges the pinned commit into the base branch without a working tree, pushes the result to the upstream, marks the approval `approved` and closes the thread with `Approved and merged into main as <sha>`. Fails if the approval is not `pending`, if the agent is still pushing (`head_sha` is `null`), if the branch moved after the request, or if the merge conflicts with the base. Nothing is published on failure.
- `reject`: `comment` is required. The approval becomes `rejected` and the assignee receives `Changes requested: <comment>` as a `decision`, which starts a new run.
- Policies other than `merge` fail with a message saying they are not implemented.

Refusals come back as 409 with the reason in `error`; the console shows it.

## Live changes: `GET /api/events?workspace=dev`

A server-sent events stream. Each event is named after the change kind (`thread`, `message`, `run`, `run_event`) and a JSON `data` with the workspace, thread and ids involved; comments (`: ping`) keep the connection open every 25 seconds. Omit `workspace` to receive every workspace. The console uses it to refetch what changed.

```text
event: run
data: {"kind":"run","workspace":"dev","thread":"THR-0001","run":4,"state":"running"}
```

## Git endpoint: `/git/<ws>/<repo>.git`

Git smart HTTP for the staging remote of a registered repository, served with `git http-backend`. Agents use it through their runner; you rarely need it directly.

| Rule | Detail |
|---|---|
| Authentication | HTTP basic: any user name, the **agent token** as password. `401` without a valid token |
| Scope | An agent reaches only its own workspace; another workspace returns `403` |
| Unknown repo | `404` |
| Pushes | Only `refs/heads/fh/*`, no deletions (enforced by a `pre-receive` hook). Anything else is rejected with `forgehall: agents can only push refs/heads/fh/*` |

```bash
git clone http://atlas:$AGENT_TOKEN@127.0.0.1:4545/git/dev/checkout-app.git
```

The runner does not put the token in the URL or `.git/config`; it sends it in an HTTP header per command. Prefer the same if you script this.

See [ADR 0007](../adr/0007-runner-handles-git-and-staging-remote.md).
