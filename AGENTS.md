# AGENTS.md

Guidance for AI coding assistants working in this repository. Humans should read [CONTRIBUTING.md](CONTRIBUTING.md).

## What this is

Forgehall: a self-hosted team of persistent Claude Code agents communicating over a Postgres-backed message bus. Phase 1 (bus, runner, CLI) works; console and providers are placeholders. Docs in `docs/`; the design rationale is in `docs/concepts/` and `docs/adr/`.

## Repo map

- `packages/shared` - zod schemas and types shared by bus and runner (`MessageType`, `ThreadState`, `Model`, `RunClaim`, `RunFinish`, ...)
- `packages/bus` - Fastify HTTP server, MCP tools (`src/mcp.ts`), router (`src/router.ts`), store and state machine (`src/store.ts`), prompt building (`src/prompt.ts`), migrations (`src/migrations/*.sql`), CLI (`src/cli.ts`, bin `fh`)
- `packages/runner` - daemon that claims runs and executes an `Engine` (`src/claude-code.ts` is the only engine)
- `packages/providers`, `packages/console` - placeholders
- `infra/docker/compose.yaml` - local Postgres (port 5433)
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

## Conventions

- TypeScript strict. ESM with `NodeNext`: relative imports use the `.js` suffix (`import { route } from "./router.js"`).
- Validate external input with zod; share schemas through `packages/shared`.
- Tests are vitest files next to the code, named `*.test.ts`.
- Conventional Commits. Do not commit unless asked.
- Add a SQL migration (new numbered file in `packages/bus/src/migrations/`) instead of editing an applied one.
- Keep `docs/reference/` in sync with the code: `fh` commands, MCP tools, env vars, runner API. Docs move with code.
- Clearly separate implemented from planned in docs. Never describe a planned feature as working.
- Use fictional example data only in docs (workspaces `personal`/`work`, agents like vigil/atlas/forge/probe).
- Structural decisions go to an ADR, smaller ones to `docs/decisions.md` (see ADR 0000).
- Never commit secrets: tokens, `.env` files, Claude credentials, real repository URLs or personal data.

## Gotchas

- Agent identity comes from the bearer token, never from tool arguments.
