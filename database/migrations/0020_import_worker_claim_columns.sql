-- ADR-0029's Import Worker claiming mechanism needs a durable "who/when claimed this" marker to
-- distinguish a job freshly transitioned to validating/importing (needs pickup now) from one
-- already being actively processed (must not be re-claimed by a second worker instance) from one
-- abandoned by a crashed worker (safely reclaimable after a stale-claim threshold) — the same
-- three-way distinction event_outbox.claimed_at/claimed_by already solves for the Event Processor
-- (migration 0010). import_jobs never had these columns because the table was pinned in migration
-- 0008, before ADR-0029 fixed the worker's exact claiming shape.
ALTER TABLE "import_jobs" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "import_jobs" ADD COLUMN "claimed_by" text;