-- Customers redesign (owner spec): `type` drops the individual/business distinction in favor of
-- the identification document itself (cedula/ruc/pasaporte, each with its own format validated at
-- the DTO layer); the single `display_name` field is replaced by separate `first_name`/`last_name`
-- inputs, with `display_name` becoming a derived, never-written `GENERATED ALWAYS AS (...) STORED`
-- column — a plain `||` concatenation with an explicit CASE for a NULL/empty last_name (not
-- `concat_ws`, see the note further down) — every existing reader of `customers.display_name`
-- (order snapshots, audit log, search) keeps working unchanged; `address` collapses from a
-- structured jsonb object to one free-form text line (`orders.customer_address_snapshot` is a
-- separate, historical column and is untouched); `notes` is dropped entirely.
--
-- Added nullable first, backfilled, THEN set NOT NULL — same reasoning as every other
-- backfill-then-constrain migration in this directory (e.g. 0029_backfill_identities,
-- 0035_inventory_transfers_code): a plain `ADD COLUMN ... NOT NULL` fails outright against any
-- tenant that already has customer rows.
ALTER TABLE "customers" ADD COLUMN "first_name" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "last_name" text;--> statement-breakpoint

-- RLS note (mirrors 0029_backfill_identities.sql / 0035_inventory_transfers_code.sql): customers
-- has ENABLE + FORCE ROW LEVEL SECURITY (tenantIsolationPolicy), and app_migrator's table
-- ownership does not bypass FORCE. Toggling FORCE off for the backfill statements below is safe —
-- this whole file runs inside the single transaction Drizzle wraps it in, so no other session ever
-- observes the intermediate state, and FORCE is unconditionally restored before commit.
ALTER TABLE customers NO FORCE ROW LEVEL SECURITY;--> statement-breakpoint

-- Backfill first_name/last_name from the old plain display_name: everything up to the first space
-- becomes first_name, the remainder (trimmed, NULL if empty) becomes last_name. There is no
-- reliable way to recover a "real" first/last split from a single free-text name, so this is a
-- best-effort, deterministic one-time split — operators can correct individual rows afterward.
UPDATE customers SET
	first_name = CASE
		WHEN position(' ' IN display_name) > 0 THEN split_part(display_name, ' ', 1)
		ELSE display_name
	END,
	last_name = CASE
		WHEN position(' ' IN display_name) > 0 THEN nullif(trim(substring(display_name FROM position(' ' IN display_name) + 1)), '')
		ELSE NULL
	END;--> statement-breakpoint

-- Backfill type: individual -> cedula, business -> ruc (the closest natural mapping — individual
-- customers almost always carry a cedula, business customers a ruc; this is a one-time best-effort
-- default, not a data assertion, and can be corrected per-row afterward same as first/last name).
-- The old check constraint only allows ('individual','business'), so it must be dropped BEFORE this
-- UPDATE writes the new values, and the new constraint added back only once every row satisfies it.
ALTER TABLE "customers" DROP CONSTRAINT "customers_type_check";--> statement-breakpoint
UPDATE customers SET type = CASE
	WHEN type = 'individual' THEN 'cedula'
	WHEN type = 'business' THEN 'ruc'
	ELSE type
END;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_type_check" CHECK ("customers"."type" IN ('cedula', 'ruc', 'pasaporte'));--> statement-breakpoint

-- Collapse the structured jsonb address into one free-form text line, joining whatever values were
-- present with ", " (jsonb_each_text(NULL) returns zero rows, so a NULL address stays NULL, and
-- string_agg() over zero rows is NULL rather than an empty string). Postgres rejects a subquery
-- directly inside `ALTER COLUMN ... TYPE ... USING` ("cannot use subquery in transform
-- expression"), so this goes through a sibling column + UPDATE + drop/rename instead, the same
-- add-backfill-swap shape as every other column change in this file.
ALTER TABLE "customers" ADD COLUMN "address_text" text;--> statement-breakpoint
UPDATE customers SET address_text = (SELECT string_agg(value, ', ') FROM jsonb_each_text(customers.address));--> statement-breakpoint
ALTER TABLE "customers" DROP COLUMN "address";--> statement-breakpoint
ALTER TABLE "customers" RENAME COLUMN "address_text" TO "address";--> statement-breakpoint

ALTER TABLE customers FORCE ROW LEVEL SECURITY;--> statement-breakpoint

ALTER TABLE "customers" ALTER COLUMN "first_name" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "customers" DROP COLUMN "notes";--> statement-breakpoint

-- Postgres has no `ALTER COLUMN ... ADD GENERATED`; dropping and re-adding display_name is the
-- only path. first_name/last_name are already fully backfilled above, so the STORED value computes
-- correctly for every existing row as part of this same ADD COLUMN. `concat_ws` cannot be used here
-- — Postgres's built-in concat_ws/concat are STABLE, not IMMUTABLE, and a GENERATED column requires
-- an IMMUTABLE expression — so this is a plain `||` (immutable for text) with an explicit CASE.
ALTER TABLE "customers" DROP COLUMN "display_name";--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "display_name" text GENERATED ALWAYS AS (
	CASE WHEN last_name IS NULL OR last_name = '' THEN first_name ELSE first_name || ' ' || last_name END
) STORED NOT NULL;
