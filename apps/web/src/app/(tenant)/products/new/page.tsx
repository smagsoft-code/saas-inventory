import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { serverApiFetch } from '../../../../lib/api/server';
import { apiPublicUrl } from '../../../../lib/api/public-url';
import { listCategories } from '../../../../lib/catalog/categories';
import { listAttributeDefinitions } from '../../../../lib/catalog/attributes';
import { loadCategoryAttributeFieldSets } from '../../../../lib/catalog/product-attributes';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { ProductForm } from '../product-form';

export const metadata = { title: 'Nuevo producto · SaaS Inventory' };

export default async function NewProductPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('products.manage')) {
    return (
      <PageContainer>
        <PageHeader title="Nuevo producto" />
        <NoAccess message="Necesitas el permiso de gestión de productos para crear productos." />
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
        title="Nuevo producto"
        help="Agrega un producto y su primera variante. Al crearlo puedes subir una imagen y se genera un código QR automáticamente."
      />
      <ProductForm
        mode="create"
        categories={categories.data.map((c) => ({ id: c.id, name: c.name }))}
        definitions={definitions}
        initialFieldSets={initialFieldSets}
        apiPublicUrl={apiPublicUrl()}
        canAddStock={checker.can('inventory.adjust')}
      />
    </PageContainer>
  );
}
