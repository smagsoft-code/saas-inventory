# SaaS Inventory (provisional name)

Multi-tenant inventory management platform. Initially targeted at businesses selling white goods,
furniture, appliances, and similar physical products, with an architecture generic enough to
support any product/category later.

> **Status:** project foundation / scaffolding phase. No business functionality is implemented
> yet — see [Current state](#current-state).

## Architecture

```text
Web / Mobile
     │
     ▼
 REST API
     │
     ▼
 NestJS Backend
     │
     ▼
 PostgreSQL (Drizzle ORM)
```

Web and mobile clients never access PostgreSQL directly; all business operations go through the
REST API. Notifications flow `Backend → Outbox/Webhook → n8n → Telegram` — the backend never talks
to Telegram directly and never stores a Telegram bot token.

Full architectural rules live in [CLAUDE.md](CLAUDE.md).

## Stack

| Layer          | Technology                                              |
| -------------- | -------------------------------------------------------- |
| Frontend       | Next.js, React, TypeScript, Tailwind CSS                 |
| Backend        | NestJS, Fastify, TypeScript, REST, OpenAPI                |
| Database       | PostgreSQL, Drizzle ORM                                  |
| Infrastructure | Docker, Docker Compose, Linux, Caddy                     |
| Dev tooling    | pnpm, Turborepo, Git, GitHub, VS Code, Claude Code        |
| Testing        | Vitest, Playwright                                       |
| Automation     | Redis, n8n                                                |

## Structure

```text
saas-inventory/
├── apps/
│   ├── web/            Next.js frontend
│   └── api/             NestJS backend
├── packages/
│   ├── shared/          Framework-agnostic shared utilities
│   ├── types/            Shared TypeScript type contracts
│   ├── config/            Shared env-var access helpers
│   ├── eslint-config/     Shared ESLint flat configs
│   └── tsconfig/          Shared TypeScript base configs
├── database/
│   ├── migrations/        Versioned Drizzle migrations
│   ├── seeds/              Reference/demo data seed scripts
│   ├── fixtures/           Static test fixtures
│   └── scripts/            Operational DB scripts
├── docs/                   Architecture, API, database, deployment, security, ADRs, roadmap
├── infrastructure/
│   ├── docker/             Dockerfiles / compose support files
│   ├── caddy/              Reverse proxy configuration
│   └── scripts/            Infra automation scripts
├── .claude/                 Claude Code agents, commands, skills, hooks
└── .github/workflows/       CI pipelines
```

## Requirements

- Node.js >= 20
- pnpm >= 9
- Docker + Docker Compose (for local Postgres/Redis and containerized runs)
- Git

## Installation

```bash
pnpm install
```

## Development

```bash
pnpm dev
```

Runs each app's dev server via Turborepo. Requires `.env` (copy from
[.env.example](.env.example)) and local Postgres/Redis — see
[docs/deployment/docker.md](docs/deployment/docker.md).

## Testing

```bash
pnpm test        # Vitest — unit/integration
pnpm test:e2e    # Playwright — end-to-end (apps/web)
```

## Docker

```bash
docker compose -f docker-compose.dev.yml up
```

See [docs/deployment/docker.md](docs/deployment/docker.md) for the full strategy, including the
production compose file.

## Git

Branching model: `main`, `develop`, `feature/*`, `fix/*`, `hotfix/*`. Commits follow
[Conventional Commits](https://www.conventionalcommits.org/). See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Current state

- Foundation/scaffolding: monorepo, tooling, governance docs — **in progress**.
- Architecture formalization (ADRs): por implementar.
- Infrastructure (Docker runtime, Caddy): por implementar.
- Database schema/migrations: por implementar.
- Authentication & authorization: por implementar.
- Business modules (tenants, products, warehouses, inventory, orders, QR, reports): por
  implementar.
- n8n / Telegram integration: por implementar.
- Production deployment: por implementar.

See [docs/roadmap/roadmap.md](docs/roadmap/roadmap.md) for the full phase plan.
