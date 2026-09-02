import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { serverApiFetch } from '../../../../lib/api/server';
import { listCategories } from '../../../../lib/catalog/categories';
import { listAttributeDefinitions } from '../../../../lib/catalog/attributes';
import { loadCategoryAttributeFieldSets } from '../../../../lib/catalog/product-attributes';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { ProductForm } from '../product-form';

export const metadata = { title: 'New product · SaaS Inventory' };

export default async function NewProductPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('products.manage')) {
    return (
      <PageContainer>
        <PageHeader title="New product" />
        <NoAccess message="You need the manage-products permission to create products." />
      </PageContainer>
    );
  }

  const [categories, definitions] = await Promise.all([
    listCategories({ pageSize: 100, status: 'active' }),
    listAttributeDefinitions(),
  ]);
  // No category is selected initially, so there are no dynamic fields yet.
  const initialFieldSets = await loadCategoryAttributeFieldSets(
    (path) => serverApiFetch(path),
    undefined,
    definitions,
  );

  return (
    <PageContainer>
      <PageHeader
        title="New product"
        description="Add a product and its first variant. Category attributes appear once you pick a category."
      />
      <ProductForm
        mode="create"
        categories={categories.data.map((c) => ({ id: c.id, name: c.name }))}
        definitions={definitions}
        initialFieldSets={initialFieldSets}
      />
    </PageContainer>
  );
}
