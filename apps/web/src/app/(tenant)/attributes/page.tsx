import Link from 'next/link';
import { getSession } from '../../../lib/auth/session';
import { createPermissionChecker } from '../../../lib/auth/permissions';
import { listAttributeDefinitions } from '../../../lib/catalog/attributes';
import { ATTRIBUTE_DATA_TYPE_LABELS } from '../../../lib/types/catalog';
import { PageContainer } from '../../../components/ui/page-container';
import { PageHeader } from '../../../components/ui/page-header';
import { ButtonLink } from '../../../components/ui/button';
import { Badge, statusTone } from '../../../components/ui/badge';
import { EmptyState } from '../../../components/ui/empty-state';
import { NoAccess } from '../../../components/ui/no-access';
import { Table, TBody, TD, TH, THead, TR } from '../../../components/ui/table';

export const metadata = { title: 'Attributes · SaaS Inventory' };

type StatusFilter = 'active' | 'inactive' | undefined;

/**
 * Attribute-definition list (`S-CAT-ATTR-DEFS`) — `GET /api/v1/attribute-definitions`
 * (reads ride on `products.view`), a **plain array, not paginated** (governance table, bounded —
 * ADR-0026). `status` is the only filter the backend accepts (applied client-side over the small
 * set; no search / sort / pagination invented).
 */
export default async function AttributesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('products.view')) {
    return (
      <PageContainer>
        <PageHeader title="Attributes" />
        <NoAccess message="You need the catalogue-view permission to view attributes." />
      </PageContainer>
    );
  }
  const canManage = checker.can('catalog.attributes.manage');

  const sp = await searchParams;
  const status: StatusFilter =
    sp.status === 'active' || sp.status === 'inactive' ? sp.status : undefined;

  const all = await listAttributeDefinitions();
  const rows = status ? all.filter((d) => d.status === status) : all;

  const filters: { label: string; value: StatusFilter }[] = [
    { label: 'All', value: undefined },
    { label: 'Active', value: 'active' },
    { label: 'Inactive', value: 'inactive' },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Attributes"
        description="Reusable attribute definitions. Assign them to categories to give products structured fields."
        actions={canManage ? <ButtonLink href="/attributes/new">New attribute</ButtonLink> : undefined}
      />

      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const active = status === f.value;
          return (
            <Link
              key={f.label}
              href={f.value ? `/attributes?status=${f.value}` : '/attributes'}
              aria-current={active ? 'true' : undefined}
              className={
                active
                  ? 'rounded-full border border-slate-900 bg-slate-900 px-3 py-1 text-xs font-medium text-white'
                  : 'rounded-full border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50'
              }
            >
              {f.label}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        all.length === 0 ? (
          <EmptyState
            title="No attributes yet"
            description="Define an attribute like “Colour” or “Voltage” and assign it to a category."
            action={canManage ? <ButtonLink href="/attributes/new">New attribute</ButtonLink> : undefined}
          />
        ) : (
          <EmptyState title="No attributes match this filter" description="Try a different status." />
        )
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Name</TH>
              <TH>Code</TH>
              <TH>Type</TH>
              <TH>Applies to</TH>
              <TH>Required by default</TH>
              <TH>Status</TH>
              <TH className="w-0"><span className="sr-only">Actions</span></TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((def) => (
              <TR key={def.id}>
                <TD className="font-medium">{def.name}</TD>
                <TD className="text-slate-500"><code className="text-xs">{def.code}</code></TD>
                <TD>{ATTRIBUTE_DATA_TYPE_LABELS[def.dataType] ?? def.dataType}</TD>
                <TD className="text-slate-500">{def.appliesTo === 'variant' ? 'Variant' : 'Product'}</TD>
                <TD className="text-slate-500">{def.isRequiredDefault ? 'Yes' : 'No'}</TD>
                <TD><Badge tone={statusTone(def.status)}>{def.status}</Badge></TD>
                <TD>
                  <Link
                    href={`/attributes/${def.id}`}
                    className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                  >
                    {canManage ? 'Edit' : 'View'}
                  </Link>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </PageContainer>
  );
}
