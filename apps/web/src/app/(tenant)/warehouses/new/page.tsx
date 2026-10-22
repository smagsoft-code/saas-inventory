import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { WarehouseForm } from '../warehouse-form';

export const metadata = { title: 'Nueva sucursal · SaaS Inventory' };

export default async function NewWarehousePage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('warehouses.manage')) {
    return (
      <PageContainer>
        <PageHeader title="Nueva sucursal" />
        <NoAccess message="Necesitas el permiso de gestión de sucursales para crear sucursales." />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="Nueva sucursal"
        help="Agrega un sitio. Su almacén «General» se crea automáticamente."
      />
      <WarehouseForm mode="create" />
    </PageContainer>
  );
}
