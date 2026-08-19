# Docker strategy

## Files

- [docker-compose.dev.yml](../../docker-compose.dev.yml) — local development: `postgres`, `redis`,
  `api`, `web`. The app services run via `pnpm dev` against a bind-mounted repo for fast iteration
  (no image build required). Postgres/Redis are bound to `127.0.0.1` only, for local convenience.
- [docker-compose.prod.yml](../../docker-compose.prod.yml) — production: `postgres`, `redis`,
  `api`, `web`, `caddy`. `api` and `web` are built from the multi-stage Dockerfiles in
  [infrastructure/docker/](../../infrastructure/docker/). Postgres and Redis publish **no** ports —
  they are reachable only from other containers on the compose network. `caddy` is the only
  service exposed on `80`/`443` and reverse-proxies `/api/*` to `api` and everything else to `web`.

## n8n

n8n is treated as separate infrastructure, not a service in either compose file here — it is not
coupled to the backend's build or lifecycle. The backend only needs `N8N_WEBHOOK_URL` and
`N8N_WEBHOOK_SECRET` to call out to it; it never receives or stores the Telegram bot token, which
n8n owns exclusively.

## Secrets

Neither compose file contains real secret values. Required secrets (`POSTGRES_PASSWORD`,
`JWT_SECRET`, `JWT_REFRESH_SECRET`, `N8N_WEBHOOK_SECRET`, ...) are read from the environment via
`${VAR:?set VAR}`, which makes `docker compose` fail fast with a clear error if a required secret
is missing, instead of silently starting with an empty value. Production secrets are provided
through the deployment environment (e.g. an `.env` file outside version control, or a secret
manager), never hardcoded in the compose files.

## Networking

- Dev: `api`/`web` reach Postgres/Redis by service name (`postgres`, `redis`) on the default
  compose network; the app ports are also published to localhost for direct access from the host.
- Prod: only `caddy` is published externally. `postgres` and `redis` are never exposed publicly,
  per [SECURITY.md](../../SECURITY.md).

## Status

This is infrastructure scaffolding only — no application secrets exist yet, and the images have
not been built/run as part of this phase (see the project's validation notes for why). Building
and running these are exercised in the Infrastructure phase (FASE 2 of the roadmap).
