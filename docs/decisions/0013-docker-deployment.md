# ADR-0013: Docker-based Deployment

## Status

Accepted

## Context

The platform needs a deployment model a small team can run and reason about, consistent between
development and production, that keeps the database and cache off the public internet and puts a
single, well-understood component (a reverse proxy) in charge of TLS and public exposure. See
[docker.md](../deployment/docker.md).

## Decision

Docker containers for every component (`web`, `api`, `postgres`, `redis`), orchestrated with
Docker Compose — `docker-compose.dev.yml` for local development, `docker-compose.prod.yml` for
production, both scaffolded in Prompt 00. Caddy is the reverse proxy, the only container with
published ports in production, handling TLS termination and routing `/api/*` to `api` and
everything else to `web`. See the deployment architecture diagram in
[docker.md#deployment-architecture](../deployment/docker.md#deployment-architecture).

## Alternatives considered

- **Kubernetes.** Provides more sophisticated orchestration (auto-scaling, rolling deploys,
  self-healing) but at a large operational-complexity cost that isn't justified at current or
  near-term scale — see [scalability.md](../architecture/scalability.md); Docker Compose is
  sufficient for the "single deployable modular monolith + a handful of supporting containers"
  shape this architecture describes. Revisit if/when the platform's scale or team size changes the
  calculus.
- **A managed PaaS (e.g. Render, Railway, Fly.io) instead of self-managed Docker Compose.** Not
  rejected outright — remains a plausible way to *run* the same Docker images — but not decided
  here; this ADR fixes "the unit of deployment is a set of Docker containers," not which
  infrastructure provider runs them. `PENDING DECISION` on hosting provider, tracked for FASE 16
  (Production Deployment) in the [roadmap](../roadmap/roadmap.md).
- **Nginx instead of Caddy as reverse proxy.** Caddy was already the approved choice in Prompt 00
  primarily for automatic TLS certificate management (no manual Let's Encrypt/certbot setup); no
  requirement surfaced in this architecture phase argues for reopening it.

## Consequences

- `postgres` and `redis` publish no ports in production — reachable only from `api` on the internal
  Docker network — per [SECURITY.md](../../SECURITY.md#docker-security), already reflected in
  `docker-compose.prod.yml`.
- Rolling out a new version means building new `api`/`web` images and redeploying the compose
  stack; rollback means redeploying the previous image tag — no blue/green or canary mechanism is
  designed yet (`PENDING DECISION`, FASE 16).
- Secrets are injected as environment variables from outside version control (see
  [docker.md#secrets](../deployment/docker.md#secrets)) — a dedicated secret manager is an
  optional future upgrade, not required by this decision.
