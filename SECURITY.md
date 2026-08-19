# Security Policy

## Principles

- Least privilege by default: every component (service, database role, API client) gets only the
  access it needs.
- Defense in depth: authorization is enforced at the API layer and, where practical, at the data
  layer — never only in the frontend.
- No implicit trust of client input: every request is validated and authorized server-side.
- Secrets and business data never leave their intended boundary (e.g. no DB credentials reaching
  the frontend, no Telegram token reaching the backend — see [Multi-tenancy](#multi-tenancy--tenant-isolation)
  and [CLAUDE.md](CLAUDE.md) §7.3–7.4).

## Secret management

- Secrets are never committed to Git. `.env` is gitignored; only `.env.example` (with empty/placeholder
  values) is tracked.
- Secrets are never logged, including in error messages or stack traces.
- Each environment (dev/staging/production/demo) uses its own secrets — a secret is never reused
  across environments.
- The frontend never receives database credentials, JWT signing secrets, S3 keys, or the n8n
  webhook secret.
- The Telegram bot token is owned exclusively by n8n; the backend never stores or transmits it.

## Reporting a vulnerability

This project does not yet have a public release or a dedicated security contact. Until one is
published here, report suspected vulnerabilities privately to the project maintainer rather than
opening a public GitHub issue.

## Multi-tenancy / tenant isolation

- The tenant a request operates on is always derived from the authenticated context, never from a
  client-supplied parameter taken at face value.
- Every query that touches tenant-scoped data is reviewed for isolation before merging.
- PostgreSQL Row-Level Security (RLS) is evaluated as an additional isolation layer in a later
  phase (see [docs/roadmap/roadmap.md](docs/roadmap/roadmap.md)).

## API security

- All inputs are validated via DTOs (class-validator) with `whitelist`/`forbidNonWhitelisted`
  enabled — unexpected fields are rejected, not silently dropped.
- Authorization is checked in the backend for every mutating and every tenant-scoped read.
- CORS is restricted to explicitly configured origins (`CORS_ORIGINS`), not wildcarded.
- Errors returned to clients never leak internal details (stack traces, SQL, file paths).

## Dependencies

- Dependency updates are reviewed, not auto-merged blindly, particularly for packages with
  database, auth, or crypto responsibilities.
- `pnpm audit` (or equivalent) is run as part of the CI/DoD process once CI is fully wired up.

## Docker security

- PostgreSQL and Redis are never exposed on public ports in production — only reachable from
  other containers on the internal network.
- Containers run without embedding real secrets in images or compose files; secrets are injected
  at runtime via environment variables backed by a secret store.
- Base images are kept up to date.

## Backups

Backup/restore strategy is defined once the database schema exists (see roadmap FASE 3+). This
section will be filled in at that point — no strategy is assumed yet.

## Auditing

Structured logging and audit trails for sensitive operations (auth events, cross-tenant access
attempts, admin actions) are designed in the Authentication & Authorization phase (FASE 4) and
Security Hardening phase (FASE 15) of the roadmap.
