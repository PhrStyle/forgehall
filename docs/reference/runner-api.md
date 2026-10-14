# Runner API

HTTP endpoints served by the bus (`packages/bus/src/http.ts`). Status: **implemented (phase 1)**. The runner is the main client, but nothing stops you from calling them with `curl` while experimenting. The API is internal and may change before 1.0.

Base URL: `http://127.0.0.1:4545` by default (see [configuration](configuration.md)). There is no TLS; keep the bus on loopback or behind your own secure transport.

**Authentication.** Every endpoint except `/health` needs `Authorization: Bearer <agent token>`. The token identifies the agent and its workspace; missing or unknown tokens get `401 {"error": "invalid agent token"}`. A run can only be touched by the agent it was queued for.

**Errors.** Bus rule violations return `409 {"error": "..."}`, invalid payloads `400 {"error": "invalid payload", "issues": [...]}`, anything else `500`.

Payload shapes are the zod schemas in `packages/shared/src/index.ts`.

## `GET /health`

No auth. Returns `{"ok": true}`.

## `POST /mcp`

The agent-facing MCP endpoint (Streamable HTTP, stateless: one server per request). `GET` and `DELETE` return 405. The tools are listed in [MCP tools](mcp-tools.md).

## `POST /runner/claim`

Long-poll for the next run for the authenticated agent. Body is ignored (send `{}`).

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
  "allowedTools": ["Read", "Glob", "Grep", "Edit", "Write"]
}
```

| Field | Type | Meaning |
|---|---|---|
| `model` | `haiku` \| `sonnet` \| `opus` | Chosen by the router |
| `effort` | `low` \| `medium` \| `high` | Chosen by the router |
| `sessionId` | string \| null | Claude session to `--resume`; null on the agent's first run in the thread |
| `prompt` | string | Bus header plus the new messages |
| `agentPrompt` | string | Agent identity, appended to the system prompt |
| `allowedTools` | string[] | Engine tools allowed without asking, in addition to `mcp__bus__*` |

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
