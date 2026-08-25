-- Follow-up to migration 0022 (tenant_settings): adds the ADR-0018 tenant-aware composite-FK-target
-- UNIQUE(tenant_id, id) constraint every NOT-NULL-tenant_id table carries by convention, even
-- though no table currently composite-FKs into tenant_settings — closes a real gap found by
-- test/database/migrations.integration.test.ts's coverage check ("every tenant-owned table has the
-- tenant-aware UNIQUE (tenant_id, id) composite-FK-target constraint"), run for real against
-- PostgreSQL (tools/pg-verify). 0022 is left as originally written, per CLAUDE.md §7.7 — this is a
-- new migration, not an edit to that one.
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_id_key" UNIQUE("tenant_id","id");