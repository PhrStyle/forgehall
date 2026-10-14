# AGENTS.md

Guidance for AI coding assistants working in this repository. Humans should read [CONTRIBUTING.md](CONTRIBUTING.md).

## What this is

Forgehall: a self-hosted team of persistent Claude Code agents communicating over a Postgres-backed message bus. Phase 1 (bus, runner, CLI, console) works, and phase 2 (repositories, approvals, isolated agents, permissions) is in progress; providers are placeholders. Docs in `docs/`; the design rationale is in `docs/concepts/` and `docs/adr/`.

## Repo map

- `packages/shared` - zod schemas and types shared by bus and runner (`MessageType`, `ThreadState`, `Model`, `RunClaim`, `RunFinish`, ...)
- `packages/bus` - Fastify HTTP server, MCP tools (`src/mcp.ts`), router (`src/router.ts`), store and state machine (`src/store.ts`), prompt building (`src/prompt.ts`), migrations (`src/migrations/*.sql`), CLI (`src/cli.ts`, bin `fh`)
- `packages/runner` - daemon that claims runs and executes an `Engine` (`src/claude-code.ts` is the only engine)
- `packages/console` - web console (Vite + React); its dev server proxies `/api` and adds the admin token
- `packages/providers` - placeholder
- `infra/docker/` - `compose.yaml` (Postgres on 127.0.0.1:5433 and the bus on 127.0.0.1:4545, network `forgehall-agents`) and the `Dockerfile` with the `bus` and `runner` targets
- `docs/` - tutorial, concepts, reference, ADRs, decision log
- `templates/` - empty role templates (planned)

## Commands

```bash
pnpm install
pnpm build        # tsc for all packages (the bus build also copies migrations to dist/)
pnpm typecheck
pnpm test         # vitest
```

Needs Node 22. Tests must not need Postgres or a real `claude` binary unless they are clearly marked and skipped by default.

## Dev workflow

The bus runs in the Docker stack, not on the host, and agents run in containers. After `pnpm build`:

```bash
alias fh="node packages/bus/dist/cli.js"
fh setup                                                                   # once: ~/.forgehall, admin token, infra/docker/.env
docker compose -f infra/docker/compose.yaml -p forgehall up -d --build     # rebuild after bus or shared changes
docker build -f infra/docker/Dockerfile --target runner -t forgehall/runner:dev .   # rebuild after runner or shared changes
fh agent run dev atlas                                                     # restart the agent on the new image
pnpm --filter @forgehall/console dev
```

- Changes to `packages/bus` or `packages/shared` need `docker compose ... up -d --build` to take effect; changes to `packages/runner` or `packages/shared` need a runner image rebuild and `fh agent run` again. Console changes need neither.
- `fh` runs on the host and talks to Postgres on `127.0.0.1:5433`; `fh repo add` goes through the bus API with the admin token.
- Do not start runners with `node packages/runner/dist/index.js` for normal work: the bus refuses host runners unless "Allow agents directly on this machine" is on.
- Never print or commit `~/.forgehall/admin-token`, `~/.config/forgehall/claude-token` or `infra/docker/.env`.

## Conventions

- TypeScript strict. ESM with `NodeNext`: relative imports use the `.js` suffix (`import { route } from "./router.js"`).
- Validate external input with zod; share schemas through `packages/shared`.
- Tests are vitest files next to the code, named `*.test.ts`.
- Conventional Commits. Do not commit unless asked.
- Add a SQL migration (new numbered file in `packages/bus/src/migrations/`) instead of editing an applied one.
- Keep `docs/reference/` in sync with the code: `fh` commands, MCP tools, env vars, runner API. Docs move with code.
- Clearly separate implemented from planned in docs. Never describe a planned feature as working.
- Use fictional example data only in docs (workspace `dev`, agents atlas/vigil, repo `checkout-app`).
- Structural decisions go to an ADR, smaller ones to `docs/decisions.md` (see ADR 0000).
- Never commit secrets: tokens, `.env` files, Claude credentials, real repository URLs or personal data.

## Gotchas

- Agent identity comes from the bearer token, never from tool arguments.
- Everything under `/api` acts as the user and needs the admin token. Agents share the Docker network with the bus: never give them the admin token or add an `/api` route that skips the check.
- The runner mode is self-reported; do not treat it as a security boundary. Host mode must never use standing permission rules.
