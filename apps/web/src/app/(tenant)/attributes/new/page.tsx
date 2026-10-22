import { getSession } from '../../../../lib/auth/session';
import { createPermissionChecker } from '../../../../lib/auth/permissions';
import { listMeasurementUnits } from '../../../../lib/catalog/attributes';
import { PageContainer } from '../../../../components/ui/page-container';
import { PageHeader } from '../../../../components/ui/page-header';
import { NoAccess } from '../../../../components/ui/no-access';
import { AttributeForm } from '../attribute-form';

export const metadata = { title: 'Nuevo atributo · SaaS Inventory' };

export default async function NewAttributePage(): Promise<React.JSX.Element> {
  const session = await getSession();
  const checker = createPermissionChecker(session?.permissions ?? []);
  if (!checker.can('catalog.attributes.manage')) {
    return (
      <PageContainer>
        <PageHeader title="Nuevo atributo" />
        <NoAccess message="Necesitas el permiso de gestión de atributos para crear atributos." />
      </PageContainer>
    );
  }

  const units = await listMeasurementUnits();

  return (
    <PageContainer>
      <PageHeader
        title="Nuevo atributo"
        help="Define un atributo reutilizable. Asígnalo a categorías después."
      />
      <AttributeForm mode="create" units={units} />
    </PageContainer>
  );
}
