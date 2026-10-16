# Runner API

HTTP endpoints served by the bus (`packages/bus/src/http.ts`). Status: **implemented (phase 1)**. The runner is the main client, but nothing stops you from calling them with `curl` while experimenting. The API is internal and may change before 1.0.

Base URL: `http://127.0.0.1:4545` from the host, and `http://bus:4545` from an agent container on the `forgehall-agents` network (see [configuration](configuration.md)). There is no TLS; the stack publishes the port on loopback only.

**Authentication.** Every endpoint here except `/health` needs `Authorization: Bearer <agent token>`. The token identifies the agent and its workspace; missing or unknown tokens get `401 {"error": "invalid agent token"}`. A run can only be touched by the agent it was queued for.

**Errors.** Bus rule violations return `409 {"error": "..."}`, invalid payloads `400 {"error": "invalid payload", "issues": [...]}`, anything else `500`.

Payload shapes are the zod schemas in `packages/shared/src/index.ts`.

## `GET /health`

No auth. Returns `{"ok": true, "home": "/data"}`. `home` is the bus's data directory. The console API (`/api/...`) is separate and needs the admin token, which agents never have: see the [console API](console-api.md#authentication).

## `POST /mcp`

The agent-facing MCP endpoint (Streamable HTTP, stateless: one server per request). `GET` and `DELETE` return 405. The tools are listed in [MCP tools](mcp-tools.md).

## `POST /runner/claim`

Long-poll for the next run for the authenticated agent. The body says where the runner executes:

```json
{"mode": "container"}
```

`mode` is `container`, `vm` (planned) or `host`; a missing or unknown value counts as `host`. It is **self-reported** by the runner. The runner image sets it through `FORGEHALL_RUNNER_MODE=container`. The mode is stored on the run and decides the permission rules in the claim.

**`403`**: the mode is `host` and "Allow agents directly on this machine" (`allow_host_runners`) is off. The body explains it, for example `{"error": "Agents running directly on this machine are disabled. Start the agent isolated (fh agent run <ws> <agent>), ..."}`. Retrying will not help, so the runner prints the error and exits.

The bus checks for work every second for up to `CLAIM_WAIT_MS`. It returns `204 No Content` when nothing is claimable: no queued run, the agent already has a run in progress, or the workspace is at `MAX_RUNNING`. Otherwise `200` with a `RunClaim`, and the run is marked `running`; every undelivered message for that agent and thread is marked as delivered in it.

```json
{
  "runId": 3,
  "workspaceId": "dev",
  "agentId": "vigil",
  "threadId": "THR-0001",
  "model": "haiku",
  "effort": "low",
  "routeReason": "handling answer: short task",
  "sessionId": "5d1c0f6e-0000-0000-0000-000000000000",
  "prompt": "[forgehall] workspace dev · thread THR-0001 ...",
  "agentPrompt": "",
  "allowedTools": ["Read", "Glob", "Grep", "Edit", "Write", "Bash(ls *)", "..."],
  "permissions": {"allow": ["Read", "..."], "ask": ["Bash(npm install *)", "..."], "deny": ["Bash(sudo *)", "..."]},
  "hostAccess": [],
  "context": {"knowledge": "Use pnpm, not npm.", "memory": [{"path": "memory/coupon-stacking.md", "content": "Coupons do not stack."}], "skills": []},
  "repo": null,
  "runnerMode": "container"
}
```

