# Information Inventory — what data actually exists

> Audited from `apps/api/src/database/schema/*.ts`, `database/migrations/*.sql` and every
> controller/DTO in `apps/api/src/**`. "Exposed by API" = there is an authenticated,
> tenant-scoped (or platform) HTTP endpoint that returns the field today. Everything else is
> DB-only (reachable by migration/direct SQL / the reporting read-side that FASE 18 will build).

## 0. Cross-cutting facts

- **Multi-tenancy:** one Postgres DB, tenant-owned tables carry `tenant_id` + RLS (`app_tenant`,
  `FORCE ROW LEVEL SECURITY`). Platform-scoped tables (no RLS, GRANT-only): `tenants`,
  `platform_admins`, `permissions`, `measurement_units`, `platform_admin_refresh_tokens`,
  `identities`, `tenant_memberships`. `app_tenant` has **no GRANT** on `identities` /
  `tenant_memberships` — a tenant request cannot read them at all.
- **IDs:** UUIDv7, application-generated (ADR-0016), time-ordered → `created_at`-ordered listing is
  index-friendly on every table.
- **Money:** Postgres `numeric` (unbounded precision), no scale pinned in the schema. `orders`
  carries `currency char(3)`, always `'USD'` in code (no per-tenant currency config exists).
  `tax_total` is **always `0`** (no tax engine — ADR-0023). `discount_total` is informational
  (never re-subtracted). Rounding is half-up to 2dp, applied in `OrdersService`, **not** enforced
  by a DB constraint.
- **Quantities:** `numeric` (fractional quantities are allowed by the column type; `> 0` / `>= 0`
  checks per table).
- **Soft-delete:** `deleted_at` on catalog/core master tables; **status, not delete** for
  lifecycle. Ledger/fact tables (`inventory_movements`, `product_price_history`, `audit_log`,
  `event_outbox`, receipt tables, `order_items`, `sales_return_items`) are append-only, never
  updated or deleted.
- **Timestamps:** every table has `created_at`; mutable tables have `updated_at`. Some carry
  domain event times: `inventory_movements.occurred_at` (backdatable), `orders` has only
  `created_at`/`updated_at` (no separate "confirmed_at"), transfers carry
  `approved_at`/`dispatched_at`/`received_at`/`cancelled_at`, price approvals carry
  `requested_at`/`resolved_at`, returns carry only `created_at`/`updated_at` + per-line
  `inspected_at`.
- **No audit-log read endpoint exists.** `audit_log` is written by `AuditLogService` /
  `PlatformAuditLogService` and never exposed by any controller.
- **No `event_outbox` read endpoint exists** for tenants. It is claimed only by the Event
  Processor (`app_event_processor`).

---

## 1. AUTH / IDENTITY / TENANTS  (platform-scoped)

| Table | Key fields | States | Exposed by API |
| --- | --- | --- | --- |
| `identities` | `email` (unique, case-insensitive), `password_hash`, `full_name`, `last_login_at`, `deleted_at` | `active` · `pending_credential` · `disabled` | **No.** Never returned; `app_tenant` has no grant. `identityId` appears as a claim in `GET /auth/me`. |
| `tenant_memberships` | `identity_id`, `tenant_id`, `user_id`, `status` | `active` · `disabled` | **No** direct endpoint. `POST /auth/login` returns `availableTenants:[{tenantId,name}]` for a multi-membership identity (post-credential only). |
| `tenants` | `name`, `slug`, `status`, `is_demo`, `created_at` | `active` · `suspended` · `archived` | Tenant: `GET /tenant` → `{id,name,slug,status,isDemo,createdAt}`. Platform: `GET /platform/tenants` (all, **not paginated**), `GET /platform/tenants/:id`. **Aggregated (F18-10):** `GET /platform/summary` (`@PlatformOnly()`) — `COUNT(*)` / `COUNT(*) FILTER` over `tenants` **alone**: `totalCount`, `byStatus`, `demoCount`, and an optional `[from,to)` `newInPeriod` count on `created_at`. Numeric aggregates only — no individual tenant fields, no tenant-scoped data. |
| `platform_admins` | `email`, `full_name`, `status` | `active` · `disabled` | **No** list endpoint. Only `POST /platform/auth/login`. |
| `auth_refresh_tokens` / `platform_admin_refresh_tokens` | `token_hash`, `expires_at`, `revoked_at`, `user_agent`, `ip_address`, `rotated_from_id` | — | **No.** No "active sessions" endpoint. |

