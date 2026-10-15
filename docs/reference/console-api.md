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
| `GET /api/workspaces/:ws/agents` | Agents with their current run, queued count, last run state, runs in the last day, and their desired and container state (see [Agent containers](#agent-containers-and-the-supervisor)) |
| `GET /api/workspaces/:ws/threads` | Threads (all columns, including `repo_id` and `branch`) with message count, participants and `waiting_on_you` |
| `GET /api/workspaces/:ws/runs?limit=50` | Recent runs (max 500) |
| `GET /api/workspaces/:ws/usage` | Latest usage reading, or `{}` |
| `GET /api/workspaces/:ws/repos` | `[{id, upstream_url, provider, base_branch, ...}]` |
| `GET /api/workspaces/:ws/permissions?state=pending` | Permission requests in that state (`pending` by default, or `allowed`, `denied`, `expired`), oldest first |
| `GET /api/workspaces/:ws/publishing` | The workspace's publishing settings and stored credentials (below) |
| `GET /api/threads/:id/reviewers?q=<text>` | Possible pull request reviewers for a repository thread (below) |
| `GET /api/settings` | Machine-wide settings, for example `{"allow_host_runners": false}` |
| `GET /api/supervisor` | `{online, seen_at}`: `online` is `true` when the supervisor reported in the last 30 seconds |
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

`state` is `pending`, `approved`, `rejected` or `superseded`. `head_sha` is `null` while the requesting agent's run is still pushing. `result` is set on approval and depends on the policy:

| Policy | `result` |
|---|---|
| `merge` | `{"merged": "<sha>"}`: the new commit on the base branch |
| `branch_only` | `{"branch": "fh/THR-0001", "commit": "<sha>"}` |
| `pull_request` | `{"branch": "fh/THR-0001", "commit": "<sha>", "pr": {"id", "url", "status": "open" \| "merged" \| "closed"}, "warnings"?}` |

`warnings` lists non-fatal problems, such as a reviewer that could not be added.

## Workspaces and agents

The console creates and edits workspaces and agents through these endpoints. The same can be done with `fh workspace add` and `fh agent add`.

| Endpoint | Body | Effect |
|---|---|---|
| `POST /api/workspaces` | `{id, name}` | Creates a workspace. 201 with `{id, name}`. 400 if it exists |
| `POST /api/workspaces/:ws/agents` | `{id, name, role, default_model, accepts_from?, prompt?}` | Creates an agent. 201 with AgentSettings. 400 if it exists |
| `GET /api/workspaces/:ws/agents/:id/settings` | none | AgentSettings |
| `PATCH /api/workspaces/:ws/agents/:id` | Any subset of `{name, role, default_model, accepts_from, prompt}` | Updates the agent. Returns AgentSettings |
| `PUT /api/workspaces/:ws/agents/:id/credentials/:provider` | `{token}` | Stores the agent's host token. Returns `{provider, token_hint, created_at}` |
| `DELETE /api/workspaces/:ws/agents/:id/credentials/:provider` | none | Removes the agent's host token. 204 |
| `POST /api/workspaces/:ws/agents/:id/start` | none | Sets the desired state to `running`. 204. The supervisor starts the container within seconds |
| `POST /api/workspaces/:ws/agents/:id/stop` | none | Sets the desired state to `stopped`. 204. The supervisor stops the container and leaves it stopped |
| `POST /api/workspaces/:ws/agents/:id/restart` | none | Asks the supervisor to restart the container. 204 |

- `id` (workspace and agent): lowercase letters, digits and `-`, at most 40 characters, starting with a letter or digit. An agent id cannot be `you` or `system`.
- `default_model`: `haiku`, `sonnet` or `opus`. `role`, `name` and `prompt` are free text.
- `accepts_from`: an empty list means any agent may send requests to the agent; otherwise only the listed agents. You can always write to it.
- `provider` is `github` or `azure-devops`. Whitespace is removed from `token`; a token under 20 characters is refused.
- AgentSettings: `{id, name, role, default_model, accepts_from, prompt, permissions: {allow?, ask?, deny?}, credentials: [{provider, token_hint, created_at}]}`. Tokens are never returned.
- Creating an agent sets its desired state to `running`, so a running supervisor starts its container. The bus has no Docker access and never starts containers itself; you can also start one with `fh agent run <ws> <id>`.

### Agent containers and the supervisor

Status: **implemented**. The start, stop and restart endpoints only record what you want; [`fh supervise`](cli.md#fh-supervise---install--uninstall) applies it within seconds. Agent rows from `GET /api/workspaces/:ws/agents` include:

| Field | Meaning |
|---|---|
| `desired_state` | `running` or `stopped`: what you asked for |
| `container_state` | Last state the supervisor reported: `running`, `stopped`, `starting`, `stopping`, `restarting`, `updating` or `error` |
| `container_detail` | Free text with more detail, such as an error message |
| `container_seen_at` | When the supervisor last reported the agent |

`GET /api/supervisor` shows whether the supervisor is running. The console shows a banner with the `fh supervise --install` command when it is offline.

```bash
curl -s -X POST http://127.0.0.1:4545/api/workspaces/dev/agents/atlas/restart \
  -H "Authorization: Bearer $(cat ~/.forgehall/admin-token)"
# 204
```

```bash
curl -s -X POST http://127.0.0.1:4545/api/workspaces/dev/agents \
  -H "Authorization: Bearer $(cat ~/.forgehall/admin-token)" \
  -H 'content-type: application/json' \
  -d '{"id":"atlas","name":"Atlas","role":"developer","default_model":"sonnet"}'
```

## Act (as the user)

| Endpoint | Body | Effect |
|---|---|---|
| `POST /api/threads` | `{workspace, to, title (min 3), body, severity?, repo?}` | Creates a thread and posts a `request` to `to`. With `repo`, the thread gets branch `fh/<id>`. Returns 201 with the thread |
| `POST /api/threads/:id/messages` | `{to, body, type? (default answer), replyTo?}` | Posts a message as the user. 201 |
| `POST /api/threads/:id/close` | `{state: "done" \| "cancelled", note?}` | Closes the thread and cancels its queued runs. 204 |
| `POST /api/threads/:id/reopen` | `{note}` | Reopens a done, cancelled or blocked thread; the assignee gets a `request` with the note. 204 |
| `POST /api/approvals/:id/decide` | `{decision: "approve" \| "reject", comment?, reviewers?, title?}` | See below |
| `POST /api/workspaces/:ws/repos` | `{id, upstream, base?}` | Registers or updates a repository and creates its staging remote. 201 with the repository. `upstream` is a git URL or a path **as the bus sees it** (`/data/upstreams/...`); `fh repo add` translates host paths for you |
| `POST /api/permissions/:id/decide` | `{decision: "allow" \| "deny", remember?, reason?}` | See [Permission requests](#permission-requests) |
| `PATCH /api/settings` | `{allow_host_runners?: boolean}` | See [Settings](#settings) |
| `PATCH /api/workspaces/:ws/publishing` | Any subset of `{approval_policy?, git_author_name?, git_author_email?, ai_trailer?}` | See [Publishing](#publishing) |
| `PUT /api/workspaces/:ws/credentials/:provider` | `{token}` | Stores a host token. 200 with `{provider, token_hint, created_at}`. See [Publishing](#publishing) |
| `DELETE /api/workspaces/:ws/credentials/:provider` | none | Removes the stored token. 204 |

### Deciding an approval

```bash
curl -s -X POST http://127.0.0.1:4545/api/approvals/3/decide \
  -H "Authorization: Bearer $(cat ~/.forgehall/admin-token)" \
  -H 'content-type: application/json' -d '{"decision":"approve"}'
```

- `approve`: the bus squashes the approved commit onto the **current** base branch, without a working tree, into **one** commit. It is authored and committed by the workspace identity ([Publishing](#publishing)), with the message: the title, a blank line, the approval summary, and the `Co-Authored-By` trailer if `ai_trailer` is on. The approval becomes `approved` and the result depends on the policy (see the table above). Fails if the approval is not `pending`, if the agent is still pushing (`head_sha` is `null`), if the branch moved after the request, or if the squash conflicts with the base. Nothing is published on failure.
  - `merge`: the commit is pushed as the base branch upstream. The thread closes with `Approved and merged into main as <sha>`.
  - `branch_only`: the commit is force-pushed as the thread branch (`fh/<THREAD-ID>`) upstream. The thread closes.
  - `pull_request`: the branch is pushed and a pull request is opened against the base branch with the chosen `reviewers` and `title` (default: the thread title). The thread moves to `external_review`. Every `PR_POLL_SECONDS` the bus checks the pull request: if it is merged, the thread closes; if it is closed without merging, the thread becomes `blocked` and you are told. Reviewer comments are **not** yet sent back to the agent (planned).
- `reject`: `comment` is required. The approval becomes `rejected` and the assignee receives `Changes requested: <comment>` as a `decision`, which starts a new run.

`reviewers` is an array of reviewer ids taken from [`GET /api/threads/:id/reviewers`](#reviewers) (at most 20). It is used only by `pull_request`. `title` is at most 200 characters.

Refusals come back as 409 with the reason in `error`; the console shows it.

```bash
curl -s -X POST http://127.0.0.1:4545/api/approvals/4/decide \
  -H "Authorization: Bearer $(cat ~/.forgehall/admin-token)" \
  -H 'content-type: application/json' \
  -d '{"decision":"approve","reviewers":["dana-reyes"],"title":"Fix coupon rounding"}'
```

### Reviewers

`GET /api/threads/:id/reviewers?q=<text>` searches people on the thread repository's host, for the `reviewers` field of an approval:

```json
[{"id": "dana-reyes", "displayName": "Dana Reyes", "uniqueName": "dana@example.com"}]
```

- GitHub: the repository's collaborators, filtered by login or name.
- Azure DevOps: identity search.
- `400` for a local repository, or when the workspace has no credential for that host.

## Publishing

Per-workspace settings for how approved work is published (console Settings, "Publishing"), and the host credentials the bus uses to push and open pull requests. Agents never receive these credentials.

```json
{"approval_policy": "pull_request", "git_author_name": "Dana Reyes", "git_author_email": "dana@example.com",
 "ai_trailer": true,
 "credentials": [{"provider": "github", "token_hint": "…k3Qz", "created_at": "2026-10-14T13:45:10.000Z"}]}
```

`GET /api/workspaces/:ws/publishing` returns this shape. Tokens are never returned: `token_hint` is the last 4 characters.

`PATCH /api/workspaces/:ws/publishing` accepts any subset of the fields and returns the same shape as GET:

| Field | Values | Default |
|---|---|---|
| `approval_policy` | `merge`, `pull_request` or `branch_only` (see [Deciding an approval](#deciding-an-approval)) | `merge` |
| `git_author_name` | text; `null` or empty clears it | `Forgehall` |
| `git_author_email` | e-mail address; `null` or empty clears it | `forgehall@localhost` |
| `ai_trailer` | boolean. On: adds `Co-Authored-By: Claude <noreply@anthropic.com>` to published commits | `true` |

`400` for an invalid policy, a name containing `<`, `>` or a newline, or an invalid e-mail address.

`PUT /api/workspaces/:ws/credentials/:provider` stores a token for a host. `:provider` is `github` or `azure-devops`; the body is `{"token": "..."}`. Whitespace is removed from the token, and a token under 20 characters is refused. The token is written to `~/.forgehall/secrets/providers/<ws>/<provider>.token` (mode `0600`), never to the database. The response is `{provider, token_hint, created_at}`.

`DELETE /api/workspaces/:ws/credentials/:provider` removes the stored token and returns 204.

The token needs these scopes:

| Host | Token | Scopes |
|---|---|---|
| GitHub | fine-grained token | Contents: read and write; Pull requests: read and write |
| Azure DevOps | personal access token | Code: Read & Write; Identity: Read |

The bus clones the base branch of a private repository with this token when the repository is added, so add the credential before the repository (see [`fh repo add`](cli.md#fh-repo-add-ws-id-upstream---base-branch)).

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
