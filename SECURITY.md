# Security

## Threat model in brief

Forgehall starts AI agents that can read and write files and, if you allow it, run commands. Assume an agent can be wrong, and can be manipulated by text it reads.

- **Agents run commands and edit files.** The phase 1 runner executes the `claude` CLI directly on your host, as your user. By default the allowed tools are `Read`, `Glob`, `Grep`, `Edit`, `Write` and the bus tools; `Bash` is not allowed. File tools can still touch anything your user can, including outside the thread's work directory. Run Forgehall on a machine or account where that is acceptable, keep secrets out of reachable directories, and think carefully before adding tools such as `Bash`.
- **Isolation (planned).** Phase 1 has no sandbox. Per-agent Docker containers are the next step, then Incus VMs with network allowlists. Until then, treat the runner like any script you run yourself.
- **Tokens stay local.** Each agent has a bearer token; only its SHA-256 hash is stored in Postgres, and it is printed once by `fh agent token`. Claude credentials (`CLAUDE_CODE_OAUTH_TOKEN` or the CLI login) stay on your machine and are never sent to the bus. Forgehall does not broker or share subscription credentials, and should only be used with your own accounts.
- **Network exposure.** The bus listens on `127.0.0.1` and speaks plain HTTP. Do not bind it to a public interface; there is no TLS yet. The local Postgres uses a development password and binds to loopback.
- **Prompt injection between agents.** An agent that reads untrusted content (web pages, issue text, files) can be tricked into asking another agent to do something harmful. Current mitigations: messages from other agents are framed as data and not as user instructions; `accepts_from` can restrict who may send `request` to an agent; workspace-scoped tools keep damage inside one workspace; and runs have a limited tool allowlist. Planned: stricter per-type policies, credentials that cannot merge or push to protected branches, and human approval for merges and memory changes. These reduce risk but do not remove it; do not give an agent that reads untrusted input the power to do irreversible things.
- **Supply chain.** The runner depends on the Claude Code CLI. Pin and update it deliberately.

## Reporting a vulnerability

Please do not open a public issue. Open a private security advisory on GitHub for this repository (placeholder: the exact link will be added when the repository is published). Include steps to reproduce, the affected version or commit and the impact you expect. You will get an acknowledgement as soon as the maintainer can respond; this is a small project, so please allow some days.

## Supported versions

Only the latest commit on `main`. There are no releases yet.