Derivable-but-not-exposed: count of memberships per identity; active-session count per user;
`last_login_at` per identity (exists on the row, no endpoint).

---

## 2. CORE — USERS / ROLES / PERMISSIONS / AUDIT  (tenant-scoped)

| Table | Key fields | States | Exposed by API |
| --- | --- | --- | --- |
| `users` | `email`, `full_name`, `status`, `last_login_at`, `deleted_at` | `invited` · `active` · `disabled` | `GET /users` (`core.users.read`, filter `status`, offset paginated), `GET /users/:id`, `POST`, `PATCH`. `UserResponseDto` returns `id, email, fullName, status, roleNames[], lastLoginAt?, createdAt` — **`lastLoginAt` and role names ARE exposed**. No filter by role, by date, or free-text name search. |
| `roles` | `name`, `description`, `is_system_default`, `deleted_at` | — | `GET /roles` (`core.roles.read`) — roles + their permission codes. No CRUD (fixed `DEFAULT_ROLE_TEMPLATES`, editable only by direct DB). |
| `role_permissions` | `role_id`, `permission_code`, `granted_at` | — | Via `GET /roles`. |
| `user_roles` | `user_id`, `role_id`, `assigned_at`, `assigned_by` | — | Via `GET /users/:id` (role list). `assigned_by` is a soft ref. |
| `permissions` | `code`, `module`, `description` | — | Platform catalogue, 41 codes (see [filters-periods-and-scope.md](filters-periods-and-scope.md#permission-catalogue)). Not listed by a dedicated endpoint; the effective set for the caller is in `GET /auth/me.permissions`. |
| `user_location_assignments` | `user_id`, `location_id`, `assigned_at`, `assigned_by` | zero rows = unrestricted | `GET /users/:id/locations`, `PUT /users/:id/locations` (`core.users.locations.manage`). |
| `audit_log` | `actor_type` (`user`/`platform_admin`/`system`), `actor_id`, `action_code`, `entity_type`, `entity_id`, `before_state`/`after_state` (jsonb), `correlation_id`, `ip_address`, `created_at`; `tenant_id` **nullable** (platform actions) | — | **No read endpoint.** Written by every mutating module. Indexes: `(tenant_id, entity_type, entity_id)`, `(tenant_id, created_at)`, `(action_code, created_at)`. |

---

## 3. CATALOG — CATEGORIES / BRANDS / SUPPLIERS / ATTRIBUTES / PRODUCTS / VARIANTS / SERIALS / LOTS / PRICE HISTORY  (tenant-scoped)

| Table | Key fields | States | Exposed by API |
| --- | --- | --- | --- |
| `categories` | `name`, `code`, `parent_category_id`, `deleted_at` | `active` · `inactive` | `GET /categories` (`categories.view`, filter `status`, paginated), `GET /:id`, `POST`, `PATCH`; `GET/PUT /categories/:id/attributes`. |
| `brands` | `name`, `deleted_at` | `active` · `inactive` | **No CRUD, no list** — reference/attribution only (ADR-0019). Referenced by `products.brand_id`. |
| `suppliers` | `display_name`, `tax_id`, `email`, `phone`, `address`, `notes`, `deleted_at` | `active` · `inactive` | **No CRUD, no list** — passive reference only (ADR-0019). No PURCHASING context exists. |
| `attribute_definitions` / `attribute_options` / `category_attributes` | `code`, `data_type`, `applies_to`, unit, min/max, `display_order` | `active` · `inactive` | `GET/POST /attribute-definitions` (+ options sub-resource), `GET /categories/:id/attributes`. Governs the JSONB `attributes` on products/variants (ADR-0026). |
| `products` | `category_id`, `brand_id`, `supplier_id`, `name`, `description`, `status`, `warranty_months`, `attributes` (jsonb), `deleted_at` | `draft` · `active` · `discontinued` | `GET /products` (`products.view`, filter `status` + `categoryId`, paginated) → **no price, no stock on the list row**; `GET /:id`, `POST`, `PATCH`. |
| `product_variants` | `product_id`, `sku`, `barcode`, `unit`, `max_price`, `base_price`, `min_price`, `cost`, `status`, `is_serialized`, `is_lot_tracked`, `attributes` | `active` · `discontinued` | `GET /products/:id/variants`, `GET /products/:id/variants/:variantId`, `POST`, `PATCH`. `min_price` returned only with `pricing.floor.view`; `cost` only with `pricing.cost.view` (ADR-0028 — field-level, by inclusion, never strip-after). |
| `product_images` | `product_id`, `product_variant_id`, `storage_key`, `position` | — | **No list endpoint** (only `storage_key`; S3-backed). |
| `product_serials` | `product_variant_id`, `serial_number`, `status` | `in_stock` · `sold` · `returned` | **No read endpoint.** Written only by the Import Worker / serialized sale/return paths. |
| `product_lots` | `product_variant_id`, `lot_number`, `manufactured_date`, `expiry_date` | — | **No read endpoint.** Written only by the Import Worker. |
| `product_price_history` | `product_variant_id`, `max/base/min_price`, `changed_by`, `effective_from`, `effective_to` | — | **No read endpoint.** Append-only; written on every variant price change. |
| `tenant_price_policies` | `exceptional_discount_requires_approval` (default `true`), `max_discount_below_min_percent` (nullable) | — | **No endpoint** (read-only defaults in code; `pricing.policy.manage` exists in the catalogue but is unused). |
| `measurement_units` | `code`, `label`, `dimension` | — | `GET /measurement-units` (platform data). |

---

## 4. INVENTORY — WAREHOUSES / LOCATIONS / BALANCES / MOVEMENTS  (tenant-scoped)

| Table | Key fields | States | Exposed by API |
| --- | --- | --- | --- |
| `warehouses` | `name`, `code`, `address`, `deleted_at` | `active` · `inactive` | `GET /warehouses` (`warehouses.view`, filter `status`, paginated), `GET /:id`, `POST`, `PATCH`. |
| `locations` | `warehouse_id`, `parent_location_id`, `name`, `code`, `is_sellable`, `deleted_at` | `active` · `inactive` | `GET /locations` (`locations.view`, filter `warehouseId` + `status`, paginated), `GET /:id`, `POST`, `PATCH`. |
| `inventory_balances` **(materialized read model)** | `product_variant_id`, `location_id`, `quantity_physical`, `quantity_reserved`, `quantity_committed`, `quantity_available` (**GENERATED** = physical − reserved − committed), `version` | — | `GET /inventory/balances` (`inventory.view`, filter `productVariantId` + `locationId`, paginated) → **raw rows: IDs + quantities only, no product name / SKU / location name / warehouse, no status, no "in transit"**. `GET /inventory/balances/:id`. |
| `inventory_movements` **(source of truth, append-only)** | `product_variant_id`, `location_id`, `movement_type`, `quantity` (signed), `balance_after`, `reference_type`, `reference_id` (polymorphic soft ref), `reason`, `actor_type`, `actor_id`, `idempotency_key`, `correlation_id`, `occurred_at` (backdatable), `created_at` | 12 movement types: `RECEIPT` · `SALE` · `RETURN` · `ADJUSTMENT_IN` · `ADJUSTMENT_OUT` · `TRANSFER_OUT` · `TRANSFER_IN` · `RESERVATION` · `RESERVATION_RELEASE` · `COMMITMENT` · `COMMITMENT_RELEASE` · `INITIAL_STOCK` | `GET /inventory/movements` (`inventory.view`, filter `productVariantId` + `locationId` + `movementType`, paginated) → **raw rows, no names, NO date-range filter, NO reference filter, no sort param**. `POST /inventory/adjustments` (`inventory.adjust`) for `RECEIPT`/`ADJUSTMENT_IN`/`ADJUSTMENT_OUT`. Indexes: `(tenant, variant, location, created_at)`, `(tenant, reference_type, reference_id)`, `(tenant, created_at)`. |

**Cost note:** `inventory_movements` has **no `unit_cost` / value column**. `product_variants.cost`
is the current cost (nullable, mutable). There is no historical cost-at-movement anywhere in the
ledger → COGS and inventory valuation cannot be computed contractually (see
[data-gaps.md](data-gaps.md#gap-cost)).

---

## 5. INVENTORY TRANSFERS  (tenant-scoped)

| Table | Key fields | States | Exposed by API |
| --- | --- | --- | --- |
| `inventory_transfers` | `source_location_id`, `destination_location_id`, `status`, `requested_by`, `approved_by`, `dispatched_by`, `notes`, `created_at`, `approved_at`, `dispatched_at`, `received_at`, `cancelled_at` | `draft` · `approved` · `preparing` · `dispatched` · `partially_received` · `received` · `cancelled` | `GET /inventory/transfers` (`inventory.view`, filter `status` + `sourceLocationId` + `destinationLocationId`, paginated), `GET /:id`, plus command routes `POST /` , `/approve`, `/prepare`, `/dispatch`, `/receive`, `/cancel`. Response = **IDs only** (location IDs, user IDs — no names). **Aggregated:** `GET /reports/transfers-summary` (F18-08) — status rollup (`COUNT(*)` by status) + in-transit stock (`Σ dispatched − received` over `dispatched`/`partially_received`) by destination / variant, names resolved. |
| `inventory_transfer_items` | `transfer_id`, `product_variant_id`, `quantity_requested`, `quantity_dispatched`, `quantity_received` | — | In transfer detail (`quantityInTransit` = `dispatched − received` per item). **Aggregated** across open transfers by destination / variant via `GET /reports/transfers-summary` (F18-08). |
| `inventory_transfer_receipts` / `inventory_transfer_receipt_items` | receiving events, `incident_type` (`shortage`/`damage`/`excess`), `incident_notes` | — | Not exposed as a standalone list; only implied by the transfer's received quantities. |

---

## 6. QR  (tenant-scoped + public)

| Table | Key fields | States | Exposed by API |
| --- | --- | --- | --- |
| `qr_codes` | `code` (globally unique opaque token), `target_type` (`product_variant`/`location`), `target_id` (polymorphic soft ref), `expires_at` | `active` · `revoked` | `GET/POST /qr-codes` (`catalog.qr.manage`), `GET/PATCH /qr-codes/:id`, `GET /qr-codes/resolve/:code` (authenticated identity resolution), `GET /q/:code` (public, `app_public_resolver`, IP-rate-limited). |

QR resolves identity only (product/location), never pricing.

---

## 7. IMPORT  (tenant-scoped + Import Worker)

| Table | Key fields | States | Exposed by API |
| --- | --- | --- | --- |
| `import_jobs` | `created_by`, `default_location_id`, `mapping_template_id`, `column_mapping` (frozen jsonb), `duplicate_handling_mode`, `original_filename`, `total_rows`, `valid_rows`, `invalid_rows`, `warning_rows`, `imported_rows`, `error_report_storage_key`, `started_at`, `completed_at`, claim cols | `uploaded` · `mapping` · `validating` · `ready` · `importing` · `completed` · `completed_with_errors` · `failed` · `cancelled`. Modes: `update_catalog_only` · `update_catalog_and_inventory` · `skip_existing` · `reject_on_duplicate` | `GET /imports` (`import.execute`, filter `status`, paginated), `GET /imports/:id`, `/:id/rows`, `/:id/preview`, `/:id/errors`, plus the staged pipeline command routes. Row counts are **on the job row** — ready to display, no aggregation needed. |
| `import_job_rows` | `row_number`, `raw_data`, `mapped_data`, `status`, `match_action` (`create`/`update`/`skip`), `matched_product_variant_id`, `errors` (jsonb), `warnings` (jsonb) | `pending` · `valid` · `warning` · `invalid` · `imported` · `skipped` | `GET /imports/:id/rows` (per-job). **Never touched by reporting** — `raw_data`/`mapped_data` (raw uploaded cell values) and `errors`/`warnings` messages are sensitive and stay out of any analytic response. |
| `import_mapping_templates` | `name`, `category_id`, `column_mapping` | — | Full CRUD. |

**Aggregated (F18-09):** `GET /reports/imports-summary` (`import.execute`, tenant-wide) — `COUNT(*)`
jobs + `Σ total_rows`/`valid_rows`/`invalid_rows`/`warning_rows`/`imported_rows` over `import_jobs`
**alone** (no `import_job_rows` join), by `day`/`week`/`month` on `completed_at` or by terminal
`status`. `completed_at` is set on every terminal transition; non-terminal jobs (`NULL`) are
excluded, so a live "imports running" count is not this report (`GAP-MULTI-STATUS`).

---

## 8. SALES — CUSTOMERS / CART / ORDERS / PRICE APPROVALS / RETURNS  (tenant-scoped)

| Table | Key fields | States | Exposed by API |
| --- | --- | --- | --- |
| `customers` | `type` (`individual`/`business`), `display_name`, `tax_id` (unique per tenant), `email`, `phone`, `address`, `notes`, `deleted_at` | `active` · `inactive` | `GET /customers` (`sales.customers.view`, filter `status` + `type` + `q` free-text on displayName/taxId/email/phone, paginated), `GET /:id`, `POST`, `PATCH`. **No order history / totals per customer.** |
| `carts` / `cart_items` | one open cart per vendor (`user_id`), `location_id`, `customer_id`, `negotiated_unit_price` per line, `expires_at` | cart: `open` · `checked_out` · `abandoned` | `GET/POST/PATCH /cart`, `POST/PATCH/DELETE /cart/items` (`sales.carts.manage`). Operational only, not a reporting subject. |
| `orders` | `location_id`, `customer_id` + **frozen customer snapshot** (`customer_name/tax_id/email/phone/address_snapshot`), `order_number` (`ORD-` + 6-digit per-tenant seq), `document_type` (`invoice`/`sales_note`), `invoice_status` (`pending`/`issued`/`failed`, invoice only), `status`, `subtotal`, `discount_total`, `tax_total` (=0), `total`, `currency`, `placed_by_user_id`, `correlation_id`, `created_at`, `updated_at` | `draft` · `pending` · `confirmed` · `fulfilled` · `cancelled` (`draft`/`fulfilled` currently unreachable) | `GET /orders` (`sales.orders.view`, filters `status` + `customerId` + `documentType` + `createdFrom` + `createdTo`, paginated) → **each row is the full `OrderResponseDto` including line items**, no list-level aggregation. `GET /orders/:id`; commands `POST /orders` (`Idempotency-Key`), `/confirm`, `/cancel`. |
| `order_items` | frozen snapshots: `sku`, `product_name`, `max/base/min_price_snapshot`, `unit_price_snapshot`, `unit_cost_snapshot` (nullable), `quantity`, `discount_amount`, `is_exceptional_discount`, `line_total` | — | In order detail/list. `min_price_snapshot` gated by `pricing.floor.view`. `unit_cost_snapshot` is **captured at sale time** (so per-order margin IS possible — unlike the ledger) but the response DTO does not currently expose it. |
| `price_approvals` | `order_id`, `order_item_id`, `requested_price`, `min_price_at_request`, `max_price_at_request`, `discount_amount`, `reason`, `requested_by`, `approved_by`, `status`, `requested_at`, `resolved_at` | `pending` · `approved` · `rejected` · `cancelled` | `GET /price-approvals` (filter `status` + `orderId`, paginated) — **no `@RequirePermissions` on the two GETs** (any authenticated tenant member); `POST` (`pricing.discount.request`), `/:id/approve` + `/:id/reject` (`pricing.discount.approve`). `minPriceAtRequest` in response gated by `pricing.floor.view`. |
| `sales_returns` | `order_id`, `location_id`, `status`, `requested_by`, `received_by`, `reason`, `created_at`, `updated_at` | `requested` · `inspecting` · `resolved` · `cancelled` | `GET /sales-returns` (`sales.returns.view`, filter `status` + `orderId`, paginated), `GET /:id`, `POST` (`sales.returns.create`, `Idempotency-Key`), `/:id/inspect` + `/:id/resolve` (`inventory.returns.manage`), `/:id/cancel`. |
| `sales_return_items` | `order_item_id`, `product_variant_id`, `quantity_returned`, `disposition` (`restock`/`quarantine`/`damaged`/`scrap`), `disposition_location_id`, `inspected_by`, `inspected_at`, `notes` | — | In return detail. |

---

## 9. EVENTS / OUTBOX  (tenant-scoped rows, processor-only access)

| Table | Key fields | States | Exposed by API |
| --- | --- | --- | --- |
| `event_outbox` | `id` = stable `eventId`, `aggregate_type`/`aggregate_id`, `event_type`, `payload` (versioned envelope), `correlation_id`, `attempts`, `last_error`, `claimed_at`/`claimed_by`, `processed_at` | `pending` · `processing` · `delivered` · `dead_letter` | **No tenant read endpoint.** 8 event types (see [metrics.md](metrics.md#events--notifications) and `events.md#event-catalog`). FASE 17's planned "notification status on the order" indicator needs a **new** narrow read path over this table keyed by `aggregate_id = order.id` (documented in [data-gaps.md](data-gaps.md#gap-notif-status)). |

---

## 10. ADMINISTRATION  (tenant-scoped + platform)

| Table | Key fields | Exposed by API |
| --- | --- | --- |
| `tenant_settings` | `timezone` (IANA), `business_hours` (jsonb array) | `GET/PATCH /administration/tenant-settings` (`administration.settings.view`/`.manage`). **This is the only source of a tenant timezone** — see [filters-periods-and-scope.md](filters-periods-and-scope.md#periods-timezone-currency-precision). |

---

## 11. IDEMPOTENCY  (tenant-scoped, infra)

`idempotency_keys` (`scope`, `idempotency_key`, `request_hash`, `response_status`, `response_body`,
`expires_at`) — infrastructure, TTL-cleaned, **not a reporting subject**.

---

## 12. What is derivable but has no endpoint (candidate reporting read-side)

Everything below is computable from existing tables by a FASE 18 read-side query, but **no API
returns it today** (→ state B or C per item in [metrics.md](metrics.md)):

- Stock on hand per product/variant/warehouse/location **with names** (join `inventory_balances`
  × `product_variants` × `products` × `locations` × `warehouses`).
- Total available / reserved / committed across a tenant, or per warehouse.
- ~~In-transit quantity per variant/location aggregated across **all** open transfers.~~
  **Built — F18-08** (`GET /reports/transfers-summary?groupBy=destination|variant`).
- Inventory value (blocked — no historical cost; see [data-gaps.md](data-gaps.md#gap-cost)).
- Movements of a period, by type, by location, by product (blocked filters: no date range on
  `GET /inventory/movements`).
- Kardex / stock card per variant per location (the ledger supports it — `balance_after` is
  stored — but the endpoint lacks date range + ordering + name enrichment).
- Sales totals for a period (Σ `orders.total` where `status='confirmed'` and `created_at` in
  range) — `GET /orders` returns the rows but no server-side sum.
- Order count, average ticket, sales by product / customer / location / period.
- Exceptional-discount volume & value per period.
- Returns pending / by disposition / value.
- Pending approvals count & age.
- ~~Import jobs summary per period.~~ **Built — F18-09** (`GET /reports/imports-summary`,
  `[from,to)` on `import_jobs.completed_at`, `groupBy=day|week|month|status`).
- Per-customer order history and lifetime value.
- User activity detail (from `audit_log` — no read endpoint at all). `last_login_at` per user **is**
  exposed via `GET /users`.
