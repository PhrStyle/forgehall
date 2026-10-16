# 0010. Automatic learning with a history, and shared knowledge written by the user

- Status: Accepted (implemented); refines [ADR 0006](0006-local-git-for-agent-data.md)
- Date: 2026-10-16

## Context

[ADR 0006](0006-local-git-for-agent-data.md) chose one local git repository per workspace for agent data and planned that every learning would wait for the user's approval on a `learn/*` branch. In practice the user wants agents to manage their own memory and skills, and to follow what they learn rather than approve each item. Some workflows still want a gate, and memory is an attack surface: text an agent reads (a repository, an issue) could try to plant instructions in its memory.

Claude Code already loads a user memory file (`~/.claude/CLAUDE.md`) and user skills (`~/.claude/skills/<name>/SKILL.md`) in every session, headless runs included.

## Decision

- **Automatic by default.** Agents change their own memory and skills through bus tools (`remember`, `forget`, `save_skill`, `remove_skill`). Each change is committed at once to the workspace repository with the agent as author, the reason and the thread id. The console shows it as the agent's **History**, with the diff and **Undo** (a revert commit).
- **Optional gate per agent.** "Ask before saving to memory" (off by default) turns each change into a proposal that the user approves or rejects in the Inbox.
- **Agents never write the repository directly.** The tools validate names, size and count; the bus writes. Agents also never write the shared knowledge.
- **Shared knowledge is the user's.** One Markdown file per workspace (`knowledge.md`), edited only in the console and delivered to every agent of the workspace.
- **Reflection when it is worth it.** When a thread closes, each agent that worked on it reflects (on its default model) if the user corrected it or answered its question, a review it asked for failed, or it needed three or more runs. The user can ask for it with "Learn from this thread". Reflections run once per agent and thread.
- **Delivered with Claude Code's own mechanisms.** Each run claim carries the knowledge, memory and skills; the runner writes them to `~/.claude/CLAUDE.md` and `~/.claude/skills` inside the agent's isolated container, never on the host (it would overwrite the user's own files).

## Alternatives considered

- **Approve every learning (ADR 0006's plan).** Safest, but the user did not want to review each memory; kept as the per-agent option.
- **Let agents edit their memory files directly.** Simpler, but no validation, no reason recorded, and a prompt injection could rewrite memory silently.
- **Agents also write shared knowledge.** Would spread one agent's mistake to all; shared conventions are a human decision.
- **Reflect after every thread.** More learning, but a run per agent per thread spends the plan on trivial work.

## Consequences

- What an agent learns is visible and reversible after the fact rather than prevented before; the History and Undo are the safety net in the default mode, and the per-agent gate exists for agents that read untrusted content.
- Memory grows with use; limits (file size, 60 memory files) keep each run's context small, and consolidation is still planned.
- Version tags, consolidation and backups from ADR 0006 remain planned.
