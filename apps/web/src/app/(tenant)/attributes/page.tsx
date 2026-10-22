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

export const metadata = { title: 'Atributos · SaaS Inventory' };

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
        <PageHeader title="Atributos" />
        <NoAccess message="Necesitas el permiso de vista del catálogo para ver los atributos." />
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
    { label: 'Todos', value: undefined },
    { label: 'Activos', value: 'active' },
    { label: 'Inactivos', value: 'inactive' },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Atributos"
        help="Definiciones de atributos reutilizables. Asígnalas a categorías para dar a los productos campos estructurados."
        actions={canManage ? <ButtonLink href="/attributes/new">Nuevo atributo</ButtonLink> : undefined}
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
            title="Aún no hay atributos"
            description="Define un atributo como «Color» o «Voltaje» y asígnalo a una categoría."
            action={canManage ? <ButtonLink href="/attributes/new">Nuevo atributo</ButtonLink> : undefined}
          />
        ) : (
          <EmptyState title="Ningún atributo coincide con este filtro" description="Prueba con otro estado." />
        )
      ) : (
        <Table>
          <THead>
            <TR>
              <TH>Nombre</TH>
              <TH>Código</TH>
              <TH>Tipo</TH>
              <TH>Aplica a</TH>
              <TH>Obligatorio por defecto</TH>
              <TH>Estado</TH>
              <TH className="w-0"><span className="sr-only">Acciones</span></TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((def) => (
              <TR key={def.id}>
                <TD className="font-medium">{def.name}</TD>
                <TD className="text-slate-500"><code className="text-xs">{def.code}</code></TD>
                <TD>{ATTRIBUTE_DATA_TYPE_LABELS[def.dataType] ?? def.dataType}</TD>
                <TD className="text-slate-500">{def.appliesTo === 'variant' ? 'Variante' : 'Producto'}</TD>
                <TD className="text-slate-500">{def.isRequiredDefault ? 'Sí' : 'No'}</TD>
                <TD>
                  <Badge tone={statusTone(def.status)}>
                    {def.status === 'active' ? 'Activo' : def.status === 'inactive' ? 'Inactivo' : def.status}
                  </Badge>
                </TD>
                <TD>
                  <Link
                    href={`/attributes/${def.id}`}
                    className="text-sm font-medium text-slate-700 underline-offset-2 hover:underline"
                  >
                    {canManage ? 'Editar' : 'Ver'}
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
