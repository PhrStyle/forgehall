# Run agents in Docker

Run each agent's runner in its own container instead of on your host. The container has the official Claude Code CLI (pinned version), git and the runner, and runs as a non-root user.

## 1. Create a Claude token (once)

Containers cannot use your interactive login. Generate a long-lived token for your own subscription:

```bash
claude setup-token
```

It prints a token valid for one year. Keep it out of shell history and out of the repository, for example in a file only you can read:

```bash
install -m 600 /dev/null ~/.config/forgehall/claude-token
$EDITOR ~/.config/forgehall/claude-token
```

## 2. Build the images

From the repository root:

```bash
docker build -f infra/docker/Dockerfile --target runner -t forgehall/runner:dev .
```

## 3. Start Postgres and the bus

Either run the bus on the host as in [Getting started](../getting-started.md), or in a container:

```bash
docker compose -f infra/docker/compose.yaml -p forgehall --profile stack up -d --build
```

The containerized bus listens on `127.0.0.1:4545` on the host and on `http://bus:4545` inside the `forgehall_default` network.

## 4. Start one runner per agent

```bash
docker run -d --name fh-runner-vigil --network forgehall_default \
  -e AGENT_TOKEN="$(fh agent token dev vigil)" \
  -e CLAUDE_CODE_OAUTH_TOKEN="$(cat ~/.config/forgehall/claude-token)" \
  forgehall/runner:dev
```

Repeat for each agent. If the bus runs on the host instead, bind it to an address the container can reach and pass `-e BUS_URL=...`.

## 5. Check

```bash
docker logs -f fh-runner-vigil
fh runs dev
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Thread becomes `blocked` with "Not logged in" | No or invalid `CLAUDE_CODE_OAUTH_TOKEN` | Create a token (step 1) and restart the container. Then reply in the thread to retry. |
| Runner logs `claim: fetch failed` | The container cannot reach the bus | Use the `forgehall_default` network and `BUS_URL=http://bus:4545` |
| A run fails with "runner stopped responding" | The container stopped mid-run | Restart it; the messages were put back in the queue |
