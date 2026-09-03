# F17 — Traceability Matrix

> Screen → real endpoint(s) → request/response DTO → permission → primary entity → governing
> ADR(s) → reporting/design reference → support state (**A** now · **B** additive · **GAP** ·
> **F18**). All API paths under `/api/v1/`. Read this alongside
> [f17-screen-catalog.md](f17-screen-catalog.md) (full detail) and [f17-gaps.md](f17-gaps.md).

## Auth

| Screen | Endpoint(s) | Req DTO | Resp DTO | Permission | Entity | ADR | Design / reporting ref | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S-AUTH-LOGIN` | `POST /auth/login` · `POST /auth/refresh` | `LoginDto {email,password}` | `LoginResponseDto` | `@Public` | `identities`, `tenant_memberships` | 0030, 0033 | `LoginDesktop/Mobile`; [017-A screen-mapping](../reporting/screen-mapping.md#login--logindesktop-loginmobile) | A |
| `S-AUTH-SELECT-TENANT` | `POST /auth/select-tenant` | `SelectTenantDto {tenantId, selectionToken?}` | `AuthSessionResponseDto` | `@Public` (selection cookie) | `tenant_memberships` | 0033 | `LoginDesktop/Mobile` state 2 | A |
| `S-AUTH-REGISTER` | `POST /auth/register` | `RegisterDto {companyName,email,password,fullName}` | `AuthSessionResponseDto` | `@Public` | `tenants`,`identities`,`users` | 0030, 0033 | — | A |

## Shell & Home

| Screen | Endpoint(s) | Req DTO | Resp DTO | Permission | Entity | ADR | Ref | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S-SHELL` | `GET /auth/me` · `GET /tenant` · `POST /auth/logout` | — | `CurrentUserResponseDto`, `TenantResponseDto` | auth only | `users`,`tenants`,`permissions` | 0009, 0030, 0033 | `Main`/`AppShell*` | A |
| `S-HOME` | `GET /orders?status=pending` · `GET /orders?status=confirmed&createdFrom=` · `GET /price-approvals?status=pending` · `GET /sales-returns?status=requested\|inspecting` · `GET /inventory/transfers?status=dispatched\|partially_received` · `GET /imports?status=failed\|completed_with_errors` · `GET /products?status=draft` · `GET /administration/tenant-settings` | list query DTOs | `PaginatedResult<*>` (`meta.total`), `TenantSettingsResponseDto` | per tile (`sales.orders.view`, `pricing.discount.request\|approve`, `sales.returns.view`, `inventory.view`, `import.execute`, `products.view`, `administration.settings.view` for the date tile) | multiple | — | [017-A dashboards §1](../reporting/dashboards.md#1-tenant-operational-dashboard--home) | A; built F17-12 at `/`. Every KPI a real `meta.total`; multi-status rollups = 2 parallel GETs (`GAP-MULTI-STATUS`); "Orders today" uses `tenant_settings.timezone` → UTC midnight (`lib/home/tenant-day.ts`), degraded to "Not available" for roles without `administration.settings.view` (`GAP-TZ-VISIBILITY`); no inventory aggregate / revenue tile (`GAP-INV-AGGREGATE`, A9→F18). Per-tile no-access/unavailable/empty; no N+1, no polling |

## Tenant administration

| Screen | Endpoint(s) | Req DTO | Resp DTO | Permission | Entity | ADR | Ref | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S-SETTINGS` | `GET/PATCH /tenant` · `GET/PATCH /administration/tenant-settings` | `UpdateTenantDto`, tenant-settings DTO | `TenantResponseDto`, settings DTO | view: none / `core.tenant.update`, `administration.settings.view`/`.manage` | `tenants`,`tenant_settings` | 0031 | — / [017-A filters §2](../reporting/filters-periods-and-scope.md#periods-timezone-currency-precision) | A |
| `S-USERS-LIST` | `GET /users` | `ListUsersQueryDto {page,pageSize,status?}` | `PaginatedResult<UserResponseDto>` | `core.users.read` | `users`,`user_roles` | 0031, 0033 | 017-DESIGN `/users` | A |
| `S-USER-NEW` | `POST /users` · `GET /roles` | `CreateUserDto {email,fullName,password,roleId}` | `UserResponseDto` | `core.users.create` | `users`,`identities`,`tenant_memberships`,`roles` | 0031, 0033 | — | A |
| `S-USER-DETAIL/EDIT` | `GET/PATCH /users/:id` · `GET/PUT /users/:id/locations` | `UpdateUserDto`, `{locationIds[]}` | `UserResponseDto` | `core.users.read`/`.update`/`.locations.manage` | `users`,`user_roles`,`user_location_assignments` | 0024, 0031 | — | A |
| `S-ROLES-LIST` | `GET /roles` | — | roles + `permissionCodes[]` | `core.roles.read` | `roles`,`role_permissions` | 0009 | — | A (read-only); CRUD = `GAP-ROLE-CRUD` |

## Catalog

| Screen | Endpoint(s) | Req DTO | Resp DTO | Permission | Entity | ADR | Ref | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S-CAT-PRODUCTS` | `GET /products` | `ListProductsQueryDto {page,pageSize,status?,categoryId?}` | `PaginatedResult<ProductResponseDto>` | `products.view` | `products` | 0017, 0026 | `ProductsDesktop/Tablet/Mobile`; [017-A `REP-CAT-PRODUCTS`](../reporting/reports.md#rep-cat-products--product-catalogue) | A; enrich/search/sort = B (`GAP-SEARCH`/`GAP-SORT`/`GAP-NAME-ENRICHMENT`) |
| `S-CAT-PRODUCT-NEW` | `POST /products` · `GET /categories` · `GET /categories/:id/attributes` · `GET /attribute-definitions` · `GET /attribute-definitions/:id/options` | `CreateProductDto` (+ `defaultVariant: VariantFieldsDto`) | `ProductResponseDto` | `products.manage` (+ `categories.view` for the attribute group) | `products`,`product_variants` | 0017, 0026, 0028 | `ProductForm` | A; brand/supplier selector **omitted** = `GAP-BRAND-SUPPLIER-LIST` (option b) |
| `S-CAT-PRODUCT-DETAIL/EDIT` | `GET/PATCH /products/:id` · `GET /products/:id/variants` · `GET /categories/:id/attributes` · `GET /attribute-definitions(/:id/options)` · `GET /inventory/balances?productVariantId=` *(variant Stock card, `inventory.view`)* | `UpdateProductDto`, `VariantFieldsDto` | `ProductResponseDto`, `VariantResponseDto[]`, `BalanceResponseDto[]` | `products.view`/`.manage` (+ `pricing.floor.view`/`.cost.view` for gated fields; `inventory.view` for stock) | `products`,`product_variants`,`product_price_history`,`inventory_balances` | 0017, 0026, 0028 | `ProductForm` | A; price history = B (`GAP-PRICE-HISTORY-READ`); images = B |
| `S-CAT-VARIANT-EDIT` | `POST/PATCH /products/:id/variants[/:variantId]` · `GET /categories/:id/attributes` · `GET /attribute-definitions(/:id/options)` | `VariantFieldsDto` | `VariantResponseDto` | `products.manage` | `product_variants` | 0017, 0026, 0028 | — | A; `sku`/`isSerialized`/`isLotTracked` read-only on PATCH |
| `S-CAT-CATEGORIES` | `GET/POST /categories` · `GET/PATCH /categories/:id` · `GET/PUT /categories/:id/attributes` | `ListCategoriesQueryDto {page,pageSize,status?}`, create/update DTOs | `PaginatedResult<CategoryResponseDto>` | `categories.view`/`.manage`, `catalog.attributes.manage` | `categories`,`category_attributes` | 0026 | — | A |
| `S-CAT-ATTR-DEFS` | `GET/POST /attribute-definitions` · `PATCH /attribute-definitions/:id` · options sub-resource · `GET /measurement-units` | attribute DTOs | attribute response DTOs | `products.view` / `catalog.attributes.manage` | `attribute_definitions`,`attribute_options`,`measurement_units` | 0026 | — | A |
| `S-QR-LIST/NEW` | `GET/POST /qr-codes` · `GET/PATCH /qr-codes/:id` · `GET /qr-codes/resolve/:code` | qr DTOs `{targetType,targetId,expiresAt?}` | qr response DTOs | `catalog.qr.manage`; resolve = none | `qr_codes` | — | mobile.md#qr | A; target name = B |

## Inventory

| Screen | Endpoint(s) | Req DTO | Resp DTO | Permission | Entity | ADR | Ref | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S-INV-BALANCES` | `GET /inventory/balances` · `GET /inventory/balances/:id` | `ListBalancesQueryDto {page,pageSize,productVariantId?,locationId?}` | `PaginatedResult<BalanceResponseDto>` | `inventory.view` | `inventory_balances` | 0024 | `InventoryDesktop/Tablet/Mobile`; [017-A `REP-INV-STOCK`](../reporting/reports.md#rep-inv-stock--existencias-stock-on-hand) | A (numbers); enriched/aggregated = B (`GAP-INV-AGGREGATE`,`GAP-NAME-ENRICHMENT`) |
| `S-INV-BALANCE-DETAIL` | `GET /inventory/balances/:id` (+ `GET /locations`, `GET /warehouses` for name resolution, shared `buildLocationIndex`) | — | `BalanceResponseDto` | `inventory.view` | `inventory_balances` | 0024 | — | A; built F17-06 at `/inventory/[balanceId]`; links to the kardex |
| `S-INV-MOVEMENTS` | `GET /inventory/movements` | `ListMovementsQueryDto {page,pageSize,productVariantId?,locationId?,movementType?}` | `PaginatedResult<MovementResponseDto>` | `inventory.view` | `inventory_movements` | 0024 | [017-A `REP-INV-KARDEX`](../reporting/reports.md#rep-inv-kardex--stock-card--kardex) | A (filtered); date range/sort/names = B (`GAP-MOVEMENTS-DATE-FILTER`); no reference drill-down route (shown as text) |
| `S-INV-ADJUST` | `POST /inventory/adjustments` (+ `GET /products`, `GET /products/:id/variants`, `GET /locations` to populate the pickers) | `CreateAdjustmentDto {productVariantId,locationId,movementType,quantity,reason,occurredAt?}` | `MovementResponseDto` | `inventory.adjust` + location auth (+ `products.view`/`locations.view` for the pickers) | `inventory_movements`,`inventory_balances` | 0024 | — | A; built F17-06 as a page at `/inventory/adjust` (not a drawer); accepts `?productVariantId=&locationId=&sku=` for a drill-in |
| `S-WH-LIST/EDIT` | `GET/POST /warehouses` · `GET/PATCH /warehouses/:id` | `ListWarehousesQueryDto {page,pageSize,status?}`, create/update | `PaginatedResult<WarehouseResponseDto>` | `warehouses.view`/`.manage` | `warehouses`,`locations` | 0018 | — | A |
| `S-LOC-LIST/EDIT` | `GET/POST /locations` · `GET/PATCH /locations/:id` | `ListLocationsQueryDto {page,pageSize,warehouseId?,status?}`, create/update | `PaginatedResult<LocationResponseDto>` | `locations.view`/`.manage` | `locations` | 0018, 0024 | — | A |
| `S-TRF-LIST/DETAIL` (`S-INV-TRANSFERS` / `S-INV-TRANSFER-DETAIL`) | `GET /inventory/transfers` · `GET /inventory/transfers/:id` | `ListTransfersQueryDto {page,pageSize,status?,sourceLocationId?,destinationLocationId?}` | `PaginatedResult<TransferResponseDto>` | `inventory.view` | `inventory_transfers`,`_items`,`_receipts` | 0020, 0024 | `TransfersDesktop/Tablet/Mobile`; [017-A `REP-INV-TRANSFERS`](../reporting/reports.md#rep-inv-transfers--transfers) | A; built F17-07 at `/inventory/transfers` + `/inventory/transfers/[id]`. Single `status` filter (`GAP-MULTI-STATUS`) as chips + source/dest `<select>`; FK ids only → `buildLocationIndex()` for location/warehouse names, `shortId` for transfer id (`GAP-TRANSFER-CODE`) and variant/user ids (`GAP-NAME-ENRICHMENT`, `GAP-VARIANT-LIST`) |
| `S-TRF-NEW` (`S-INV-TRANSFER-NEW`) | `POST /inventory/transfers` (+ `GET /products`, `GET /products/:id/variants`, `GET /locations` for the pickers) | `CreateTransferDto {sourceLocationId,destinationLocationId,items:[{productVariantId,quantityRequested}],notes?}` | `TransferResponseDto` | `inventory.transfers.request` (+ `products.view`/`locations.view` for the pickers); location auth is enforced later at prepare/dispatch | `inventory_transfers` | 0020, 0024 | — | A; built F17-07 at `/inventory/transfers/new`. Product → Variant → qty per line (`GAP-VARIANT-LIST`); never sends `tenantId`/`requestedBy`/`status` |
| `S-TRF-RECEIVE` (`S-INV-TRANSFER-DETAIL` actions) | `POST /inventory/transfers/:id/approve`\|`/prepare`\|`/dispatch`\|`/cancel` · `POST /inventory/transfers/:id/receive` (+ `Idempotency-Key` header, REQUIRED) | `DispatchTransferDto {items?:[{transferItemId,quantityDispatched}]}`, `ReceiveTransferDto {items:[{transferItemId,quantityReceived,incidentType?,incidentNotes?}],notes?}` | `TransferResponseDto` | approve/cancel: `inventory.transfers.approve`; prepare/dispatch: `inventory.transfers.dispatch` + **source** location auth; receive: `inventory.transfers.receive` + **destination** location auth | `inventory_transfers`,`_items`,`_receipts`,`_receipt_items`,`inventory_movements` | 0020, 0024 | — | A; built F17-07 as `transfer-actions.tsx` on the detail. One `Idempotency-Key` per receiving attempt, preserved across retries, regenerated per fresh attempt; buttons rendered only when status + permission allow; 403/409 shown in place, `router.refresh()` on success |

## Sales

| Screen | Endpoint(s) | Req DTO | Resp DTO | Permission | Entity | ADR | Ref | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S-SALE-NEW` | `GET/POST/PATCH /cart` · `POST/PATCH/DELETE /cart/items[/:id]` · `POST /orders` (+ `Idempotency-Key` header, REQUIRED) · `GET /customers?q=` · `GET /products?status=active` + `GET /products/:id/variants` · `GET /locations` | `CreateCartDto {locationId,customerId?}`, `AddCartItemDto {productVariantId,quantity,negotiatedUnitPrice?}`, `UpdateCartItemDto {quantity?,negotiatedUnitPrice?}`, `CreateOrderDto {cartId,documentType}` | `CartResponseDto`, `OrderResponseDto` | `sales.carts.manage` + `sales.orders.create` (+ `sales.customers.view` picker, `products.view`/`locations.view` pickers); cart/checkout location auth (ADR-0024) enforced backend | `carts`,`cart_items`,`orders`,`order_items`,`inventory_movements` (RESERVATION) | 0022, 0023, 0028 | `NewSaleDesktop/Tablet/Mobile` | A; built F17-08 at `/sales/new`. Cart is the backend's singular `/cart` resource (not browser storage); Product → Variant picker (`GAP-VARIANT-LIST`); one `Idempotency-Key` per checkout attempt, held across retries; never sends `tenantId`/`customerId`/`locationId`/`total`/`status` on `POST /orders` |
| `S-CUST-LIST` | `GET /customers` | `ListCustomersQueryDto {page,pageSize,status?,type?,q?}` | `PaginatedResult<CustomerResponseDto>` | `sales.customers.view` | `customers` | — | `NewSale*` customer card; [017-A `REP-CUST-LIST`](../reporting/reports.md#rep-cust-list--customers) | A; built F17-08 at `/customers`. Real `q` search (backend match, `GAP-SEARCH`); `status`/`type` filters; native GET form |
| `S-CUST-NEW/EDIT/DETAIL` | `POST/PATCH /customers[/:id]` · `GET /customers/:id` · `GET /orders?customerId=` | `CreateCustomerDto`, `UpdateCustomerDto`, `AddressDto` | `CustomerResponseDto`, `PaginatedResult<OrderResponseDto>` | `sales.customers.view`/`.manage` (+ `sales.orders.view` for the order list) | `customers`,`orders` | — | — | A; built F17-08 at `/customers/new` + `/customers/[id]`. 409 on duplicate `taxId` in place; commercial-data (taxId/email/phone/address) nudge for checkout; history list = A, rollups = B (`GAP-CUSTOMER-HISTORY`) |
| `S-SALES-HISTORY` | `GET /orders` | `ListOrdersQueryDto {page,pageSize,status?,customerId?,documentType?,createdFrom?,createdTo?}` | `PaginatedResult<OrderResponseDto>` | `sales.orders.view` | `orders`,`order_items` | 0022, 0023, 0028 | `SalesHistoryDesktop`; [017-A `REP-SALES-ORDERS`](../reporting/reports.md#rep-sales-orders--sales--orders-list) | A; built F17-09 at `/sales`. KPI tiles = F18; per-row notif status deferred (N+1) — status is on the detail (F17-10) |
| `S-ORDER-DETAIL` | `GET /orders/:id` · `POST /orders/:id/confirm` · `POST /orders/:id/cancel` · `GET /orders/:id/notifications` | — | `OrderResponseDto`, `OrderNotificationsResponseDto` | `sales.orders.view`/`.create`/`.cancel` | `orders`,`price_approvals`,`inventory_movements`,`event_outbox` (read) | 0021, 0022, 0023 | — | built F17-08 read-only · F17-09 confirm/cancel + approvals · **F17-10** notification-status card (`GAP-NOTIF-STATUS` status half closed; retry = `GAP-NOTIF-RETRY-BACKEND`) + "Start a return" + related-returns list. margin = `GAP-ORDER-MARGIN` |
| `S-APPROVALS-LIST/DETAIL` | `GET /price-approvals` · `GET /price-approvals/:id` · `POST /price-approvals/:id/approve`\|`/reject` | `ListPriceApprovalsQueryDto {page,pageSize,status?,orderId?}` | `PaginatedResult<PriceApprovalResponseDto>` | GET: `pricing.discount.request` **or** `.approve` (`@RequireAnyPermission`, F17-09); resolve: `pricing.discount.approve` (+ `pricing.floor.view` for `minPriceAtRequest`) | `price_approvals` | 0022, 0028 | `ReturnsDesktop` (reused) | built F17-09 at `/approvals`, `/approvals/[id]` |
| `S-APPROVAL-NEW` | `POST /price-approvals` | `CreatePriceApprovalDto {orderItemId,reason,requestedPrice?}` | `PriceApprovalResponseDto` | `pricing.discount.request` | `price_approvals`,`order_items` | 0022 | — | built F17-09 (request flow on the order detail) |

## Returns

| Screen | Endpoint(s) | Req DTO | Resp DTO | Permission | Entity | ADR | Ref | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S-RET-LIST/DETAIL` | `GET /sales-returns` · `GET /sales-returns/:id` (+ `GET /orders/:id` for line SKUs when `sales.orders.view`) | `ListReturnsQueryDto {page,pageSize,status?,orderId?}` | `PaginatedResult<ReturnResponseDto>` (no `orderNumber`/SKU — `GAP-NAME-ENRICHMENT`) | `sales.returns.view` | `sales_returns`,`sales_return_items` | 0021 | `ReturnsDesktop`; [017-A `REP-RET-LIST`](../reporting/reports.md#rep-ret-list--rep-ret-detail) | **built F17-10** at `/returns`, `/returns/[id]` |
| `S-RET-NEW` | `POST /sales-returns` (+ `Idempotency-Key`) · `GET /orders?status=confirmed` · `GET /orders/:id` + `GET /sales-returns?orderId=` (returnable hint) · `GET /locations` | `CreateReturnDto {orderId,locationId,reason,items[]}` | `ReturnResponseDto` | `sales.returns.create` | `sales_returns` | 0021 | — | **built F17-10** at `/returns/new` (also linked from the order detail) |
| `S-RET-DETAIL` actions | `POST /sales-returns/:id/inspect` · `/resolve` (+ `Idempotency-Key`) · `/cancel` | `InspectReturnDto {items:[{returnItemId,disposition,dispositionLocationId,notes?}]}` | `ReturnResponseDto` | `inventory.returns.manage` (inspect/resolve) + location auth; `sales.returns.create` (cancel) | `sales_return_items`,`inventory_movements` | 0021, 0024 | — | **built F17-10** (`ReturnActions`) |

## Import

| Screen | Endpoint(s) | Req DTO | Resp DTO | Permission | Entity | ADR | Ref | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S-IMP-NEW` | `POST /imports` (multipart `file` + `mappingTemplateId`\|`columnMapping`,`defaultLocationId?`,`duplicateHandlingMode?`; **no** `Idempotency-Key`) · `GET /imports/template` (`<a>` link) | multipart text fields | `ImportJobResponseDto` | `import.execute` | `import_jobs`,`import_job_rows` | 0027, 0029 | `ImportDesktop` | **built F17-11** at `/imports/new`; mapping chosen up front (`GAP-IMPORT-FILE-HEADERS`) |
| `S-IMP-DETAIL` (pipeline) | `POST /imports/:id/mapping`\|`/validate`\|`/confirm`\|`/cancel` · `GET /imports/:id`\|`/preview` · `GET /imports/:id/errors` (`<a>` link) | `SetMappingDto` | `ImportJobResponseDto` / `ImportPreviewResponseDto` | `import.execute` (+ `import.inventory` server-side at confirm for inventory mode) | `import_jobs` | 0027 | — | **built F17-11** (`ImportPipeline`); status+counters only, `GAP-IMPORT-PROGRESS` open |
| `S-IMP-LIST` / `S-IMP-ROWS` | `GET /imports` · `GET /imports/:id/rows` | `ListImportJobsQueryDto {page,pageSize,status?}` · `ListImportJobRowsQueryDto {…,status?}` | `PaginatedResult<ImportJobResponseDto>` / `<ImportJobRowResponseDto>` | `import.execute` | `import_jobs`,`import_job_rows` | 0027 | [017-A `REP-IMP-JOBS`](../reporting/reports.md#rep-imp-jobs--rep-imp-rows--rep-imp-errors) | **built F17-11** (`/imports`, rows on the detail page) |
| `S-IMP-TEMPLATES` | `GET/POST/PATCH/DELETE /import-mapping-templates[/:id]` | `Create/UpdateMappingTemplateDto {name,categoryId?,columnMapping}` | `MappingTemplateResponseDto` | `import.execute` | `import_mapping_templates` | 0027 | — | **built F17-11** at `/imports/templates` (real DELETE) |

## Super-Admin

| Screen | Endpoint(s) | Req DTO | Resp DTO | Permission | Entity | ADR | Ref | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S-SA-LOGIN` | `POST /platform/auth/login`\|`/refresh`\|`/logout` · `GET /platform/auth/me` | platform login DTO | platform session | `@Public` / `@PlatformOnly` | `platform_admins`,`platform_admin_refresh_tokens` | 0032 | multi-tenancy.md#superadmin-vs-tenant | A |
| `S-SA-TENANTS` | `GET /platform/tenants` | — | `PlatformTenantResponseDto[]` (**unpaginated**) | `@PlatformOnly` | `tenants` | 0032 | [017-A `REP-PLAT-TENANTS`](../reporting/reports.md#rep-plat-tenants--companies-superadmin) | A |
| `S-SA-TENANT-DETAIL` | `GET /platform/tenants/:id` · `POST /platform/tenants/:id/suspend`\|`/activate` | — | `PlatformTenantResponseDto` | `@PlatformOnly` (audited) | `tenants`,`audit_log` | 0032, 0015 | — | A; admins/metrics/create = `GAP-SA-*` |

## Referenced but not F17 (traceability of exclusions)

| Element | Reason | Gap |
| --- | --- | --- |
| Executive/analytical dashboards | aggregation/trend/rank | 017-A `dashboards.md`, [f17-f18-boundary](f17-f18-boundary.md) |
| Brands/Suppliers CRUD | no endpoint | ADR-0019, `GAP-BRAND-SUPPLIER-LIST` |
| Serial/lot browser, price-history, audit viewer | no read endpoint | `GAP-*` / deferred design |
| Notifications bell, global search | no endpoint | PROTOTYPE ONLY |
| Role/permission CRUD | no endpoint | `GAP-ROLE-CRUD` |
| Platform dashboard, admin CRUD, tenant creation | no endpoint / isolation | `GAP-SA-*`, `GAP-PLATFORM-AGGREGATE` |
| Dark mode, in-session tenant switch | deferred / not a feature | 017-DESIGN §24 / 016-C |
