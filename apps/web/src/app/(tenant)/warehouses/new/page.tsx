import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { WarehouseForm } from '../warehouse-form';

export const metadata = { title: 'New warehouse · SaaS Inventory' };

export default async function NewWarehousePage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('warehouses.manage')) {
    return (
      <PageContainer>
        <PageHeader title="New warehouse" />
        <NoAccess message="You need the manage-warehouses permission to create warehouses." />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        title="New warehouse"
        description="Add a site. Its default “General” location is created automatically."
      />
      <WarehouseForm mode="create" />
    </PageContainer>
  );
}
