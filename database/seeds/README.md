# Seeds

Idempotent data-seeding scripts (reference/lookup data, demo tenants) run after migrations.

Rules:

- No real customer or production data is ever seeded.
- Demo/seed credentials are never reused in production.

Empty until entity schemas exist.
