# F17 — Module & Screen Dependency Map

> What each screen needs *to exist and function*. "Depends on" = the target screen/data must be
> usable first (for its selector, its drill-down source, or its prerequisite entity). Derived from
> the real FK graph and endpoint shapes.

## Entity dependency graph (backend FKs)

```
tenant ──┬── users ── user_roles ── roles ── role_permissions ── permissions(platform)
         │      └── user_location_assignments ── locations
         ├── categories(self-parent) ── category_attributes ── attribute_definitions ── attribute_options
         │                                                             └── measurement_units(platform)
         ├── brands / suppliers  (reference only — no CRUD)
         ├── products ── product_variants ──┬── product_images
         │                                  ├── product_serials / product_lots
         │                                  ├── product_price_history
         │                                  └── (qr_codes → target)
         ├── warehouses ── locations(self-parent, is_sellable)
         │                     └── inventory_balances (variant × location, GENERATED available)
         │                     └── inventory_movements (append-only ledger, balance_after)
         ├── inventory_transfers ── inventory_transfer_items ── inventory_transfer_receipts ── receipt_items
         ├── customers
         ├── carts ── cart_items          (one open cart per user)
         ├── orders ── order_items ──┬── price_approvals
         │                           └── sales_returns ── sales_return_items ── (disposition_location)
         ├── tenant_price_policies   (read-only defaults — no endpoint)
         ├── tenant_settings         (timezone, business hours)
         ├── event_outbox            (processor-only; notification status = GAP)
         └── audit_log               (write-only — no read endpoint)
```

## Screen dependency chains

### Catalog
```
S-CAT-CATEGORIES ─┐
S-CAT-ATTR-DEFS ──┤→ S-CAT-PRODUCT-NEW/EDIT → S-CAT-PRODUCT-DETAIL → S-CAT-VARIANT-EDIT
(brands/suppliers)┘         (GAP-BRAND-SUPPLIER-LIST for the selectors)
S-CAT-PRODUCT-DETAIL → S-QR-NEW (target = a variant)
S-CAT-PRODUCT-DETAIL → S-INV-BALANCES?productVariantId= (stock drill-down)
```
- `S-CAT-PRODUCT-NEW` **hard-depends** on `S-CAT-CATEGORIES` (categoryId selector) and the
  attribute set for that category. **Soft-depends** on brand/supplier lists → **GAP**.

### Inventory
```
S-WH-LIST → S-LOC-LIST → S-INV-BALANCES / S-INV-MOVEMENTS
S-LOC-LIST + S-CAT-PRODUCT-DETAIL → S-INV-ADJUST (variant + location + location auth)
S-LOC-LIST + variants → S-TRF-NEW → S-TRF-DETAIL → S-TRF-RECEIVE
S-TRF-* writes → S-INV-MOVEMENTS (TRANSFER_OUT/IN) → S-INV-BALANCES
```
- `S-INV-*` **hard-depend** on `S-WH-LIST` + `S-LOC-LIST` (there is no stock without a location).
- `S-TRF-NEW` **hard-depends** on `S-LOC-LIST` (source/destination) and a way to pick variants
  (**GAP-VARIANT-LIST** for search, or pick via product→variant).

### Sales
```
S-CUST-LIST ─┐
S-LOC-LIST ──┤→ S-SALE-NEW (cart) ──checkout──→ S-ORDER-DETAIL (pending)
variants ────┘        │                              │
                      └→ S-APPROVAL-NEW               ├─confirm→ (gated on approvals)
                                                      └─cancel→ (releases reservation)
S-ORDER-DETAIL → S-RET-NEW → S-RET-DETAIL → inspect → resolve (writes RETURN movements)
S-APPROVALS-LIST → S-APPROVAL-DETAIL → S-ORDER-DETAIL
order confirm → event_outbox → (notification status = GAP-NOTIF-STATUS on S-ORDER-DETAIL / S-SALES-HISTORY)
```
- `S-SALE-NEW` **hard-depends** on: `S-CUST-LIST` (customer with full commercial data — 012-A),
  `S-LOC-LIST` (cart location), catalog variants + prices, and (for below-floor) `S-APPROVAL-NEW`.
- `S-ORDER-DETAIL` **confirm** is gated by `S-APPROVALS-LIST` outcomes for exceptional lines.
- `S-RET-NEW` **hard-depends** on a **`confirmed`** order (`S-ORDER-DETAIL`).

### Import
```
S-CAT-CATEGORIES + S-LOC-LIST + S-WH-LIST → S-IMP-TEMPLATES → S-IMP-NEW
S-IMP-NEW (wizard) → S-IMP-DETAIL / S-IMP-ROWS / S-IMP-ERRORS
S-IMP-NEW commit → catalog + inventory (same repositories every other flow uses)
```
- The dynamic `.xlsx` template reflects the tenant's real categories/attributes/warehouses/
  locations → those must exist first for a meaningful import.

### Administration
```
S-LOC-LIST → S-USER-DETAIL (location-access editor)
S-ROLES-LIST (read) → S-USER-NEW/EDIT (role selector)
S-SETTINGS.timezone → every date filter / Home "today" computation
```

### Super-Admin (independent)
```
S-SA-LOGIN → S-SA-TENANTS → S-SA-TENANT-DETAIL (suspend / activate)
```
- No dependency on any tenant screen (and must not have one).

## Cross-cutting dependencies

| Consumer | Depends on | Nature |
| --- | --- | --- |
| Every `(tenant)` screen | `S-SHELL` + `GET /auth/me` (session + permissions) | hard |
| Every date filter / Home | `S-SETTINGS` (`tenant_settings.timezone`) | hard (for correct "today"/"month") |
| Every list screen | `f17-functional-contract.md` `DataTable`/`Pagination`/`TableToolbar` | component |
| Every location-targeting write | `user_location_assignments` (ADR-0024) | authorisation |
| Every gated price display | `pricing.floor.view` / `pricing.cost.view` in `session.permissions` | field visibility |

## Build-order implication

The dependency graph forces roughly: **shell/auth → settings (timezone) → warehouses → locations →
categories → attributes → products/variants → inventory → transfers → customers → sales/cart →
orders → approvals → returns → imports → users/roles/location-access → super-admin.** See
[f17-implementation-order.md](f17-implementation-order.md) for the justified sequence.
