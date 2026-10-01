import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { CustomerForm } from '../customer-form';

export const metadata = { title: 'Nuevo cliente · SaaS Inventory' };

export default async function NewCustomerPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.customers.manage')) {
    return (
      <PageContainer>
        <PageHeader title="Nuevo cliente" />
        <NoAccess message="Necesitas el permiso de gestión de clientes para agregar un cliente." />
      </PageContainer>
    );
  }
  return (
    <PageContainer>
      <PageHeader title="Nuevo cliente" description="Agrega a alguien a quien le vendes." />
      <CustomerForm mode="create" />
    </PageContainer>
  );
}
