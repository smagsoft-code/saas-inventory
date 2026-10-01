import Link from 'next/link';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listMappingTemplates } from '../../../../lib/imports/templates';
import { listCategories } from '../../../../lib/catalog/categories';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { MappingTemplates } from './mapping-templates';

export const metadata = { title: 'Plantillas de mapeo · SaaS Inventory' };

/**
 * Import mapping templates (`S-IMP-TEMPLATES`) — full CRUD on
 * `GET/POST/PATCH/DELETE /api/v1/import-mapping-templates[/:id]` (`import.execute`). A template is a
 * saved, reusable `{ excelHeader: targetField }` map ("Excel proveedor X"). DELETE is a real
 * endpoint here (unlike categories/customers), so a real Delete control is shown.
 */
export default async function MappingTemplatesPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('import.execute')) {
    return (
      <PageContainer>
        <PageHeader title="Plantillas de mapeo" />
        <NoAccess message="Necesitas el permiso de importación para administrar plantillas de mapeo." />
      </PageContainer>
    );
  }

  const [templates, categories] = await Promise.all([
    listMappingTemplates({ pageSize: 100 }),
    checker.can('categories.view') ? listCategories({ pageSize: 100 }).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="Plantillas de mapeo"
        description="Mapeos de columnas guardados — reutiliza el formato de hoja de cálculo de un proveedor sin volver a mapear cada importación."
      />

      <MappingTemplates
        initialTemplates={templates.data}
        categories={(categories?.data ?? [])
          .filter((c) => c.status === 'active')
          .map((c) => ({ id: c.id, name: c.name }))}
      />

      <p className="text-sm text-slate-500">
        <Link href="/imports" className="font-medium hover:underline">
          Volver a importaciones
        </Link>
      </p>
    </PageContainer>
  );
}
