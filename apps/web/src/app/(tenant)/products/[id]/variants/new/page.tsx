import { notFound } from 'next/navigation';
import { getSession } from '../../../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../../../lib/auth/permissions';
import { isApiError } from '../../../../../../lib/api/errors';
import { serverApiFetch } from '../../../../../../lib/api/server';
import { getProduct } from '../../../../../../lib/catalog/products';
import { listAttributeDefinitions } from '../../../../../../lib/catalog/attributes';
import { loadCategoryAttributeFieldSets } from '../../../../../../lib/catalog/product-attributes';
import { apiPublicUrl } from '../../../../../../lib/api/public-url';
import { PageContainer } from '../../../../../../components/ui/page-container';
import { PageHeader } from '../../../../../../components/ui/page-header';
import { NoAccess } from '../../../../../../components/ui/no-access';
import { VariantForm } from '../../variant-form';

export const metadata = { title: 'Nueva variante · SaaS Inventory' };

export default async function NewVariantPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('products.manage')) {
    return (
      <PageContainer>
        <PageHeader title="Nueva variante" />
        <NoAccess message="Necesitas el permiso de gestión de productos para agregar variantes." />
      </PageContainer>
    );
  }

  let product;
  try {
    product = await getProduct(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const canViewCategories = checker.can('categories.view');
  const definitions = canViewCategories ? await listAttributeDefinitions() : [];
  const fieldSets = canViewCategories
    ? await loadCategoryAttributeFieldSets((path) => serverApiFetch(path), product.categoryId, definitions)
    : { product: [], variant: [], options: {} };

  return (
    <PageContainer>
      <PageHeader title="Nueva variante" description={`Agrega una variante a ${product.name}.`} />
      <VariantForm
        mode="create"
        productId={id}
        variantFields={fieldSets.variant}
        optionsByDefinitionId={fieldSets.options}
        canViewFloor={checker.can('pricing.floor.view')}
        canViewCost={checker.can('pricing.cost.view')}
        totalPhysicalStock={null}
        {...(product.categoryId ? { categoryId: product.categoryId } : {})}
        apiPublicUrl={apiPublicUrl()}
      />
    </PageContainer>
  );
}
