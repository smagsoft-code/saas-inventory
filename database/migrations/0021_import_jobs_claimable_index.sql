-- Supports the Import Worker's cross-tenant claim query (WHERE status IN ('validating',
-- 'importing') ORDER BY created_at FOR UPDATE SKIP LOCKED) — never filtered by tenant_id, so the
-- existing import_jobs_tenant_status_created_idx (tenant_id-first) can't serve it. Same partial-index
-- shape as event_outbox_pending_created_idx (migration 0010), sized to two statuses instead of one.
CREATE INDEX "import_jobs_claimable_idx" ON "import_jobs" USING btree ("status","created_at") WHERE "import_jobs"."status" IN ('validating', 'importing');