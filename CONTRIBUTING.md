# Contributing

## Branching

- `main` — always deployable.
- `develop` — integration branch for ongoing work.
- `feature/<short-description>` — new functionality, branched from `develop`.
- `fix/<short-description>` — non-urgent bug fixes, branched from `develop`.
- `hotfix/<short-description>` — urgent production fixes, branched from `main`.

## Commits — Conventional Commits

```text
feat:     a new feature
fix:      a bug fix
refactor: a code change that neither fixes a bug nor adds a feature
docs:     documentation only
test:     adding or correcting tests
chore:    tooling/maintenance with no production code change
build:    changes to the build system or dependencies
ci:       changes to CI configuration
perf:     a performance improvement
security: a security-related fix or hardening change
```

Guidelines:

- Each commit is one logical change — avoid bundling unrelated changes.
- Write the message in the imperative mood ("add tenant guard", not "added tenant guard").
- Never force-push shared branches; never commit secrets.

## Pull requests

- Target `develop` (or `main` only for hotfixes).
- Describe what changed and why, and call out any security or migration implications.
- Keep PRs scoped to one logical change — split unrelated work into separate PRs.
- Link the relevant roadmap phase or ADR when applicable.

## Tests

- New behavior ships with tests (Vitest for unit/integration, Playwright for e2e where relevant).
- No real tenant/customer data in tests or fixtures — see [SECURITY.md](SECURITY.md).
- All tests must pass locally (`pnpm test`, `pnpm test:e2e`) before requesting review.

## Code review

- At least one review is expected before merging to `develop` or `main`.
- Reviewers check: correctness, tenant isolation, input validation, test coverage, and adherence
  to [CLAUDE.md](CLAUDE.md).
- Do not approve a PR that introduces secrets, disables strict TypeScript checks, or bypasses
  backend authorization.

## Definition of Done

See [CLAUDE.md §7.9](CLAUDE.md#79-definition-of-done). A task is not done until code, tests, lint,
typecheck, security review, and documentation are all addressed and the diff has been reviewed.
