# Contributing

Thanks for helping. Forgehall is in early development, so open an issue to discuss anything larger than a small fix before writing code.

## Setup

Requires Node 22 (see `.nvmrc`), pnpm and Docker.

```bash
pnpm install
pnpm build
docker compose -f infra/docker/compose.yaml -p forgehall up -d   # local Postgres on 127.0.0.1:5433
```

To run the whole system by hand, follow [Getting started](docs/getting-started.md). It calls a real Claude Code CLI and uses your account's usage limits.

## Scripts

Run from the repository root; each runs across all packages.

| Script | What it does |
|---|---|
| `pnpm build` | Compile every package to `dist/` |
| `pnpm typecheck` | Type-check without emitting |
| `pnpm test` | Run the vitest suites |

Before opening a pull request, `pnpm build && pnpm typecheck && pnpm test` should pass.

## Tests

Tests use vitest and sit next to the code as `*.test.ts`. Prefer testing pure logic (routing, state transitions, prompt building) directly. Do not make tests call the real Claude Code CLI.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`, with an optional scope such as `feat(bus): ...`.
- Keep pull requests focused. Explain what changed and why; the description is where implementation reasoning belongs.
- Add an entry under `## [Unreleased]` in [CHANGELOG.md](CHANGELOG.md) for user-visible changes.

## Docs move with code

A change that alters behaviour must update its docs in the same pull request. In particular keep [docs/reference](docs/reference/cli.md) in sync with the code: CLI commands and options, MCP tools, environment variables and the runner API. Mark anything not yet working as planned; never describe planned features as available.

## ADR or decisions line?

Follow [ADR 0000](docs/adr/0000-record-architecture-decisions.md):

- **Write an ADR** for a hard-to-reverse or structural decision that had serious alternatives. Copy the shape of an existing one in [docs/adr](docs/adr/0000-record-architecture-decisions.md). Supersede old ADRs rather than editing them.
- **Add a one-line Y-statement** to [docs/decisions.md](docs/decisions.md) for a smaller decision worth remembering.
- **Put it in the pull request or commit** if the diff and its description already explain it.

## Conventions

TypeScript strict, ESM with NodeNext (local imports end in `.js`). More detail for tools and contributors in [AGENTS.md](AGENTS.md).

## Security issues

Do not open public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).

## License

By contributing you agree your contribution is licensed under Apache-2.0.
