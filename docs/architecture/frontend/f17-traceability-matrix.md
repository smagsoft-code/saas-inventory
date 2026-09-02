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
| `S-HOME` | `GET /price-approvals?status=` · `GET /imports?status=` · `GET /orders?status=&createdFrom=` · `GET /products?status=draft` · `GET /sales-returns?status=` · `GET /inventory/transfers?status=` | list query DTOs | `PaginatedResult<*>` (`meta.total`) | per tile | multiple | — | [017-A dashboards §1](../reporting/dashboards.md#1-tenant-operational-dashboard--home) | A/B |

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
| `S-TRF-LIST/DETAIL` | `GET /inventory/transfers` · `GET /inventory/transfers/:id` | `ListTransfersQueryDto {page,pageSize,status?,sourceLocationId?,destinationLocationId?}` | `PaginatedResult<TransferResponseDto>` | `inventory.view` | `inventory_transfers`,`_items`,`_receipts` | 0020, 0024 | `TransfersDesktop/Tablet/Mobile`; [017-A `REP-INV-TRANSFERS`](../reporting/reports.md#rep-inv-transfers--transfers) | A; names/code = B |
| `S-TRF-NEW` | `POST /inventory/transfers` | `CreateTransferDto {sourceLocationId,destinationLocationId,items[],notes?}` | `TransferResponseDto` | `inventory.transfers.request` + location auth | `inventory_transfers` | 0020, 0024 | — | A |
| `S-TRF-RECEIVE` | `POST /inventory/transfers/:id/receive` (+ `Idempotency-Key`) · `.../approve` `.../prepare` `.../dispatch` `.../cancel` | `ReceiveTransferDto {items[],notes?}` | `TransferResponseDto` | `.receive`/`.approve`/`.dispatch` + location auth | `inventory_transfers`,`_receipt_items`,`inventory_movements` | 0020, 0024 | — | A |

## Sales

| Screen | Endpoint(s) | Req DTO | Resp DTO | Permission | Entity | ADR | Ref | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S-SALE-NEW` | `GET/POST/PATCH /cart` · `POST/PATCH/DELETE /cart/items[/:id]` · `POST /orders` (+ `Idempotency-Key`) · `GET /customers?q=` · `GET /products` + `/:id/variants` | `CreateCartDto`, `AddCartItemDto`, `CreateOrderDto {cartId,documentType}` | `CartResponseDto`, `OrderResponseDto` | `sales.carts.manage`, `sales.orders.create` | `carts`,`cart_items`,`orders`,`order_items` | 0022, 0023, 0028 | `NewSaleDesktop/Tablet/Mobile` | A; SKU search = `GAP-VARIANT-LIST` |
| `S-CUST-LIST` | `GET /customers` | `ListCustomersQueryDto {page,pageSize,status?,type?,q?}` | `PaginatedResult<CustomerResponseDto>` | `sales.customers.view` | `customers` | — | `NewSale*` customer card; [017-A `REP-CUST-LIST`](../reporting/reports.md#rep-cust-list--customers) | A |
| `S-CUST-NEW/EDIT/DETAIL` | `POST/PATCH /customers[/:id]` · `GET /customers/:id` · `GET /orders?customerId=` | customer DTOs | `CustomerResponseDto` | `sales.customers.manage`/`.view` | `customers`,`orders` | — | — | A; history = B (`GAP-CUSTOMER-HISTORY`) |
| `S-SALES-HISTORY` | `GET /orders` | `ListOrdersQueryDto {page,pageSize,status?,customerId?,documentType?,createdFrom?,createdTo?}` | `PaginatedResult<OrderResponseDto>` | `sales.orders.view` | `orders`,`order_items` | 0022, 0023, 0028 | `SalesHistoryDesktop`; [017-A `REP-SALES-ORDERS`](../reporting/reports.md#rep-sales-orders--sales--orders-list) | A (list); KPI tiles = F18; notif status = `GAP-NOTIF-STATUS` |
| `S-ORDER-DETAIL` | `GET /orders/:id` · `POST /orders/:id/confirm` · `POST /orders/:id/cancel` | — | `OrderResponseDto` | `sales.orders.view`/`.create`/`.cancel` | `orders`,`price_approvals`,`inventory_movements` | 0022, 0023 | — | A; margin = `GAP-ORDER-MARGIN` |
| `S-APPROVALS-LIST/DETAIL` | `GET /price-approvals` · `GET /price-approvals/:id` · `POST /price-approvals/:id/approve`\|`/reject` | `ListPriceApprovalsQueryDto {page,pageSize,status?,orderId?}` | `PaginatedResult<PriceApprovalResponseDto>` | **GET: none** (`GAP-APPROVALS-PERMISSION`); resolve: `pricing.discount.approve` (+ `pricing.floor.view` for `minPriceAtRequest`) | `price_approvals` | 0022, 0028 | `ReturnsDesktop` (reused) | A; permission fix required |
| `S-APPROVAL-NEW` | `POST /price-approvals` | `CreatePriceApprovalDto {orderItemId,reason,requestedPrice?}` | `PriceApprovalResponseDto` | `pricing.discount.request` | `price_approvals`,`order_items` | 0022 | — | A |

## Returns

| Screen | Endpoint(s) | Req DTO | Resp DTO | Permission | Entity | ADR | Ref | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S-RET-LIST/DETAIL` | `GET /sales-returns` · `GET /sales-returns/:id` | `ListReturnsQueryDto {page,pageSize,status?,orderId?}` | `PaginatedResult<ReturnResponseDto>` | `sales.returns.view` | `sales_returns`,`sales_return_items` | 0021 | `ReturnsDesktop`; [017-A `REP-RET-LIST`](../reporting/reports.md#rep-ret-list--rep-ret-detail) | A |
| `S-RET-NEW` | `POST /sales-returns` (+ `Idempotency-Key`) | `CreateReturnDto {orderId,locationId,reason,items[]}` | `ReturnResponseDto` | `sales.returns.create` | `sales_returns` | 0021 | — | A |
| `S-RET-DETAIL` actions | `POST /sales-returns/:id/inspect` · `/resolve` (+ `Idempotency-Key`) · `/cancel` | `InspectReturnDto {items:[{returnItemId,disposition,dispositionLocationId,notes?}]}` | `ReturnResponseDto` | `inventory.returns.manage` (inspect/resolve) + location auth; `sales.returns.create` (cancel) | `sales_return_items`,`inventory_movements` | 0021, 0024 | — | A |

## Import

| Screen | Endpoint(s) | Req DTO | Resp DTO | Permission | Entity | ADR | Ref | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `S-IMP-NEW` | `GET /imports/template` · `POST /imports` (multipart) · `POST /imports/:id/mapping`\|`/validate`\|`/confirm`\|`/cancel` · `GET /imports/:id/preview`\|`/rows`\|`/errors` | import DTOs (`duplicateHandlingMode`, `columnMapping`, …) | import job/row DTOs | `import.execute` (+ `import.inventory`) | `import_jobs`,`import_job_rows` | 0027, 0029 | `ImportDesktop` | A; progress polling = `GAP-IMPORT-PROGRESS` |
| `S-IMP-LIST/DETAIL/ROWS` | `GET /imports` · `GET /imports/:id`\|`/rows`\|`/errors` | `ListImportJobsQueryDto {page,pageSize,status?}` | `PaginatedResult<ImportJobResponseDto>` | `import.execute` | `import_jobs`,`import_job_rows` | 0027 | [017-A `REP-IMP-JOBS`](../reporting/reports.md#rep-imp-jobs--rep-imp-rows--rep-imp-errors) | A |
| `S-IMP-TEMPLATES` | `GET/POST/PATCH/DELETE /import-mapping-templates[/:id]` | template DTOs | template DTOs | `import.execute` | `import_mapping_templates` | 0027 | — | A |

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
