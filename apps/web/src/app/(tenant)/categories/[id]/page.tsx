import { notFound } from 'next/navigation';
import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { isApiError } from '../../../../lib/api/errors';
import { getCategory, getCategoryAttributes, listCategories } from '../../../../lib/catalog/categories';
import { listAttributeDefinitions } from '../../../../lib/catalog/attributes';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { Card, CardBody } from '../../../../components/ui/card';
import { Badge, statusTone } from '../../../../components/ui/badge';
import { NoAccess } from '../../../../components/ui/no-access';
import { CategoryForm } from '../category-form';
import { CategoryAttributesEditor } from './category-attributes-editor';

export const metadata = { title: 'Categoría · SaaS Inventory' };

export default async function CategoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('categories.view')) {
    return (
      <PageContainer>
        <PageHeader title="Categoría" />
        <NoAccess message="Necesitas el permiso de categorías para ver esta página." />
      </PageContainer>
    );
  }
  const canManageCategory = checker.can('categories.manage');
  const canManageAttributes = checker.can('catalog.attributes.manage');
  const canViewAttributes = checker.can('products.view');

  let category;
  try {
    category = await getCategory(id);
  } catch (error) {
    if (isApiError(error) && error.status === 404) {
      notFound();
    }
    throw error;
  }

  const [parents, assigned, definitions] = await Promise.all([
    listCategories({ pageSize: 100, status: 'active' }),
    canViewAttributes ? getCategoryAttributes(id) : Promise.resolve([]),
    canViewAttributes ? listAttributeDefinitions() : Promise.resolve([]),
  ]);

  return (
    <PageContainer>
      <PageHeader
        title={category.name}
        description={`/${category.slug}`}
        actions={
          <Badge tone={statusTone(category.status)}>
            {category.status === 'active' ? 'Activa' : category.status === 'inactive' ? 'Inactiva' : category.status}
          </Badge>
        }
      />

      <Card>
        <CardBody className="flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-slate-900">Detalles</h2>
          {canManageCategory ? (
            <CategoryForm
              mode="edit"
              category={category}
              parentOptions={parents.data.map((c) => ({ id: c.id, name: c.name }))}
            />
          ) : (
            <dl className="grid max-w-md grid-cols-[8rem_1fr] gap-y-2 text-sm">
              <dt className="text-slate-500">Nombre</dt>
              <dd className="text-slate-900">{category.name}</dd>
              <dt className="text-slate-500">Slug</dt>
              <dd className="text-slate-900"><code className="text-xs">{category.slug}</code></dd>
              <dt className="text-slate-500">Padre</dt>
              <dd className="text-slate-900">
                {category.parentCategoryId
                  ? parents.data.find((c) => c.id === category.parentCategoryId)?.name ?? 'Subcategoría'
                  : '—'}
              </dd>
            </dl>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Atributos</h2>
            <p className="mt-1 text-sm text-slate-500">
              Las definiciones de atributos que llevan los productos de esta categoría (ADR-0026). El
              orden y «obligatorio» aquí determinan el formulario de producto.
            </p>
          </div>
          {canViewAttributes ? (
            <CategoryAttributesEditor
              categoryId={category.id}
              assigned={assigned}
              definitions={definitions}
              canManage={canManageAttributes}
            />
          ) : (
            <p className="text-sm text-slate-500">
              No tienes permiso para ver las asignaciones de atributos.
            </p>
          )}
        </CardBody>
      </Card>
    </PageContainer>
  );
}
