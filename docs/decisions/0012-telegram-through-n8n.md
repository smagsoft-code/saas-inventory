# ADR-0012: Telegram Notifications Exclusively Through n8n

## Status

Accepted

## Context

Telegram is the initial notification channel. A bot token is a bearer credential — anyone holding
it can send messages as that bot — so where it lives and who can reach it materially affects the
platform's secret-handling risk surface. See
[security.md#secrets-management](../architecture/security.md#secrets-management) and
[SECURITY.md](../../SECURITY.md).

## Decision

The backend never integrates with Telegram directly, never stores a Telegram bot token (in
PostgreSQL, in environment variables, anywhere), and never imports a Telegram SDK. n8n owns the
entire Telegram integration — the bot token lives only in n8n's credential store; message
formatting, chat/channel routing, and delivery all happen inside n8n workflows triggered by the
webhook described in [ADR-0011](0011-n8n-external-automation.md). Per-tenant notification
configuration (which channel a tenant's alerts go to) is future-designed in
[events.md#n8n-and-telegram](../architecture/events.md#n8n-and-telegram) as tenant-owned settings
that identify an n8n routing target, not a Telegram destination the backend handles directly.

## Alternatives considered

- **Backend calls the Telegram Bot API directly, token stored in backend secrets.** Rejected:
  this is exactly the risk this ADR exists to avoid — a token capable of sending messages as the
  platform's bot would then be a backend secret, reachable by anything that can reach backend
  secrets (env vars, and by extension anything that can read the container's environment), and any
  bug in that integration code is now inside the core application rather than isolated in n8n.
- **Frontend calls Telegram directly (e.g. a client-side widget).** Rejected outright — this would
  put the token in a context (the browser) that is fundamentally not trustable with any secret; not
  seriously considered, listed here only because [CLAUDE.md §7.4](../../CLAUDE.md#74-security)
  explicitly forbids it and it's worth recording that the alternative was never on the table.

## Consequences

- Rotating the Telegram bot token is purely an n8n-side operation — no backend deploy, no backend
  secret rotation.
- If Telegram is ever replaced or supplemented by another channel (email, SMS, Slack), that is an
  n8n workflow change consuming the same event catalog — the backend's outbox contract does not
  change.
- The backend cannot itself verify a notification was actually delivered to Telegram (it only
  knows the webhook to n8n succeeded) — deeper delivery confirmation, if ever needed, would be a
  future n8n-side callback into the platform, not built now.
