import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listQrCodes } from '../../../lib/catalog/qr-codes';
import { buildLocationIndex, shortId } from '../../../lib/inventory/location-index';
import {
  QR_TARGET_TYPES,
  QR_TARGET_TYPE_LABELS,
  isQrExpired,
  qrStatusTone,
  type QrTargetType,
} from '../../../lib/types/qr';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Pagination } from '../../../components/ui/pagination';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';
import { RevokeQrButton } from './revoke-qr-button';

export const metadata = { title: 'QR codes · SaaS Inventory' };

const PAGE_SIZE = 20;

function pick<T extends string>(allowed: readonly T[], value: string | undefined): T | undefined {
  return (allowed as readonly string[]).includes(value ?? '') ? (value as T) : undefined;
}

/**
 * `S-QR-LIST` — `GET /api/v1/qr-codes` (`catalog.qr.manage`), offset paginated. Real filter only:
 * `targetType` (chips). The DTO carries `code` (the opaque token on the physical label) + `targetId`
 * (a raw id — `GAP-NAME-ENRICHMENT`); a location id is named from the bounded `GET /locations`
 * fetch, a variant id shows short (no tenant-wide variant list — `GAP-VARIANT-LIST`). No QR bitmap
 * is rendered — the printable URL is `/q/<code>`.
 */
export default async function QrCodesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; targetType?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('catalog.qr.manage')) {
    return (
      <PageContainer>
        <PageHeader title="QR codes" />
        <NoAccess message="You need the QR management permission to view this page." />
      </PageContainer>
    );
  }

  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page) || 1);
  const targetType = pick(QR_TARGET_TYPES, sp.targetType);

  const [result, index] = await Promise.all([
    listQrCodes({ page, pageSize: PAGE_SIZE, ...(targetType ? { targetType } : {}) }),
    buildLocationIndex(checker.can('warehouses.view')),
  ]);

  function targetLabel(type: string, id: string): string {
    if (type === 'location') {
      return index.locationName(id);
    }
    return `Variant ${shortId(id)}`;
  }

  function buildHref(next: { page?: number; targetType?: QrTargetType | undefined }): string {
    const params = new URLSearchParams();
    const nextType = 'targetType' in next ? next.targetType : targetType;
    if (nextType) params.set('targetType', nextType);
    if (next.page && next.page > 1) params.set('page', String(next.page));
    return `/qr${params.toString() ? `?${params}` : ''}`;
  }

  return (
    <PageContainer>
      <PageHeader
        title="QR codes"
        description="Printable codes that resolve to a product variant or a location."
        actions={<ButtonLink href="/qr/new">Generate QR code</ButtonLink>}
      />

      <div className="flex flex-wrap gap-2">
        <Link
          href={buildHref({ targetType: undefined })}
          aria-current={!targetType ? 'true' : undefined}
          className={
            !targetType
              ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
              : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
          }
        >
          All targets
        </Link>
        {QR_TARGET_TYPES.map((type) => {
          const active = targetType === type;
          return (
            <Link
              key={type}
              href={buildHref({ targetType: type })}
              aria-current={active ? 'true' : undefined}
              className={
                active
                  ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
              }
            >
              {QR_TARGET_TYPE_LABELS[type]}
            </Link>
          );
        })}
      </div>

      {result.data.length === 0 ? (
        <EmptyState
          title={targetType ? 'No QR codes for this target type' : 'No QR codes yet'}
          description={
            targetType
              ? 'Try a different target type, or clear the filter.'
              : 'Generate a code to link a printed label to a variant or a location.'
          }
        />
      ) : (
        <>
          <Table>
            <THead>
              <TR>
                <TH>Code</TH>
                <TH>Target</TH>
                <TH>Type</TH>
                <TH>Status</TH>
                <TH>Expires</TH>
                <TH className="w-0">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {result.data.map((qr) => {
                const expired = isQrExpired(qr);
                return (
                  <TR key={qr.id}>
                    <TD>
                      <code className="text-xs text-slate-700">{qr.code}</code>
                    </TD>
                    <TD className="text-slate-700">{targetLabel(qr.targetType, qr.targetId)}</TD>
                    <TD className="text-slate-500">
                      {QR_TARGET_TYPE_LABELS[qr.targetType as QrTargetType] ?? qr.targetType}
                    </TD>
                    <TD>
                      <Badge tone={qrStatusTone(qr.status)}>{qr.status}</Badge>
                      {expired && qr.status === 'active' && (
                        <Badge tone="warning" className="ml-2">
                          expired
                        </Badge>
                      )}
                    </TD>
                    <TD className="whitespace-nowrap text-slate-500">
                      {qr.expiresAt ? new Date(qr.expiresAt).toLocaleDateString() : '—'}
                    </TD>
                    <TD>
                      {qr.status === 'active' ? (
                        <RevokeQrButton id={qr.id} />
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
          <Pagination
            page={result.meta.page}
            pageSize={result.meta.pageSize}
            total={result.meta.total}
            totalPages={result.meta.totalPages}
            buildHref={(nextPage) => buildHref({ page: nextPage })}
          />
        </>
      )}
    </PageContainer>
  );
}
