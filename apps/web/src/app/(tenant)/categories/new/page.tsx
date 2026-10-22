import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { getNextCategoryCode, listCategories } from '../../../../lib/catalog/categories';
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

  const [parents, suggestedCode] = await Promise.all([
    listCategories({ pageSize: 100, status: 'active' }),
    // A failed preview just leaves the code empty — an untouched code is assigned by the server anyway.
    getNextCategoryCode().catch(() => ''),
  ]);

  return (
    <PageContainer>
      <PageHeader title="Nueva categoría" help="Agrega una categoría al catálogo." />
      <CategoryForm
        mode="create"
        parentOptions={parents.data.map((c) => ({ id: c.id, name: c.name }))}
        suggestedCode={suggestedCode}
      />
    </PageContainer>
  );
}
