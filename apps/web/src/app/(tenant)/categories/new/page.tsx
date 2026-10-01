import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listCategories } from '../../../../lib/catalog/categories';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { CategoryForm } from '../category-form';

export const metadata = { title: 'Nueva categoría · SaaS Inventory' };

export default async function NewCategoryPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('categories.manage')) {
    return (
      <PageContainer>
        <PageHeader title="Nueva categoría" />
        <NoAccess message="Necesitas el permiso de gestión de categorías para crear categorías." />
      </PageContainer>
    );
  }

  const parents = await listCategories({ pageSize: 100, status: 'active' });

  return (
    <PageContainer>
      <PageHeader title="Nueva categoría" description="Agrega una categoría al catálogo." />
      <CategoryForm
        mode="create"
        parentOptions={parents.data.map((c) => ({ id: c.id, name: c.name }))}
      />
    </PageContainer>
  );
}
