import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { CustomerForm } from '../customer-form';

export const metadata = { title: 'New customer · SaaS Inventory' };

export default async function NewCustomerPage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('sales.customers.manage')) {
    return (
      <PageContainer>
        <PageHeader title="New customer" />
        <NoAccess message="You need the manage-customers permission to add a customer." />
      </PageContainer>
    );
  }
  return (
    <PageContainer>
      <PageHeader title="New customer" description="Add someone you sell to." />
      <CustomerForm mode="create" />
    </PageContainer>
  );
}
