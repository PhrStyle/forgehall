# Console API

HTTP endpoints the console uses, plus the git endpoint for staging remotes. All are served by the bus (default `http://127.0.0.1:4545`, published by the stack on loopback only).

## Authentication

Everything under `/api` acts with your authority, so it requires the **admin token**:

```bash
curl -s -H "Authorization: Bearer $(cat ~/.forgehall/admin-token)" http://127.0.0.1:4545/api/workspaces
```

- The token is created by `fh setup` (or by the bus on first start) in `~/.forgehall/admin-token`, mode `0600`. `FORGEHALL_ADMIN_TOKEN` overrides it.
- Missing or wrong token: `401 {"error": "admin token required"}`.
- The console's dev and preview server adds the header to proxied requests, so the browser never holds the token. `fh` uses it for `fh repo add`.
- Agents are on the same Docker network as the bus but never get the admin token: from there `/api` answers `401` (verified). Agents use their own tokens on `/mcp`, `/runner` and `/git`.
- `GET /health` needs no token.

Status: **implemented**. JSON bodies and responses unless stated. Validation errors return 400; bus errors (unknown thread, refused approval, ...) return 409 with `{"error": "<message>"}`. For the runner endpoints see the [Runner API](runner-api.md).

## Health

`GET /health` returns `{"ok": true, "home": "/data"}`. `home` is the bus's data directory (`FORGEHALL_HOME`, `/data` in the stack); `fh` uses it to translate host paths.

## Read

| Endpoint | Returns |
|---|---|
| `GET /api/workspaces` | `[{id, name}]` |
| `GET /api/workspaces/:ws/agents` | Agents with their current run, queued count, last run state, runs in the last day |
| `GET /api/workspaces/:ws/threads` | Threads (all columns, including `repo_id` and `branch`) with message count, participants and `waiting_on_you` |
| `GET /api/workspaces/:ws/runs?limit=50` | Recent runs (max 500) |
| `GET /api/workspaces/:ws/usage` | Latest usage reading, or `{}` |
| `GET /api/workspaces/:ws/repos` | `[{id, upstream_url, provider, base_branch, ...}]` |
| `GET /api/workspaces/:ws/permissions?state=pending` | Permission requests in that state (`pending` by default, or `allowed`, `denied`, `expired`), oldest first |
| `GET /api/settings` | Machine-wide settings, for example `{"allow_host_runners": false}` |
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
| `POST /api/workspaces/:ws/repos` | `{id, upstream, base?}` | Registers or updates a repository and creates its staging remote. 201 with the repository. `upstream` is a git URL or a path **as the bus sees it** (`/data/upstreams/...`); `fh repo add` translates host paths for you |
| `POST /api/permissions/:id/decide` | `{decision: "allow" \| "deny", remember?, reason?}` | See [Permission requests](#permission-requests) |
| `PATCH /api/settings` | `{allow_host_runners?: boolean}` | See [Settings](#settings) |

### Deciding an approval

```bash
curl -s -X POST http://127.0.0.1:4545/api/approvals/3/decide \
  -H "Authorization: Bearer $(cat ~/.forgehall/admin-token)" \
  -H 'content-type: application/json' -d '{"decision":"approve"}'
```

- `approve` (policy `merge`): merges the pinned commit into the base branch without a working tree, pushes the result to the upstream, marks the approval `approved` and closes the thread with `Approved and merged into main as <sha>`. Fails if the approval is not `pending`, if the agent is still pushing (`head_sha` is `null`), if the branch moved after the request, or if the merge conflicts with the base. Nothing is published on failure.
- `reject`: `comment` is required. The approval becomes `rejected` and the assignee receives `Changes requested: <comment>` as a `decision`, which starts a new run.
- Policies other than `merge` fail with a message saying they are not implemented.

Refusals come back as 409 with the reason in `error`; the console shows it.

## Permission requests

When Claude Code needs a tool use that no rule allows or denies, the agent's run creates a request (see [Isolation and permissions](../concepts/isolation-and-permissions.md)). A request:

```json
{"id": 12, "workspace_id": "dev", "agent_id": "atlas", "run_id": 7, "thread_id": "THR-0001",
 "tool_name": "Bash", "input": {"command": "npm install left-pad"}, "rule": "Bash(npm install *)",
 "state": "pending", "remember": false, "reason": null}
```

`state` is `pending`, `allowed`, `denied` or `expired`. `rule` is what "Always allow" would add.

`POST /api/permissions/:id/decide`:

| Body field | Meaning |
|---|---|
| `decision` | `allow` or `deny` |
| `remember` | With `allow`: add `rule` to the agent's permissions. Takes effect on isolated runners only; host runs never use standing rules |
| `reason` | With `deny`: shown to the agent, which must not retry |

```bash
curl -s -X POST http://127.0.0.1:4545/api/permissions/12/decide \
  -H "Authorization: Bearer $(cat ~/.forgehall/admin-token)" \
  -H 'content-type: application/json' -d '{"decision":"allow","remember":true}'
```

Deciding a request that is not `pending` (already answered or expired) returns 409. A request nobody answers expires after `PERMISSION_TIMEOUT_MS` (15 minutes) and counts as denied.

## Settings

`GET /api/settings` returns the machine-wide settings; `PATCH /api/settings` updates them and returns the result.

| Setting | Default | Meaning |
|---|---|---|
| `allow_host_runners` | `false` | Let runners that report mode `host` claim work. Off: they get `403`. On: they get no standing permissions and every tool use is asked. In the console: Settings, "Allow agents directly on this machine" |

```bash
curl -s -X PATCH http://127.0.0.1:4545/api/settings \
  -H "Authorization: Bearer $(cat ~/.forgehall/admin-token)" \
  -H 'content-type: application/json' -d '{"allow_host_runners":true}'
```

## Live changes: `GET /api/events?workspace=dev`

A server-sent events stream. Each event is named after the change kind (`thread`, `message`, `run`, `run_event`, `agent`, `permission`) and a JSON `data` with the workspace, thread and ids involved; comments (`: ping`) keep the connection open every 25 seconds. Omit `workspace` to receive every workspace. The console uses it to refetch what changed.

```text
event: run
data: {"kind":"run","workspace":"dev","thread":"THR-0001","run":4,"state":"running"}
```

## Git endpoint: `/git/<ws>/<repo>.git`

Git smart HTTP for the staging remote of a registered repository, served with `git http-backend`. Agents use it through their runner; you rarely need it directly. It is not under `/api` and does not take the admin token.

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
