# 0000. Record architecture decisions

- Status: Accepted
- Date: 2026-10-13

## Context

Forgehall makes several structural choices (engine, bus, isolation) that shape everything built later and that are expensive to undo. Contributors, and our future selves, need to know why they were made and what was rejected. At the same time, writing a long document for every small choice buries the important ones and makes the habit unsustainable.

## Decision

Use three tiers, matching the effort to how hard a decision is to reverse.

1. **ADR** (this directory, lean MADR format: Status, Date, Context, Decision, Alternatives considered, Consequences). Only for decisions that are hard to reverse or structural, and that had serious alternatives. About one page.
2. **One-line Y-statement** in [docs/decisions.md](../decisions.md) for everything else that is worth remembering: "In the context of ..., facing ..., we chose ... over ..., to achieve ..., accepting ...".
3. **Pull request or commit message** for implementation detail. If a reader can recover the reason from the diff and its description, it needs nothing more.

Rules:

- ADRs are numbered sequentially and never rewritten once accepted. To change a decision, write a new ADR and mark the old one `Superseded by NNNN`. Do not pile up edits.
- A decision log row can be promoted to an ADR when it turns out to be harder to reverse than expected.
- Status values: Proposed, Accepted, Superseded by NNNN, Deprecated.

## Alternatives considered

- **ADR for every decision.** Complete, but the volume discourages writing and reading them.
- **No formal records, rely on commit history.** Cheap, but the reasoning and rejected options are not recoverable from diffs.
- **A single running design document.** This is what the project started with. It mixes current design with history and goes stale; it was split into concept pages and ADRs.

## Consequences

- Reviewers can ask "is this an ADR, a log line, or just a PR?" and have a shared answer. See [CONTRIBUTING.md](../../CONTRIBUTING.md).
- Some decisions will be under-documented at first and promoted later.
- Superseding keeps history honest but means older ADRs may describe a state that no longer holds. The status line says so.
