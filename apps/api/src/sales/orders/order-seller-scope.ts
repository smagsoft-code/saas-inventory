/**
 * The seller-scope rule of `sales.orders.view_all`, in ONE place.
 *
 * Without `sales.orders.view_all` a seller only ever sees the orders they placed themselves; with it they
 * see every seller's orders of their tenant (never another tenant's). An order the caller may not see
 * answers `404` like any other missing resource.
 *
 * The rule governs every route that NAMES an existing order, not just the reads — otherwise a seller could
 * act on a document they cannot even open (FINDING-VA-WRITE-SCOPE, FINDING-SELLER-SCOPE-APPROVALS-RETURNS):
 * order confirm / cancel, `POST /price-approvals` (request an approval for a line of the order) and
 * `POST /sales-returns` + its cancel (a return traced to the order). It is deliberately only about WHO PLACED
 * the order: the functional permission (`sales.orders.create`, `pricing.discount.request`,
 * `sales.returns.create`, …) is still required separately — `view_all` alone grants no action.
 */
export const VIEW_ALL_ORDERS_PERMISSION = 'sales.orders.view_all';

/**
 * READ scope of the two order-derived queues (owner decision, 2026-10-26).
 *
 * A price-approval request and a sales return belong to an order, so a seller without `sales.orders.view_all` only reads those
 * of the orders THEY placed — lists and lookups by id alike; anything else answers like a missing resource (404 / absent from
 * the list and its totals). Two functional roles keep the operational view they need, regardless of who placed the order:
 *  - the **approvers** (`pricing.discount.approve`) read the whole approvals queue — it is their work queue;
 *  - the **warehouse** (`inventory.returns.manage`, the holders of inspect/resolve) read every return — they process them.
 * `sales.orders.view_all` widens the read of both (it is the "see every seller's documents" permission) but, as everywhere,
 * grants no action. The location scope (ADR-0024/0035) and the tenant boundary still apply on top. No new permission is introduced.
 */
export const APPROVER_PERMISSION = 'pricing.discount.approve';
export const RETURNS_WORKFLOW_PERMISSION = 'inventory.returns.manage';

export function canReadAllApprovals(permissions: string[]): boolean {
  return permissions.includes(APPROVER_PERMISSION) || permissions.includes(VIEW_ALL_ORDERS_PERMISSION);
}

export function canReadAllReturns(permissions: string[]): boolean {
  return permissions.includes(RETURNS_WORKFLOW_PERMISSION) || permissions.includes(VIEW_ALL_ORDERS_PERMISSION);
}

export function canSeeOrderOfSeller(order: { placedByUserId: string | null }, actorId: string, permissions: string[]): boolean {
  return permissions.includes(VIEW_ALL_ORDERS_PERMISSION) || order.placedByUserId === actorId;
}
