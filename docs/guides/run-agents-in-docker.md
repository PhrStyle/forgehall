# Run agents in Docker

Agents run isolated by default: one container per agent, started with `fh agent run`. The container has the official Claude Code CLI (pinned version), git and the runner, and runs as a non-root user. Background and limits: [Isolation and permissions](../concepts/isolation-and-permissions.md).

Prerequisites: the stack is running (`fh setup`, then `docker compose -f infra/docker/compose.yaml -p forgehall up -d --build`), as in [Getting started](../getting-started.md), and the agent exists (`fh agent add`).

## 1. Build the runner image (once)

From the repository root. Rebuild it after changes to the runner or when you change the pinned Claude Code version:

```bash
docker build -f infra/docker/Dockerfile --target runner -t forgehall/runner:dev .
```

## 2. Create a Claude token (once)

Containers cannot use your interactive login. Generate a long-lived token for your own subscription and keep it in a file only you can read:

```bash
claude setup-token
install -D -m 600 /dev/null ~/.config/forgehall/claude-token
$EDITOR ~/.config/forgehall/claude-token
```

`fh agent run` reads `~/.config/forgehall/claude-token` (or the path in `FORGEHALL_CLAUDE_TOKEN_FILE`), or `CLAUDE_CODE_OAUTH_TOKEN` if it is set. The token is valid for a year.

## 3. Start, inspect and stop agents

```bash
fh agent run dev atlas
# dev/atlas running isolated (docker, 5a7e1c0e91b2). Logs: docker logs -f fh-dev-atlas
fh agent ps
docker logs -f fh-dev-atlas
fh agent stop dev atlas
# dev/atlas stopped
```

`fh agent run` creates the container `fh-dev-atlas` on the `forgehall-agents` network, with a work volume (`fh-dev-atlas-work`), the restart policy `unless-stopped`, and the agent token and Claude token passed as environment variables. It issues a new agent token each time, so running it again restarts the agent with a fresh one. If `FORGEHALL_BILLING` is set in your shell it is passed through (for example `subscription-only`; see [Billing](../concepts/workspaces.md#billing)).

`--isolation vm` is **planned** (phase 5, Incus) and currently refused.

## 4. Answer permission requests

An agent that wants to use a tool no rule covers pauses and asks. Open the console, find the card in **Waiting on you** and choose **Allow once**, **Always allow** or **Deny**. Unanswered requests are denied after 15 minutes. See [Tool permissions](../concepts/isolation-and-permissions.md#tool-permissions).

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `Runner image forgehall/runner:dev not found` | The image is not built | Step 1 |
| `The forgehall-agents network does not exist` | The stack is not running | `docker compose -f infra/docker/compose.yaml -p forgehall up -d --build` |
| `No Claude token for isolated agents` | No token file and no `CLAUDE_CODE_OAUTH_TOKEN` | Step 2 |
| Thread becomes `blocked` with "Not logged in" | Invalid or expired Claude token | Create a new token, run `fh agent run` again, then reply in the thread to retry |
| Runner logs `claim: fetch failed` | The container cannot reach the bus | Check that the stack is up and the agent is on `forgehall-agents` (`docker inspect fh-dev-atlas`) |
| Runner logs that agents directly on this machine are disabled | A runner reported mode `host` | Start it with `fh agent run`. Only enable "Allow agents directly on this machine" in Settings if you accept that every tool use is then asked |
| A run fails with "runner stopped responding" | The container stopped mid-run | Restart it with `fh agent run`; the messages were put back in the queue |
| Image or bus changes not picked up | Old image or container | Rebuild the runner image and `fh agent run` again; for the bus, `docker compose ... up -d --build` |

## Running a runner on the host (opt-in, not recommended)

Possible only after you turn on **Settings, "Allow agents directly on this machine"**. The runner then has your user's reach and every tool use that is not denied is asked, with no standing permissions:

```bash
BUS_URL=http://127.0.0.1:4545 AGENT_TOKEN=$(fh agent token dev atlas) node packages/runner/dist/index.js
```

Without the setting, the bus answers `403` and the runner exits with an explanation.
