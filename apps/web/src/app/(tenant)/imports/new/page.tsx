import Link from 'next/link';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listMappingTemplates } from '../../../../lib/imports/templates';
import { listLocations } from '../../../../lib/inventory/locations';
import { listCategories } from '../../../../lib/catalog/categories';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { ImportUploadForm } from './import-upload-form';

export const metadata = { title: 'New import · SaaS Inventory' };

/**
 * Start an import (`S-IMP-NEW`) — the upload step of the staged pipeline. `import.execute` gates
 * everything; `import.inventory` is only checked later, at confirm, for `update_catalog_and_inventory`.
 * The mapping must be chosen up front (there is no endpoint that returns an uploaded file's parsed
 * headers — `GAP-IMPORT-FILE-HEADERS`), either as a saved template or the standard downloadable-
 * template layout. Everything else (validate / review / confirm) happens on the detail page.
 */
export default async function NewImportPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('import.execute')) {
    return (
      <PageContainer>
        <PageHeader title="New import" />
        <NoAccess message="You need the import permission to start an import." />
      </PageContainer>
    );
  }
  const canUseInventoryMode = checker.can('import.inventory');

  const [templates, locations, categories] = await Promise.all([
    listMappingTemplates({ pageSize: 100 }).catch(() => null),
    checker.can('locations.view') ? listLocations({ pageSize: 100 }).catch(() => null) : Promise.resolve(null),
    checker.can('categories.view') ? listCategories({ pageSize: 100 }).catch(() => null) : Promise.resolve(null),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title="New import"
        description="Upload an .xlsx file, choose how its columns map to product fields, then validate and review before anything is written."
      />

      <ImportUploadForm
        canUseInventoryMode={canUseInventoryMode}
        templates={(templates?.data ?? []).map((t) => ({ id: t.id, name: t.name }))}
        locations={(locations?.data ?? [])
          .filter((l) => l.status === 'active')
          .map((l) => ({ id: l.id, name: l.name }))}
        categories={(categories?.data ?? [])
          .filter((c) => c.status === 'active')
          .map((c) => ({ id: c.id, name: c.name }))}
      />

      <p className="text-sm text-slate-500">
        <Link href="/imports/templates" className="font-medium hover:underline">
          Manage mapping templates
        </Link>{' '}
        · {' '}
        <Link href="/imports" className="font-medium hover:underline">
          Back to imports
        </Link>
      </p>
    </PageContainer>
  );
}
