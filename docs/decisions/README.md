# Architecture Decision Records (ADRs)

An ADR is a short document that records a significant architectural decision: the context that
forced it, the decision itself, the alternatives considered, and the consequences of choosing it.

## Why we use them

- They give future contributors (human or Claude Code) the *why* behind a decision, not just the *what*.
- They prevent re-litigating settled decisions without new information.
- They create an audit trail for decisions that affect security, multi-tenancy, or data integrity.

## When to write one

An ADR is warranted when a decision:

- Changes the approved architecture or stack (see [CLAUDE.md](../../CLAUDE.md)).
- Affects multi-tenancy, security, or data model boundaries.
- Introduces a new external dependency or infrastructure component.
- Would be expensive to reverse later.

Routine implementation choices within an already-approved design do not need an ADR.

## Format

Each ADR lives in this directory as `NNNN-short-title.md` (four-digit sequence number) and covers:

1. **Status** — proposed / accepted / superseded.
2. **Context** — the problem and constraints.
3. **Decision** — what was decided.
4. **Alternatives considered** — and why they were rejected.
5. **Consequences** — trade-offs, follow-up work, risks.

No ADRs have been written yet — the architecture is formalized starting in the next phase
(Prompt 01 — Arquitectura General).
