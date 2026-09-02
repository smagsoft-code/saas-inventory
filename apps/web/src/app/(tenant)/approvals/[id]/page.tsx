import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { getPriceApproval } from '../../../../lib/sales/price-approvals';
import { getOrder } from '../../../../lib/sales/orders';
import { shortId } from '../../../../lib/inventory/location-index';
import {
  PRICE_APPROVAL_STATUS_LABELS,
  priceApprovalStatusTone,
  type PriceApprovalStatus,
} from '../../../../lib/types/sales';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { Badge } from '../../../../components/ui/badge';
import { NoAccess } from '../../../../components/ui/no-access';
import { ApprovalActions } from './approval-actions';

export const metadata = { title: 'Approval · SaaS Inventory' };

/**
 * Price-approval detail (`S-APPROVAL-DETAIL`) — `GET /api/v1/price-approvals/:id`
 * (`pricing.discount.request` **or** `pricing.discount.approve`). Resolving needs
 * `pricing.discount.approve` and is refused for the requester's own request (server-enforced).
 * `minPriceAtRequest` is only present for a caller with `pricing.floor.view`.
 */
export default async function ApprovalDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.canAny(['pricing.discount.request', 'pricing.discount.approve'])) {
    return (
      <PageContainer>
        <PageHeader title="Approval" />
        <NoAccess message="You need a pricing-discount permission to view this request." />
      </PageContainer>
    );
  }
  const canResolve = checker.can('pricing.discount.approve');

  let approval;
  try {
    approval = await getPriceApproval(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  // The order's number + the specific line, for context. Best-effort — a caller without
  // `sales.orders.view` gets a 403 here, which is fine (the ids still link).
  const order = await getOrder(approval.orderId).catch(() => null);
  const line = order?.items.find((item) => item.id === approval.orderItemId) ?? null;
  const isOwnRequest = approval.requestedBy === session?.id;

  return (
    <PageContainer>
      <PageHeader
        title={`Approval ${shortId(approval.id)}`}
        description="Exceptional-discount request"
        actions={
          <Badge tone={priceApprovalStatusTone(approval.status)}>
            {PRICE_APPROVAL_STATUS_LABELS[approval.status as PriceApprovalStatus] ?? approval.status}
          </Badge>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <dl className="grid max-w-lg grid-cols-[10rem_1fr] gap-y-2 text-sm">
            <dt className="text-slate-500">Order</dt>
            <dd className="text-slate-900">
              <Link href={`/sales/${approval.orderId}`} className="font-medium underline underline-offset-2">
                {order ? order.orderNumber : shortId(approval.orderId)}
              </Link>
            </dd>
            <dt className="text-slate-500">Line</dt>
            <dd className="text-slate-900">
              {line ? (
                <>
                  <span className="font-medium">{line.sku}</span>
                  <span className="text-slate-500"> · {line.productName}</span>
                  <span className="text-slate-500"> · qty {line.quantity}</span>
                </>
              ) : (
                <code className="text-xs text-slate-500">{shortId(approval.orderItemId)}</code>
              )}
            </dd>
            <dt className="text-slate-500">Requested price</dt>
            <dd className="text-slate-900">{approval.requestedPrice.toFixed(2)}</dd>
            <dt className="text-slate-500">Reference (max) price</dt>
            <dd className="text-slate-900">{approval.maxPriceAtRequest.toFixed(2)}</dd>
            {approval.minPriceAtRequest !== undefined && (
              <>
                <dt className="text-slate-500">Floor (min) price</dt>
                <dd className="text-slate-900">{approval.minPriceAtRequest.toFixed(2)}</dd>
              </>
            )}
            <dt className="text-slate-500">Discount amount</dt>
            <dd className="text-slate-900">{approval.discountAmount.toFixed(2)}</dd>
            <dt className="text-slate-500">Reason</dt>
            <dd className="whitespace-pre-wrap text-slate-900">{approval.reason}</dd>
            <dt className="text-slate-500">Requested by</dt>
            <dd className="text-slate-900">
              <code className="text-xs">{shortId(approval.requestedBy)}</code>
              {isOwnRequest && <span className="text-slate-500"> · you</span>}
            </dd>
            <dt className="text-slate-500">Requested at</dt>
            <dd className="text-slate-900">{new Date(approval.requestedAt).toLocaleString()}</dd>
            {approval.approvedBy && (
              <>
                <dt className="text-slate-500">Resolved by</dt>
                <dd className="text-slate-900">
                  <code className="text-xs">{shortId(approval.approvedBy)}</code>
                </dd>
              </>
            )}
            {approval.resolvedAt && (
              <>
                <dt className="text-slate-500">Resolved at</dt>
                <dd className="text-slate-900">{new Date(approval.resolvedAt).toLocaleString()}</dd>
              </>
            )}
          </dl>

          <ApprovalActions
            approvalId={approval.id}
            status={approval.status}
            canResolve={canResolve}
            isOwnRequest={isOwnRequest}
          />
        </CardBody>
      </Card>

      <div className="flex gap-4 text-sm">
        <Link href="/approvals" className="font-medium text-slate-500 hover:underline">
          All approvals
        </Link>
        <Link href={`/sales/${approval.orderId}`} className="font-medium text-slate-500 hover:underline">
          Order {order ? order.orderNumber : shortId(approval.orderId)}
        </Link>
      </div>
    </PageContainer>
  );
}
