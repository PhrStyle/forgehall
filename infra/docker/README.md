# infra/docker

The Forgehall stack and the images behind it. Run `fh setup` once first: it writes `infra/docker/.env` (`FORGEHALL_HOME_HOST`, `FORGEHALL_UID`, `FORGEHALL_GID`) for this machine and detects rootless Docker.

```bash
docker compose -f infra/docker/compose.yaml -p forgehall up -d --build   # Postgres + bus
docker build -f infra/docker/Dockerfile --target runner -t forgehall/runner:dev .
```

## Services

| Service | Image | Ports | Notes |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `127.0.0.1:5433` | Data in the `postgres-data` volume. Development password |
| `bus` | `forgehall/bus:dev` (built here) | `127.0.0.1:4545` | Mounts `~/.forgehall` at `/data`; runs as `FORGEHALL_UID:FORGEHALL_GID`; joins the `forgehall-agents` network |

The `forgehall-agents` network is where agent containers meet the bus, as `http://bus:4545`. The bus is in the stack because with rootless Docker or Docker Desktop containers cannot reach services on the host. Everything under `/api` needs the admin token, which agents never get.

## Dockerfile targets

- `bus`: Node 22, git, the built bus. Sets `HOST=0.0.0.0`, `PORT=4545`, `FORGEHALL_HOME=/data`.
- `runner`: Node 22, git, ripgrep, the Claude Code CLI (version pinned by `CLAUDE_CODE_VERSION`) and the runner, as the non-root user `agent`. Sets `FORGEHALL_RUNNER_MODE=container` and `BUS_URL=http://bus:4545`. `fh agent run` starts one container per agent from it.

## After changing code

- Bus or shared code: `docker compose -f infra/docker/compose.yaml -p forgehall up -d --build`.
- Runner or shared code: rebuild the runner image, then `fh agent run <ws> <agent>` for each agent.

More: [Run agents in Docker](../../docs/guides/run-agents-in-docker.md), [Isolation and permissions](../../docs/concepts/isolation-and-permissions.md), [Configuration](../../docs/reference/configuration.md).