| Field | Type | Meaning |
|---|---|---|
| `model` | `haiku` \| `sonnet` \| `opus` | Chosen by the router |
| `effort` | `low` \| `medium` \| `high` | Chosen by the router |
| `sessionId` | string \| null | Claude session to `--resume`; null on the agent's first run in the thread |
| `prompt` | string | Bus header plus the new messages |
| `agentPrompt` | string | Agent identity, appended to the system prompt |
| `allowedTools` | string[] | Engine tools allowed without asking, in addition to `mcp__bus__*`. Same as `permissions.allow` |
| `permissions` | `{allow, ask, deny}` | Tool rules in Claude Code syntax for this run, from the mode's defaults plus the agent's additions. For `host` runs `allow` is empty. The runner passes them to Claude Code with `--settings`; see [Isolation and permissions](../concepts/isolation-and-permissions.md#tool-permissions) |
| `hostAccess` | `[{provider, token}]` | The agent's host tokens, `provider` is `github` or `azure-devops`. Default `[]`. The runner maps them to fixed environment variables for the engine: `github` gives `GH_TOKEN` and `GITHUB_TOKEN`, `azure-devops` gives `AZURE_DEVOPS_EXT_PAT`. A claim cannot set other variables. See [Host access per agent](../concepts/workspaces.md#host-access-per-agent) |
| `context` | `{knowledge, memory, skills}` | What the agent knows, delivered with every run. `knowledge` is the workspace's shared Markdown (`knowledge.md`, written by the user). `memory` is `[{path, content}]`, the agent's memory files, with `path` relative to the agent's folder (for example `memory/coupon-stacking.md`). `skills` is `[{name, files}]`, each skill's files as `[{path, content}]`, with `path` relative to the skill folder (for example `SKILL.md`). Default: empty. See [What the runner does with `context`](#what-the-runner-does-with-context) |
| `repo` | `{id, base, branch}` \| null | The repository checkout for the run; null for threads without one |
| `runnerMode` | `container` \| `vm` \| `host` | The mode the claim was made with |

### What the runner does with `context`

**Status: implemented.** Before each run, in `container` and `vm` modes, the runner writes into the agent's home directory (`~` inside the container):

- `~/.claude/CLAUDE.md`: the workspace knowledge under "Workspace knowledge", then the agent's memory under "Your memory". Claude Code loads it in every session, headless runs included.
- `~/.claude/skills/<name>/`: each skill's files. Names that are not lowercase slugs are skipped, and so is any file whose path leaves its skill folder.

Both are rewritten on every run and the skills folder is cleared first, so a forgotten memory or removed skill is gone from the next run on. The runner does not write anything from `context` in `host` mode, because that would overwrite the user's own `~/.claude`. If writing fails, the runner logs the error and runs the agent without the context. See [Learning and data](../concepts/learning-and-data.md#learning-flow).

## `POST /runner/runs/:id/events`

Forwards raw engine events for the activity feed. Body is an array of `RunEvent`:

```json
[
  {"kind": "system.init", "payload": {"type": "system", "subtype": "init", "session_id": "..."}},
  {"kind": "assistant", "payload": {"type": "assistant", "message": {}}}
]
```

`kind` is the event's `type` and `subtype` joined with a dot; `payload` is the full event (or the raw line, with `kind: "raw"`, when it is not JSON). Returns `204`. An empty array is accepted. A run that does not belong to the caller gives `409`.

## `POST /runner/runs/:id/finish`

Reports the end of a run. Body is a `RunFinish`; omitted numeric fields default to 0, `error` to null and `rateLimit` to null.

```json
{
  "ok": true,
  "sessionId": "5d1c0f6e-0000-0000-0000-000000000000",
  "inputTokens": 98123,
  "outputTokens": 412,
  "costUsd": 0.0123,
  "error": null,
  "rateLimit": {
    "status": "allowed",
    "unifiedWindows": {
      "five_hour": {"utilization": 0.04, "resetsAt": 1791925200},
      "seven_day": {"utilization": 0.01, "resetsAt": 1792314000}
    }
  }
}
```

Effects, all in one transaction:

- the run becomes `done` or `failed`, with tokens, cost and error stored;
- the session id is saved for this agent and thread, so the next run resumes it;
- the workspace's latest usage reading is updated from `rateLimit` (`resetsAt` values are Unix seconds);
- if the run failed, its delivered messages go back to the queue;
- if messages arrived for this agent and thread during the run, a new run is queued.

Returns `204`. `409` if the run is not `running` or does not belong to the caller.
